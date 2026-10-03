const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DecoderClient } = require('../miniprogram/services/decoder-client');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('only one camera frame can be in flight; late replies after dispose are ignored', async () => {
  let listener;
  let frames = 0;
  const messages = [];
  const fake = {
    onMessage(callback) { listener = callback; },
    postMessage(message) {
      messages.push(message);
      if (message.type === 'init') queueMicrotask(() => listener({ id: message.id, type: 'ready' }));
    }, terminate() {}
  };
  const client = new DecoderClient({ createWorker: () => fake }, () => frames++, () => assert.fail('unexpected fatal error'));
  await client.start(68);
  const frame = { width: 100, height: 100, data: new ArrayBuffer(40000) };
  assert.equal(client.pushFrame(frame), true);
  assert.equal(client.pushFrame(frame), false);
  listener({ id: messages.at(-1).id, type: 'frame', result: {} });
  await tick();
  assert.equal(frames, 1);
  assert.equal(client.pushFrame(frame), true);
  const last = messages.at(-1).id;
  client.dispose();
  listener({ id: last, type: 'frame', result: { complete: true } });
  await tick();
  assert.equal(frames, 1);
  assert.equal(client.pushFrame(frame), false);
});

test('worker failure rejects pending reads and reports a recoverable session failure', async () => {
  let listener, onError;
  let error;
  const fake = { onMessage(callback) { listener = callback; }, onError(callback) { onError = callback; },
    postMessage(message) { if (message.type === 'init') queueMicrotask(() => listener({ id: message.id, type: 'ready' })); }, terminate() {} };
  const client = new DecoderClient({ createWorker: () => fake }, () => {}, failure => { error = failure; });
  await client.start(68);
  const chunk = client.readChunk(0, 10);
  onError({ error: { message: 'worker killed' } });
  await assert.rejects(chunk);
  assert.equal(error.message, 'worker killed');
  assert.equal(client.closed, true);
});

test('iOS requests an experimental Worker and direct requests contain only dimensions', async () => {
  let listener, frameReply, options;
  const messages = [];
  const fake = { onMessage(fn) { listener = fn; }, terminate() {},
    postMessage(message) {
      messages.push(message);
      if (message.type === 'init') queueMicrotask(() => listener({ id: message.id, type: 'ready', directCamera: true }));
      else frameReply = () => listener({ id: message.id, type: 'frame', result: { progress: 15 }, metrics: { heapBytes: 33554432 } });
    } };
  let settled = 0;
  const client = new DecoderClient({ getDeviceInfo: () => ({ platform: 'ios' }),
    createWorker(file, opts) { options = opts; return fake; } }, () => {}, error => assert.fail(error));
  await client.start(68);
  assert.equal(options.useExperimentalWorker, true);
  assert.equal(client.directCamera, true);
  for (let i = 0; i < 300; i++) {
    assert.equal(client.pullCameraFrame(1080, 1920, () => settled++), true);
    assert.equal(client.pullCameraFrame(1080, 1920), false);
    assert.deepEqual(Object.keys(messages.at(-1)).sort(), ['height', 'id', 'type', 'width']);
    assert.equal(client.pending.size, 1);
    frameReply(); await tick();
    assert.equal(client.pending.size, 0);
  }
  assert.equal(settled, 300);
  assert.equal(client.lastMetrics.heapBytes, 33554432);
  client.dispose();
});

test('failed iOS experimental WASM initialization terminates it before ordinary fallback', async () => {
  const order = [];
  const client = new DecoderClient({ getDeviceInfo: () => ({ platform: 'ios' }),
    createWorker(file, options) {
      order.push(options.useExperimentalWorker ? 'create-experimental' : 'create-ordinary');
      let receive;
      return { onMessage(fn) { receive = fn; }, terminate() { order.push('terminate'); },
        postMessage(message) { queueMicrotask(() => receive(options.useExperimentalWorker ?
          { id: message.id, type: 'error', message: 'WXWebAssembly not available' } :
          { id: message.id, type: 'ready', directCamera: true })); } };
    } }, () => {}, error => assert.fail(error));
  await client.start(68);
  assert.deepEqual(order, ['create-experimental', 'terminate', 'create-ordinary']);
  assert.equal(client.ready, true);
  assert.equal(client.directCamera, false, 'ordinary Workers must never bind the iOS-only direct camera');
  assert.equal(client.experimental, false);
  client.dispose();
});

test('stopping during experimental initialization must not create a fallback Worker', async () => {
  let creates = 0, terminated = 0;
  const client = new DecoderClient({ getDeviceInfo: () => ({ platform: 'ios' }), createWorker() {
    creates++;
    return { onMessage() {}, postMessage() {}, terminate() { terminated++; } };
  } }, () => {}, error => assert.fail(error));
  const starting = client.start(68);
  client.dispose();
  await assert.rejects(starting, /停止/);
  assert.equal(creates, 1);
  assert.equal(terminated, 1);
});

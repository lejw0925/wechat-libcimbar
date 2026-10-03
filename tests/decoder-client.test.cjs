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

test('diagnostics separate Worker round trip, decode cost and frame cadence without counting paused time', async () => {
  let now = 0, listener, pendingFrame;
  const fake = { onMessage(fn) { listener = fn; }, terminate() {}, postMessage(message) {
    if (message.type === 'init') queueMicrotask(() => listener({ id: message.id, type: 'ready' }));
    else if (message.type === 'release-frame') queueMicrotask(() => listener({ id: message.id, type: 'released' }));
    else pendingFrame = message;
  } };
  const client = new DecoderClient({ createWorker: () => fake }, () => {}, error => assert.fail(error), () => now);
  await client.start(68);
  const reply = async (at, elapsed) => {
    now = at;
    listener({ id: pendingFrame.id, type: 'frame', result: { progress: 15 }, elapsed, metrics: { heapBytes: 33554432 } });
    await tick();
  };
  client.pullCameraFrame(720, 1280); await reply(45, 30);
  assert.equal(client.lastMetrics.roundTripMs, 45);
  assert.equal(client.lastMetrics.workerElapsedMs, 30);
  assert.equal(client.lastMetrics.frameIntervalMs, undefined);
  now = 250; client.pullCameraFrame(720, 1280); await reply(290, 28);
  assert.equal(client.lastMetrics.frameIntervalMs, 245);
  // Pause with one frame in flight, then resume much later.
  now = 500; client.pullCameraFrame(720, 1280); client.releaseFrameBuffer(); await reply(545, 30);
  assert.equal(client.lastMetrics.frameIntervalMs, undefined);
  now = 90000; client.pullCameraFrame(720, 1280); await reply(90040, 28);
  assert.equal(client.lastMetrics.frameIntervalMs, undefined);
  now = 90250; client.pullCameraFrame(720, 1280); await reply(90295, 31);
  assert.equal(client.lastMetrics.frameIntervalMs, 255);
  assert.equal(client.lastMetrics.heapBytes, 33554432);
  client.dispose();
});

test('square messages carry fewer pixels while diagnostics preserve raw dimensions and fresh reply timings', async () => {
  let now = 0, listener, request;
  const settled = [];
  const fake = { onMessage(fn) { listener = fn; }, terminate() {}, postMessage(message) {
    if (message.type === 'init') queueMicrotask(() => listener({ id: message.id, type: 'ready' }));
    else request = message;
  } };
  const client = new DecoderClient({ createWorker: () => fake }, () => {}, error => assert.fail(error), () => now);
  const { FrameCropper } = require('../miniprogram/services/frame-cropper');
  const prepared = new FrameCropper().prepare({ width: 720, height: 1280, data: new ArrayBuffer(3686400) });
  await client.start(68);
  client.pushFrame(prepared.frame, metrics => settled.push(metrics), { ...prepared.metrics, cropMs: 2 });
  assert.equal(request.frame.data.byteLength, 2073600);
  assert.deepEqual(Object.keys(request.frame).sort(), ['data', 'height', 'width']);
  now = 35;
  listener({ id: request.id, type: 'frame', result: {}, elapsed: 25,
    metrics: { width: 720, height: 720, inputBytes: 2073600, cropLeft: 0, cropTop: 0, decodeWidth: 720, decodeHeight: 720 } });
  await tick();
  assert.equal(settled[0].height, 1280); assert.equal(settled[0].inputBytes, 3686400);
  assert.equal(settled[0].postBytes, 2073600); assert.equal(settled[0].cropTop, 280);
  assert.equal(settled[0].cropMs, 2); assert.equal(settled[0].roundTripMs, 35);
  assert.equal(settled[0].workerElapsedMs, 25);
  assert.equal(settled[0].cropBufferBytes, 2073600);
  client.pullCameraFrame(720, 1280, metrics => settled.push(metrics));
  listener({ id: request.id, type: 'frame', directUnavailable: false }); await tick();
  assert.equal(settled[1], null, 'empty direct replies must not reuse the last successful timing');
  client.dispose();
});

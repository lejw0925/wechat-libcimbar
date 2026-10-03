const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CameraSource, FRAME_INTERVAL } = require('../miniprogram/services/camera-source');

function harness(direct = false) {
  let now = 0, sequence = 0, callback, settled, enabled = false;
  const timers = new Map(), starts = [], stops = [], submissions = [];
  const timing = {
    now: () => now,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const listener = {
    start(options) { starts.push(options); enabled = true; if (options.success) options.success(); },
    stop(options) { stops.push(options); enabled = false; if (options.success) options.success(); }
  };
  const camera = { onCameraFrame(fn) { callback = fn; return listener; } };
  const client = {
    busy: false, directCamera: direct, worker: {},
    pushFrame(frame, done) {
      assert.equal(enabled, false, 'native frame delivery must be stopped before copying');
      assert.equal(this.busy, false);
      this.busy = true; submissions.push(frame); settled = done; return true;
    },
    pullCameraFrame(width, height, done) {
      assert.equal(this.busy, false);
      this.busy = true; submissions.push({ width, height }); settled = done; return true;
    }
  };
  const errors = [];
  const source = new CameraSource(camera, client, error => errors.push(error), timing);
  return { source, client, listener, starts, stops, submissions, timers, errors,
    frame() { callback({ width: 1024, height: 1024, data: new ArrayBuffer(1024 * 1024 * 4) }); },
    settle() { client.busy = false; settled(); },
    next() {
      const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(id); now = task.at; task.fn();
    },
    get now() { return now; }
  };
}

test('copied frames stop the native listener until decode completes, with a 4 fps ceiling', () => {
  const h = harness();
  h.source.start();
  h.frame();
  assert.equal(h.submissions.length, 1);
  for (let i = 0; i < 20; i++) h.frame(); // Late callbacks are ignored, not queued.
  assert.equal(h.submissions.length, 1);
  assert.equal(h.timers.size, 0, 'no capture can be scheduled while decode is busy');
  h.settle();
  assert.equal(h.starts.length, 1);
  h.next();
  assert.equal(h.now, FRAME_INTERVAL);
  assert.equal(h.starts.length, 2);
  h.frame();
  assert.equal(h.submissions.length, 2);
  h.source.stop();
  h.settle();
  assert.equal(h.timers.size, 0, 'late completion must not restart a stopped camera');
  assert.deepEqual(h.errors, []);
});

test('iOS bootstraps only dimensions, then sends no pixel buffers to the Worker', () => {
  const h = harness(true);
  h.source.start();
  h.frame();
  assert.equal(h.submissions.length, 0, 'bootstrap pixels are not posted');
  assert.equal(h.starts.at(-1).worker, h.client.worker);
  assert.equal(h.source.transport, 'ios-worker-camera');
  h.next();
  assert.deepEqual(h.submissions, [{ width: 1024, height: 1024 }]);
  assert.equal(h.timers.size, 0);
  h.frame();
  assert.equal(h.submissions.length, 1);
  h.settle();
  h.next();
  assert.equal(h.submissions.length, 2);
  h.source.stop();
  h.settle();
  assert.equal(h.timers.size, 0);
});

test('an unsupported direct camera binding falls back to sampled copying', () => {
  const h = harness(true);
  const start = h.listener.start;
  h.listener.start = options => {
    if (options.worker) options.fail(new Error('not supported'));
    else start(options);
  };
  h.source.start();
  h.frame();
  assert.equal(h.client.directCamera, false);
  assert.equal(h.source.transport, 'sampled-copy');
  h.frame();
  assert.equal(h.submissions[0].data.byteLength, 1024 * 1024 * 4);
  h.source.stop();
  assert.deepEqual(h.errors, []);
});

test('missing direct frames fall back after the Worker declines the direct path', () => {
  const h = harness(true);
  h.source.start(); h.frame(); h.next();
  h.client.directCamera = false;
  h.settle(); h.next(); h.frame();
  assert.equal(h.source.transport, 'sampled-copy');
  assert.ok(h.submissions.at(-1).data instanceof ArrayBuffer);
  h.source.stop();
});

test('pause during asynchronous camera stop prevents binding or copying a late frame', () => {
  for (const direct of [false, true]) {
    const h = harness(direct);
    let stopped;
    h.listener.stop = options => { if (options.success) stopped = options.success; };
    h.source.start(); h.frame(); h.source.stop(); stopped();
    assert.equal(h.submissions.length, 0);
    assert.equal(h.starts.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('a camera with no frames times out without leaving capture timers alive', () => {
  const h = harness();
  h.source.start(); h.next();
  assert.equal(h.errors.length, 1);
  assert.equal(h.source.closed, true);
  assert.equal(h.timers.size, 0);
});

test('a native stop which never completes cannot leave the receiver waiting forever', () => {
  const h = harness();
  h.listener.stop = () => {};
  h.source.start(); h.frame(); h.next();
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /暂停超时/);
  assert.equal(h.source.closed, true);
  assert.equal(h.submissions.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a late direct-bind success after timeout must not overwrite the fallback capture', () => {
  const h = harness(true);
  const start = h.listener.start;
  let ready;
  h.listener.start = options => {
    if (options.worker) ready = options.success;
    else start(options);
  };
  h.source.start(); h.frame(); h.next(); // Bind timeout falls back to capture.
  assert.equal(h.source.phase, 'capture');
  assert.equal(h.source.transport, 'sampled-copy');
  ready();
  assert.equal(h.timers.size, 1);
  h.frame();
  assert.ok(h.submissions.at(-1).data instanceof ArrayBuffer);
  h.source.stop();
});

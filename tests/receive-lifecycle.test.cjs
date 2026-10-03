const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function pageInstance(api = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/pages/receive/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: page => { definition = page; }, require: createRequire(filename),
    wx: { setKeepScreenOn() {}, vibrateShort() {}, ...api },
    console, setTimeout, clearTimeout, ...globals
  }, { filename });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update); },
    _visible: true, _run: 1, _frames: 0, _lastUpdateAt: 0,
    refreshPending() {}
  });
  return page;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('backgrounding pauses camera but preserves decoder; an in-flight completion is still saved', async () => {
  const page = pageInstance();
  let stopped = 0, disposed = 0, staged = 0;
  const client = { ready: true, closed: false, dispose() { disposed++; this.closed = true; },
    readChunk: async () => new ArrayBuffer(2) };
  page._client = client;
  page._source = { stop() { stopped++; } };
  page._store = { async stage(info, read) {
    staged++;
    assert.equal((await read(0, 2)).byteLength, 2);
    return { id: 'abc-def', name: info.name, size: info.size };
  } };
  page.data.phase = 'scanning';
  page.data.cameraVisible = true;
  page.onHide();
  assert.equal(page.data.phase, 'paused');
  assert.equal(stopped, 1);
  assert.equal(disposed, 0);
  page.onDecoded({ complete: true, name: 'hello.txt', size: 2 });
  await tick();
  assert.equal(staged, 1);
  assert.equal(disposed, 1);
  assert.equal(page.data.phase, 'rename');
  assert.equal(page.data.filename, 'hello.txt');
});

test('a previous session finishing persistence cannot overwrite a newer session UI or dispose its worker', async () => {
  const page = pageInstance();
  let commit;
  let oldDisposed = 0, newDisposed = 0;
  page._result = { name: 'old.bin', size: 1 };
  page._client = { dispose() { oldDisposed++; }, readChunk() {} };
  page._store = { stage() { return new Promise(resolve => { commit = resolve; }); } };
  const write = page.persistResult();
  page._run++;
  page._client = { dispose() { newDisposed++; } };
  page.data.phase = 'scanning';
  commit({ id: 'abc-def', name: 'old.bin', size: 1 });
  await write;
  assert.equal(page.data.phase, 'scanning');
  assert.equal(oldDisposed, 1);
  assert.equal(newDisposed, 0);
});

test('a local write failure preserves decoded data for a retry', async () => {
  const page = pageInstance();
  page._result = { name: 'file.bin', size: 1 };
  let disposed = false;
  page._client = { closed: false, dispose() { disposed = true; }, readChunk() {} };
  page._store = { async stage() { throw new Error('ENOSPC'); } };
  await page.persistResult();
  assert.equal(page.data.phase, 'error');
  assert.equal(page.data.canRetrySave, true);
  assert.equal(disposed, false);
  assert.equal(page._result.name, 'file.bin');
});

test('first iOS memory warning pauses and retains packets; a second warning releases the Worker', () => {
  const page = pageInstance();
  let stopped = 0, disposed = 0, released = 0;
  page._client = { ready: true, closed: false, releaseFrameBuffer() { released++; },
    dispose() { disposed++; this.closed = true; } };
  page._source = { stop() { stopped++; } };
  page.data.phase = 'scanning';
  page.data.cameraVisible = true;
  page.data.progress = 15;
  page.memoryWarning({}); // iOS does not supply Android's memory-warning level.
  assert.equal(page.data.phase, 'paused');
  assert.equal(page.data.progress, 15);
  assert.equal(page.data.cameraVisible, false);
  assert.equal(stopped, 1);
  assert.equal(released, 1);
  assert.equal(disposed, 0);
  page.memoryWarning({});
  assert.equal(page.data.phase, 'error');
  assert.equal(disposed, 1);
  assert.match(page.data.error, /进度需重新接收/);
});

test('memory listeners are removed on unload, and a warning while initializing invalidates the run', () => {
  let subscribed, removed;
  const page = pageInstance({ env: { USER_DATA_PATH: '/sandbox' }, getFileSystemManager: () => ({}),
    onMemoryWarning(fn) { subscribed = fn; }, offMemoryWarning(fn) { removed = fn; } });
  page.onLoad();
  assert.equal(typeof subscribed, 'function');
  page.data.phase = 'loading';
  const run = page._run;
  subscribed({});
  assert.equal(page.data.phase, 'error');
  assert.ok(page._run > run, 'late authorization/initialization cannot restart after a memory failure');
  page.onUnload();
  assert.equal(removed, subscribed);
});

test('speed refresh falls to zero without frames and stops on pause and unload', () => {
  let sequence = 0, speed = 12800, resumed = 0, paused = 0;
  const timers = new Map();
  const page = pageInstance({}, {
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  page._rate = { resume() { resumed++; }, pause() { paused++; }, value: () => speed };
  page._client = { ready: true, closed: false, releaseFrameBuffer() {}, dispose() {} };
  page.data.phase = 'scanning';
  page.startSpeed();
  assert.equal(page.data.speedLabel, '12.5 KiB/s');
  assert.equal(timers.size, 1);
  speed = 0;
  const [id, next] = [...timers][0]; timers.delete(id); next();
  assert.equal(page.data.speedLabel, '0 B/s');
  page.pause();
  assert.equal(timers.size, 0);
  assert.equal(paused, 1);
  page.resume();
  assert.equal(resumed, 2);
  assert.equal(timers.size, 1);
  page.onUnload();
  assert.equal(timers.size, 0);
});

test('receive UI displays source and square dimensions while counting only decoded payload bytes', () => {
  const page = pageInstance();
  const seen = [];
  page._rate = { observe(bytes) { seen.push(bytes); } };
  page._client = { lastMetrics: { width: 720, height: 1280, decodeWidth: 720, decodeHeight: 720 } };
  page.data.phase = 'scanning';
  page.onDecoded({ complete: false, progress: 15, compressedSize: 1048576, receivedBytes: 157320 });
  assert.equal(page.data.cameraSizeLabel, '720×1280');
  assert.equal(page.data.decodeSizeLabel, '720×720');
  assert.deepEqual(seen, [157320]);
  assert.equal(page.data.progress, 15);
});

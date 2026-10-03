const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReceiveDiagnostics, STORAGE_KEY, PREVIOUS_STORAGE_KEY } = require('../miniprogram/services/receive-diagnostics');

test('one bounded diagnostic snapshot survives a restart, with throttled writes and a heap high-water mark', () => {
  const storage = new Map();
  let writes = 0;
  const api = { getDeviceInfo: () => ({ platform: 'ios', model: 'test phone' }),
    getStorageSync: key => storage.get(key), setStorageSync(key, data) { writes++; storage.set(key, structuredClone(data)); } };
  const log = new ReceiveDiagnostics(api);
  log.begin(68);
  log.record({ event: 'receiving', progress: 15, heapBytes: 33554432 });
  for (let i = 0; i < 1000; i++) log.record({ progress: 15 + i / 1000, heapBytes: 16777216 });
  assert.equal(writes, 1);
  log.record({ event: 'memory-paused', memoryWarnings: 1 }, true);
  const restored = new ReceiveDiagnostics(api);
  assert.equal(restored.data.peakHeapBytes, 33554432);
  assert.equal(restored.data.event, 'memory-paused');
  assert.equal(storage.size, 1);
  assert.ok(JSON.stringify(storage.get(STORAGE_KEY)).length < 1024);
});

test('diagnostic storage errors cannot interrupt decoding', () => {
  const log = new ReceiveDiagnostics({ getStorageSync() { throw new Error('storage unavailable'); },
    setStorageSync() { throw new Error('storage full'); } });
  log.begin(68);
  assert.doesNotThrow(() => log.record({ event: 'receiving' }, true));
});

test('automatic scan startup keeps the previous failure snapshot and bounds storage to two records', () => {
  const storage = new Map();
  const api = { getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)) };
  let log = new ReceiveDiagnostics(api);
  log.begin(68); log.record({ event: 'memory-paused', progress: 15, memoryWarnings: 1 }, true);
  log = new ReceiveDiagnostics(api);
  log.begin(66); log.record({ event: 'start', progress: 0 }, true);
  const restored = new ReceiveDiagnostics(api);
  assert.equal(restored.data.mode, 66);
  assert.equal(restored.previous.progress, 15);
  assert.equal(restored.previous.event, 'memory-paused');
  assert.equal(storage.get(PREVIOUS_STORAGE_KEY).memoryWarnings, 1);
  for (let i = 0; i < 100; i++) {
    log.begin(68); log.record({ event: 'receiving', progress: i }, true);
  }
  assert.equal(storage.size, 2);
  assert.ok(JSON.stringify([...storage.values()]).length < 2048);
});

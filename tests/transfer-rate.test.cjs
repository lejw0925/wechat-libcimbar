const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TransferRate } = require('../miniprogram/utils/transfer-rate');
const { formatSpeed } = require('../miniprogram/utils/format');

test('throughput uses byte deltas, smooths over three seconds, and decays without new frames', () => {
  const rate = new TransferRate();
  rate.resume(0);
  rate.observe(2048, 500);
  assert.equal(rate.value(1000), 2048);
  rate.observe(2048, 1000); // Duplicate data, not another 2048 bytes.
  assert.equal(rate.value(1000), 2048);
  rate.observe(6144, 1500);
  assert.equal(rate.value(2000), 3072);
  assert.equal(rate.value(3500), 4096 / 3);
  assert.equal(rate.value(4500), 0);
});

test('pausing clears the rate window; late replies and paused time do not cause a resume spike', () => {
  const rate = new TransferRate();
  rate.resume(0); rate.observe(4096, 500);
  rate.pause();
  assert.equal(rate.value(1000), 0);
  rate.observe(8192, 1500); // An in-flight frame completes while paused.
  rate.resume(60000);
  assert.equal(rate.value(60000), 0);
  rate.observe(9216, 60500);
  assert.equal(rate.value(61000), 1024);
});

test('counter resets and invalid samples cannot produce negative or infinite speed', () => {
  const rate = new TransferRate();
  rate.resume(0); rate.observe(4096, 500); rate.observe(0, 1000);
  assert.equal(rate.value(1000), 0);
  for (const bad of [undefined, NaN, Infinity, -1]) rate.observe(bad, 1200);
  assert.equal(rate.bytes, 0);
  rate.observe(1024, 1500);
  assert.equal(rate.value(2000), 1024);
});

test('rate history is bounded even with thousands of callbacks', () => {
  const rate = new TransferRate();
  rate.resume(0);
  for (let n = 0; n < 30000; n++) {
    rate.observe(n * 100, n);
    assert.ok(rate.buckets.length <= 13);
  }
  assert.equal(rate.value(34000), 0);
  assert.equal(rate.buckets.length, 0);
});

test('throughput labels use byte units per second', () => {
  assert.equal(formatSpeed(0), '0 B/s');
  assert.equal(formatSpeed(512.2), '512 B/s');
  assert.equal(formatSpeed(12800), '12.5 KiB/s');
  assert.equal(formatSpeed(1572864), '1.5 MiB/s');
  assert.equal(formatSpeed(Infinity), '0 B/s');
});

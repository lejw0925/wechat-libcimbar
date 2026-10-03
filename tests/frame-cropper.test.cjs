const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FrameCropper } = require('../miniprogram/services/frame-cropper');

function input(width, height) {
  const pixels = new Uint32Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i;
  return { width, height, data: pixels.buffer };
}

test('pre-post crops preserve exactly the same center pixels in portrait, landscape and odd dimensions', () => {
  const cropper = new FrameCropper();
  for (const [width, height] of [[720, 1280], [1280, 720], [65, 100], [100, 65], [64, 64]]) {
    const raw = input(width, height), before = raw.data.slice(0);
    const { frame, metrics } = cropper.prepare(raw);
    const side = Math.min(width, height), pixels = new Uint32Array(frame.data);
    const left = Math.floor((width - side) / 2), top = Math.floor((height - side) / 2);
    assert.equal(frame.width, side); assert.equal(frame.height, side);
    assert.equal(frame.data.byteLength, side * side * 4);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      assert.equal(pixels[y * side + x], (y + top) * width + x + left);
    }
    assert.deepEqual(raw.data, before, 'native pixels must remain unchanged');
    assert.equal(metrics.width, width); assert.equal(metrics.height, height);
    assert.equal(metrics.inputBytes, width * height * 4); assert.equal(metrics.postBytes, side * side * 4);
    assert.equal(metrics.cropLeft, left); assert.equal(metrics.cropTop, top);
  }
});

test('one exact-sized crop buffer is reused, resized and released without sending stale trailing pixels', () => {
  const cropper = new FrameCropper();
  const first = cropper.prepare(input(720, 1280));
  for (let i = 0; i < 300; i++) assert.equal(cropper.prepare(input(i % 2 ? 64 : 128, i % 2 ? 128 : 64)).frame.data.byteLength, 64 * 64 * 4);
  const buffer = cropper.pixels.buffer;
  assert.equal(cropper.prepare(input(128, 64)).frame.data, buffer);
  assert.equal(first.metrics.postBytes, 2073600);
  assert.equal(first.metrics.inputBytes, 3686400);
  const square = input(64, 64);
  assert.equal(cropper.prepare(square).frame.data, square.data, 'square native frames need no staging copy');
  assert.equal(cropper.pixels, null);
  cropper.prepare(input(64, 128)); cropper.release();
  assert.equal(cropper.pixels, null);
});

test('invalid native frames are rejected before allocating a staging buffer', () => {
  const cropper = new FrameCropper();
  for (const frame of [{ width: 720, height: 1280, data: new ArrayBuffer(16) },
    { width: 9000, height: 9000, data: new ArrayBuffer(0) },
    { width: 64.5, height: 64, data: new ArrayBuffer(0) }]) assert.throws(() => cropper.prepare(frame), /格式/);
  assert.equal(cropper.pixels, undefined);
});

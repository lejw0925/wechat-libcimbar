const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DecoderRuntime } = require('../miniprogram/workers/decoder-runtime');

function fixture() {
  const calls = [], allocations = [], frees = [];
  const module = {
    HEAPU8: new Uint8Array(4 * 1024 * 1024),
    _malloc(size) { allocations.push(size); return 16; }, _free(pointer) { frees.push(pointer); },
    _cb_decode_rgba(pointer, width, height) { calls.push({ pointer, width, height }); return 0; },
    _cb_progress: () => 0, _cb_compressed_size: () => 0, _cb_received_bytes: () => 0
  };
  return { runtime: new DecoderRuntime(module), module, calls, allocations, frees };
}
function frame(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    pixels[at] = x % 256; pixels[at + 1] = y % 256;
    pixels[at + 2] = (x + y) % 256; pixels[at + 3] = 255;
  }
  return { width, height, data: pixels.buffer };
}

test('square decoding copies exactly the central pixels without stretching portrait or landscape frames', () => {
  for (const [width, height] of [[64, 128], [128, 64], [65, 100], [100, 65], [720, 1280], [1280, 720]]) {
    const f = fixture();
    const input = frame(width, height);
    const before = new Uint8Array(input.data).slice();
    f.runtime.decode(input, { square: true });
    const side = Math.min(width, height);
    assert.deepEqual(f.calls[0], { pointer: 16, width: side, height: side });
    assert.deepEqual(f.allocations, [side * side * 4]);
    const left = Math.floor((width - side) / 2), top = Math.floor((height - side) / 2);
    for (let y = 0; y < side; y++) {
      const source = ((top + y) * width + left) * 4;
      assert.deepEqual(f.module.HEAPU8.subarray(16 + y * side * 4, 16 + (y + 1) * side * 4),
        before.subarray(source, source + side * 4));
    }
    assert.deepEqual(new Uint8Array(input.data), before, 'camera-owned input must not be modified');
    assert.equal(f.runtime.frameInfo.width, width);
    assert.equal(f.runtime.frameInfo.height, height);
    assert.equal(f.runtime.frameInfo.decodeWidth, side);
    assert.equal(f.runtime.frameInfo.decodeHeight, side);
    assert.equal(f.runtime.frameInfo.cropLeft, left);
    assert.equal(f.runtime.frameInfo.cropTop, top);
  }
});

test('square frame storage is reused across orientation changes and freed on pause', () => {
  const f = fixture();
  f.runtime.decode(frame(64, 128), { square: true });
  f.runtime.decode(frame(128, 64), { square: true });
  assert.equal(f.allocations.length, 1);
  f.runtime.releaseFrameBuffer();
  assert.deepEqual(f.frees, [16]);
  assert.equal(f.runtime.capacity, 0);
  f.runtime.decode(frame(64, 128), { square: true });
  assert.equal(f.allocations.length, 2);
});

test('full-frame runtime mode remains available for upstream image regression tests', () => {
  const f = fixture();
  const input = frame(64, 128);
  f.runtime.decode(input);
  assert.deepEqual(f.calls[0], { pointer: 16, width: 64, height: 128 });
  assert.deepEqual(f.module.HEAPU8.subarray(16, 16 + input.data.byteLength), new Uint8Array(input.data));
});

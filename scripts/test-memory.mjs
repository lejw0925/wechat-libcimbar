import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// This bounds the real decoder's WASM heap, not iOS/WeChat process memory.
// Native camera delivery and Worker bridge lifetime still need device testing.
const require = createRequire(import.meta.url);
const { loadDecoder } = require('../miniprogram/workers/decoder-runtime');
const { FrameCropper } = require('../miniprogram/services/frame-cropper');
const bytes = brotliDecompressSync(fs.readFileSync('miniprogram/wasm/cimbar.wasm.br'));
const createEncoder = require(path.resolve('build/decoder/fixture_encoder.js'));
const encoder = await createEncoder();
const input = Buffer.alloc(1024 * 1024);
let seed = 0x12345678;
for (let i = 0; i < input.length; i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; input[i] = seed & 255;
}
const expectedHash = createHash('sha256').update(input).digest('hex');

for (const [width, height, preCrop] of [[1024, 1024, false], [1080, 1920, false], [1080, 1920, true]]) {
  const runtime = await loadDecoder({ instantiate: (_file, imports) => WebAssembly.instantiate(bytes, imports) });
  runtime.reset(68);
  const initialHeap = runtime.module.HEAPU8.byteLength;
  const dataPtr = encoder._malloc(input.length);
  const filename = Buffer.from('memory-1MiB.bin\0');
  const namePtr = encoder._malloc(filename.length);
  encoder.HEAPU8.set(input, dataPtr);
  encoder.HEAPU8.set(filename, namePtr);
  assert.equal(encoder._fixture_init(dataPtr, input.length, namePtr, 68), 1);
  encoder._free(dataPtr); encoder._free(namePtr);
  const pixels = new Uint8Array(width * height * 4).fill(255);
  const cropper = new FrameCropper();
  let stagingBuffer, stagingAllocations = 0;
  let result, frames = 0, paused = false, peakHeap = 0;
  for (let n = 0; n < 400; n++) {
    const pointer = encoder._fixture_next();
    assert.notEqual(pointer, 0);
    const w = encoder._fixture_width(), h = encoder._fixture_height();
    const left = Math.floor((width - w) / 2), top = Math.floor((height - h) / 2);
    for (let y = 0; y < h; y++) pixels.set(encoder.HEAPU8.subarray(pointer + y * w * 4, pointer + (y + 1) * w * 4),
      ((y + top) * width + left) * 4);
    // Repeated frames make receiving much longer than the ideal round trip.
    // Only the current frame exists; there is deliberately no frames array.
    let previous;
    for (let repeat = 0; repeat < 4; repeat++) {
      let frame = { width, height, data: pixels.buffer };
      if (preCrop) {
        const prepared = cropper.prepare(frame);
        if (stagingBuffer !== prepared.frame.data) { stagingBuffer = prepared.frame.data; stagingAllocations++; }
        assert.equal(prepared.metrics.postBytes, Math.min(width, height) ** 2 * 4);
        assert.equal(prepared.metrics.cropBufferBytes, prepared.metrics.postBytes);
        frame = structuredClone(prepared.frame); // Model the message copy with only one request alive.
      }
      result = runtime.decode(frame, { square: true });
      frames++;
      peakHeap = Math.max(peakHeap, runtime.module.HEAPU8.byteLength);
      assert.ok(peakHeap <= initialHeap, `WASM grew to ${peakHeap} bytes at ${result.progress}%`);
      assert.equal(runtime.capacity, Math.min(width, height) ** 2 * 4);
      assert.equal(runtime.frameInfo.decodeWidth, Math.min(width, height));
      if (previous !== undefined) assert.equal(result.progress, previous, 'duplicate frame advanced progress');
      previous = result.progress;
      if (!paused && result.progress >= 15 && !result.complete) {
        runtime.releaseFrameBuffer();
        cropper.release();
        stagingBuffer = null;
        assert.equal(runtime.capacity, 0);
        assert.equal(runtime.pointer, 0);
        paused = true; // Next duplicate must retain the fountain progress.
      }
      if (result.complete) break;
    }
    if (result.complete) break;
  }
  assert.equal(paused, true);
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.size, input.length);
  assert.equal(result.name, 'memory-1MiB.bin');
  const actualHash = createHash('sha256');
  for (let offset = 0; offset < result.size; offset += 256 * 1024) {
    actualHash.update(Buffer.from(runtime.readChunk(offset, Math.min(256 * 1024, result.size - offset))));
  }
  assert.equal(actualHash.digest('hex'), expectedHash);
  runtime.dispose();
  cropper.release();
  if (preCrop) assert.equal(stagingAllocations, 2, 'only initial and post-pause staging allocation are allowed');
  console.log(`PASS: 1 MiB, ${width}×${height} → ${runtime.frameInfo.decodeWidth}×${runtime.frameInfo.decodeHeight}, ${preCrop ? 'pre-post crop + cloned message' : 'Worker crop'}, ${frames} decodes, pause at 15%, SHA-256 matches; WASM heap stayed ${peakHeap / 1048576} MiB${preCrop ? '; staging buffer allocated twice total' : ''}.`);
}
console.log('Phone camera/Worker memory must still be checked on iPhone and Android; desktop heap results are not device measurements.');

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync, zstdCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { loadDecoder } = require('../miniprogram/workers/decoder-runtime');
const { FrameCropper } = require('../miniprogram/services/frame-cropper');
const bytes = brotliDecompressSync(fs.readFileSync('miniprogram/wasm/cimbar.wasm.br'));
const runtime = await loadDecoder({ instantiate: (_file, imports) => WebAssembly.instantiate(bytes, imports) });
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const asArrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
function readResult(size) {
  const chunks = [];
  for (let offset = 0; offset < size; offset += 256 * 1024) chunks.push(Buffer.from(runtime.readChunk(offset, Math.min(256 * 1024, size - offset))));
  return Buffer.concat(chunks);
}

runtime.reset(68);
assert.equal(runtime.decode({ width: 320, height: 240, data: new ArrayBuffer(320 * 240 * 4) }).complete, false);
assert.throws(() => runtime.decode({ width: 320, height: 240, data: new ArrayBuffer(3) }), /格式/);
assert.throws(() => runtime.readChunk(0, 1));
console.log('PASS: production WASM loads; blank and invalid camera frames handled.');

// Published upstream regression image, if the optional samples checkout exists.
const sample = 'third_party/libcimbar/samples/b/4cecc30f.png';
if (fs.existsSync(sample)) {
  const probe = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'stream=width,height', '-of', 'json', sample], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('ffprobe is needed to read the official PNG fixture');
  const { width, height } = JSON.parse(probe.stdout).streams[0];
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', sample, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  runtime.reset(68);
  const result = runtime.decode({ width, height, data: asArrayBuffer(decoded.stdout) });
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.size, 7538); // Upstream cimbar_recv_jsTest/testFullDecode.
  const recovered = readResult(result.size);
  console.log(`PASS: official Mode B sample, ${result.size} bytes, sha256 ${hash(recovered)}`);
  const portrait = spawnSync('ffmpeg', ['-v', 'error', '-i', sample, '-vf',
    'scale=640:640:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=white',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(portrait.status, 0, portrait.stderr.toString());
  runtime.reset(68);
  const square = runtime.decode({ width: 720, height: 1280, data: asArrayBuffer(portrait.stdout) }, { square: true });
  assert.equal(square.complete, true);
  assert.equal(hash(readResult(square.size)), hash(recovered));
  assert.equal(runtime.frameInfo.decodeBytes, 720 * 720 * 4);
  console.log('PASS: synthetic 720×1280 camera frame cropped to 720×720, exact decoded file hash.');
  const cropper = new FrameCropper();
  const copied = cropper.prepare({ width: 720, height: 1280, data: asArrayBuffer(portrait.stdout) });
  runtime.reset(68);
  const preCropped = runtime.decode(structuredClone(copied.frame), { square: true });
  assert.equal(preCropped.complete, true);
  assert.equal(hash(readResult(preCropped.size)), hash(recovered));
  assert.equal(copied.metrics.postBytes, 2073600);
  cropper.release();
  console.log('PASS: pre-post 720×720 crop survives message cloning and restores the same file hash.');
  for (const filename of ['b/scan2434.jpg', '6bit/4_30_f0_big.jpg', '6bit/4_30_f2_734.jpg', '6bit/4_30_f0_627.jpg']) {
    const source = 'third_party/libcimbar/samples/' + filename;
    const dimensions = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'stream=width,height', '-of', 'json', source], { encoding: 'utf8' });
    assert.equal(dimensions.status, 0);
    const shape = JSON.parse(dimensions.stdout).streams[0];
    const image = spawnSync('ffmpeg', ['-v', 'error', '-i', source, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 40 * 1024 * 1024 });
    assert.equal(image.status, 0, image.stderr.toString());
    runtime.reset(filename.startsWith('b/') ? 68 : 4);
    const photo = runtime.decode({ ...shape, data: asArrayBuffer(image.stdout) });
    assert.ok(photo.matched && photo.progress > 0, `No valid packets from camera photo ${filename}`);
    console.log(`PASS: official camera photo ${filename}, valid fountain packets recovered.`);
  }
}

const encoderPath = path.resolve('build/decoder/fixture_encoder.js');
if (!fs.existsSync(encoderPath)) throw new Error('Run npm run build:wasm to build the test-only fixture encoder first.');
const createEncoder = require(encoderPath);
const encoder = await createEncoder();
function encodeInit(data, name, mode) {
  const dataPtr = encoder._malloc(Math.max(1, data.length));
  const filename = Buffer.from(name + '\0', 'utf8');
  const namePtr = encoder._malloc(filename.length);
  encoder.HEAPU8.set(data, dataPtr);
  encoder.HEAPU8.set(filename, namePtr);
  assert.equal(encoder._fixture_init(dataPtr, data.length, namePtr, mode), 1);
  encoder._free(dataPtr);
  encoder._free(namePtr);
}
function nextFrame() {
  const pointer = encoder._fixture_next();
  assert.notEqual(pointer, 0);
  const width = encoder._fixture_width(), height = encoder._fixture_height();
  return { width, height, data: encoder.HEAPU8.slice(pointer, pointer + width * height * 4).buffer };
}
function encodeRaw(data, mode = 68) {
  const pointer = encoder._malloc(data.length);
  encoder.HEAPU8.set(data, pointer);
  assert.equal(encoder._fixture_init_raw(pointer, data.length, mode), 1);
  encoder._free(pointer);
}
// Deterministic, poorly compressible bytes force the multi-frame/fountain path.
const original = Buffer.alloc(60000);
let state = 0x12345678;
for (let i = 0; i < original.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; original[i] = state & 255; }
for (const mode of [68, 67, 66, 4, 8]) {
  runtime.reset(mode);
  encodeInit(original, '测试文件.bin', mode);
  const frames = Array.from({ length: 36 }, nextFrame);
  // Drop a third of frames and receive a later frame twice before reversing order.
  const usable = frames.filter((_, index) => index % 3 !== 0).reverse();
  const first = runtime.decode(usable[0]);
  assert.equal(first.complete, false);
  const duplicate = runtime.decode(usable[0]);
  assert.equal(duplicate.progress, first.progress, 'duplicate packets advanced progress');
  assert.ok(Number.isInteger(first.receivedBytes) && first.receivedBytes >= 0);
  assert.equal(duplicate.receivedBytes, first.receivedBytes, 'duplicate packets inflated throughput');
  let result = first;
  let count = 1;
  const started = performance.now();
  for (const frame of usable.slice(1)) {
    result = runtime.decode(frame);
    count++;
    if (result.complete) break;
  }
  assert.equal(result.complete, true, `Mode ${mode} incomplete: ${JSON.stringify(result)}`);
  assert.equal(result.name, '测试文件.bin');
  assert.equal(result.size, original.length);
  assert.ok(result.receivedBytes > 0 && result.receivedBytes >= first.receivedBytes,
    'final byte count was lost when releasing the fountain stream');
  assert.equal(hash(readResult(result.size)), hash(original));
  console.log(`PASS: Mode ${mode}, ${count} received frames with drops/reordering/duplicates, exact SHA-256 match, ${Math.round(performance.now() - started)} ms`);
}
// A fresh session must receive the same file again, without a stale done cache.
runtime.reset(68);
assert.equal(runtime.module._cb_received_bytes(), 0);
encodeInit(Buffer.from('second receive\n'), 'again.txt', 68);
let again;
for (let i = 0; i < 12; i++) { again = runtime.decode(nextFrame()); if (again.complete) break; }
assert.equal(again.complete, true);
assert.equal(readResult(again.size).toString(), 'second receive\n');
// Files which are highly compressible must still be bounded after decompression.
for (const [label, packed, expected] of [
  ['invalid zstd', Buffer.alloc(2000, 42), /解压校验失败/],
  ['truncated zstd', zstdCompressSync(original).subarray(0, -3), /不完整/],
  ['decompression limit', zstdCompressSync(Buffer.alloc(65 * 1024 * 1024)), /64 MiB/]
]) {
  runtime.reset(68);
  encodeRaw(packed);
  assert.throws(() => {
    for (let i = 0; i < 40; i++) runtime.decode(nextFrame());
  }, expected, label);
  assert.throws(() => runtime.readChunk(0, 1));
  console.log(`PASS: ${label} rejected without producing a completed file.`);
}
runtime.reset(68);
encodeRaw(Buffer.alloc(17 * 1024 * 1024, 23));
assert.throws(() => runtime.decode(nextFrame()), /16 MiB/);
console.log('PASS: oversized compressed file rejected before fountain allocation.');
runtime.dispose();
console.log('PASS: reset and second receive. All real WASM integration checks passed.');

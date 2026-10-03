// Desktop measurement of the production decoder, not phone/camera throughput.
// Only the current RGBA frame is held. No output is published or artifacts replaced.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { loadDecoder } = require('../miniprogram/workers/decoder-runtime');
const { FPS_STEPS, INITIAL_FPS } = require('../miniprogram/services/adaptive-sampling');
const wasm = brotliDecompressSync(fs.readFileSync('miniprogram/wasm/cimbar.wasm.br'));
const runtime = await loadDecoder({ instantiate: (_file, imports) => WebAssembly.instantiate(wasm, imports) });
const nativeDecode = runtime.module._cb_decode_rgba;
let nativeMs = 0;
runtime.module._cb_decode_rgba = (...args) => {
  const start = performance.now();
  try { return nativeDecode(...args); }
  finally { nativeMs = performance.now() - start; }
};
function measure(frame) {
  const start = performance.now();
  const result = runtime.decode(frame, { square: true });
  const totalMs = performance.now() - start;
  return { result, totalMs, nativeMs, copyAndResultMs: Math.max(0, totalMs - nativeMs) };
}
function summary(label, measurements) {
  const samples = measurements.map(item => item.totalMs).sort((a, b) => a - b);
  const round = value => Number(value.toFixed(2));
  const average = field => measurements.reduce((sum, item) => sum + item[field], 0) / measurements.length;
  const ceilings = Object.fromEntries(FPS_STEPS.map(fps => [fps, round(1000 * samples.length /
    measurements.reduce((sum, item) => sum + Math.max(1000 / fps, item.totalMs), 0))]));
  console.log(JSON.stringify({ label, frames: samples.length, meanMs: round(average('totalMs')),
    p50Ms: round(samples[Math.floor(samples.length * .5)]), p95Ms: round(samples[Math.floor(samples.length * .95)]),
    nativeMeanMs: round(average('nativeMs')), copyAndResultMeanMs: round(average('copyAndResultMs')),
    fixedRateCpuOnlyCeilingsFps: ceilings,
    computeOnlyCeilingFps: round(1000 / average('totalMs')), heapMiB: runtime.module.HEAPU8.byteLength / 1048576 }));
}
console.log(JSON.stringify({ environment: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0].model,
  node: process.version, wasmSha256: createHash('sha256').update(wasm).digest('hex'), initialFps: INITIAL_FPS, samplingFpsSteps: FPS_STEPS,
  limitation: 'Desktop only; excludes camera delivery, Worker bridge, display refresh and phone thermal/memory limits. Ceilings are arithmetic, not measured transfer rates.' }));

// Match the reported camera dimensions with a published, known-good cimbar image.
const source = 'third_party/libcimbar/samples/b/4cecc30f.png';
const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', source, '-vf',
  'scale=640:640:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=white',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 8 * 1024 * 1024 });
if (converted.error) throw converted.error;
assert.equal(converted.status, 0, converted.stderr.toString());
const data = converted.stdout.buffer.slice(converted.stdout.byteOffset, converted.stdout.byteOffset + converted.stdout.byteLength);
const portrait = { width: 720, height: 1280, data };
const warmMeasurements = [];
for (let i = 0; i < 90; i++) {
  // The fixture is a complete small file. Reset outside the timer to avoid
  // benchmarking the already-completed decoder's fast return.
  runtime.reset(68);
  const measurement = measure(portrait);
  assert.equal(measurement.result.complete, true);
  assert.equal(measurement.result.size, 7538);
  if (i >= 10) warmMeasurements.push(measurement);
}
summary('Mode B / upstream sample / 720x1280 cropped to 720x720 / 10 warmups', warmMeasurements);

// A genuine, multi-frame 1 MiB transfer, including distinct fountain packets,
// the final recovery and decompression. No repeated-frame shortcut.
const createEncoder = require(path.resolve('build/decoder/fixture_encoder.js'));
const encoder = await createEncoder();
const input = Buffer.alloc(1024 * 1024);
let seed = 0x12345678;
for (let i = 0; i < input.length; i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; input[i] = seed & 255;
}
const inputPointer = encoder._malloc(input.length), name = Buffer.from('benchmark.bin\0');
const namePointer = encoder._malloc(name.length);
encoder.HEAPU8.set(input, inputPointer); encoder.HEAPU8.set(name, namePointer);
assert.equal(encoder._fixture_init(inputPointer, input.length, namePointer, 68), 1);
encoder._free(inputPointer); encoder._free(namePointer);
runtime.reset(68);
const measurements = [];
let frame, result;
for (let i = 0; i < 400; i++) {
  const pointer = encoder._fixture_next();
  assert.notEqual(pointer, 0);
  const width = encoder._fixture_width(), height = encoder._fixture_height();
  if (!frame) frame = { width, height, data: new ArrayBuffer(width * height * 4) };
  assert.equal(frame.data.byteLength, width * height * 4);
  new Uint8Array(frame.data).set(encoder.HEAPU8.subarray(pointer, pointer + frame.data.byteLength));
  const measurement = measure(frame);
  result = measurement.result;
  measurements.push(measurement);
  if (result.complete) break;
}
assert.equal(result.complete, true);
assert.equal(result.size, input.length);
const actualHash = createHash('sha256');
for (let offset = 0; offset < result.size; offset += 256 * 1024) {
  actualHash.update(Buffer.from(runtime.readChunk(offset, Math.min(256 * 1024, result.size - offset))));
}
assert.equal(actualHash.digest('hex'), createHash('sha256').update(input).digest('hex'));
summary(`Mode B / 1 MiB random file / ${frame.width}x${frame.height} / SHA-256 verified`, measurements);
runtime.dispose();

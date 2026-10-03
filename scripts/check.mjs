import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk('miniprogram');
for (const file of files) {
  if (file.endsWith('.js')) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
}
const app = JSON.parse(fs.readFileSync('miniprogram/app.json'));
for (const page of app.pages) for (const extension of ['js', 'json', 'wxml', 'wxss']) {
  assert.ok(fs.existsSync(`miniprogram/${page}.${extension}`), `Missing ${page}.${extension}`);
}
for (const component of Object.values(app.usingComponents || {})) {
  const base = 'miniprogram/' + component.replace(/^\//, '');
  for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.ok(fs.existsSync(`${base}.${extension}`));
  assert.equal(JSON.parse(fs.readFileSync(base + '.json')).component, true);
}
assert.equal(app.workers, 'workers');
assert.ok(fs.existsSync('miniprogram/workers/decode.js'));
const wasm = brotliDecompressSync(fs.readFileSync('miniprogram/wasm/cimbar.wasm.br'));
assert.ok(WebAssembly.validate(wasm), 'Invalid WASM');
const info = JSON.parse(fs.readFileSync('miniprogram/wasm/build-info.json'));
assert.equal(createHash('sha256').update(wasm).digest('hex'), info.sha256);
const size = files.reduce((total, file) => total + fs.statSync(file).size, 0);
assert.ok(size < 2 * 1024 * 1024, `Main package exceeds 2 MiB: ${size}`);
console.log(`Checked ${files.length} mini program files. Package ${(size / 1024).toFixed(1)} KiB; WASM ${(wasm.length / 1024).toFixed(1)} KiB before Brotli.`);

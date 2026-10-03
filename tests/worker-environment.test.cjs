const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { brotliDecompressSync } = require('node:zlib');

test('production worker loads with WXWebAssembly and without DOM, fetch, TextDecoder or performance', async () => {
  const wasm = brotliDecompressSync(fs.readFileSync(path.join(__dirname, '../miniprogram/wasm/cimbar.wasm.br')));
  let handler;
  let cameraData;
  const replies = [];
  const context = vm.createContext({ console, setTimeout, clearTimeout,
    // Real WebAssembly is used behind WeChat's pathname-based API contract.
    WXWebAssembly: { Memory: WebAssembly.Memory, Table: WebAssembly.Table, RuntimeError: WebAssembly.RuntimeError,
      instantiate: (file, imports) => { assert.equal(file, 'wasm/cimbar.wasm.br'); return WebAssembly.instantiate(wasm, imports); } },
    worker: {
      getCameraFrameData() { return cameraData; },
      onMessage(callback) { handler = callback; },
      postMessage(message) { replies.push(message); }
    }
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const wrapper = vm.runInContext(`(function(require, module, exports) { ${fs.readFileSync(file, 'utf8')}\n})`, context, { filename: file });
    wrapper(request => load(path.resolve(path.dirname(file), request + '.js')), module, module.exports);
    return module.exports;
  }
  load(path.resolve(__dirname, '../miniprogram/workers/decode.js'));
  await handler({ id: 1, type: 'init', mode: 999 });
  assert.equal(replies.at(-1).type, 'error');
  assert.match(replies.at(-1).message, /不支持的 cimbar 模式/); // Native UTF-8 without TextDecoder.
  await handler({ id: 2, type: 'init', mode: 68 });
  assert.equal(replies.at(-1).type, 'ready', JSON.stringify(replies.at(-1)));
  assert.equal(replies.at(-1).directCamera, true);
  const frame = vm.runInContext('({ width: 320, height: 240, data: new ArrayBuffer(320 * 240 * 4) })', context);
  await handler({ id: 3, type: 'frame', frame });
  assert.equal(replies.at(-1).type, 'frame', JSON.stringify(replies.at(-1)));
  assert.equal(replies.at(-1).result.complete, false);
  assert.equal(replies.at(-1).metrics.inputBytes, 320 * 240 * 4);
  assert.equal(replies.at(-1).metrics.decodeWidth, 240);
  assert.equal(replies.at(-1).metrics.decodeHeight, 240);
  assert.equal(replies.at(-1).metrics.frameBufferBytes, 240 * 240 * 4);
  assert.equal(replies.at(-1).result.receivedBytes, 0);
  const initialHeap = replies.at(-1).metrics.heapBytes;
  cameraData = frame.data;
  await handler({ id: 4, type: 'camera-frame', width: 320, height: 240 });
  assert.equal(replies.at(-1).result.complete, false);
  assert.equal(replies.at(-1).metrics.heapBytes, initialHeap);
  await handler({ id: 5, type: 'release-frame' });
  assert.equal(replies.at(-1).type, 'released');
  await handler({ id: 6, type: 'camera-frame', width: 320, height: 240 });
  assert.equal(replies.at(-1).metrics.heapBytes, initialHeap);
  cameraData = undefined;
  for (let i = 0; i < 8; i++) {
    await handler({ id: 7 + i, type: 'camera-frame', width: 320, height: 240 });
    assert.equal(replies.at(-1).type, 'frame');
    assert.equal(replies.at(-1).directUnavailable, i === 7);
    assert.equal(replies.at(-1).result, undefined, 'missing direct data is skipped, never treated as decoded');
  }
});

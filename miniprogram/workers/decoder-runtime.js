const createCimbarModule = require('./generated/cimbar');

class DecoderRuntime {
  constructor(module) {
    this.module = module;
    this.pointer = 0;
    this.capacity = 0;
    this.complete = false;
  }
  reset(mode) {
    const result = this.module._cb_reset(mode);
    if (result < 0) throw new Error(this.module.UTF8ToString(this.module._cb_error()));
    this.complete = false;
  }
  decode(frame, options = {}) {
    const { width, height, data } = frame;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 ||
      width > 4096 || height > 4096 || width * height > 4096 * 2160 ||
      !(data instanceof ArrayBuffer) || data.byteLength !== width * height * 4) throw new Error('相机帧格式无效');
    const module = this.module;
    // A square preview does not change WeChat's raw camera dimensions. Crop
    // at native pixel density directly into the reusable WASM input buffer;
    // do not resize or allocate another full RGBA image in JavaScript.
    const side = Math.min(width, height);
    const decodeWidth = options.square ? side : width;
    const decodeHeight = options.square ? side : height;
    const cropLeft = Math.floor((width - decodeWidth) / 2);
    const cropTop = Math.floor((height - decodeHeight) / 2);
    const decodeBytes = decodeWidth * decodeHeight * 4;
    if (this.capacity < decodeBytes) {
      if (this.pointer) module._free(this.pointer);
      this.pointer = 0;
      this.capacity = 0;
      this.pointer = module._malloc(decodeBytes);
      if (!this.pointer) throw new Error('相机帧内存分配失败');
      this.capacity = decodeBytes;
    }
    if (decodeWidth === width) {
      module.HEAPU8.set(new Uint8Array(data, cropTop * width * 4, decodeBytes), this.pointer);
    } else {
      const rowBytes = decodeWidth * 4;
      for (let row = 0; row < decodeHeight; row++) {
        const source = ((row + cropTop) * width + cropLeft) * 4;
        module.HEAPU8.set(new Uint8Array(data, source, rowBytes), this.pointer + row * rowBytes);
      }
    }
    const result = module._cb_decode_rgba(this.pointer, decodeWidth, decodeHeight);
    if (result < 0) throw new Error(module.UTF8ToString(module._cb_error()));
    this.complete = result === 2;
    this.frameInfo = { width, height, inputBytes: data.byteLength,
      decodeWidth, decodeHeight, decodeBytes, cropLeft, cropTop,
      heapBytes: module.HEAPU8.byteLength, frameBufferBytes: this.capacity };
    return { complete: this.complete, matched: result > 0,
      progress: module._cb_progress() / 10,
      compressedSize: module._cb_compressed_size(),
      receivedBytes: module._cb_received_bytes(),
      name: this.complete ? module.UTF8ToString(module._cb_filename()) : '',
      size: this.complete ? module._cb_result_size() : 0 };
  }
  readChunk(offset, length) {
    const size = this.module._cb_result_size();
    if (!this.complete || !Number.isInteger(offset) || !Number.isInteger(length) ||
      offset < 0 || length < 0 || length > 256 * 1024 || offset + length > size) throw new Error('无效的文件读取范围');
    const start = this.module._cb_result_data() + offset;
    return this.module.HEAPU8.slice(start, start + length).buffer;
  }
  releaseFrameBuffer() {
    if (this.pointer) this.module._free(this.pointer);
    this.pointer = 0;
    this.capacity = 0;
  }
  dispose() { this.releaseFrameBuffer(); }
}

async function loadDecoder(wasmAPI) {
  if (!wasmAPI || typeof wasmAPI.instantiate !== 'function') throw new Error('当前微信环境不支持 WASM 解码，请更新微信并使用真机运行');
  let rejectLoad;
  const failed = new Promise((_, reject) => { rejectLoad = reject; });
  const loading = createCimbarModule({
    print() {},
    printErr(message) { console.warn(message); },
    onAbort(message) { rejectLoad(new Error('解码模块停止运行：' + message)); },
    instantiateWasm(imports, receiveInstance) {
      wasmAPI.instantiate('wasm/cimbar.wasm.br', imports).then(result => {
        receiveInstance(result.instance || result, result.module);
      }).catch(error => rejectLoad(new Error('无法加载解码模块：' + (error.message || error.errMsg || error))));
      return {};
    }
  });
  return new DecoderRuntime(await Promise.race([loading, failed]));
}
module.exports = { DecoderRuntime, loadDecoder };

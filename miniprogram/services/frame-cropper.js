// The copied-camera path owns at most one square staging buffer. It is reused
// only after the preceding Worker request settles; the camera's pixels are read-only.
class FrameCropper {
  prepare(frame) {
    const { width, height, data } = frame;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 ||
      width > 4096 || height > 4096 || width * height > 4096 * 2160 ||
      !(data instanceof ArrayBuffer) || data.byteLength !== width * height * 4) throw new Error('相机帧格式无效');
    const side = Math.min(width, height);
    const cropLeft = Math.floor((width - side) / 2), cropTop = Math.floor((height - side) / 2);
    const bytes = side * side * 4;
    let output = data;
    if (width === height) this.release();
    else {
      // Exact length matters: postMessage clones the whole ArrayBuffer.
      if (!this.pixels || this.pixels.byteLength !== bytes) this.pixels = new Uint8Array(bytes);
      if (width === side) this.pixels.set(new Uint8Array(data, cropTop * width * 4, bytes));
      else {
        const rowBytes = side * 4;
        for (let row = 0; row < side; row++) {
          const offset = ((row + cropTop) * width + cropLeft) * 4;
          this.pixels.set(new Uint8Array(data, offset, rowBytes), row * rowBytes);
        }
      }
      output = this.pixels.buffer;
    }
    return { frame: { width: side, height: side, data: output },
      metrics: { width, height, inputBytes: data.byteLength, postBytes: bytes, cropLeft, cropTop,
        cropBufferBytes: this.pixels ? this.pixels.byteLength : 0 } };
  }
  release() { this.pixels = null; }
}

module.exports = { FrameCropper };

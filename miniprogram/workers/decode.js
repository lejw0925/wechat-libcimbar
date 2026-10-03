const { loadDecoder } = require('./decoder-runtime');
let runtime;
let initializing = false;
let missedCameraFrames = 0;
worker.onMessage(async message => {
  // Some host wrappers expose event.message, while the documented examples
  // deliver the message directly.
  const request = message.type ? message : message.message;
  if (!request) return;
  const { id, type } = request;
  try {
    if (type === 'init') {
      if (initializing) throw new Error('解码器正在初始化');
      initializing = true;
      runtime = await loadDecoder(typeof WXWebAssembly === 'undefined' ? null : WXWebAssembly);
      runtime.reset(request.mode);
      initializing = false;
      missedCameraFrames = 0;
      worker.postMessage({ id, type: 'ready', directCamera: typeof worker.getCameraFrameData === 'function' });
    } else if (type === 'frame' || type === 'camera-frame') {
      if (!runtime) throw new Error('解码器尚未就绪');
      const started = Date.now();
      let frame = request.frame;
      if (type === 'camera-frame') {
        let data;
        try { data = worker.getCameraFrameData(); } catch (_) { /* Fall back to sampled copying. */ }
        if (!(data instanceof ArrayBuffer) || data.byteLength !== request.width * request.height * 4) {
          // The camera can be empty while starting/stopping. Persistent missing
          // data (including unsupported hosts) switches to the compatible path.
          worker.postMessage({ id, type: 'frame', directUnavailable: ++missedCameraFrames >= 8 });
          return;
        }
        missedCameraFrames = 0;
        frame = { width: request.width, height: request.height, data };
      }
      const result = runtime.decode(frame, { square: true });
      worker.postMessage({ id, type: 'frame', result, elapsed: Date.now() - started,
        metrics: runtime.frameInfo });
    } else if (type === 'release-frame') {
      if (runtime) runtime.releaseFrameBuffer();
      worker.postMessage({ id, type: 'released' });
    } else if (type === 'chunk') {
      if (!runtime) throw new Error('解码器尚未就绪');
      worker.postMessage({ id, type: 'chunk', data: runtime.readChunk(request.offset, request.length) });
    }
  } catch (error) {
    initializing = false;
    worker.postMessage({ id, type: 'error', message: error.message || String(error) });
  }
});

class DecoderClient {
  constructor(api, onFrame, onFatal, now = Date.now) {
    this.api = api;
    this.onFrame = onFrame;
    this.onFatal = onFatal;
    this.pending = new Map();
    this.sequence = 0;
    this.busy = false;
    this.ready = false;
    this.closed = false;
    this.directCamera = false;
    this.lastMetrics = null;
    this.now = now;
  }
  async start(mode) {
    let platform;
    try { platform = (this.api.getDeviceInfo ? this.api.getDeviceInfo() : this.api.getSystemInfoSync()).platform; }
    catch (_) { /* Older hosts use the sampled-copy path. */ }
    // iOS can read the camera inside an experimental Worker, avoiding RGBA
    // postMessage copies. Keep ordinary Workers as a compatibility fallback.
    const attempts = platform === 'ios' ? [true, false] : [false];
    for (const experimental of attempts) {
      if (this.closed) throw new Error('接收已停止');
      try {
        const worker = this.api.createWorker('workers/decode.js', { useExperimentalWorker: experimental });
        this.worker = worker;
        this.experimental = experimental;
        worker.onMessage(event => { if (this.worker === worker) this.receive(event.type ? event : event.message); });
        const failed = error => {
          if (this.worker !== worker || this.closed) return;
          const failure = error instanceof Error ? error : new Error(error.errMsg || error.message || '解码线程异常');
          if (this.ready) this.fatal(failure);
          else this.rejectPending(failure);
        };
        if (worker.onError) worker.onError(error => failed(error.error || error));
        if (worker.onProcessKilled) worker.onProcessKilled(() => failed(new Error('系统回收了解码线程，请重新接收')));
        const reply = await this.request('init', { mode }, 30000);
        if (this.closed) throw new Error('接收已停止');
        this.directCamera = experimental && reply.directCamera === true;
        this.ready = true;
        return;
      } catch (error) {
        this.destroyWorker(error);
        if (this.closed || !experimental) throw error;
        this.fallbackReason = error.message || '实验线程不可用';
      }
    }
  }
  request(type, payload, timeout = 15000) {
    if (this.closed) return Promise.reject(new Error('解码器已关闭'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('解码响应超时，请重新接收'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage(Object.assign({ id, type }, payload)); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  receive(message) {
    if (this.closed || !message) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.type === 'error') pending.reject(new Error(message.message));
    else pending.resolve(message);
  }
  pushFrame(frame, onSettled, sourceMetrics) { return this.submitFrame('frame', { frame }, onSettled, sourceMetrics); }
  pullCameraFrame(width, height, onSettled) {
    return this.submitFrame('camera-frame', { width, height }, onSettled);
  }
  submitFrame(type, payload, onSettled, sourceMetrics) {
    if (this.closed || !this.ready || this.busy) return false;
    if (this.samplingPaused) this.lastFrameAt = undefined;
    this.samplingPaused = false;
    const startedAt = this.now();
    const postBytes = type === 'frame' ? payload.frame.data.byteLength : 0;
    let frameMetrics = null;
    this.busy = true;
    this.request(type, payload).then(message => {
      if (this.closed) return;
      if (message.directUnavailable) this.directCamera = false;
      if (message.metrics) {
        const finishedAt = this.now();
        const metrics = Object.assign({ postBytes,
          cropMs: 0, cropBufferBytes: 0 }, message.metrics, sourceMetrics,
        { roundTripMs: Math.max(0, finishedAt - startedAt) });
        if (Number.isFinite(message.elapsed)) metrics.workerElapsedMs = Math.max(0, message.elapsed);
        if (!this.samplingPaused) {
          if (this.lastFrameAt !== undefined && finishedAt > this.lastFrameAt) metrics.frameIntervalMs = finishedAt - this.lastFrameAt;
          this.lastFrameAt = finishedAt;
        }
        this.lastMetrics = metrics;
        frameMetrics = metrics;
      }
      if (message.result) this.onFrame(message.result, message.elapsed);
    }).catch(error => this.fatal(error)).finally(() => {
      this.busy = false;
      if (!this.closed && onSettled) onSettled(frameMetrics);
    });
    return true;
  }
  releaseFrameBuffer() {
    this.samplingPaused = true;
    this.lastFrameAt = undefined;
    if (this.closed || !this.ready) return;
    // Queued after any in-flight decode; never resets the received file packets.
    this.request('release-frame', {}).catch(error => this.fatal(error));
  }
  async readChunk(offset, length) {
    const message = await this.request('chunk', { offset, length });
    return message.data;
  }
  fatal(error) {
    if (this.closed) return;
    this.dispose();
    this.onFatal(error instanceof Error ? error : new Error(error.errMsg || error.message || '解码线程异常'));
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.destroyWorker(new Error('接收已停止'));
  }
  rejectPending(error) {
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.pending.clear();
  }
  destroyWorker(error) {
    this.rejectPending(error);
    const worker = this.worker;
    this.worker = null;
    if (worker) worker.terminate();
  }
}
module.exports = { DecoderClient };

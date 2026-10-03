// Sampling must happen at the camera source, not merely by ignoring 30 fps of
// already-created RGBA ArrayBuffers. No frame queue is kept by this class.
const { AdaptiveSampling, INITIAL_FPS } = require('./adaptive-sampling');
const { FrameCropper } = require('./frame-cropper');
const FRAME_INTERVAL = 1000 / INITIAL_FPS;
const BUSY_RETRY_MS = 8;

class CameraSource {
  constructor(camera, client, onError, timing = {}) {
    this.camera = camera;
    this.client = client;
    this.onError = onError;
    this.delay = timing.setTimeout || setTimeout;
    this.cancel = timing.clearTimeout || clearTimeout;
    this.now = timing.now || Date.now;
    this.sampling = new AdaptiveSampling(this.now, timing.maxFps);
    this.cropper = new FrameCropper();
    this.busyRetries = 0;
    this.closed = false;
    this.phase = 'idle';
    this.transport = 'sampled-copy';
  }
  get interval() { return this.sampling.interval; }
  samplingMetrics() {
    return Object.assign(this.sampling.metrics(), { busyRetries: this.busyRetries,
      cameraWaitMs: this.cameraWaitMs || 0, sampleWorkMs: this.sampleWorkMs || 0 });
  }
  start() {
    try {
      this.listener = this.camera.onCameraFrame(frame => this.receive(frame));
      this.capture();
    } catch (error) { this.fail(error); }
  }
  schedule(action, delay) {
    this.cancel(this.timer);
    if (!this.closed) this.timer = this.delay(() => { if (!this.closed) action(); }, delay);
  }
  capture() {
    if (this.closed || this.client.closed) return;
    if (this.client.busy) { this.retry(() => this.capture()); return; }
    this.cycleStartedAt = this.now();
    this.phase = 'capture';
    this.schedule(() => this.fail(new Error('未收到相机画面，请重新打开接收')), 10000);
    try { this.listener.start({ fail: error => this.fail(error) }); }
    catch (error) { this.fail(error); }
  }
  receive(frame) {
    if (this.closed || !frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)) return;
    if (this.phase === 'direct') {
      // Hosts which still invoke this callback can report orientation changes.
      // Do not retain or forward the native RGBA buffer.
      this.width = frame.width;
      this.height = frame.height;
      return;
    }
    if (this.phase !== 'capture') return;
    this.phase = 'stopping';
    this.cancel(this.timer);
    this.width = frame.width;
    this.height = frame.height;
    this.sampledAt = this.now();
    this.cameraWaitMs = Math.max(0, this.sampledAt - this.cycleStartedAt);
    if (this.client.directCamera) {
      // Bootstrap dimensions once using the standard callback. Direct access
      // returns just an ArrayBuffer, not a width/height pair.
      frame = null;
      this.halt(() => this.bindDirect());
    } else {
      this.halt(() => {
        // Never overwrite a staging buffer while the previous frame is in flight.
        if (this.client.busy) { frame = null; this.retry(() => this.capture()); return; }
        try {
          const started = this.now();
          const prepared = this.cropper.prepare(frame);
          frame = null; // Do not retain the full native image in a stop callback.
          prepared.metrics.cropMs = Math.max(0, this.now() - started);
          if (!this.client.pushFrame(prepared.frame, metrics => this.afterFrame(metrics, () => this.capture()), prepared.metrics)) {
            this.retry(() => this.capture());
          }
        } catch (error) { this.fail(error); }
      });
    }
  }
  halt(next) {
    this.schedule(() => this.fail(new Error('相机暂停超时，请重新打开接收')), 10000);
    try {
      this.listener.stop({ success: () => {
        this.cancel(this.timer);
        if (!this.closed) next();
      }, fail: error => this.fail(error) });
    } catch (error) { this.fail(error); }
  }
  retry(action) {
    this.busyRetries++;
    this.schedule(action, BUSY_RETRY_MS);
  }
  afterFrame(metrics, next) {
    if (this.closed) return;
    this.sampleWorkMs = Math.max(0, this.now() - this.sampledAt);
    this.sampling.observe(metrics, this.sampleWorkMs);
    // Count listener start/stop, cropping and decoding inside the same period.
    this.schedule(next, Math.max(0, this.interval - (this.now() - this.cycleStartedAt)));
  }
  bindDirect() {
    if (this.closed) return;
    this.phase = 'direct';
    this.transport = 'ios-worker-camera';
    const fallback = () => {
      if (this.closed || this.phase !== 'direct') return;
      this.client.directCamera = false;
      this.sampling.reset();
      this.transport = 'sampled-copy';
      this.phase = 'stopping';
      this.halt(() => this.capture());
    };
    this.schedule(fallback, 10000);
    try {
      this.listener.start({ worker: this.client.worker,
        success: () => { if (!this.closed && this.phase === 'direct') this.schedule(() => this.poll(), this.interval); },
        fail: fallback });
    } catch (_) { fallback(); }
  }
  poll() {
    if (this.closed || this.client.closed) return;
    if (!this.client.directCamera) {
      this.transport = 'sampled-copy';
      this.sampling.reset();
      this.phase = 'stopping';
      this.halt(() => this.capture());
      return;
    }
    if (this.client.busy) { this.retry(() => this.poll()); return; }
    this.cycleStartedAt = this.sampledAt = this.now();
    this.cameraWaitMs = 0;
    if (!this.client.pullCameraFrame(this.width, this.height, metrics => this.afterFrame(metrics, () => this.poll()))) {
      this.retry(() => this.poll());
    }
  }
  fail(error) {
    if (this.closed) return;
    this.stop();
    this.onError(error);
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    this.cancel(this.timer);
    if (this.listener) {
      try { this.listener.stop({ fail() {} }); } catch (_) { /* Camera may already be gone. */ }
      this.listener = null;
    }
    this.camera = null;
    this.cropper.release();
  }
}
module.exports = { CameraSource, FRAME_INTERVAL, BUSY_RETRY_MS };

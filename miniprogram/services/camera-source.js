// Sampling must happen at the camera source, not merely by ignoring 30 fps of
// already-created RGBA ArrayBuffers. No frame queue is kept by this class.
const FRAME_INTERVAL = 250;

class CameraSource {
  constructor(camera, client, onError, timing = {}) {
    this.camera = camera;
    this.client = client;
    this.onError = onError;
    this.delay = timing.setTimeout || setTimeout;
    this.cancel = timing.clearTimeout || clearTimeout;
    this.now = timing.now || Date.now;
    this.interval = timing.interval || FRAME_INTERVAL;
    this.closed = false;
    this.phase = 'idle';
    this.transport = 'sampled-copy';
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
    if (this.closed) return;
    if (this.client.busy) { this.schedule(() => this.capture(), this.interval); return; }
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
    if (this.client.directCamera) {
      // Bootstrap dimensions once using the standard callback. Direct access
      // returns just an ArrayBuffer, not a width/height pair.
      this.halt(() => this.bindDirect());
    } else {
      this.halt(() => {
        if (!this.client.pushFrame(frame, () => this.afterCopy())) this.afterCopy();
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
  afterCopy() {
    this.schedule(() => this.capture(), Math.max(0, this.interval - (this.now() - this.sampledAt)));
  }
  bindDirect() {
    if (this.closed) return;
    this.phase = 'direct';
    this.transport = 'ios-worker-camera';
    const fallback = () => {
      if (this.closed || this.phase !== 'direct') return;
      this.client.directCamera = false;
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
    if (this.closed) return;
    if (!this.client.directCamera) {
      this.transport = 'sampled-copy';
      this.phase = 'stopping';
      this.halt(() => this.capture());
      return;
    }
    this.sampledAt = this.now();
    const next = () => this.schedule(() => this.poll(), Math.max(0, this.interval - (this.now() - this.sampledAt)));
    if (!this.client.pullCameraFrame(this.width, this.height, next)) next();
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
  }
}
module.exports = { CameraSource, FRAME_INTERVAL };

const STORAGE_KEY = 'cimbar-receive-diagnostics';
const PREVIOUS_STORAGE_KEY = 'cimbar-previous-receive-diagnostics';
const REVISION = 'adaptive-sampling-9';

// At most two small snapshots, never pixels, file contents or filenames.
// Keep the previous run because the scanner now starts automatically on launch.
class ReceiveDiagnostics {
  constructor(api) {
    this.api = api;
    try {
      const stored = api.getStorageSync(STORAGE_KEY);
      this.data = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
    } catch (_) { this.data = null; }
    try {
      const previous = api.getStorageSync(PREVIOUS_STORAGE_KEY);
      this.previous = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : null;
    } catch (_) { this.previous = null; }
    this.savedAt = 0;
  }
  begin(mode) {
    if (this.data) {
      this.previous = this.data;
      try { this.api.setStorageSync(PREVIOUS_STORAGE_KEY, this.previous); } catch (_) {}
    }
    let device = {}, app = {};
    try { device = this.api.getDeviceInfo ? this.api.getDeviceInfo() : this.api.getSystemInfoSync(); } catch (_) {}
    try { app = this.api.getAppBaseInfo ? this.api.getAppBaseInfo() : {}; } catch (_) {}
    this.data = { revision: REVISION, startedAt: new Date().toISOString(), mode,
      platform: device.platform, model: device.model, system: device.system,
      wechat: app.version, sdk: app.SDKVersion, peakHeapBytes: 0, memoryWarnings: 0 };
    this.savedAt = 0;
  }
  record(info, force = false) {
    if (!this.data) return;
    Object.assign(this.data, info, { updatedAt: new Date().toISOString() });
    this.data.peakHeapBytes = Math.max(this.data.peakHeapBytes || 0, info.heapBytes || 0);
    const now = Date.now();
    if (!force && now - this.savedAt < 5000) return;
    this.savedAt = now;
    try { this.api.setStorageSync(STORAGE_KEY, this.data); } catch (_) { /* Diagnostics must never block receiving. */ }
  }
}
module.exports = { ReceiveDiagnostics, STORAGE_KEY, PREVIOUS_STORAGE_KEY };

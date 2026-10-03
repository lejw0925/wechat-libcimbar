const STORAGE_KEY = 'cimbar-receive-diagnostics';
const REVISION = 'square-speed-3';

// One small local snapshot, not a frame log. Never store pixels, file contents,
// or filenames. It survives an OS kill so a device report remains useful.
class ReceiveDiagnostics {
  constructor(api) {
    this.api = api;
    try {
      const stored = api.getStorageSync(STORAGE_KEY);
      this.data = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
    } catch (_) { this.data = null; }
    this.savedAt = 0;
  }
  begin(mode) {
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
module.exports = { ReceiveDiagnostics, STORAGE_KEY };

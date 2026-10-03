// Rolling useful-payload throughput. The native counter excludes duplicate
// fountain packets, camera pixels, and Reed–Solomon/protocol overhead. Distinct
// repair packets still count, so this is not the decompressed file's write rate.
class TransferRate {
  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
    this.bytes = 0;
    this.buckets = [];
    this.active = false;
  }
  resume(now = Date.now()) {
    this.startedAt = now;
    this.buckets = [];
    this.active = true;
  }
  pause() { this.active = false; this.buckets = []; }
  observe(bytes, now = Date.now()) {
    if (!Number.isFinite(bytes) || bytes < 0) return;
    if (bytes < this.bytes) {
      // A new decoder session must not turn a counter reset into a rate spike.
      this.buckets = [];
      this.startedAt = now;
    }
    const delta = Math.max(0, bytes - this.bytes);
    this.bytes = bytes;
    this.prune(now);
    if (!this.active || !delta) return;
    const at = Math.floor(now / 250) * 250;
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.at === at) last.bytes += delta;
    else this.buckets.push({ at, bytes: delta });
    // Normally at most 13 time buckets. Also bound abnormal clock changes.
    if (this.buckets.length > 16) this.buckets.shift();
  }
  prune(now) {
    while (this.buckets.length && this.buckets[0].at <= now - this.windowMs) this.buckets.shift();
  }
  value(now = Date.now()) {
    if (!this.active) return 0;
    this.prune(now);
    const duration = Math.min(this.windowMs, Math.max(1000, now - this.startedAt));
    return this.buckets.reduce((sum, bucket) => sum + bucket.bytes, 0) * 1000 / duration;
  }
}
module.exports = { TransferRate };

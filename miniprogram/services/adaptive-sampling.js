const FPS_STEPS = [4, 8, 12, 20];
const INITIAL_FPS = 8;
const UPGRADE_DELAY_MS = 1500;

// Keep a few scalar estimates, never a queue of frames or timing samples.
class AdaptiveSampling {
  constructor(now = Date.now, maxFps = 20) {
    this.now = now;
    this.steps = FPS_STEPS.filter(fps => fps <= Math.max(4, maxFps));
    this.reset();
  }
  reset() {
    this.index = Math.max(0, this.steps.indexOf(INITIAL_FPS));
    this.workMs = undefined;
    this.fast = 0;
    this.slow = 0;
    this.changes = 0;
    this.upgradeAfter = this.now() + UPGRADE_DELAY_MS;
  }
  get fps() { return this.steps[this.index]; }
  get interval() { return 1000 / this.fps; }
  observe(metrics, activeMs) {
    // Missing camera frames and replies without timings cannot justify an upgrade.
    if (!metrics || !Number.isFinite(metrics.workerElapsedMs) || metrics.workerElapsedMs < 0 ||
      !Number.isFinite(metrics.roundTripMs) || metrics.roundTripMs < 0 || !Number.isFinite(activeMs) || activeMs < 0) {
      this.fast = 0;
      this.slow = 0;
      return;
    }
    const cost = Math.max(metrics.workerElapsedMs, metrics.roundTripMs, activeMs);
    this.workMs = this.workMs === undefined ? cost : this.workMs * .75 + cost * .25;
    this.slow = cost >= this.interval * .9 ? this.slow + 1 : 0;
    if (this.index > 0 && (cost >= this.interval * 1.25 || this.slow >= 2)) {
      this.change(this.index - 1);
      return;
    }
    const next = this.steps[this.index + 1];
    const spacing = Number.isFinite(metrics.frameIntervalMs) && metrics.frameIntervalMs > 0 ? metrics.frameIntervalMs : this.interval;
    const spare = next && cost <= this.interval * .65 && cost <= (1000 / next) * .8 &&
      this.workMs <= (1000 / next) * .75 && spacing >= cost * 1.5;
    this.fast = spare ? this.fast + 1 : 0;
    if (this.fast >= 8 && this.now() >= this.upgradeAfter) this.change(this.index + 1);
  }
  change(index) {
    this.index = index;
    this.changes++;
    this.fast = 0;
    this.slow = 0;
    this.upgradeAfter = this.now() + UPGRADE_DELAY_MS;
  }
  metrics() {
    return { targetFps: this.fps, targetFrameIntervalMs: this.interval,
      samplingWorkMs: this.workMs === undefined ? undefined : Math.round(this.workMs * 100) / 100,
      samplingChanges: this.changes, samplingMaxFps: this.steps[this.steps.length - 1] };
  }
}

module.exports = { AdaptiveSampling, FPS_STEPS, INITIAL_FPS };

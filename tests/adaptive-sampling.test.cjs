const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AdaptiveSampling } = require('../miniprogram/services/adaptive-sampling');

function simulation(maxFps) {
  let now = 0;
  const sampling = new AdaptiveSampling(() => now, maxFps);
  return { sampling, frame(worker = 20, roundTrip = 30, active = roundTrip, spacing) {
    now += sampling.interval;
    sampling.observe({ workerElapsedMs: worker, roundTripMs: roundTrip,
      frameIntervalMs: spacing === undefined ? sampling.interval : spacing }, active);
  }, missing() { now += sampling.interval; sampling.observe(null, 0); } };
}

test('sustained timing headroom climbs 8, 12, 20 fps without skipping a stage', () => {
  const h = simulation(), stages = [h.sampling.fps];
  for (let i = 0; i < 100; i++) {
    h.frame();
    if (h.sampling.fps !== stages.at(-1)) stages.push(h.sampling.fps);
  }
  assert.deepEqual(stages, [8, 12, 20]);
  assert.equal(h.sampling.interval, 50);
  assert.equal(h.sampling.metrics().samplingChanges, 2);
});

test('overload lowers the rate promptly and recovery requires sustained spare capacity', () => {
  const h = simulation();
  for (let i = 0; i < 100; i++) h.frame();
  h.frame(46, 46); assert.equal(h.sampling.fps, 20);
  h.frame(46, 46); assert.equal(h.sampling.fps, 12);
  h.frame(180, 200); assert.equal(h.sampling.fps, 8);
  h.frame(180, 200); assert.equal(h.sampling.fps, 4);
  for (let i = 0; i < 4; i++) h.frame();
  assert.equal(h.sampling.fps, 4, 'a few cheap frames cannot erase a load spike');
  for (let i = 0; i < 120; i++) h.frame();
  assert.equal(h.sampling.fps, 20);
});

test('bridge latency, preprocessing and actual cadence prevent misleading upgrades', () => {
  const slowBridge = simulation(), slowPreparation = simulation(), noIdle = simulation();
  for (let i = 0; i < 60; i++) {
    slowBridge.frame(5, 100);
    slowPreparation.frame(5, 20, 160);
    noIdle.frame(10, 25, 25, 25);
  }
  assert.equal(slowBridge.sampling.fps, 8);
  assert.equal(slowPreparation.sampling.fps, 4);
  assert.equal(noIdle.sampling.fps, 8);
});

test('missing replies do not recycle stale timings and a memory cap stays at 4 fps', () => {
  const h = simulation(), limited = simulation(4);
  for (let i = 0; i < 100; i++) {
    h.frame(); h.missing(); limited.frame(1, 2);
  }
  assert.equal(h.sampling.fps, 8);
  assert.equal(limited.sampling.fps, 4);
  assert.equal(limited.sampling.metrics().samplingMaxFps, 4);
  h.sampling.reset();
  assert.equal(h.sampling.fps, 8); assert.equal(h.sampling.metrics().samplingWorkMs, undefined);
});

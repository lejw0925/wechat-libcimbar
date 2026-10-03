const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { manageReceivedFile } = require('../miniprogram/services/history-actions');

function gesture(expanded = false) {
  const scope = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync('miniprogram/components/history-sheet/motion.wxs', 'utf8'), scope);
  const motion = scope.module.exports, state = {}, styles = {}, calls = [];
  let now = 0, timerId = 0;
  const timers = new Map();
  const owner = { getState: () => state,
    selectComponent: name => ({ setStyle: values => { styles[name] = { ...styles[name], ...values }; } }),
    setTimeout(fn, delay) { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    callMethod: (name, detail) => calls.push({ name, detail: JSON.parse(JSON.stringify(detail)) }) };
  const config = { height: 700, peek: 150, expanded, disabled: false, version: 0 };
  motion.sync(config, null, owner);
  const event = (y, time, identifier = 1) => ({ touches: [{ identifier, clientY: y }], timeStamp: time });
  return { motion, state, styles, calls, config, owner, event,
    start(y, time = 0) { motion.start(event(y, time), owner); },
    move(y, time) { motion.move(event(y, time), owner); },
    end(time) { motion.end({ timeStamp: time, touches: [] }, owner); },
    cancel() { motion.cancel({}, owner); },
    advance(ms = 280) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    sync(values) { Object.assign(config, values); motion.sync({ ...config }, null, owner); } };
}

test('drag follows every move and camera settlement waits until after the snap animation', () => {
  const h = gesture();
  h.start(700);
  h.move(650, 100);
  assert.equal(h.styles['.history-panel'].transform, 'translate3d(0,500px,0)');
  const firstOpacity = h.styles['.history-body'].opacity;
  h.move(425, 600);
  assert.equal(h.styles['.history-panel'].transform, 'translate3d(0,275px,0)');
  assert.equal(h.styles['.history-body'].filter, undefined, 'history no longer uses blur');
  assert.ok(h.styles['.history-body'].opacity > firstOpacity);
  assert.equal(h.styles['.history-peek-fade'].opacity, .5);
  assert.equal(h.styles['.history-panel'].transition, 'none');
  assert.deepEqual(h.calls.map(call => call.name), ['dragStarted']);
  h.end(800);
  assert.equal(h.styles['.history-panel'].transform, 'translate3d(0,0px,0)');
  h.advance(240);
  assert.deepEqual(h.calls.map(call => call.name), ['dragStarted'], 'no camera lifecycle call during the snap');
  h.advance(40);
  assert.equal(h.calls.at(-1).detail.expanded, true);
});

test('a short slow pull folds back, a fast upward fling opens, and downward dragging closes', () => {
  const slow = gesture(); slow.start(700); slow.move(650, 600); slow.end(800);
  slow.advance();
  assert.equal(slow.calls.at(-1).detail.expanded, false);
  const fast = gesture(); fast.start(700); fast.move(660, 40); fast.end(60);
  fast.advance();
  assert.equal(fast.calls.at(-1).detail.expanded, true);
  const close = gesture(true); close.start(100); close.move(170, 80); close.end(90);
  assert.deepEqual(close.calls.map(call => call.name), ['dragStarted'], 'camera must not restart while closing');
  close.advance();
  assert.equal(close.calls.at(-1).detail.expanded, false);
});

test('cancel restores the original detent and long holds do not retain stale fling velocity', () => {
  for (const expanded of [false, true]) {
    const h = gesture(expanded); h.start(400); h.move(expanded ? 450 : 350, 30); h.cancel();
    h.advance();
    assert.equal(h.calls.at(-1).detail.expanded, expanded);
  }
  const held = gesture(); held.start(700); held.move(660, 40); held.end(500);
  held.advance();
  assert.equal(held.calls.at(-1).detail.expanded, false);
});

test('positions remain bounded, ordinary data refreshes preserve a live drag, and resize ends it safely', () => {
  const h = gesture(); h.start(700); h.move(-900, 100);
  assert.equal(h.state.offset, 0);
  h.sync({}); assert.equal(h.state.down, true); assert.equal(h.state.offset, 0);
  h.move(2000, 300); assert.equal(h.state.offset, 550);
  h.sync({ height: 500, peek: 116 });
  assert.equal(h.state.down, false); assert.equal(h.state.offset, 384);
  assert.equal(h.calls.at(-1).detail.expanded, false);
});

test('writing blocks opening, multi-touch cancels a drag, and a release tap cannot flip a settled sheet', () => {
  const locked = gesture(); locked.sync({ disabled: true }); locked.start(700); locked.move(400, 100); locked.end(120);
  assert.deepEqual(locked.calls, []);
  const multiple = gesture(); multiple.start(700); multiple.move(600, 100);
  multiple.motion.move({ touches: [{ identifier: 1, clientY: 580 }, { identifier: 2, clientY: 600 }], timeStamp: 120 }, multiple.owner);
  multiple.advance();
  assert.equal(multiple.calls.at(-1).detail.expanded, false);
  const h = gesture(); h.start(700); h.move(660, 40); h.end(60);
  h.advance();
  const count = h.calls.length;
  h.motion.tap({}, h.owner); assert.equal(h.calls.length, count);
  h.start(100, 1000); h.end(1005); h.motion.tap({}, h.owner);
  h.advance();
  assert.equal(h.calls.at(-1).detail.expanded, false);
});

test('history only deletes the selected record after explicit native confirmation', async () => {
  const deleted = [];
  const store = { get: async id => ({ id, name: '保留.txt', status: 'saved' }), remove: async id => deleted.push(id) };
  const api = { showActionSheet: options => options.success({ tapIndex: 3 }),
    showModal: options => options.success({ confirm: false }) };
  await manageReceivedFile(api, store, 'a-b'); assert.deepEqual(deleted, []);
  api.showModal = options => options.success({ confirm: true });
  await manageReceivedFile(api, store, 'a-b'); assert.deepEqual(deleted, ['a-b']);
});

test('grabbing a sheet during its snap animation continues from the visible position', () => {
  const h = gesture();
  const select = h.owner.selectComponent;
  h.owner.selectComponent = name => ({ ...select(name), getBoundingClientRect: () =>
    name === '.history-dim' ? { height: 800 } : { top: 300 } });
  h.start(350); h.move(300, 200);
  assert.equal(h.state.offset, 150, 'visible offset 200 minus the 50px finger movement');
});

test('a new touch cancels pending camera settlement even before the drag threshold', () => {
  const h = gesture();
  h.start(700); h.move(660, 40); h.end(60);
  h.advance(120);
  h.sync({}); // A receive progress update must not commit/cancel the snap.
  h.start(150, 180);
  h.advance(300);
  assert.deepEqual(h.calls.map(call => call.name), ['dragStarted']);
  h.move(250, 200); h.end(220); h.advance();
  assert.equal(h.calls.at(-1).detail.expanded, false);
  assert.equal(h.calls.filter(call => call.name === 'settled').length, 1);
});

test('backgrounding or writing cancels delayed expansion and stale timer callbacks', () => {
  for (const change of [{ expanded: false, version: 1 }, { disabled: true }]) {
    const h = gesture();
    const callbacks = [], schedule = h.owner.setTimeout;
    h.owner.setTimeout = (fn, delay) => { callbacks.push(fn); return schedule(fn, delay); };
    h.start(700); h.move(660, 40); h.end(60);
    h.sync(change);
    const count = h.calls.length;
    for (const callback of callbacks) callback(); // Simulate a callback already queued before cancellation.
    h.advance();
    assert.equal(h.calls.length, count);
    assert.equal(h.calls.at(-1).detail.expanded, false);
  }
});

test('downward pulls on file rows or blank content fold the sheet at the top of the list', () => {
  const h = gesture(true);
  assert.equal(h.motion.bodyStart(h.event(400, 0), h.owner), true);
  assert.equal(h.motion.bodyMove(h.event(500, 100), h.owner), false, 'consume the closing gesture');
  assert.equal(h.state.offset, 100);
  assert.deepEqual(h.calls.map(call => call.name), ['dragStarted']);
  h.motion.bodyEnd({ timeStamp: 110, touches: [] }, h.owner);
  h.motion.fileTap({ currentTarget: { dataset: { id: 'a-b' } } }, h.owner);
  assert.equal(h.calls.length, 1, 'dragging a row must not open its file action sheet');
  h.advance();
  assert.equal(h.calls.at(-1).detail.expanded, false);
  assert.equal(h.motion.block(), false, 'the backdrop consumes touch moves');
});

test('long history lists keep native scrolling and hand a pull to the drawer only at the top', () => {
  const h = gesture(true);
  h.motion.scrolled({ detail: { scrollTop: 200 } }, h.owner);
  h.motion.bodyStart(h.event(400, 0), h.owner);
  assert.equal(h.motion.bodyMove(h.event(500, 100), h.owner), true);
  assert.equal(h.state.offset, 0); assert.equal(h.calls.length, 0);
  h.motion.scrolled({ detail: { scrollTop: 0 } }, h.owner);
  assert.equal(h.motion.bodyMove(h.event(520, 120), h.owner), false);
  assert.equal(h.state.offset, 20, 'prior list scrolling is not added to drawer movement');
  h.motion.bodyCancel({}, h.owner); h.advance();
  assert.equal(h.calls.at(-1).detail.expanded, true);

  const up = gesture(true);
  up.motion.bodyStart(up.event(400, 0), up.owner);
  assert.equal(up.motion.bodyMove(up.event(300, 100), up.owner), true);
  up.motion.bodyEnd({ timeStamp: 110, touches: [] }, up.owner);
  assert.equal(up.state.offset, 0); assert.equal(up.calls.length, 0);
});

test('a normal row tap still opens the selected file; multi-touch cannot leave a half-open drawer', () => {
  const h = gesture(true);
  h.motion.bodyStart(h.event(400, 0), h.owner);
  h.motion.bodyEnd({ timeStamp: 10, touches: [] }, h.owner);
  h.motion.fileTap({ currentTarget: { dataset: { id: 'a-b' } } }, h.owner);
  assert.deepEqual(h.calls, [{ name: 'fileTap', detail: { id: 'a-b' } }]);
  h.motion.bodyStart(h.event(400, 1000), h.owner);
  h.motion.bodyMove(h.event(500, 1100), h.owner);
  h.motion.bodyStart({ touches: [{ identifier: 1, clientY: 500 }, { identifier: 2, clientY: 510 }], timeStamp: 1101 }, h.owner);
  h.advance();
  assert.equal(h.state.offset, 0); assert.equal(h.calls.at(-1).detail.expanded, true);
});

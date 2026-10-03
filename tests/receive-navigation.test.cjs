const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { MODES, STORAGE_KEY, indexForValue, normalizeIndex, readModeIndex, writeModeIndex } = require('../miniprogram/utils/receive-modes');
const { STORAGE_KEY: DIAGNOSTICS_KEY, PREVIOUS_STORAGE_KEY } = require('../miniprogram/services/receive-diagnostics');
const { navigationLayout } = require('../miniprogram/utils/navigation-layout');

function pageInstance(name, api = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: page => { definition = page; }, require: createRequire(filename),
    wx: { env: { USER_DATA_PATH: '/sandbox' }, getFileSystemManager: () => ({}),
      setKeepScreenOn() {}, vibrateShort() {}, ...api },
    console, setTimeout, clearTimeout
  }, { filename });
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update); }
  });
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('five discrete slider positions preserve protocol modes and invalid values fall back safely', () => {
  assert.deepEqual(MODES.map(mode => mode.value), [68, 67, 66, 4, 8]);
  for (const [index, mode] of MODES.entries()) {
    assert.equal(indexForValue(mode.value), index);
    assert.equal(indexForValue(String(mode.value)), index);
    assert.equal(normalizeIndex(String(index)), index);
  }
  for (const value of [undefined, null, '', 'no-mode', 0, 1, 99, NaN]) assert.equal(indexForValue(value), 0);
  for (const value of [undefined, 'oops', -1, 5, 0.5, 68, Infinity]) assert.equal(normalizeIndex(value), 0);
  assert.equal(readModeIndex({ getStorageSync: () => 67 }), 1);
  assert.equal(readModeIndex({ getStorageSync: () => { throw new Error('unavailable'); } }), 0);
  assert.doesNotThrow(() => writeModeIndex({ setStorageSync() { throw new Error('full'); } }, 2));
});

test('More previews slider changes, committing only on release or a labeled stop tap', () => {
  const writes = [];
  const more = pageInstance('more', { getStorageSync: () => 67,
    setStorageSync: (key, value) => writes.push([key, value]) });
  more.onLoad();
  assert.equal(more.data.modeLabel, 'B · Mini');
  more.modeChanging({ detail: { value: 2 } });
  assert.equal(more.data.modeLabel, 'B · Micro');
  assert.match(more.data.modeDetail, /Mode B Micro/);
  assert.deepEqual(writes, []);
  more.modeChange({ detail: { value: 2 } });
  assert.deepEqual(writes, [[STORAGE_KEY, 66]]);
  more.modeTap({ currentTarget: { dataset: { index: 4 } } });
  assert.equal(more.data.modeLabel, '旧版 · 8 色');
  assert.deepEqual(writes.at(-1), [STORAGE_KEY, 8]);
  more.modeChange({ detail: { value: 999 } });
  assert.equal(more.data.modeIndex, 0);
});

test('More starts no camera and offers both current and previous diagnostics without overwriting them', () => {
  const current = { revision: 'ios-scanner-5', progress: 0 };
  const previous = { revision: 'two-page-4', progress: 15, memoryWarnings: 1 };
  const storage = new Map([[STORAGE_KEY, 68], [DIAGNOSTICS_KEY, current], [PREVIOUS_STORAGE_KEY, previous]]);
  const copied = [];
  const more = pageInstance('more', {
    getStorageSync: key => storage.get(key),
    setStorageSync() { assert.fail('opening More must not overwrite diagnostic snapshots'); },
    createWorker() { assert.fail('must not start a Worker'); },
    createCameraContext() { assert.fail('must not open a camera'); },
    authorize() { assert.fail('must not request camera permission'); },
    setClipboardData: options => copied.push(JSON.parse(options.data))
  });
  more.onLoad(); more.onShow();
  assert.equal(more.data.helpOpen, false);
  assert.equal(more.data.hasDiagnostics, true);
  assert.equal(more.data.hasPreviousDiagnostics, true);
  more.copyDiagnostics(); more.copyPreviousDiagnostics();
  assert.deepEqual(copied, [current, previous]);
  more.toggleHelp(); assert.equal(more.data.helpOpen, true);
});

test('scanner uses the last selection on launch and validates legacy routed mode values', () => {
  for (const mode of MODES) {
    const page = pageInstance('receive', { getStorageSync: () => mode.value });
    page.onLoad();
    assert.equal(page.data.modeValue, mode.value);
    assert.equal(page.data.modeLabel, mode.label);
    assert.equal(page.modeChange, undefined);
  }
  const page = pageInstance('receive');
  page.onLoad({ mode: '67' }); assert.equal(page.data.modeValue, 67);
  page.onLoad({ mode: 'invalid' }); assert.equal(page.data.modeValue, 68);
});

test('launch starts the scanner once, and foregrounding preserves a paused session', () => {
  const page = pageInstance('receive');
  let starts = 0;
  page.start = () => { starts++; page.update({ phase: 'scanning', progress: 15 }); };
  page.onLoad(); page.onShow();
  assert.equal(starts, 0);
  page.onReady(); assert.equal(starts, 1);
  page.onHide(); page.onShow(); page.onReady();
  assert.equal(starts, 1);
  assert.equal(page.data.phase, 'paused');
  assert.equal(page.data.progress, 15);
});

test('hidden or unloaded scanners cannot auto-start', () => {
  const page = pageInstance('receive');
  let starts = 0;
  page.start = () => { starts++; };
  page.onLoad(); page.onHide(); page.onReady();
  assert.equal(starts, 0);
  page.onShow(); assert.equal(starts, 1);
  const exited = pageInstance('receive');
  exited.start = () => assert.fail('late readiness must not restart');
  exited.onLoad(); exited.onUnload(); exited.onReady(); exited.onShow();
});

test('More pauses camera, preserves its Worker and progress, and blocks duplicate navigation', () => {
    const routes = [];
    let stopped = 0, disposed = 0;
    const page = pageInstance('receive', { navigateTo: options => routes.push(options.url) });
    page.onLoad();
    page.update({ phase: 'scanning', progress: 15, cameraVisible: true });
    page._source = { stop() { stopped++; } };
    const client = page._client = { dispose() { disposed++; } };
    page.openMore(); page.openMore();
    assert.deepEqual(routes, ['/pages/more/index']);
    assert.equal(page.data.phase, 'paused'); assert.equal(page.data.cameraVisible, false);
    assert.equal(stopped, 1); assert.equal(disposed, 0);
    page.onHide(); page.onShow();
    assert.equal(page.data.progress, 15); assert.equal(page._client, client);
    assert.equal(page.data.phase, 'paused');
});

test('failed navigation unlocks actions and keeps received progress', () => {
  let navigation;
  const page = pageInstance('receive', { navigateTo: options => { navigation = options; } });
  page.onLoad(); page.update({ phase: 'scanning', progress: 15 });
  page.openMore();
  navigation.fail({ errMsg: 'navigateTo:fail' });
  assert.equal(page._openingPanel, false);
  assert.equal(page._panel, null);
  assert.equal(page.data.progress, 15);
  assert.match(page.data.error, /navigateTo:fail/);
});

test('navigation is temporarily unavailable while a file is being written or renamed on disk', () => {
  const page = pageInstance('receive', { navigateTo() { assert.fail('must wait for persistence'); } });
  page.onLoad(); page.update({ phase: 'writing' }); page.openMore(); page.historyOpening();
  page.update({ phase: 'rename', saving: true }); page.openMore(); page.historyOpening();
  assert.equal(page._openingPanel, undefined);
  assert.equal(page._historyActive, undefined);
});

test('opening More during initialization invalidates late authorization instead of starting a hidden Worker', async () => {
  let authorize;
  const page = pageInstance('receive', {
    canIUse: () => true, authorize: options => { authorize = options.success; },
    createWorker() { assert.fail('must not start after navigating away'); }, navigateTo() {}
  });
  page.onLoad(); page.onReady(); await tick();
  page.openMore(); page.onHide(); authorize(); await tick();
  assert.equal(page.data.phase, 'paused');
  assert.equal(page._client, null);
});

test('unloading during privacy or camera authorization prevents late permissions and Worker creation', async () => {
  for (const waitFor of ['privacy', 'camera']) {
    let release, authorized = 0;
    const page = pageInstance('receive', {
      canIUse: () => true,
      requirePrivacyAuthorize(options) { if (waitFor === 'privacy') release = options.success; else options.success(); },
      authorize(options) { authorized++; release = options.success; },
      createWorker() { assert.fail('must not create a Worker after leaving'); }
    });
    page.onLoad(); page.onReady(); await tick();
    page.onUnload(); release(); await tick();
    assert.equal(authorized, waitFor === 'privacy' ? 0 : 1);
    assert.equal(page._client, null); assert.equal(page._speedTimer, null);
  }
});

test('canceling a settings mode change restores the preference without dropping progress', async () => {
  const writes = [];
  let disposed = 0, prompted = 0;
  const page = pageInstance('receive', {
    getStorageSync: () => 66, setStorageSync: (key, value) => writes.push([key, value]),
    showModal: options => { prompted++; options.success({ confirm: false }); }
  });
  page.onLoad({ mode: '68' }); page.update({ phase: 'paused', progress: 15 });
  page._client = { dispose() { disposed++; } };
  page.start = () => assert.fail('must not restart after cancel');
  await page.applyPreferredMode();
  assert.equal(prompted, 1); assert.equal(disposed, 0);
  assert.equal(page.data.modeValue, 68); assert.equal(page.data.progress, 15);
  assert.deepEqual(writes, [[STORAGE_KEY, 68]]);
});

test('confirming a mode change releases the old Worker before starting a fresh mode', async () => {
  const order = [];
  const page = pageInstance('receive', {
    getStorageSync: () => 67, showModal: options => options.success({ confirm: true })
  });
  page.onLoad({ mode: '68' }); page.update({ phase: 'paused', progress: 15 });
  page._client = { dispose: () => order.push('dispose') };
  page.start = () => { order.push('start'); assert.equal(page.data.modeValue, 67); assert.equal(page.data.progress, 0); };
  await page.applyPreferredMode();
  assert.deepEqual(order, ['dispose', 'start']);
});

test('changing mode before any payload arrives needs no discard warning, but sub-percent progress does', async () => {
  for (const received of [0, 1]) {
    let prompts = 0, starts = 0;
    const page = pageInstance('receive', { getStorageSync: () => 66,
      showModal: options => { prompts++; options.success({ confirm: true }); } });
    page.onLoad({ mode: '68' }); page.update({ phase: 'paused', progress: 0 });
    page._receivedBytes = received; page.start = () => starts++;
    await page.applyPreferredMode();
    assert.equal(prompts, received); assert.equal(starts, 1); assert.equal(page.data.modeValue, 66);
  }
});

test('mode preferences defer until the next file when writing, naming, saved, or retrying a write', async () => {
  for (const phase of ['writing', 'rename', 'saved', 'error']) {
    const page = pageInstance('receive', { getStorageSync: () => 66,
      showModal() { assert.fail('completed files must not be discarded for a mode preference'); } });
    page.onLoad({ mode: '68' });
    page.update({ phase, progress: 100, canRetrySave: phase === 'error' });
    const record = page._record = { id: 'a-b' };
    page.start = () => assert.fail('must finish naming or retrying first');
    await page.applyPreferredMode();
    assert.equal(page.data.phase, phase); assert.equal(page.data.modeValue, 68);
    assert.equal(page._nextMode.value, 66); assert.equal(page._record, record);
  }
});

test('late decode completion during a mode confirmation cannot lose the newly durable file', async () => {
  let answer;
  const page = pageInstance('receive', { getStorageSync: () => 67,
    showModal: options => { answer = options.success; } });
  page.onLoad({ mode: '68' }); page.update({ phase: 'paused', progress: 15 });
  page.start = () => assert.fail('completed file must still be named');
  const sync = page.applyPreferredMode();
  page.update({ phase: 'rename', progress: 100 });
  answer({ confirm: true }); await sync;
  assert.equal(page.data.phase, 'rename'); assert.equal(page._nextMode.value, 67);
});

test('real DecoderClient uses every selected mode and unload terminates it without live timers', async () => {
  for (const mode of MODES) {
    let listener, terminated = 0, init;
    const page = pageInstance('receive', {
      canIUse: () => true, authorize: options => options.success(),
      createWorker: () => ({ onMessage(fn) { listener = fn; }, terminate() { terminated++; },
        postMessage(message) {
          if (message.type === 'init') init = message;
          queueMicrotask(() => listener({ id: message.id, type: 'ready' }));
        }
      })
    });
    page.onLoad({ mode: String(mode.value) });
    // The next-mode path is used after finishing a file while settings changed.
    page._nextMode = mode;
    await page.start();
    assert.equal(init.mode, mode.value); assert.equal(page._nextMode, null);
    assert.equal(page.data.phase, 'scanning');
    page.onUnload(); await tick();
    assert.equal(terminated, 1); assert.equal(page._speedTimer, null);
  }
});

test('returning from history refreshes a renamed pending file and handles an explicitly deleted file', async () => {
  const page = pageInstance('receive');
  page.onLoad(); page.update({ phase: 'rename' });
  page._record = { id: 'a-b', name: 'old.txt' };
  page._store = { get: async () => ({ id: 'a-b', name: '新名称.txt', size: 2, status: 'saved' }) };
  await page.refreshResult();
  assert.equal(page.data.phase, 'saved'); assert.equal(page.data.savedName, '新名称.txt');
  page._store.get = async () => { throw new Error('文件不存在，可能已被清理'); };
  await page.refreshResult();
  assert.equal(page.data.phase, 'idle'); assert.equal(page._record, null);
});

test('custom navigation shares the capsule row and reserves system buttons on short or offset windows', () => {
  const notch = navigationLayout({ getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47,
    screenTop: 0, safeArea: { bottom: 810 } }), getMenuButtonBoundingClientRect: () => ({ top: 51, bottom: 83, left: 295 }) });
  assert.equal(notch.navTop, 47); assert.equal(notch.navBottom, 91); assert.equal(notch.finderSize, 358);
  assert.equal(notch.navRight, 99); assert.equal(notch.navTitleCenter, 195);
  assert.ok(notch.navTop < 83, 'must not add an action row below the capsule');
  assert.ok(390 - notch.navRight <= 295 - 4, 'actions must end before the system capsule');
  const small = navigationLayout({ getWindowInfo: () => ({ windowWidth: 320, windowHeight: 568, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 225 }) });
  assert.ok(small.finderSize < 288); assert.ok(small.finderSize >= 180);
  assert.ok(small.navTitleCenter + 22 <= 320 - small.navRight, 'title must clear the system capsule');
  assert.equal(notch.sheetPeek, 150); assert.equal(small.sheetPeek, 116);
  assert.ok(small.finderSize + small.navBottom + small.sheetPeek + 206 <= 568);
  const offset = navigationLayout({ getWindowInfo: () => ({ windowWidth: 360, windowHeight: 696, screenTop: 24,
    statusBarHeight: 24, safeArea: { bottom: 696 } }), getMenuButtonBoundingClientRect: () => ({ top: 28, bottom: 60, left: 265 }) });
  assert.equal(offset.navTop, 0); assert.equal(offset.navBottom, 44);
  for (const api of [{}, { getWindowInfo: () => null, getMenuButtonBoundingClientRect: () => null },
    { getWindowInfo: () => ({ safeArea: {} }), getMenuButtonBoundingClientRect: () => ({ bottom: NaN }) }]) {
    const fallback = navigationLayout(api);
    assert.ok(Number.isFinite(fallback.navTop)); assert.ok(Number.isFinite(fallback.finderSize));
    assert.ok(fallback.navRight >= 95); assert.ok(fallback.navHeight >= 44);
  }
});

test('visiting history without changing the record preserves an unfinished filename edit', async () => {
  const page = pageInstance('receive');
  page.onLoad(); page.update({ phase: 'rename', filename: '我的新名称.txt' });
  page._record = { id: 'a-b', name: 'original.txt', size: 2, status: 'pending' };
  page._store = { get: async () => ({ ...page._record }) };
  await page.refreshResult();
  assert.equal(page.data.filename, '我的新名称.txt');
  assert.equal(page.data.phase, 'rename');
});

test('history lives in the scanner with draggable rows and no separate route or history button', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../miniprogram', file), 'utf8');
  const app = JSON.parse(read('app.json'));
  assert.equal(app.pages[0], 'pages/receive/index');
  assert.ok(app.pages.includes('pages/more/index'));
  assert.ok(!app.pages.includes('pages/home/index'));
  assert.ok(!app.pages.includes('pages/files/index'));
  assert.equal(JSON.parse(read('pages/receive/index.json')).navigationStyle, 'custom');
  const more = read('pages/more/index.wxml'), receive = read('pages/receive/index.wxml');
  assert.match(more, /<slider[^>]+min="0"[^>]+max="4"[^>]+step="1"/);
  assert.match(more, /<open-source-footer/);
  assert.doesNotMatch(more, /相机画面|解码画面|cameraSizeLabel|decodeSizeLabel/);
  assert.doesNotMatch(receive, /<slider\b|<picker\b|<open-source-footer|准备页|让文件|CAMERA FILE/);
  assert.match(receive, /nav-left[^>]+bindtap="openMore"/);
  assert.doesNotMatch(receive, /openFiles|history-icon/);
  assert.match(receive, /<history-sheet[^>]+bindopening="historyOpening"/);
  const sheet = read('components/history-sheet/index.wxml');
  assert.doesNotMatch(sheet, /<button\b/);
  assert.match(sheet, /catchtouchmove="{{sheet.move}}"/);
  assert.match(sheet, /<scroll-view[^>]+scroll-y="{{expanded}}"/);
  assert.match(sheet, /bindtouchmove="{{sheet.bodyMove}}"/);
  assert.match(receive, /^<page-meta[^>]+overflow: hidden/);
  assert.match(receive, /<camera[^>]+frame-size="large"[^>]+resolution="high"/);
  assert.doesNotMatch(receive, /class="corner (tl|tr)"/);
  assert.match(receive, /speedLabel/);
  assert.match(receive, /width: {{finderSize}}px; height: {{finderSize}}px/);
  for (const name of ['more', 'receive']) {
    const page = pageInstance(name), markup = read('pages/' + name + '/index.wxml');
    for (const [, handler] of markup.matchAll(/\b(?:bind|catch)[a-z]+="([A-Za-z]\w*)"/g)) {
      assert.equal(typeof page[handler], 'function', name + ' binds missing handler ' + handler);
    }
  }
});

test('inline history pauses and resumes only the formerly running session without discarding packets', () => {
  const page = pageInstance('receive');
  page.onLoad(); page._startPending = false;
  let resumes = 0, disposed = 0, stopped = 0;
  page._client = { ready: true, closed: false, dispose() { disposed++; } };
  page._source = { stop() { stopped++; } };
  page.resume = () => { resumes++; page.update({ phase: 'scanning' }); };
  page.update({ phase: 'scanning', cameraVisible: true, progress: 15 });
  page.historyOpening();
  assert.equal(page.data.phase, 'scanning'); assert.equal(page.data.cameraVisible, true);
  assert.equal(stopped, 0); assert.equal(disposed, 0);
  page.historySettled({ detail: { expanded: true } });
  assert.equal(page.data.phase, 'paused'); assert.equal(stopped, 1); assert.equal(disposed, 0);
  page.historyOpening(); // Starting a downward drag must keep the original resume intent.
  page.historySettled({ detail: { expanded: false } });
  assert.equal(resumes, 1); assert.equal(page.data.progress, 15);
  page.update({ phase: 'paused' });
  page.historyOpening(); page.historySettled({ detail: { expanded: false } });
  assert.equal(resumes, 1, 'manual pause must remain paused');
});

test('an aborted history pull leaves the running camera and receiving state untouched', () => {
  const page = pageInstance('receive');
  page.onLoad(); page._startPending = false;
  page.update({ phase: 'scanning', cameraVisible: true, progress: 15 });
  const source = { stop() { assert.fail('a short pull must not stop the camera'); } };
  page._source = source;
  page._client = { ready: true, closed: false, dispose() { assert.fail('must preserve decoder'); },
    releaseFrameBuffer() { assert.fail('must not release camera buffers while dragging'); } };
  page.recordDiagnostics = () => assert.fail('dragging must not synchronously flush diagnostics');
  page.resume = () => assert.fail('camera was never paused');
  const update = page.update;
  page.update = () => assert.fail('starting a drag must not re-render the receiving page');
  page.historyOpening();
  page.update = update;
  page.historySettled({ detail: { expanded: false } });
  assert.equal(page._source, source); assert.equal(page.data.phase, 'scanning');
  assert.equal(page.data.cameraVisible, true); assert.equal(page.data.progress, 15);
  assert.equal(page._historyActive, false);
});

test('memory warnings, backgrounding and late file completion cancel history auto-resume', () => {
  for (const stop of ['warning', 'hidden', 'component-hidden', 'completed']) {
    const page = pageInstance('receive');
    page.onLoad(); page._startPending = false;
    page.update({ phase: 'scanning' });
    page.historyOpening();
    page.resume = () => assert.fail('history must not restart this session');
    if (stop === 'warning') page.memoryWarning({ level: 5 });
    if (stop === 'hidden') page.onHide();
    if (stop === 'completed') page.update({ phase: 'writing' });
    page.historySettled({ detail: { expanded: false, hidden: stop === 'component-hidden' } });
    assert.equal(page._resumeAfterHistory, false);
  }
});

test('history opened during authorization invalidates the late camera initialization', async () => {
  let authorize;
  const page = pageInstance('receive', { canIUse: () => true,
    authorize: options => { authorize = options.success; },
    createWorker() { assert.fail('history must not create a hidden camera Worker'); } });
  page.onLoad(); page.onReady(); await tick();
  page.historyOpening(); authorize(); await tick();
  assert.equal(page.data.phase, 'paused'); assert.equal(page._client, null);
});

test('history is refreshed after changes and an older asynchronous refresh cannot replace newer records', async () => {
  const page = pageInstance('receive');
  page.onLoad();
  let oldResolve;
  page._store.list = () => new Promise(resolve => { oldResolve = resolve; });
  const old = page.refreshHistory();
  page._store.list = async () => [{ id: 'a-b', name: 'new.bin', size: 12, createdAt: 1000, status: 'saved' }];
  await page.refreshHistory();
  oldResolve([]); await old;
  assert.equal(page.data.historyFiles[0].name, 'new.bin');
  assert.equal(page.data.historyLoading, false);
  page.onUnload();
  await page.refreshHistory();
  assert.equal(page.data.historyFiles.length, 1);
});

test('renaming from inline history updates the scanner result and blocks concurrent rename/save', async () => {
  let releaseRename, saves = 0;
  const page = pageInstance('receive', {
    showActionSheet: options => options.success({ tapIndex: 0 }),
    showModal: options => { releaseRename = () => options.success({ confirm: true, content: 'new.txt' }); }
  });
  page.onLoad();
  let record = { id: 'a-b', name: 'old.txt', size: 1, createdAt: 1000, status: 'pending' };
  page._record = record;
  page._store = { get: async () => record, list: async () => [record],
    save: async (id, name) => { saves++; return record = { ...record, name, status: 'saved' }; } };
  page.update({ phase: 'rename', historyExpanded: true, filename: 'draft.txt' });
  const operation = page.historyAction({ detail: { id: 'a-b' } });
  await tick(); await page.save(); await page.historyAction({ detail: { id: 'a-b' } });
  assert.equal(saves, 0);
  releaseRename(); await operation;
  assert.equal(saves, 1); assert.equal(page.data.savedName, 'new.txt');
  assert.equal(page.data.historyFiles[0].name, 'new.txt'); assert.equal(page.data.phase, 'saved');
});

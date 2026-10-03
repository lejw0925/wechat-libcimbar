const { DecoderClient } = require('../../services/decoder-client');
const { CameraSource, FRAME_INTERVAL } = require('../../services/camera-source');
const { ReceiveDiagnostics } = require('../../services/receive-diagnostics');
const { FileStore } = require('../../services/file-store');
const { exportFile, previewFile, isCancellation } = require('../../services/export-file');
const { formatSize, formatSpeed, formatDate, errorText } = require('../../utils/format');
const { manageReceivedFile } = require('../../services/history-actions');
const { TransferRate } = require('../../utils/transfer-rate');
const { suggestName } = require('../../utils/filename');
const { MODES, indexForValue, readModeIndex, writeModeIndex } = require('../../utils/receive-modes');
const { navigationLayout } = require('../../utils/navigation-layout');

Page({
  data: {
    phase: 'idle', cameraVisible: false, progress: 0, frames: 0,
    modeValue: MODES[0].value, modeLabel: MODES[0].label,
    status: '准备接收', hint: '将完整码图放入框内',
    sizeLabel: '', filename: '', originalName: '', savedName: '',
    error: '', cameraDenied: false, saving: false, writeProgress: 0,
    canRetrySave: false, navTop: 20, navHeight: 44, navRight: 99, navTitleCenter: 184, navBottom: 64, finderSize: 300,
    speedLabel: '0 B/s', cameraSizeLabel: '', decodeSizeLabel: '',
    sheetHeight: 580, sheetPeek: 116, compact: false,
    historyExpanded: false, historyFiles: [], historySize: '0 B', historyLoading: true, historyError: ''
  },
  onLoad(options = {}) {
    this._visible = true;
    this._run = 0;
    this._startPending = true;
    this._store = new FileStore(wx);
    this._diagnostics = new ReceiveDiagnostics(wx);
    const mode = MODES[options.mode === undefined ? readModeIndex(wx) : indexForValue(options.mode)];
    this.update(Object.assign({ modeValue: mode.value, modeLabel: mode.label }, navigationLayout(wx)));
    this._memoryListener = event => this.memoryWarning(event);
    if (wx.onMemoryWarning) wx.onMemoryWarning(this._memoryListener);
  },
  onShow() {
    this._visible = true;
    this._openingPanel = false;
    const panel = this._panel;
    this._panel = null;
    if (panel === 'more' || this._needsModeSync) this.applyPreferredMode();
    this.refreshHistory();
    this.startWhenReady();
  },
  onResize() { this.update(navigationLayout(wx)); },
  onReady() {
    this._ready = true;
    this.startWhenReady();
  },
  startWhenReady() {
    // The scanner is the launch page. Foregrounding must not reset a paused run.
    if (!this._startPending || !this._ready || !this._visible || this._unloaded || this._historyActive) return;
    this._startPending = false;
    this.start();
  },
  onHide() {
    this._visible = false;
    this._resumeAfterHistory = false;
    this._historyActive = false;
    this.update({ historyExpanded: false });
    if (['loading', 'scanning'].includes(this.data.phase)) this.pause();
  },
  onUnload() {
    this._unloaded = true;
    this._visible = false;
    this._run++;
    if (wx.offMemoryWarning && this._memoryListener) wx.offMemoryWarning(this._memoryListener);
    this.stopCamera();
    if (this._client) this._client.dispose();
  },
  update(data) { if (!this._unloaded) this.setData(data); },
  openMore() {
    if (this._openingPanel || this._unloaded || this.data.phase === 'writing' || this.data.saving) return;
    this._openingPanel = true;
    this._panel = 'more';
    if (this.data.phase === 'loading') {
      // Invalidate late permission/init callbacks while settings are on screen.
      this._run++;
      if (this._client) this._client.dispose();
      this._client = null;
      this.pause();
    } else if (this.data.phase === 'scanning') this.pause();
    wx.navigateTo({
      url: '/pages/more/index',
      fail: error => {
        this._openingPanel = false;
        this._panel = null;
        this.update({ error: errorText(error) });
      }
    });
  },
  historyOpening() {
    if (this._unloaded || !this._visible || this._historyActive || this.data.phase === 'writing' || this.data.saving) return;
    this._historyActive = true;
    this._resumeAfterHistory = ['loading', 'scanning'].includes(this.data.phase);
    // A running camera stays mounted throughout dragging and the snap. Native
    // teardown, buffer release and pause diagnostics would stall that animation.
    if (this.data.phase === 'loading') {
      // A pending permission or Worker init cannot mount a camera behind history.
      this._run++;
      if (this._client) this._client.dispose();
      this._client = null;
      this.pause();
    }
  },
  historySettled(event) {
    const expanded = !!event.detail.expanded;
    this.update({ historyExpanded: expanded });
    if (expanded) {
      if (!this._unloaded && this._visible && !event.detail.hidden && this.data.phase === 'scanning') this.pause();
      return;
    }
    const resume = this._resumeAfterHistory;
    this._historyActive = false;
    this._resumeAfterHistory = false;
    if (this._unloaded || !this._visible || event.detail.hidden) return;
    if (resume && this.data.phase === 'paused') this.resume();
    else this.startWhenReady();
  },
  async refreshHistory() {
    if (!this._store || this._unloaded) return;
    const request = this._historyRequest = (this._historyRequest || 0) + 1;
    try {
      const records = await this._store.list();
      if (this._unloaded || request !== this._historyRequest) return;
      this.update({ historyFiles: records.map(record => ({ id: record.id, name: record.name,
        status: record.status, sizeLabel: formatSize(record.size), dateLabel: formatDate(record.createdAt),
        extension: (record.name.split('.').pop() || 'FILE').slice(0, 5).toUpperCase() })),
        historySize: formatSize(records.reduce((size, file) => size + file.size, 0)), historyError: '' });
    } catch (error) {
      if (request === this._historyRequest) this.update({ historyError: errorText(error) });
    } finally {
      if (request === this._historyRequest) this.update({ historyLoading: false });
    }
  },
  async historyAction(event) {
    if (this._unloaded || !this.data.historyExpanded || this._historyActing || this.data.phase === 'writing' || this.data.saving) return;
    this._historyActing = true;
    try { await manageReceivedFile(wx, this._store, event.detail.id); }
    catch (error) { if (!this._unloaded) this.notifyError(error); }
    finally {
      if (!this._unloaded) {
        await this.refreshHistory();
        await this.refreshResult();
      }
      this._historyActing = false;
    }
  },
  async applyPreferredMode() {
    if (this._syncingMode || this._unloaded || !this._visible) return;
    this._syncingMode = true;
    this._needsModeSync = true;
    const mode = MODES[readModeIndex(wx)];
    const defer = () => ['writing', 'rename', 'saved'].includes(this.data.phase) || this.data.canRetrySave;
    try {
      if (mode.value === this.data.modeValue) {
        this._nextMode = null;
        this._needsModeSync = false;
        return;
      }
      if (!defer() && (this.data.progress > 0 || this._receivedBytes > 0)) {
        const run = this._run;
        const result = await new Promise(resolve => wx.showModal({
          title: '切换接收模式？', content: '当前接收进度将清空，使用新模式重新接收。已保存文件不受影响。',
          confirmText: '切换模式', success: resolve, fail: () => resolve({ confirm: false })
        }));
        if (!result.confirm) {
          writeModeIndex(wx, indexForValue(this.data.modeValue));
          this._needsModeSync = false;
          return;
        }
        if (this._unloaded || !this._visible || run !== this._run) return;
      }
      this._needsModeSync = false;
      // A late in-flight decode may have completed while the confirmation was open.
      // Never discard a completed or retryable file to apply a preference.
      if (defer()) { this._nextMode = mode; return; }
      this._run++;
      this.stopCamera();
      if (this._client) this._client.dispose();
      this._client = null;
      this.update({ phase: 'idle', modeValue: mode.value, modeLabel: mode.label, progress: 0, error: '' });
      this.start();
    } finally { this._syncingMode = false; }
  },
  async refreshResult() {
    if (!this._record || !['rename', 'saved'].includes(this.data.phase)) return;
    const id = this._record.id, run = this._run;
    try {
      const record = await this._store.get(id);
      if (run !== this._run || this._unloaded) return;
      const changed = record.name !== this._record.name || record.status !== this._record.status;
      this._record = record;
      this.update({ phase: record.status === 'saved' ? 'saved' : 'rename',
        filename: changed ? record.name : this.data.filename, savedName: record.name, sizeLabel: formatSize(record.size),
        status: record.status === 'saved' ? '文件已保存' : '接收完成',
        hint: record.status === 'saved' ? '可在历史接收中查看' : '确认文件名后保存' });
    } catch (error) {
      if (run !== this._run || this._unloaded) return;
      if (/不存在|已被清理/.test(errorText(error))) {
        this._record = null;
        this._result = null;
        this.update({ phase: 'idle', progress: 0, status: '文件已移除', hint: '可以开始新的接收' });
      } else this.update({ error: errorText(error) });
    }
  },
  async start() {
    if (this._unloaded || !this._visible || this._historyActive || this._historyActing || ['loading', 'scanning', 'writing', 'rename'].includes(this.data.phase)) return;
    if (!wx.canIUse('CameraContext.onCameraFrame') || typeof wx.createWorker !== 'function') {
      this.fail(new Error('当前微信版本不支持相机实时解码，请更新微信并使用真机运行'));
      return;
    }
    const run = ++this._run;
    this.stopCamera();
    if (this._client) this._client.dispose();
    this._client = null;
    this._result = null;
    this._record = null;
    this._frames = 0;
    this._receivedBytes = 0;
    this._rate = new TransferRate();
    this._lastUpdateAt = 0;
    this._memoryWarnings = 0;
    this._lastSamplingMetrics = null;
    if (this._nextMode) {
      this.update({ modeValue: this._nextMode.value, modeLabel: this._nextMode.label });
      this._nextMode = null;
    }
    if (this._diagnostics) this._diagnostics.begin(this.data.modeValue);
    this.update({ phase: 'loading', error: '', cameraDenied: false, canRetrySave: false,
      progress: 0, frames: 0, sizeLabel: '', speedLabel: '0 B/s', cameraSizeLabel: '', decodeSizeLabel: '',
      status: '正在准备', hint: '正在加载解码器' });
    this.recordDiagnostics('start', true);
    try {
      if (wx.requirePrivacyAuthorize) await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }));
      if (run !== this._run || !this._visible) return;
      await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.camera', success: resolve, fail: reject }));
      if (run !== this._run || !this._visible) return;
      const client = new DecoderClient(wx,
        (result, elapsed) => { if (run === this._run) this.onDecoded(result, elapsed); },
        error => { if (run === this._run) this.fail(error); });
      this._client = client;
      await client.start(this.data.modeValue);
      if (run !== this._run || !this._visible) { client.dispose(); return; }
      this._startedAt = Date.now();
      this.update({ phase: 'scanning', cameraVisible: true, status: '对准码图', hint: '将四个角标放入框内' });
      this.startSpeed();
      this.recordDiagnostics('worker-ready', true);
      wx.setKeepScreenOn({ keepScreenOn: true });
    } catch (error) {
      if (run !== this._run || !this._visible) return;
      const denied = /auth|privacy|authorize/i.test(errorText(error));
      this.fail(new Error(denied ? '需要同意隐私说明并允许使用相机，才能接收文件' : errorText(error)));
      this.update({ cameraDenied: denied });
    }
  },
  cameraReady() {
    if (this.data.phase !== 'scanning' || !this._client || !this._client.ready || !this._visible || this.data.historyExpanded) return;
    if (this._source) this._source.stop();
    this._source = new CameraSource(wx.createCameraContext(), this._client, error => this.fail(error),
      { maxFps: this._memoryWarnings > 0 ? 4 : 20 });
    this._source.start();
  },
  cameraError(event) {
    if (!this.data.cameraVisible) return;
    this.fail(new Error(event.detail && event.detail.errMsg || '无法打开相机，请检查相机权限并使用真机运行'));
    this.update({ cameraDenied: true });
  },
  cameraStopped() { if (this.data.phase === 'scanning') this.pause(); },
  stopCamera() {
    this.stopSpeed();
    if (this._source) {
      if (this._source.samplingMetrics) this._lastSamplingMetrics = this._source.samplingMetrics();
      this._source.stop();
      this._source = null;
    }
    if (this._client && this._client.releaseFrameBuffer) this._client.releaseFrameBuffer();
    this.update({ cameraVisible: false });
    wx.setKeepScreenOn({ keepScreenOn: false });
  },
  pause() {
    // Preserve the fountain decoder and its packets while the page is hidden.
    this.update({ phase: 'paused', status: '已暂停', hint: '进度已保留，继续接收同一个文件' });
    this.stopCamera();
    this.recordDiagnostics('paused', true);
  },
  resume() {
    if (this._unloaded || !this._visible || this._historyActive) return;
    if (!this._client || !this._client.ready || this._client.closed) { this.start(); return; }
    this.update({ phase: 'scanning', cameraVisible: true, status: '继续接收', hint: '请保持发送端播放同一个文件' });
    this.startSpeed();
    wx.setKeepScreenOn({ keepScreenOn: true });
  },
  async restart() {
    const result = await new Promise(resolve => wx.showModal({
      title: '重新接收？', content: '当前接收进度将清空。已保存在本机的文件不受影响。',
      confirmText: '重新接收', success: resolve, fail: () => resolve({ confirm: false })
    }));
    if (!result.confirm || this._unloaded || this.data.phase !== 'paused') return;
    this._run++;
    this.update({ phase: 'idle' });
    this.start();
  },
  onDecoded(result) {
    if (this._result) return;
    this._frames++;
    this._receivedBytes = Math.max(this._receivedBytes || 0, Number(result.receivedBytes) || 0);
    if (this._rate) this._rate.observe(result.receivedBytes);
    this.recordDiagnostics('receiving', false, { progress: result.progress, compressedSize: result.compressedSize,
      receivedBytes: result.receivedBytes });
    if (result.complete) {
      this._result = { name: result.name, size: result.size };
      this.update({ phase: 'writing', progress: 100, status: '解码完成', hint: '正在把文件写入本机' });
      this.stopCamera();
      this.recordDiagnostics('decoded', true, { progress: 100 });
      this.persistResult();
      return;
    }
    if (this.data.phase !== 'scanning') return;
    const now = Date.now();
    if (now - this._lastUpdateAt < 250) return;
    this._lastUpdateAt = now;
    const metrics = this._client && this._client.lastMetrics;
    const dimensions = metrics ? {
      cameraSizeLabel: `${metrics.width}×${metrics.height}`,
      decodeSizeLabel: `${metrics.decodeWidth}×${metrics.decodeHeight}`
    } : {};
    this.update(Object.assign({ progress: Math.floor(result.progress), frames: this._frames,
      sizeLabel: result.compressedSize ? formatSize(result.compressedSize) : '',
      status: result.progress > 0 ? '正在接收' : '对准码图',
      hint: result.progress > 0 ? '保持码图完整，等待接收完成' :
        now - this._startedAt > 10000 ? '请确认两端模式一致，码图四角完整可见' : '将四个角标放入框内' }, dimensions));
  },
  startSpeed() {
    clearTimeout(this._speedTimer);
    if (!this._rate) this._rate = new TransferRate();
    this._rate.resume();
    const tick = () => {
      if (this._unloaded || !this._visible || this.data.phase !== 'scanning') return;
      const speedLabel = formatSpeed(this._rate.value());
      if (speedLabel !== this.data.speedLabel) this.update({ speedLabel });
      this._speedTimer = setTimeout(tick, 500);
    };
    tick();
  },
  stopSpeed() {
    clearTimeout(this._speedTimer);
    this._speedTimer = null;
    if (this._rate) this._rate.pause();
    if (this.data.speedLabel !== '0 B/s') this.update({ speedLabel: '0 B/s' });
  },
  async persistResult() {
    if (!this._result || this._writing) return;
    this._writing = true;
    const run = this._run;
    const client = this._client;
    const info = this._result;
    this.update({ phase: 'writing', error: '', canRetrySave: false, writeProgress: 0 });
    try {
      const record = await this._store.stage(info,
        (offset, length) => client.readChunk(offset, length),
        progress => { if (run === this._run) this.update({ writeProgress: progress }); });
      client.dispose();
      if (run !== this._run || this._unloaded) return;
      this._record = record;
      this.update({ phase: 'rename', filename: suggestName(record.name), originalName: info.name || '发送端未提供文件名',
        sizeLabel: formatSize(record.size), status: '接收完成', hint: '确认文件名后保存' });
      this.recordDiagnostics('stored', true);
      this.refreshHistory();
      wx.vibrateShort({ type: 'light' });
    } catch (error) {
      if (run !== this._run || this._unloaded) return;
      this.update({ phase: 'error', error: errorText(error), canRetrySave: !!this._client && !this._client.closed,
        status: '本地写入未完成', hint: '请释放存储空间后重试保存' });
    } finally { this._writing = false; }
  },
  nameChange(event) { this.update({ filename: event.detail.value, error: '' }); },
  async save() {
    if (this.data.saving || this._historyActing || !this._record) return;
    this.update({ saving: true, error: '' });
    try {
      this._record = await this._store.save(this._record.id, this.data.filename);
      this.update({ phase: 'saved', savedName: this._record.name, status: '文件已保存',
        hint: '可在历史接收中查看' });
      this.refreshHistory();
    } catch (error) { this.update({ error: errorText(error) }); }
    finally { this.update({ saving: false }); }
  },
  receiveNext() {
    if (this.data.phase === 'saved') this.start();
  },
  fail(error) {
    this._resumeAfterHistory = false;
    this._run++;
    this.recordDiagnostics('error', true, { failure: errorText(error) });
    this.stopCamera();
    if (this._client) this._client.dispose();
    this.update({ phase: 'error', error: errorText(error), status: '暂时无法接收', hint: '解决下方问题后可以重新开始', canRetrySave: false });
  },
  memoryWarning(event = {}) {
    if (!['loading', 'scanning', 'paused', 'writing'].includes(this.data.phase)) return;
    this._resumeAfterHistory = false;
    this._memoryWarnings = (this._memoryWarnings || 0) + 1;
    this.recordDiagnostics('memory-warning', true, { warningLevel: event.level });
    if (this.data.phase === 'writing') {
      // Already stopped the camera; finish the bounded writes and release the Worker.
      if (this._client && this._client.releaseFrameBuffer) this._client.releaseFrameBuffer();
      return;
    }
    if (this.data.phase === 'loading' || this._memoryWarnings > 1 || event.level >= 15) {
      this.fail(new Error('系统可用内存仍然不足，已结束本次接收以释放内存；未完成的进度需重新接收。已保存文件不受影响。'));
      return;
    }
    this.pause();
    this.update({ status: '内存紧张，已暂停接收', hint: '已保留接收进度；稍候点击“继续接收”。再次收到内存警告时将结束本次接收。' });
    this.recordDiagnostics('memory-paused', true);
  },
  recordDiagnostics(event, force, extra = {}) {
    if (!this._diagnostics) return;
    const client = this._client;
    this._diagnostics.record(Object.assign({ event, phase: this.data.phase,
      progress: this.data.progress, frames: this._frames || 0, memoryWarnings: this._memoryWarnings || 0,
      receiveBytesPerSecond: this._rate ? Math.round(this._rate.value()) : 0,
      targetFrameIntervalMs: FRAME_INTERVAL, targetFps: 1000 / FRAME_INTERVAL,
      transport: this._source ? this._source.transport : this._diagnostics.data && this._diagnostics.data.transport,
      experimentalWorker: client && client.experimental,
      fallbackReason: client && client.fallbackReason
    }, client && client.lastMetrics, this._source && this._source.samplingMetrics ?
      this._source.samplingMetrics() : this._lastSamplingMetrics, extra), force);
  },
  async openSaved() { try { await previewFile(wx, this._record); } catch (error) { this.notifyError(error); } },
  async exportSaved() { try { await exportFile(wx, this._record); } catch (error) { this.notifyError(error); } },
  notifyError(error) { if (!isCancellation(error)) wx.showModal({ title: '提示', content: errorText(error), showCancel: false }); },
  openSettings() { wx.openSetting({}); }
});

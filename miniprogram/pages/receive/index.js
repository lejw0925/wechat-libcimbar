const { DecoderClient } = require('../../services/decoder-client');
const { CameraSource } = require('../../services/camera-source');
const { ReceiveDiagnostics } = require('../../services/receive-diagnostics');
const { FileStore } = require('../../services/file-store');
const { exportFile, previewFile, isCancellation } = require('../../services/export-file');
const { formatSize, formatSpeed, errorText } = require('../../utils/format');
const { TransferRate } = require('../../utils/transfer-rate');
const { suggestName } = require('../../utils/filename');
const MODES = [
  { value: 68, label: 'B · 标准', detail: '对应发送端 Mode B' },
  { value: 67, label: 'B · Mini', detail: '对应发送端 Mode B Mini' },
  { value: 66, label: 'B · Micro', detail: '对应发送端 Mode B Micro' },
  { value: 4, label: '旧版 · 4 色', detail: '对应旧版 4 color 模式' },
  { value: 8, label: '旧版 · 8 色', detail: '对应旧版 8 color 模式' }
];

Page({
  data: {
    phase: 'idle', cameraVisible: false, progress: 0, frames: 0,
    modeIndex: 0, modes: MODES, modeLabel: MODES[0].label,
    status: '让文件，穿过镜头。', hint: '对准另一块屏幕上的动态 cimbar 码',
    sizeLabel: '', filename: '', originalName: '', savedName: '',
    error: '', cameraDenied: false, saving: false, writeProgress: 0,
    pendingCount: 0, canRetrySave: false, hasDiagnostics: false,
    speedLabel: '0 B/s', cameraSizeLabel: '', decodeSizeLabel: ''
  },
  onLoad() {
    this._visible = true;
    this._run = 0;
    this._store = new FileStore(wx);
    this._diagnostics = new ReceiveDiagnostics(wx);
    this.update({ hasDiagnostics: !!this._diagnostics.data });
    this._memoryListener = event => this.memoryWarning(event);
    if (wx.onMemoryWarning) wx.onMemoryWarning(this._memoryListener);
  },
  onShow() {
    this._visible = true;
    this.refreshPending();
  },
  onHide() {
    this._visible = false;
    if (['loading', 'scanning'].includes(this.data.phase)) this.pause();
  },
  onUnload() {
    this._unloaded = true;
    this._run++;
    if (wx.offMemoryWarning && this._memoryListener) wx.offMemoryWarning(this._memoryListener);
    this.stopCamera();
    if (this._client) this._client.dispose();
  },
  update(data) { if (!this._unloaded) this.setData(data); },
  async refreshPending() {
    try {
      const records = await this._store.list();
      this.update({ pendingCount: records.filter(item => item.status === 'pending').length });
    } catch (error) { this.update({ error: errorText(error) }); }
  },
  modeChange(event) {
    const index = Number(event.detail.value);
    this.update({ modeIndex: index, modeLabel: MODES[index].label });
  },
  async start() {
    if (['loading', 'scanning', 'writing', 'rename'].includes(this.data.phase)) return;
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
    this._rate = new TransferRate();
    this._lastUpdateAt = 0;
    this._memoryWarnings = 0;
    if (this._diagnostics) this._diagnostics.begin(MODES[this.data.modeIndex].value);
    this.update({ phase: 'loading', error: '', cameraDenied: false, canRetrySave: false,
      progress: 0, frames: 0, sizeLabel: '', speedLabel: '0 B/s', cameraSizeLabel: '', decodeSizeLabel: '',
      hasDiagnostics: true, status: '正在准备接收', hint: '首次加载解码器需要片刻' });
    this.recordDiagnostics('start', true);
    try {
      if (wx.requirePrivacyAuthorize) await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }));
      await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.camera', success: resolve, fail: reject }));
      if (run !== this._run || !this._visible) return;
      const client = new DecoderClient(wx,
        (result, elapsed) => { if (run === this._run) this.onDecoded(result, elapsed); },
        error => { if (run === this._run) this.fail(error); });
      this._client = client;
      await client.start(MODES[this.data.modeIndex].value);
      if (run !== this._run || !this._visible) { client.dispose(); return; }
      this._startedAt = Date.now();
      this.update({ phase: 'scanning', cameraVisible: true, status: '寻找 cimbar 码', hint: '让四个角标完整进入正方形框内，保持手机稳定' });
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
    if (this.data.phase !== 'scanning' || !this._client || !this._client.ready || !this._visible) return;
    if (this._source) this._source.stop();
    this._source = new CameraSource(wx.createCameraContext(), this._client, error => this.fail(error));
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
    if (this._source) { this._source.stop(); this._source = null; }
    if (this._client && this._client.releaseFrameBuffer) this._client.releaseFrameBuffer();
    this.update({ cameraVisible: false });
    wx.setKeepScreenOn({ keepScreenOn: false });
  },
  pause() {
    // Preserve the fountain decoder and its packets while the page is hidden.
    this.update({ phase: 'paused', status: '接收已暂停', hint: '已接收的数据会保留，继续对准同一个文件' });
    this.stopCamera();
    this.recordDiagnostics('paused', true);
  },
  resume() {
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
    if (!result.confirm) return;
    this._run++;
    this.update({ phase: 'idle' });
    this.start();
  },
  onDecoded(result) {
    if (this._result) return;
    this._frames++;
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
      status: result.progress > 0 ? '正在接收文件' : '寻找 cimbar 码',
      hint: result.progress > 0 ? '保持对准，丢失的画面会由后续帧补齐' :
        now - this._startedAt > 10000 ? '请把码图完整放入正方形框内，并检查两端模式一致' : '让四个角标完整进入正方形框内，保持手机稳定' }, dimensions));
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
        sizeLabel: formatSize(record.size), status: '给文件起个名字', hint: '保留扩展名，方便在其他应用中打开' });
      this.recordDiagnostics('stored', true);
      wx.vibrateShort({ type: 'light' });
      this.refreshPending();
    } catch (error) {
      if (run !== this._run || this._unloaded) return;
      this.update({ phase: 'error', error: errorText(error), canRetrySave: !!this._client && !this._client.closed,
        status: '本地写入未完成', hint: '请释放存储空间后重试保存' });
    } finally { this._writing = false; }
  },
  nameChange(event) { this.update({ filename: event.detail.value, error: '' }); },
  async save() {
    if (this.data.saving || !this._record) return;
    this.update({ saving: true, error: '' });
    try {
      this._record = await this._store.save(this._record.id, this.data.filename);
      this.update({ phase: 'saved', savedName: this._record.name, status: '文件已保存',
        hint: '已保存在此手机的小程序专属目录' });
      this.refreshPending();
    } catch (error) { this.update({ error: errorText(error) }); }
    finally { this.update({ saving: false }); }
  },
  receiveNext() {
    this._run++;
    this._record = null;
    this._result = null;
    if (this._client) this._client.dispose();
    this.update({ phase: 'idle', progress: 0, frames: 0, error: '', sizeLabel: '', canRetrySave: false,
      speedLabel: '0 B/s', cameraSizeLabel: '', decodeSizeLabel: '',
      status: '让文件，穿过镜头。', hint: '对准另一块屏幕上的动态 cimbar 码' });
  },
  fail(error) {
    this._run++;
    this.recordDiagnostics('error', true, { failure: errorText(error) });
    this.stopCamera();
    if (this._client) this._client.dispose();
    this.update({ phase: 'error', error: errorText(error), status: '暂时无法接收', hint: '解决下方问题后可以重新开始', canRetrySave: false });
  },
  memoryWarning(event = {}) {
    if (!['loading', 'scanning', 'paused', 'writing'].includes(this.data.phase)) return;
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
      transport: this._source ? this._source.transport : this._diagnostics.data && this._diagnostics.data.transport,
      experimentalWorker: client && client.experimental,
      fallbackReason: client && client.fallbackReason
    }, client && client.lastMetrics, extra), force);
  },
  copyDiagnostics() {
    if (this._diagnostics && this._diagnostics.data) wx.setClipboardData({ data: JSON.stringify(this._diagnostics.data, null, 2) });
  },
  async openSaved() { try { await previewFile(wx, this._record); } catch (error) { this.notifyError(error); } },
  async exportSaved() { try { await exportFile(wx, this._record); } catch (error) { this.notifyError(error); } },
  notifyError(error) { if (!isCancellation(error)) wx.showModal({ title: '提示', content: errorText(error), showCancel: false }); },
  openSettings() { wx.openSetting({}); },
  openFiles() { wx.navigateTo({ url: '/pages/files/index' }); },
  copySender() { wx.setClipboardData({ data: 'https://cimbar.org' }); }
});

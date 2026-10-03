const { ReceiveDiagnostics } = require('../../services/receive-diagnostics');
const { MODES, normalizeIndex, readModeIndex, writeModeIndex } = require('../../utils/receive-modes');
const { watchTheme, modeColors } = require('../../utils/theme');

Page({
  data: Object.assign({
    modes: MODES, modeIndex: 0, modeLabel: MODES[0].label, modeDetail: MODES[0].detail,
    helpOpen: false, hasDiagnostics: false, hasPreviousDiagnostics: false
  }, modeColors('light')),
  onLoad() { this.selectMode(readModeIndex(wx)); this._stopTheme = watchTheme(this, wx); },
  onShow() {
    this._diagnostics = new ReceiveDiagnostics(wx);
    this.update({ hasDiagnostics: !!this._diagnostics.data, hasPreviousDiagnostics: !!this._diagnostics.previous });
  },
  onUnload() { this._unloaded = true; if (this._stopTheme) this._stopTheme(); },
  update(data) { if (!this._unloaded) this.setData(data); },
  selectMode(value) {
    const index = normalizeIndex(value);
    const mode = MODES[index];
    this.update({ modeIndex: index, modeLabel: mode.label, modeDetail: mode.detail });
  },
  modeChanging(event) { this.selectMode(event.detail.value); },
  modeChange(event) {
    this.selectMode(event.detail.value);
    writeModeIndex(wx, this.data.modeIndex);
  },
  modeTap(event) {
    this.selectMode(event.currentTarget.dataset.index);
    writeModeIndex(wx, this.data.modeIndex);
  },
  toggleHelp() { this.update({ helpOpen: !this.data.helpOpen }); },
  copySender() { wx.setClipboardData({ data: 'https://cimbar.org' }); },
  copyDiagnostics() {
    if (this._diagnostics && this._diagnostics.data) wx.setClipboardData({ data: JSON.stringify(this._diagnostics.data, null, 2) });
  },
  copyPreviousDiagnostics() {
    if (this._diagnostics && this._diagnostics.previous) wx.setClipboardData({ data: JSON.stringify(this._diagnostics.previous, null, 2) });
  },
  licenses() { wx.navigateTo({ url: '/pages/licenses/index' }); }
});

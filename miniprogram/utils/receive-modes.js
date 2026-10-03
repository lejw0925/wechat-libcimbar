// Slider positions are UI indices, not the protocol's mode numbers.
const MODES = [
  { value: 68, label: 'B · 标准', shortLabel: '标准', detail: '对应发送端 Mode B' },
  { value: 67, label: 'B · Mini', shortLabel: 'Mini', detail: '对应发送端 Mode B Mini' },
  { value: 66, label: 'B · Micro', shortLabel: 'Micro', detail: '对应发送端 Mode B Micro' },
  { value: 4, label: '旧版 · 4 色', shortLabel: '4 色', detail: '对应旧版 4 color 模式' },
  { value: 8, label: '旧版 · 8 色', shortLabel: '8 色', detail: '对应旧版 8 color 模式' }
];
const STORAGE_KEY = 'cimbar-receive-mode';

function indexForValue(value) {
  const index = MODES.findIndex(mode => mode.value === Number(value));
  return index < 0 ? 0 : index;
}
function normalizeIndex(value) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < MODES.length ? index : 0;
}
function readModeIndex(api) {
  try { return indexForValue(api.getStorageSync(STORAGE_KEY)); } catch (_) { return 0; }
}
function writeModeIndex(api, index) {
  try { api.setStorageSync(STORAGE_KEY, MODES[normalizeIndex(index)].value); } catch (_) { /* Preferences must not block receiving. */ }
}

module.exports = { MODES, STORAGE_KEY, indexForValue, normalizeIndex, readModeIndex, writeModeIndex };

function modeColors(theme) {
  return theme === 'dark' ? { sliderAccent: '#64a9ff', sliderTrack: '#454956', sliderThumb: '#e9ecf2' } :
    { sliderAccent: '#007aff', sliderTrack: '#d9dce4', sliderThumb: '#ffffff' };
}
function watchTheme(page, api) {
  let info = {};
  try { info = (api.getAppBaseInfo ? api.getAppBaseInfo() : api.getSystemInfoSync()) || {}; } catch (_) {}
  page.update(modeColors(info.theme));
  const listener = event => page.update(modeColors(event.theme));
  if (api.onThemeChange) api.onThemeChange(listener);
  return () => { if (api.offThemeChange) api.offThemeChange(listener); };
}
module.exports = { modeColors, watchTheme };

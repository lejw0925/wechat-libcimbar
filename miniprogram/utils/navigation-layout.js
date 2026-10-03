// Capsule coordinates use the screen origin; layout uses the page window.
// Align a single 44px action row to the capsule and reserve its whole right side.
function navigationLayout(api) {
  let windowInfo = {}, capsule = {};
  try { windowInfo = (api.getWindowInfo ? api.getWindowInfo() : api.getSystemInfoSync()) || {}; } catch (_) {}
  try { capsule = api.getMenuButtonBoundingClientRect() || {}; } catch (_) {}
  const valid = value => Number.isFinite(value) && value > 0;
  const width = valid(windowInfo.windowWidth) ? windowInfo.windowWidth : 375;
  const height = valid(windowInfo.windowHeight) ? windowInfo.windowHeight : 667;
  const status = Number.isFinite(windowInfo.statusBarHeight) && windowInfo.statusBarHeight >= 0 ? windowInfo.statusBarHeight : 20;
  const screenTop = Number.isFinite(windowInfo.screenTop) ? Math.max(0, windowInfo.screenTop) : 0;
  const capsuleValid = valid(capsule.top) && valid(capsule.bottom) && capsule.top >= status &&
    capsule.bottom > capsule.top && capsule.bottom < screenTop + height / 2;
  const capsuleHeight = capsuleValid ? capsule.bottom - capsule.top : 32;
  const capsuleTop = capsuleValid ? capsule.top : status + 6;
  const navHeight = Math.max(44, capsuleHeight);
  const navTop = Math.max(0, status - screenTop, capsuleTop + capsuleHeight / 2 - navHeight / 2 - screenTop);
  const capsuleLeft = valid(capsule.left) && capsule.left > width / 2 && capsule.left < width ? capsule.left : width - 95;
  const navRight = width - capsuleLeft + 4;
  const navTitleCenter = Math.min(width / 2, capsuleLeft - 4 - 22);
  const navBottom = navTop + navHeight;
  const safeBottom = windowInfo.safeArea && valid(windowInfo.safeArea.bottom) ?
    Math.max(0, screenTop + height - windowInfo.safeArea.bottom) : 0;
  const sheetHeight = Math.max(200, height - navBottom - 12);
  const sheetPeek = Math.min(sheetHeight, 116 + safeBottom);
  const compact = height < 640;
  // Reserve the collapsed history panel, not just the home indicator.
  const finderSize = Math.floor(Math.min(560, width - 32, Math.max(160,
    height - navBottom - sheetPeek - (compact ? 206 : 244))));
  return { navTop, navHeight, navRight, navTitleCenter, navBottom, finderSize,
    sheetHeight, sheetPeek, compact };
}
module.exports = { navigationLayout };

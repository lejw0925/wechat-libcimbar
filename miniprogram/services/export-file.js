function call(api, method, options) {
  return new Promise((resolve, reject) => api[method](Object.assign({}, options, { success: resolve, fail: reject })));
}
async function previewFile(api, record) {
  const ext = record.name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
    return call(api, 'previewImage', { current: record.filePath, urls: [record.filePath] });
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
    return call(api, 'openDocument', { filePath: record.filePath, showMenu: true });
  }
  throw new Error('此格式无法在微信内预览，可使用“导出 / 转发”');
}
async function exportFile(api, record) {
  const device = api.getDeviceInfo ? api.getDeviceInfo() : api.getSystemInfoSync();
  const desktop = ['windows', 'mac'].includes(device.platform);
  const ext = record.name.split('.').pop().toLowerCase();
  const actions = [];
  if (desktop && typeof api.saveFileToDisk === 'function') actions.push({ title: '保存到电脑', method: 'saveFileToDisk' });
  if (['jpg', 'jpeg', 'png'].includes(ext)) actions.push({ title: '保存图片到手机相册', method: 'saveImageToPhotosAlbum' });
  if (ext === 'mp4') actions.push({ title: '保存视频到手机相册', method: 'saveVideoToPhotosAlbum' });
  if (typeof api.shareFileMessage === 'function') actions.push({ title: '转发文件到微信聊天', method: 'shareFileMessage' });
  if (!actions.length) throw new Error('当前微信版本没有可用的文件导出接口，请更新微信');
  const result = await call(api, 'showActionSheet', { itemList: actions.map(item => item.title) });
  const chosen = actions[result.tapIndex];
  if (!chosen) return;
  await call(api, chosen.method, { filePath: record.filePath, fileName: record.name });
  // Sharing success is not a claim that the file is in a public system folder.
  if (chosen.method !== 'shareFileMessage') api.showToast({ title: '已保存', icon: 'success' });
}
function isCancellation(error) {
  return /cancel/i.test(error && (error.errMsg || error.message) || '');
}
module.exports = { previewFile, exportFile, isCancellation };

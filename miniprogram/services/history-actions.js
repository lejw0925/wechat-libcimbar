const { exportFile, previewFile } = require('./export-file');

// Shared with the scanner's inline history. Only the selected record is changed.
async function manageReceivedFile(api, store, id) {
  const record = await store.get(id);
  const result = await new Promise((resolve, reject) => api.showActionSheet({
    itemList: [record.status === 'pending' ? '命名并保存' : '重命名', '打开文件', '导出 / 转发', '删除本地文件'],
    success: resolve, fail: reject
  }));
  if (result.tapIndex === 0) {
    const rename = await new Promise((resolve, reject) => api.showModal({
      title: record.status === 'pending' ? '命名并保存' : '重命名文件', editable: true,
      content: record.name, placeholderText: '请输入文件名，保留扩展名', confirmText: '保存',
      success: resolve, fail: reject
    }));
    if (rename.confirm) await store.save(record.id, rename.content);
  } else if (result.tapIndex === 1) await previewFile(api, record);
  else if (result.tapIndex === 2) await exportFile(api, record);
  else if (result.tapIndex === 3) {
    const confirmed = await new Promise(resolve => api.showModal({
      title: '删除本地文件？', content: `将删除“${record.name}”，无法从小程序恢复。`, confirmText: '删除', confirmColor: '#ff453a',
      success: resolve, fail: () => resolve({ confirm: false })
    }));
    if (confirmed.confirm) await store.remove(record.id);
  }
}
module.exports = { manageReceivedFile };

const { FileStore } = require('../../services/file-store');
const { exportFile, previewFile, isCancellation } = require('../../services/export-file');
const { formatSize, formatDate, errorText } = require('../../utils/format');

Page({
  data: { files: [], loading: true, error: '', totalSize: '0 B' },
  onLoad() { this._store = new FileStore(wx); },
  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async refresh() {
    try {
      const records = await this._store.list();
      this.setData({ files: records.map(record => Object.assign({}, record, {
        sizeLabel: formatSize(record.size), dateLabel: formatDate(record.createdAt),
        extension: (record.name.split('.').pop() || 'FILE').slice(0, 5).toUpperCase()
      })), totalSize: formatSize(records.reduce((size, file) => size + file.size, 0)), error: '' });
    } catch (error) { this.setData({ error: errorText(error) }); }
    finally { this.setData({ loading: false }); }
  },
  async action(event) {
    if (this._acting) return;
    this._acting = true;
    try {
      const record = await this._store.get(event.currentTarget.dataset.id);
      const result = await new Promise((resolve, reject) => wx.showActionSheet({
        itemList: [record.status === 'pending' ? '命名并保存' : '重命名', '打开文件', '导出 / 转发', '删除本地文件'], success: resolve, fail: reject
      }));
      if (result.tapIndex === 0) {
        const rename = await new Promise((resolve, reject) => wx.showModal({
          title: record.status === 'pending' ? '命名并保存' : '重命名文件', editable: true,
          content: record.name, placeholderText: '请输入文件名，保留扩展名',
          confirmText: '保存', success: resolve, fail: reject
        }));
        if (rename.confirm) await this._store.save(record.id, rename.content);
      } else if (result.tapIndex === 1) await previewFile(wx, record);
      else if (result.tapIndex === 2) await exportFile(wx, record);
      else if (result.tapIndex === 3) {
        const confirm = await new Promise(resolve => wx.showModal({
          title: '删除本地文件？', content: `将删除“${record.name}”，无法从小程序恢复。`, confirmText: '删除', confirmColor: '#a34832',
          success: resolve, fail: () => resolve({ confirm: false })
        }));
        if (confirm.confirm) await this._store.remove(record.id);
      }
      await this.refresh();
    } catch (error) {
      if (!isCancellation(error)) wx.showModal({ title: '操作未完成', content: errorText(error), showCancel: false });
    } finally { this._acting = false; }
  },
  receive() { wx.navigateBack(); },
  licenses() { wx.navigateTo({ url: '/pages/licenses/index' }); }
});

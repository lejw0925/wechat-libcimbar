Page({
  data: { text: '' },
  onLoad() {
    wx.getFileSystemManager().readFile({
      filePath: 'licenses/THIRD_PARTY_NOTICES.txt', encoding: 'utf8',
      success: result => this.setData({ text: result.data }),
      fail: () => this.setData({ text: '无法读取许可证，请检查代码包中的 licenses/THIRD_PARTY_NOTICES.txt。' })
    });
  }
});

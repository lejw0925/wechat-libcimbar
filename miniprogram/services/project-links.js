const REPOSITORY = 'lejw0925/wechat-libcimbar';
const SOURCE_URL = 'https://github.com/' + REPOSITORY;

function copySourceLink(api, recommendStar = false) {
  api.setClipboardData({
    data: SOURCE_URL,
    success() {
      api.showModal({
        title: recommendStar ? '感谢支持开源' : '源码链接已复制',
        content: recommendStar ?
          '请在浏览器打开刚复制的 GitHub 链接。如果这个工具对你有帮助，欢迎登录 GitHub 后点一下 Star。\n\n' + SOURCE_URL :
          '请在浏览器中粘贴链接，查看源码、构建说明或提交问题。\n\n' + SOURCE_URL,
        showCancel: false, confirmText: '知道了'
      });
    },
    fail() {
      api.showModal({ title: '未能复制链接', content: '可在浏览器中手动打开：\n' + SOURCE_URL,
        showCancel: false, confirmText: '知道了' });
    }
  });
}
module.exports = { REPOSITORY, SOURCE_URL, copySourceLink };

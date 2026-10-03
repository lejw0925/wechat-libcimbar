const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_URL, copySourceLink } = require('../miniprogram/services/project-links');

test('source and Star actions copy the public URL and give truthful browser instructions', () => {
  for (const star of [false, true]) {
    let copied, modal;
    copySourceLink({
      setClipboardData(options) { copied = options.data; options.success(); },
      showModal(options) { modal = options; }
    }, star);
    assert.equal(copied, SOURCE_URL);
    assert.match(copied, /^https:\/\/github\.com\/lejw0925\/wechat-libcimbar$/);
    assert.match(modal.content, /浏览器/);
    assert.equal(modal.showCancel, false);
    if (star) {
      assert.match(modal.content, /登录 GitHub 后点一下 Star/);
      assert.doesNotMatch(modal.content, /已.*Star/);
    }
  }
});

test('clipboard failure still provides a manual public link without claiming success', () => {
  let modal;
  copySourceLink({ setClipboardData(options) { options.fail(); }, showModal(options) { modal = options; } });
  assert.equal(modal.title, '未能复制链接');
  assert.ok(modal.content.includes(SOURCE_URL));
});

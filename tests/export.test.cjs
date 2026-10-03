const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exportFile, previewFile } = require('../miniprogram/services/export-file');

test('phone export never calls the desktop-only saveFileToDisk API', async () => {
  let shared = false;
  const api = {
    getDeviceInfo: () => ({ platform: 'ios' }),
    saveFileToDisk: () => assert.fail('desktop API called on phone'),
    showActionSheet: opts => { assert.deepEqual(opts.itemList, ['转发文件到微信聊天']); opts.success({ tapIndex: 0 }); },
    shareFileMessage: opts => { shared = true; assert.equal(opts.fileName, 'notes.txt'); opts.success({}); },
    showToast: () => assert.fail('sharing must not claim system disk save')
  };
  await exportFile(api, { name: 'notes.txt', filePath: '/test/file' });
  assert.equal(shared, true);
});

test('unsupported file preview is explicit, rather than silently invoking an incompatible viewer', async () => {
  await assert.rejects(previewFile({}, { name: 'program.bin' }), /无法在微信内预览/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { FileStore, CHUNK_SIZE } = require('../miniprogram/services/file-store');
const { makeFileAPI, arrayBuffer } = require('./helpers.cjs');
const { validateName, suggestName, uniqueName, byteLength } = require('../miniprogram/utils/filename');

test('untrusted names cannot escape the received-file directory', () => {
  for (const name of ['', '.', '..', '../../secret', 'a/b', 'a\\b', 'a\0b', 'file.']) assert.throws(() => validateName(name));
  assert.equal(suggestName('../../报告.pdf'), '报告.pdf');
  assert.equal(suggestName('C:\\fake\\report.txt'), 'report.txt');
  assert.equal(validateName('  文档.pdf  '), '文档.pdf');
  assert.equal(uniqueName('报告.pdf', ['报告.pdf']), '报告 (2).pdf');
  assert.ok(byteLength(suggestName('文'.repeat(200) + '.pdf')) <= 180);
});

test('binary file survives chunked writing, restart, naming and duplicate naming', async t => {
  const api = await makeFileAPI(t);
  const store = new FileStore(api);
  const original = Buffer.alloc(CHUNK_SIZE * 2 + 37);
  for (let i = 0; i < original.length; i++) original[i] = i % 251;
  const reads = [];
  const pending = await store.stage({ name: '../原文件.bin', size: original.length }, async (offset, length) => {
    reads.push(length);
    return arrayBuffer(original.subarray(offset, offset + length));
  });
  assert.equal(reads.length, 3);
  assert.deepEqual(await fs.readFile(pending.filePath), original);
  const restarted = new FileStore(api);
  assert.equal((await restarted.list())[0].status, 'pending');
  const saved = await restarted.save(pending.id, '文件.bin');
  assert.equal(saved.status, 'saved');
  assert.deepEqual(await fs.readFile(saved.filePath), original);
  const duplicate = await restarted.stage({ name: 'file', size: 0 }, () => assert.fail('empty file must not read chunks'));
  const second = await restarted.save(duplicate.id, '文件.bin');
  assert.equal(second.name, '文件 (2).bin');
  await assert.rejects(store.save(saved.id, '../../escape'));
  await store.remove(second.id);
  assert.equal((await store.list()).length, 1);
  assert.deepEqual(await fs.readFile(saved.filePath), original);
});

test('interrupted writes are never listed as completed and do not accumulate partial data', async t => {
  const api = await makeFileAPI(t);
  const store = new FileStore(api);
  let reads = 0;
  await assert.rejects(store.stage({ name: 'broken.bin', size: CHUNK_SIZE + 1 }, () => {
    if (++reads === 2) throw new Error('worker stopped');
    return new ArrayBuffer(CHUNK_SIZE);
  }));
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await fs.readdir(store.root), []);
});

test('storage failure leaves other files intact, and a short chunk fails', async t => {
  const api = await makeFileAPI(t);
  const store = new FileStore(api);
  const saved = await store.stage({ name: 'keep.bin', size: 1 }, () => new Uint8Array([42]).buffer);
  api.faults.appendFile = true;
  await assert.rejects(store.stage({ name: 'fail.bin', size: 1 }, () => new ArrayBuffer(1)));
  api.faults.appendFile = false;
  await assert.rejects(store.stage({ name: 'short.bin', size: 10 }, () => new ArrayBuffer(9)));
  assert.equal((await store.list()).length, 1);
  assert.deepEqual(await fs.readFile(saved.filePath), Buffer.from([42]));
});

test('committed content is recoverable even when metadata is missing or stale', async t => {
  const api = await makeFileAPI(t);
  const store = new FileStore(api);
  const record = await store.stage({ name: 'old.txt', size: 3 }, () => arrayBuffer(Buffer.from('abc')));
  await fs.unlink(store.directory(record.id) + '/record.json');
  await fs.rename(record.filePath, store.directory(record.id) + '/content/new.txt');
  const recovered = (await new FileStore(api).list())[0];
  assert.equal(recovered.name, 'new.txt');
  assert.equal(recovered.status, 'pending');
  assert.equal(recovered.size, 3);
  const saved = await store.save(record.id, '完成.txt');
  assert.equal((await store.get(saved.id)).status, 'saved');
});

test('retry after a process crash reclaims only abandoned partial writes', async t => {
  const api = await makeFileAPI(t);
  const store = new FileStore(api);
  const saved = await store.stage({ name: 'keep.bin', size: 1 }, () => new Uint8Array([42]).buffer);
  const abandoned = store.directory('old-part');
  await fs.mkdir(abandoned + '/content', { recursive: true });
  await fs.writeFile(abandoned + '/payload.part', Buffer.alloc(500));
  await store.stage({ name: 'new.bin', size: 1 }, () => new Uint8Array([13]).buffer);
  await assert.rejects(fs.access(abandoned));
  assert.deepEqual(await fs.readFile(saved.filePath), Buffer.from([42]));
  assert.equal((await store.list()).length, 2);
});

test('a concurrent writer cannot delete or corrupt an active transfer', async t => {
  const api = await makeFileAPI(t);
  const store = new FileStore(api);
  let release;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const first = store.stage({ name: 'first.bin', size: 1 }, () => {
    entered();
    return new Promise(resolve => { release = resolve; });
  });
  await enteredPromise;
  await assert.rejects(new FileStore(api).stage({ name: 'second.bin', size: 1 }, () => new ArrayBuffer(1)), /正在写入/);
  release(new Uint8Array([99]).buffer);
  const record = await first;
  assert.deepEqual(await fs.readFile(record.filePath), Buffer.from([99]));
});

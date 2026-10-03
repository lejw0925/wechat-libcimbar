const { suggestName, uniqueName, validateName } = require('../utils/filename');
const MAX_SIZE = 64 * 1024 * 1024;
const CHUNK_SIZE = 256 * 1024;
const activeWrites = new Set();

class FileStore {
  constructor(api) {
    this.fs = api.getFileSystemManager();
    this.root = api.env.USER_DATA_PATH + '/cimbar-received';
  }
  call(method, options) {
    return new Promise((resolve, reject) => this.fs[method](Object.assign({}, options, {
      success: resolve,
      fail: reject
    })));
  }
  async exists(filePath) {
    try { await this.call('access', { path: filePath }); return true; } catch (_) { return false; }
  }
  async mkdir(dirPath) {
    if (!await this.exists(dirPath)) await this.call('mkdir', { dirPath, recursive: true });
  }
  directory(id) {
    if (!/^[a-z0-9]+-[a-z0-9]+$/.test(id)) throw new Error('无效的文件记录');
    return this.root + '/' + id;
  }
  async metadata(record) {
    const directory = this.directory(record.id);
    await this.call('writeFile', { filePath: directory + '/record.next', data: JSON.stringify(record), encoding: 'utf8' });
    await this.call('rename', { oldPath: directory + '/record.next', newPath: directory + '/record.json' });
  }
  async list() {
    await this.mkdir(this.root);
    const { files } = await this.call('readdir', { dirPath: this.root });
    const records = [];
    for (const id of files) {
      if (!/^[a-z0-9]+-[a-z0-9]+$/.test(id)) continue;
      const directory = this.directory(id);
      let names;
      try { names = (await this.call('readdir', { dirPath: directory + '/content' })).files; } catch (_) { continue; }
      if (names.length !== 1) continue; // .part transfers are never presented as complete.
      let name;
      try { name = validateName(names[0]); } catch (_) { continue; }
      const filePath = directory + '/content/' + name;
      const { stats } = await this.call('stat', { path: filePath });
      let meta = {};
      try {
        const parsed = JSON.parse((await this.call('readFile', { filePath: directory + '/record.json', encoding: 'utf8' })).data);
        if (parsed && typeof parsed === 'object') meta = parsed;
      } catch (_) { /* Recover committed content after a metadata-write interruption. */ }
      records.push({ id, name, filePath, size: stats.size,
        createdAt: Number(meta.createdAt) || parseInt(id.split('-')[0], 36),
        status: meta.status === 'saved' ? 'saved' : 'pending' });
    }
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(id) {
    const record = (await this.list()).find(item => item.id === id);
    if (!record) throw new Error('文件不存在，可能已被清理');
    return record;
  }
  // readChunk returns an exact, independent ArrayBuffer. Write sequentially so
  // neither the UI nor WeChat's message channel holds the whole decoded file.
  async stage(info, readChunk, onProgress = () => {}) {
    if (activeWrites.has(this.root)) throw new Error('已有文件正在写入，请稍候');
    activeWrites.add(this.root);
    try { return await this.stageExclusive(info, readChunk, onProgress); }
    finally { activeWrites.delete(this.root); }
  }
  async stageExclusive(info, readChunk, onProgress) {
    if (!Number.isInteger(info.size) || info.size < 0 || info.size > MAX_SIZE) throw new Error('文件大小超出支持范围');
    await this.mkdir(this.root);
    // A killed app can leave a .part file. Before a new write, reclaim only
    // abandoned, uncommitted transfers; never touch content/ with a real file.
    const entries = (await this.call('readdir', { dirPath: this.root })).files;
    for (const entry of entries) {
      if (!/^[a-z0-9]+-[a-z0-9]+$/.test(entry)) continue;
      const abandoned = this.directory(entry);
      if (!await this.exists(abandoned + '/payload.part')) continue;
      const contents = await this.call('readdir', { dirPath: abandoned + '/content' });
      if (contents.files.length === 0) await this.call('rmdir', { dirPath: abandoned, recursive: true });
    }
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    const directory = this.directory(id);
    if (await this.exists(directory)) throw new Error('文件记录冲突，请重试保存');
    await this.mkdir(directory + '/content');
    const partial = directory + '/payload.part';
    try {
      await this.call('writeFile', { filePath: partial, data: new ArrayBuffer(0) });
      for (let offset = 0; offset < info.size; offset += CHUNK_SIZE) {
        const length = Math.min(CHUNK_SIZE, info.size - offset);
        const chunk = await readChunk(offset, length);
        if (!(chunk instanceof ArrayBuffer) || chunk.byteLength !== length) throw new Error('文件数据传输不完整，请重试保存');
        await this.call('appendFile', { filePath: partial, data: chunk });
        onProgress(Math.round((offset + length) / info.size * 100));
      }
    } catch (error) {
      // Only remove this attempt's incomplete bytes; completed records are untouched.
      try { await this.call('rmdir', { dirPath: directory, recursive: true }); } catch (_) { /* Storage may be unavailable. */ }
      throw error;
    }
    const name = suggestName(info.name);
    const record = { id, name, size: info.size, createdAt: Date.now(), status: 'pending' };
    await this.call('rename', { oldPath: partial, newPath: directory + '/content/' + name });
    // Content is durable already. If metadata persistence fails, list() recovers
    // it as a pending file so a retry can never lose the completed transfer.
    try { await this.metadata(record); } catch (_) { /* Recover on next list. */ }
    return Object.assign(record, { filePath: directory + '/content/' + name });
  }
  async save(id, requestedName) {
    const records = await this.list();
    const record = records.find(item => item.id === id);
    if (!record) throw new Error('待保存的文件不存在');
    const name = uniqueName(requestedName, records.filter(item => item.id !== id).map(item => item.name));
    const filePath = this.directory(id) + '/content/' + name;
    if (name !== record.name) await this.call('rename', { oldPath: record.filePath, newPath: filePath });
    const saved = Object.assign({}, record, { name, filePath, status: 'saved' });
    await this.metadata(saved);
    return saved;
  }
  async remove(id) {
    await this.get(id); // Only a known, user-selected received file may be removed.
    await this.call('rmdir', { dirPath: this.directory(id), recursive: true });
  }
}
module.exports = { FileStore, MAX_SIZE, CHUNK_SIZE };

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function makeFileAPI(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cimbar-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const faults = {};
  const callbacks = (method, operation) => options => {
    Promise.resolve().then(() => {
      if (faults[method]) throw new Error('ENOSPC: injected disk write failure');
      return operation(options);
    }).then(value => options.success(value || {}), error => options.fail({ errMsg: error.message }));
  };
  const binary = data => data instanceof ArrayBuffer ? Buffer.from(data) : data;
  const manager = {
    access: callbacks('access', opts => fs.access(opts.path)),
    mkdir: callbacks('mkdir', opts => fs.mkdir(opts.dirPath, { recursive: opts.recursive })),
    readdir: callbacks('readdir', async opts => ({ files: await fs.readdir(opts.dirPath) })),
    stat: callbacks('stat', async opts => ({ stats: await fs.stat(opts.path) })),
    writeFile: callbacks('writeFile', opts => fs.writeFile(opts.filePath, binary(opts.data), opts.encoding)),
    appendFile: callbacks('appendFile', opts => fs.appendFile(opts.filePath, binary(opts.data))),
    readFile: callbacks('readFile', async opts => ({ data: await fs.readFile(opts.filePath, opts.encoding) })),
    rename: callbacks('rename', opts => fs.rename(opts.oldPath, opts.newPath)),
    rmdir: callbacks('rmdir', opts => fs.rm(opts.dirPath, { recursive: opts.recursive }))
  };
  return { env: { USER_DATA_PATH: root }, getFileSystemManager: () => manager, faults };
}
const arrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
module.exports = { makeFileAPI, arrayBuffer };

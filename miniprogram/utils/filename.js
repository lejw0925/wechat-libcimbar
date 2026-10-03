const INVALID = /[\\/<>:"|?*\u0000-\u001f\u007f]/;
function byteLength(value) {
  let count = 0;
  for (const char of value) {
    const point = char.codePointAt(0);
    count += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return count;
}
function validateName(input) {
  const name = String(input || '').trim();
  if (!name || name === '.' || name === '..') throw new Error('请输入文件名（包含扩展名）');
  if (INVALID.test(name)) throw new Error('文件名不能包含 / \\ : * ? " < > | 或控制字符');
  if (name.endsWith('.')) throw new Error('文件名不能以句点结尾');
  if (byteLength(name) > 180) throw new Error('文件名过长，请缩短后重试');
  return name;
}
function truncate(value, maxBytes) {
  let output = '';
  for (const char of value) {
    if (byteLength(output + char) > maxBytes) break;
    output += char;
  }
  return output;
}
function suggestName(input) {
  let name = String(input || '').split(/[\\/]/).pop().replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '_').trim().replace(/\.+$/, '');
  if (!name || /^\.+$/.test(name)) return '接收文件.bin';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot < 16 ? name.slice(dot) : '';
  name = truncate(ext ? name.slice(0, dot) : name, 160 - byteLength(ext)) + ext;
  return name;
}
function uniqueName(input, used) {
  const name = validateName(input);
  const names = new Set(used.map(item => item.toLowerCase()));
  if (!names.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let index = 2; ; index++) {
    const suffix = ` (${index})${ext}`;
    const candidate = truncate(stem, 180 - byteLength(suffix)) + suffix;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}
module.exports = { byteLength, validateName, suggestName, uniqueName };

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MiB';
}
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function formatSpeed(bytesPerSecond) {
  const value = Number(bytesPerSecond);
  return formatSize(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0) + '/s';
}
function errorText(error) {
  const message = error && (error.message || error.errMsg) || String(error || '操作失败');
  if (/quota|space|limit exceeded|ENOSPC/i.test(message)) return '本地存储空间不足，请先清理已接收的文件后重试';
  return message;
}
module.exports = { formatSize, formatSpeed, formatDate, errorText };

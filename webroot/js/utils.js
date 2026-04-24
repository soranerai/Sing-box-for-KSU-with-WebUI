export const MOD_PATH = "/data/adb/modules/singbox_ksu";
export const BIN_PATH = `${MOD_PATH}/sing-box`;
export const META_PATH = `${MOD_PATH}/.metadata.json`;
export const AUTOUPDATER_SCRIPT = `${MOD_PATH}/autoupdater.sh`;
export const AUTOUPDATE_LIST = `${MOD_PATH}/autoupdate.list`;

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `"'"`)}'`;
}

export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const days = Math.floor(sec / 86400); sec -= days * 86400;
  const hours = Math.floor(sec / 3600); sec -= hours * 3600;
  const minutes = Math.floor(sec / 60); const seconds = sec - minutes * 60;
  if (days) return `${days}д ${hours}ч`;
  if (hours) return `${hours}ч ${minutes}м`;
  if (minutes) return `${minutes}м ${seconds}с`;
  return `${seconds}с`;
}

export function formatBytesPerSec(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n/1e9).toFixed(2)+' GB/s';
  if (n >= 1e6) return (n/1e6).toFixed(2)+' MB/s';
  if (n >= 1e3) return (n/1e3).toFixed(1)+' KB/s';
  return n+' B/s';
}

export function formatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n/1e9).toFixed(2)+' GB';
  if (n >= 1e6) return (n/1e6).toFixed(2)+' MB';
  if (n >= 1e3) return (n/1e3).toFixed(1)+' KB';
  return n+' B';
}

export function displayName(file) {
  if (!file) return '';
  return String(file).replace(/\.json$/i, '');
}

export const Toast = {
  init() {
    this.container = document.getElementById('toast-container');
  },
  show(title, message, icon = 'info', duration = 4000) {
    if (!this.container) this.init();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span class="material-symbols-rounded">${icon}</span>
      <div>
        <div style="font-weight:600">${title}</div>
        <div style="font-size:12px;opacity:0.9">${message}</div>
      </div>
    `;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hide');
      toast.onanimationend = () => toast.remove();
    }, duration);
  },
  success(msg, title = 'Успешно') { this.show(title, msg, 'check_circle'); },
  error(msg, title = 'Ошибка') { this.show(title, msg, 'error'); },
  info(msg, title = 'Инфо') { this.show(title, msg, 'info'); }
};

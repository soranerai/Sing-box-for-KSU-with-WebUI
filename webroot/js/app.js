/* app.js — Modular and optimized for Material 3 UI */

const MOD_PATH = "/data/adb/modules/singbox_ksu";
const BIN_PATH = `${MOD_PATH}/sing-box`;
const META_PATH = `${MOD_PATH}/.metadata.json`;
const AUTOUPDATER_SCRIPT = `${MOD_PATH}/autoupdater.sh`;
const AUTOUPDATE_LIST = `${MOD_PATH}/autoupdate.list`;

// --- Utils ---
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `"'"`)}'`;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const days = Math.floor(sec / 86400); sec -= days * 86400;
  const hours = Math.floor(sec / 3600); sec -= hours * 3600;
  const minutes = Math.floor(sec / 60); const seconds = sec - minutes * 60;
  if (days) return `${days}д ${hours}ч`;
  if (hours) return `${hours}ч ${minutes}м`;
  if (minutes) return `${minutes}м ${seconds}с`;
  return `${seconds}с`;
}

function formatBytesPerSec(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n/1e9).toFixed(2)+' GB/s';
  if (n >= 1e6) return (n/1e6).toFixed(2)+' MB/s';
  if (n >= 1e3) return (n/1e3).toFixed(1)+' KB/s';
  return n+' B/s';
}

function formatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n/1e9).toFixed(2)+' GB';
  if (n >= 1e6) return (n/1e6).toFixed(2)+' MB';
  if (n >= 1e3) return (n/1e3).toFixed(1)+' KB';
  return n+' B';
}

function displayName(file) {
  if (!file) return '';
  return String(file).replace(/\.json$/i, '');
}

// --- Toast System ---
const Toast = {
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

// --- API Service ---
class Api {
  static async exec(cmd) {
    try {
      if (typeof ksu === 'undefined' || !ksu.exec) {
        throw new Error("API KernelSU недоступен.");
      }
      return await ksu.exec(cmd);
    } catch (e) {
      console.error('Exec error:', e);
      return 'error';
    }
  }

  static async loadMetadata() {
    try {
      const res = await this.exec(`[ -f ${shellQuote(META_PATH)} ] && cat ${shellQuote(META_PATH)} || echo '{}'`);
      if (res === 'error') throw new Error("Не удалось прочитать метаданные");
      
      let data = JSON.parse(res || '{}') || {};
      
      let needsSave = false;
      if (!data.configs) {
        const oldData = { ...data };
        data = { serviceStart: oldData.__service_start || 0, configs: {} };
        
        for (const [key, value] of Object.entries(oldData)) {
          if (key === '__service_start' || key === '_service_start') continue;
          if (typeof value === 'string' && key.endsWith('.json')) {
            data.configs[key] = {
              url: value,
              autoUpdate: false,
              updateIntervalHours: 24
            };
          }
        }
        needsSave = true;
      }
      
      if (needsSave) {
        await this.saveMetadata(data);
      }
      return data;
      
    } catch (e) {
      Toast.error(e.message, "Ошибка загрузки");
      return { serviceStart: 0, configs: {} };
    }
  }

  static async saveMetadata(data) {
    try {
      // 1. Сохраняем JSON
      const json = JSON.stringify(data);
      const cmdJson = `cat > ${shellQuote(META_PATH)} <<'EOF'\n${json}\nEOF`;
      const resJson = await this.exec(cmdJson);
      if (resJson === 'error') throw new Error("Не удалось записать JSON");

      // 2. Генерируем autoupdate.list для Bash-демона
      let listContent = "";
      if (data.configs) {
        for (const [file, meta] of Object.entries(data.configs)) {
          if (meta.autoUpdate && meta.url) {
            listContent += `${file}|${meta.updateIntervalHours || 24}|${meta.url}\n`;
          }
        }
      }
      const cmdList = `cat > ${shellQuote(AUTOUPDATE_LIST)} <<'EOF'\n${listContent}EOF`;
      await this.exec(cmdList);

    } catch (e) {
      Toast.error(e.message, "Ошибка сохранения");
    }
  }
}

// --- Log Viewer ---
class LogViewer {
  constructor() {
    this.ws = null;
    this.container = document.getElementById('logs-body');
    this.searchInput = document.getElementById('logs-search');
    this.levelSelect = document.getElementById('log-level-select');
    this.btnClear = document.getElementById('btn-clear-logs');
    
    this.maxLines = 1000;
    this.lines = [];
    this.filterQuery = '';

    this.bindEvents();
  }

  bindEvents() {
    this.searchInput.addEventListener('input', (e) => {
      this.filterQuery = e.target.value.toLowerCase();
      this.render();
    });

    this.levelSelect.addEventListener('change', () => {
      this.clear();
      this.stop();
      if (document.getElementById('tab-logs').classList.contains('active')) {
        this.start();
      }
    });

    this.btnClear.addEventListener('click', () => this.clear());
  }

  pushLog(level, text) {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const fullText = `[${ts}] ${text}`;
    
    this.lines.push({ level, text: fullText });
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
    this.appendLogDOM({ level, text: fullText });
  }

  appendLogDOM(log) {
    if (this.filterQuery && !log.text.toLowerCase().includes(this.filterQuery)) return;

    const el = document.createElement('div');
    el.className = `log-line ${log.level}`;
    el.textContent = log.text;
    this.container.appendChild(el);

    this.container.scrollTop = this.container.scrollHeight;
    
    if (this.container.childElementCount > this.maxLines) {
      this.container.removeChild(this.container.firstElementChild);
    }
  }

  render() {
    this.container.innerHTML = '';
    const filtered = this.lines.filter(l => !this.filterQuery || l.text.toLowerCase().includes(this.filterQuery));
    for (const log of filtered) {
      const el = document.createElement('div');
      el.className = `log-line ${log.level}`;
      el.textContent = log.text;
      this.container.appendChild(el);
    }
    this.container.scrollTop = this.container.scrollHeight;
  }

  clear() {
    this.lines = [];
    this.container.innerHTML = '';
  }

  getToken() {
    return localStorage.getItem('ksu_token') || App.metadata?.token || '';
  }

  start() {
    this.stop();
    const level = this.levelSelect.value || 'info';
    try {
      const url = `ws://127.0.0.1:9090/logs?token=${encodeURIComponent(this.getToken())}&level=${encodeURIComponent(level)}`;
      this.ws = new WebSocket(url);
      this.ws.onmessage = (ev) => {
        const parts = String(ev.data).split(/\r?\n/).filter(Boolean);
        for (const p of parts) {
          try {
            const o = JSON.parse(p);
            if (o?.payload) this.pushLog(String(o.type || 'info').toLowerCase(), o.payload);
          } catch (e) { continue; }
        }
      };
      this.ws.onerror = () => {
        this.pushLog('error', 'Локальный сокет логов недоступен.');
      };
      this.ws.onclose = () => {
        this.ws = null;
        setTimeout(() => this.start(), 3000);
      };
    } catch (e) { this.ws = null; }
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// --- Traffic Monitor (Chart.js) ---
class TrafficMonitor {
  constructor() {
    this.ws = null;
    this.maxPoints = 60;
    
    this.upHistory = Array(this.maxPoints).fill(0);
    this.downHistory = Array(this.maxPoints).fill(0);
    this.connHistory = Array(this.maxPoints).fill(0);
    this.memHistory = Array(this.maxPoints).fill(0);

    Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    const colorUp = getComputedStyle(document.documentElement).getPropertyValue('--chart-red').trim() || '#FFB4AB';
    const colorDown = getComputedStyle(document.documentElement).getPropertyValue('--chart-blue').trim() || '#FFB3C3';
    const colorConns = getComputedStyle(document.documentElement).getPropertyValue('--chart-green').trim() || '#81C995';
    const colorMem = getComputedStyle(document.documentElement).getPropertyValue('--chart-purple').trim() || '#E8C08F';

    this.chartUp = this.createChart('chart-up', this.upHistory, colorUp, this.hexToRgba(colorUp, 0.2)); 
    this.chartDown = this.createChart('chart-down', this.downHistory, colorDown, this.hexToRgba(colorDown, 0.2));
    this.chartConns = this.createChart('chart-conns', this.connHistory, colorConns, this.hexToRgba(colorConns, 0.2));
    this.chartMem = this.createChart('chart-mem', this.memHistory, colorMem, this.hexToRgba(colorMem, 0.2));

    this.els = {
      up: document.getElementById('up-value'),
      down: document.getElementById('down-value'),
      conn: document.getElementById('conn-value'),
      mem: document.getElementById('mem-value')
    };

    this.start();
  }

  hexToRgba(hex, alpha) {
    if(!hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  createChart(canvasId, dataRef, borderColor, bgColor) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array(this.maxPoints).fill(''),
        datasets: [{
          data: dataRef,
          borderColor: borderColor,
          backgroundColor: bgColor,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0 }
        }
      }
    });
  }

  getToken() {
    return localStorage.getItem('ksu_token') || App.metadata?.token || '';
  }

  start() {
    this.connectTraffic();
    this.pollConnections();
  }

  connectTraffic() {
    try {
      if (this.ws) this.ws.close();
      const url = `ws://127.0.0.1:9090/traffic?token=${encodeURIComponent(this.getToken())}`;
      this.ws = new WebSocket(url);
      
      this.ws.onmessage = (ev) => {
        try {
          const obj = JSON.parse(ev.data);
          const up = Number(obj.up) || 0;
          const down = Number(obj.down) || 0;
          
          this.upHistory.push(up); this.upHistory.shift();
          this.downHistory.push(down); this.downHistory.shift();
          
          this.els.up.textContent = formatBytesPerSec(up);
          this.els.down.textContent = formatBytesPerSec(down);
          
          this.chartUp.update();
          this.chartDown.update();
        } catch (e) {}
      };
      
      this.ws.onclose = () => {
        this.ws = null;
        setTimeout(() => this.connectTraffic(), 3000);
      };
    } catch (e) {
      setTimeout(() => this.connectTraffic(), 3000);
    }
  }

  async pollConnections() {
    try {
      const res = await fetch('http://127.0.0.1:9090/connections');
      if (res.ok) {
        const j = await res.json();
        const conns = Array.isArray(j.connections) ? j.connections.length : 0;
        const mem = Number(j.memory) || 0;
        
        this.connHistory.push(conns); this.connHistory.shift();
        this.memHistory.push(mem); this.memHistory.shift();
        
        this.els.conn.textContent = String(conns);
        this.els.mem.textContent = formatBytes(mem);
        
        this.chartConns.update();
        this.chartMem.update();
      }
    } catch (e) {}
    
    setTimeout(() => this.pollConnections(), 1000);
  }
}

// --- Main App Orchestrator ---
const App = {
  metadata: { serviceStart: 0, configs: {} },
  configs: [],
  activeConfig: localStorage.getItem('active_cfg') || 'config.json',
  serviceRunning: false,
  updaterRunning: false,
  
  async init() {
    Toast.init();
    this.metadata = await Api.loadMetadata();
    
    this.logViewer = new LogViewer();
    this.trafficMonitor = new TrafficMonitor();
    
    this.bindUI();
    await this.scanConfigs();
    await this.updateStatus();
    await this.updateDaemonStatus();
    
    setInterval(() => this.updateStatus(), 2000);
    setInterval(() => this.updateDaemonStatus(), 3000);
  },

  bindUI() {
    // Tabs
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        const tabId = el.dataset.tab;
        
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
        
        document.getElementById(tabId).classList.add('active');
        el.classList.add('active');
        
        if (tabId === 'tab-logs') {
          this.logViewer.start();
        } else {
          this.logViewer.stop();
        }
      });
    });

    // Switches
    const mainSwitch = document.getElementById('main-switch');
    mainSwitch.addEventListener('change', async (e) => {
      e.preventDefault();
      if (mainSwitch.checked) {
        await this.startService();
      } else {
        await this.stopService();
      }
    });

    const updaterSwitch = document.getElementById('updater-switch');
    updaterSwitch.addEventListener('change', async (e) => {
      e.preventDefault();
      if (updaterSwitch.checked) {
        await this.startUpdaterDaemon();
      } else {
        await this.stopUpdaterDaemon();
      }
    });

    // Config Actions
    document.getElementById('btn-refresh-configs').addEventListener('click', () => this.scanConfigs());
    document.getElementById('btn-clear-cache').addEventListener('click', () => this.clearCache());
    
    // Add Dialog Elements
    const addDialog = document.getElementById('add-panel');
    const autoUpdateCheck = document.getElementById('cfg-auto-update');
    const intervalWrapper = document.getElementById('cfg-interval-wrapper');
    
    document.getElementById('btn-open-add').addEventListener('click', () => {
      addDialog.classList.add('open');
      document.getElementById('new-cfg-name').value = '';
      document.getElementById('new-cfg-url').value = '';
    });
    
    document.getElementById('btn-cancel-add').addEventListener('click', () => addDialog.classList.remove('open'));
    document.getElementById('btn-download-config').addEventListener('click', () => this.downloadConfig());
    
    autoUpdateCheck.addEventListener('change', (e) => {
      intervalWrapper.style.opacity = e.target.checked ? '1' : '0.5';
      intervalWrapper.style.pointerEvents = e.target.checked ? 'auto' : 'none';
    });
  },

  async updateStatus() {
    try {
      const pidRaw = String(await Api.exec('pidof sing-box')).trim();
      const pid = (pidRaw || '').split(/\s+/)[0] || '';
      this.serviceRunning = Boolean(pid && pid !== 'error');
      
      const sw = document.getElementById('main-switch');
      sw.checked = this.serviceRunning;

      let uptimeStr = '';
      if (this.serviceRunning && this.metadata?.serviceStart) {
        const elapsed = Math.floor((Date.now() - Number(this.metadata.serviceStart)) / 1000);
        uptimeStr = formatDuration(elapsed);
      }

      const stLabel = document.getElementById('st-label');
      const stDetail = document.getElementById('st-detail');
      const chip = document.getElementById('chip-runtime');

      if (this.serviceRunning) {
        stLabel.textContent = 'Работает';
        stLabel.style.color = 'var(--md-sys-color-primary)';
        stDetail.textContent = `Конфиг: ${displayName(this.activeConfig)}`;
        chip.innerHTML = `<span class="material-symbols-rounded" style="color:var(--md-sys-color-success)">check_circle</span><span>PID ${pid} ${uptimeStr ? '· '+uptimeStr : ''}</span>`;
        chip.classList.add('active');
      } else {
        stLabel.textContent = 'Выключен';
        stLabel.style.color = 'var(--md-sys-color-on-surface)';
        stDetail.textContent = 'Сервис не активен';
        chip.innerHTML = `<span class="material-symbols-rounded">pause_circle</span><span>Остановлен</span>`;
        chip.classList.remove('active');
      }
    } catch (e) {
      console.error("Ошибка обновления статуса", e);
    }
  },

  async updateDaemonStatus() {
    try {
      const psRes = String(await Api.exec(`ps -ef | grep autoupdater.sh | grep -v grep | wc -l`)).trim();
      this.updaterRunning = Number(psRes) > 0;

      const sw = document.getElementById('updater-switch');
      sw.checked = this.updaterRunning;

      const chip = document.getElementById('chip-updater');
      if (this.updaterRunning) {
        chip.innerHTML = `<span class="material-symbols-rounded" style="color:var(--md-sys-color-primary)">sync</span><span>Демон активен</span>`;
        chip.classList.add('active');
      } else {
        chip.innerHTML = `<span class="material-symbols-rounded">sync_disabled</span><span>Демон спит</span>`;
        chip.classList.remove('active');
      }
    } catch (e) {
      console.error("Ошибка обновления статуса демона", e);
    }
  },

  async scanConfigs() {
    try {
      const out = await Api.exec(`sh -lc 'first=1; for f in ${shellQuote(MOD_PATH)}/*.json; do [ -f "$f" ] || continue; b=$(basename "$f"); [ "$b" = ".metadata.json" ] && continue; if [ $first -eq 0 ]; then printf ";"; fi; printf "%s" "$b"; first=0; done; printf "\n"'`);
      if (out === 'error') throw new Error("Не удалось просканировать директорию");
      
      const files = String(out || '').split(';').map(s => s.trim()).filter(f => f.endsWith('.json') && f !== '.metadata.json');
      const records = [];
      
      for (const file of files) {
        const meta = this.metadata.configs[file];
        records.push({ 
          file, 
          meta: meta || null, 
          isSelected: file === this.activeConfig 
        });
      }
      
      records.sort((a, b) => {
        if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
        return a.file.localeCompare(b.file);
      });
      
      this.configs = records;
      if (this.configs.length && !this.configs.some(c => c.file === this.activeConfig)) {
        this.activeConfig = this.configs[0].file;
        localStorage.setItem('active_cfg', this.activeConfig);
      }
      this.renderConfigs();
    } catch (e) {
      Toast.error("Ошибка при сканировании файлов");
      this.configs = [];
      this.renderConfigs();
    }
  },

  renderConfigs() {
    const list = document.getElementById('config-list');
    list.innerHTML = '';
    document.getElementById('cfg-summary').textContent = `Конфигов: ${this.configs.length}`;

    for (const cfg of this.configs) {
      const item = document.createElement('div');
      item.className = `config-item ${cfg.isSelected ? 'selected' : ''}`;
      
      let metaHtml = '<span class="cfg-tag">Локальный файл</span>';
      let autoUpdateIcon = '';
      if (cfg.meta) {
        metaHtml = `<span class="cfg-tag" style="color:var(--md-sys-color-primary)"><span class="material-symbols-rounded">link</span> Из сети</span>`;
        if (cfg.meta.autoUpdate) {
          autoUpdateIcon = `<span class="cfg-tag"><span class="material-symbols-rounded" style="font-size:12px;color:var(--md-sys-color-success)">autorenew</span> ${cfg.meta.updateIntervalHours}ч</span>`;
        }
      }

      item.innerHTML = `
        <div class="cfg-info">
          <div class="cfg-name">${displayName(cfg.file)}</div>
          <div class="cfg-meta">
            ${metaHtml}
            ${autoUpdateIcon}
          </div>
        </div>
        <div class="cfg-actions">
          ${cfg.meta ? `<button class="md3-icon-btn update-btn" title="Принудительно обновить"><span class="material-symbols-rounded">sync</span></button>` : ''}
          <button class="md3-icon-btn delete delete-btn" title="Удалить"><span class="material-symbols-rounded">delete</span></button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (!e.target.closest('.md3-icon-btn')) {
          this.selectConfig(cfg.file);
        }
      });

      const updateBtn = item.querySelector('.update-btn');
      if (updateBtn) updateBtn.addEventListener('click', () => this.forceUpdateConfig(cfg.file));

      const delBtn = item.querySelector('.delete-btn');
      if (delBtn) delBtn.addEventListener('click', () => this.deleteConfig(cfg.file));

      list.appendChild(item);
    }
  },

  async selectConfig(file) {
    if (!file || this.activeConfig === file) return;
    const wasRunning = this.serviceRunning;
    this.activeConfig = file;
    localStorage.setItem('active_cfg', file);
    
    this.renderConfigs();
    if (wasRunning) {
      try {
        await Api.exec('pkill -9 sing-box');
        await wait(400);
        await this.startService();
      } catch (e) {
        Toast.error("Ошибка при перезапуске сервиса");
      }
    }
    await this.updateStatus();
  },

  async startService() {
    if (!this.activeConfig) {
      Toast.info("Выберите файл конфигурации");
      return;
    }
    try {
      await Api.exec(`chmod +x ${shellQuote(BIN_PATH)} 2>/dev/null || true`);
      const cmd = `cd ${shellQuote(MOD_PATH)} && nohup ${shellQuote(BIN_PATH)} run -c ${shellQuote(this.activeConfig)} >> /dev/null 2>&1 &`;
      await Api.exec(cmd);
      await wait(500);
      this.metadata.serviceStart = Date.now();
      await Api.saveMetadata(this.metadata);
      await this.updateStatus();
    } catch (e) {
      Toast.error("Не удалось запустить sing-box");
    }
  },

  async stopService() {
    try {
      await Api.exec('pkill -9 sing-box 2>/dev/null || true');
      await wait(300);
      this.metadata.serviceStart = 0;
      await Api.saveMetadata(this.metadata);
      await this.updateStatus();
    } catch (e) {
      Toast.error("Ошибка при остановке");
    }
  },

  async startUpdaterDaemon() {
    try {
      await Api.exec(`chmod +x ${shellQuote(AUTOUPDATER_SCRIPT)} 2>/dev/null || true`);
      const cmd = `cd ${shellQuote(MOD_PATH)} && nohup sh ${shellQuote(AUTOUPDATER_SCRIPT)} >> /dev/null 2>&1 &`;
      await Api.exec(cmd);
      await wait(500);
      await this.updateDaemonStatus();
      Toast.success("Демон автообновления запущен");
    } catch (e) {
      Toast.error("Не удалось запустить демона");
    }
  },

  async stopUpdaterDaemon() {
    try {
      await Api.exec(`ps -ef | grep autoupdater.sh | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`);
      await wait(300);
      await this.updateDaemonStatus();
      Toast.info("Демон автообновления остановлен");
    } catch (e) {
      Toast.error("Ошибка при остановке демона");
    }
  },

  async downloadConfig(targetFile = null, targetUrl = null, autoUpdate = null, interval = null) {
    const url = (targetUrl || document.getElementById('new-cfg-url').value || '').trim();
    let name = (targetFile || document.getElementById('new-cfg-name').value || '').trim();
    const isAutoUpdate = autoUpdate !== null ? autoUpdate : document.getElementById('cfg-auto-update').checked;
    const updateIntervalHours = interval !== null ? interval : Number(document.getElementById('cfg-update-interval').value || 24);
    
    if (!url) { Toast.info("Введите ссылку"); return false; }
    if (!name) name = `remote_${Date.now().toString().slice(-6)}`;
    if (!name.endsWith('.json')) name += '.json';

    document.getElementById('add-panel').classList.remove('open');
    Toast.info("Скачивание конфигурации...");

    try {
      const temp = `${MOD_PATH}/.tmp_download.json`;
      const dlRes = await Api.exec(`busybox wget -q --no-check-certificate -O ${shellQuote(temp)} ${shellQuote(url)}`);
      if (dlRes === 'error') throw new Error("Ошибка загрузки файла");
      
      const check = await Api.exec(`${shellQuote(BIN_PATH)} check -c ${shellQuote(temp)} >/dev/null 2>&1 && echo ok || echo fail`);
      if (!String(check).includes('ok')) {
        await Api.exec(`rm -f ${shellQuote(temp)}`);
        throw new Error("Не прошел проверку sing-box");
      }

      await Api.exec(`mv -f ${shellQuote(temp)} ${shellQuote(`${MOD_PATH}/${name}`)}`);
      
      this.metadata.configs[name] = {
        url: url,
        autoUpdate: isAutoUpdate,
        updateIntervalHours: updateIntervalHours
      };
      // saveMetadata также сгенерирует autoupdate.list
      await Api.saveMetadata(this.metadata);
      
      await this.scanConfigs();
      await this.selectConfig(name);
      Toast.success("Конфиг добавлен и проверен", "Успех");
      
      return true;
    } catch (e) {
      Toast.error(e.message, "Ошибка добавления");
      console.error(e);
      return false;
    }
  },

  async forceUpdateConfig(file) {
    const meta = this.metadata.configs[file];
    if (meta && meta.url) {
      Toast.info(`Обновление ${file}...`);
      await this.downloadConfig(file, meta.url, meta.autoUpdate, meta.updateIntervalHours);
    }
  },

  async deleteConfig(file) {
    if (!confirm(`Удалить конфигурацию ${file}?`)) return;
    try {
      await Api.exec(`rm -f ${shellQuote(`${MOD_PATH}/${file}`)}`);
      delete this.metadata.configs[file];
      await Api.saveMetadata(this.metadata);
      
      if (this.activeConfig === file) {
        this.activeConfig = '';
        localStorage.removeItem('active_cfg');
        await this.stopService();
      }
      await this.scanConfigs();
    } catch (e) {
      Toast.error("Ошибка при удалении");
    }
  },

  async clearCache() {
    if (!confirm('Очистить кэш sing-box (cache.db)?')) return;
    try {
      await Api.exec(`rm -f ${shellQuote(`${MOD_PATH}/cache.db`)}`);
      Toast.success('Кэш успешно очищен');
      await this.scanConfigs();
      await this.updateStatus();
    } catch (e) {
      Toast.error('Ошибка при очистке');
    }
  }
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

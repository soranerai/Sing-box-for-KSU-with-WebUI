import { MOD_PATH, BIN_PATH, AUTOUPDATER_SCRIPT, shellQuote, wait, formatDuration, displayName, Toast } from './utils.js';
import { Api } from './api.js';
import { LogViewer } from './components/logViewer.js';
import { TrafficMonitor } from './components/trafficMonitor.js';
import { ConfigManager } from './components/configManager.js';

const App = {
  metadata: { serviceStart: 0, configs: {} },
  configs: [],
  activeConfig: localStorage.getItem('active_cfg') || 'config.json',
  serviceRunning: false,
  updaterRunning: false,
  statDaemonRunning: false,
  apiType: '',

  async init() {
    this.detectApiType();
    Toast.init();
    Toast.info("App init started");

    await this.loadPartials();

    this.metadata = await Api.loadMetadata();

    this.logViewer = new LogViewer(() => this.getToken());
    this.trafficMonitor = new TrafficMonitor(() => this.getToken());
    this.configManager = new ConfigManager(this);

    this.bindUI();
    await this.configManager.scanConfigs();
    await this.updateStatus();
    await this.updateDaemonStatus();

    this.logViewer.start();
    this.trafficMonitor.start();

    setInterval(() => this.updateStatus(), 2000);
    setInterval(() => this.updateDaemonStatus(), 3000);
  },

  detectApiType() {
    const isKsu = typeof window.ksu !== 'undefined' || typeof ksu !== 'undefined';
    const isApatch = typeof window.apatch !== 'undefined' || typeof apatch !== 'undefined' || 
                     typeof window.ap !== 'undefined' || typeof ap !== 'undefined';
    
    if (isKsu) {
      this.apiType = 'ksu';
    } else if (isApatch) {
      this.apiType = 'apatch';
    } else {
      this.apiType = 'unknown';
    }
    console.log(`[App] Detected Root Type: ${this.apiType}`);
  },

  async optimizeProcess(pid) {
    if (!pid) return;
    const p = String(pid).trim();
    // Try to move to high priority cgroups and renice
    const cgroupCmd = `
      echo ${p} > /dev/stune/top-app/tasks 2>/dev/null || true;
      echo ${p} > /dev/stune/foreground/tasks 2>/dev/null || true;
      echo ${p} > /dev/cpuctl/top-app/cgroup.procs 2>/dev/null || true;
      echo ${p} > /dev/cpuctl/foreground/cgroup.procs 2>/dev/null || true;
      renice -n -10 -p ${p} 2>/dev/null || true;
    `;
    await Api.exec(cgroupCmd);
  },

  getToken() {
    return localStorage.getItem('ksu_token') || this.metadata?.token || '';
  },

  async loadPartials() {
    try {
      const [homeHtml, logsHtml, configHtml] = await Promise.all([
        fetch('pages/home.html').then(r => r.text()),
        fetch('pages/logs.html').then(r => r.text()),
        fetch('pages/configs.html').then(r => r.text())
      ]);
      document.getElementById('tab-home').innerHTML = homeHtml;
      document.getElementById('tab-logs').innerHTML = logsHtml;
      document.getElementById('tab-config').innerHTML = configHtml;
    } catch (e) {
      console.error("Ошибка загрузки partials", e);
    }
  },

  bindUI() {
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

    const mainSwitch = document.getElementById('main-switch');
    if (mainSwitch) {
      mainSwitch.addEventListener('change', async (e) => {
        e.preventDefault();
        if (mainSwitch.checked) {
          await this.startService();
        } else {
          await this.stopService();
        }
      });
    }

    const fabProxy = document.getElementById('fab-proxy');
    if (fabProxy) {
      fabProxy.addEventListener('click', async () => {
        if (this.serviceRunning) {
          await this.stopService();
        } else {
          await this.startService();
        }
      });
    }

    const chipUpdater = document.getElementById('chip-updater');
    if (chipUpdater) {
      chipUpdater.addEventListener('click', async (e) => {
        e.preventDefault();
        if (this.updaterRunning) {
          await this.stopUpdaterDaemon();
        } else {
          await this.startUpdaterDaemon();
        }
      });
    }

    const chipStatDaemon = document.getElementById('chip-stat-daemon');
    if (chipStatDaemon) {
      chipStatDaemon.addEventListener('click', async (e) => {
        e.preventDefault();
        if (this.statDaemonRunning) {
          await this.stopStatDaemon();
        } else {
          await this.startStatDaemon();
        }
      });
    }

    const btnRefresh = document.getElementById('btn-refresh-configs');
    if (btnRefresh) btnRefresh.addEventListener('click', () => this.configManager.scanConfigs());

    const btnClearCache = document.getElementById('btn-clear-cache');
    if (btnClearCache) btnClearCache.addEventListener('click', async () => {
      if (!confirm('Очистить кэш sing-box (cache.db)?')) return;
      try {
        await Api.exec(`rm -f ${shellQuote(`${MOD_PATH}/cache.db`)}`);
        Toast.success('Кэш успешно очищен');
        await this.configManager.scanConfigs();
        await this.updateStatus();
      } catch (e) {
        Toast.error('Ошибка при очистке');
      }
    });

    const addDialog = document.getElementById('add-panel');
    const autoUpdateCheck = document.getElementById('cfg-auto-update');
    const intervalWrapper = document.getElementById('cfg-interval-wrapper');

    const btnOpenAdd = document.getElementById('btn-open-add');
    if (btnOpenAdd) btnOpenAdd.addEventListener('click', () => {
      if (addDialog) addDialog.classList.add('open');
      document.getElementById('new-cfg-name').value = '';
      document.getElementById('new-cfg-url').value = '';
    });

    const btnCancelAdd = document.getElementById('btn-cancel-add');
    if (btnCancelAdd) btnCancelAdd.addEventListener('click', () => {
      if (addDialog) addDialog.classList.remove('open');
    });

    const btnDownload = document.getElementById('btn-download-config');
    if (btnDownload) btnDownload.addEventListener('click', () => this.configManager.downloadConfig());

    if (autoUpdateCheck && intervalWrapper) {
      autoUpdateCheck.addEventListener('change', (e) => {
        intervalWrapper.style.opacity = e.target.checked ? '1' : '0.5';
        intervalWrapper.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      });
    }
  },

  async updateStatus() {
    try {
      const pidRaw = String(await Api.exec('pidof sing-box')).trim();
      const pid = (pidRaw || '').split(/\s+/)[0] || '';
      this.serviceRunning = Boolean(pid && pid !== 'error');

      const fab = document.getElementById('fab-proxy');
      if (fab) {
        if (this.serviceRunning) {
          fab.classList.add('active');
          fab.title = "Остановить прокси";
        } else {
          fab.classList.remove('active');
          fab.title = "Запустить прокси";
        }
      }

      let uptimeStr = '';
      if (this.serviceRunning && this.metadata?.serviceStart) {
        const elapsed = Math.floor((Date.now() - Number(this.metadata.serviceStart)) / 1000);
        uptimeStr = formatDuration(elapsed);
      }

      const chip = document.getElementById('chip-runtime');

      if (this.serviceRunning) {
        if (chip) {
          chip.innerHTML = `<span class="material-symbols-rounded" style="color:var(--md-sys-color-success)">check_circle</span><span>PID ${pid} ${uptimeStr ? '· ' + uptimeStr : ''}</span>`;
          chip.classList.add('active');
        }
      } else {
        if (chip) {
          chip.innerHTML = `<span class="material-symbols-rounded">pause_circle</span><span>Остановлен</span>`;
          chip.classList.remove('active');
        }
      }
    } catch (e) {
      console.error("Ошибка обновления статуса", e);
    }
  },

  async updateDaemonStatus() {
    try {
      const psResUpdater = String(await Api.exec(`ps -ef | grep autoupdater.sh | grep -v grep | wc -l`)).trim();
      this.updaterRunning = Number(psResUpdater) > 0;

      const chipUpd = document.getElementById('chip-updater');
      if (chipUpd) {
        if (this.updaterRunning) {
          chipUpd.classList.add('active');
          chipUpd.innerHTML = `<span class="material-symbols-rounded">sync</span>`;
        } else {
          chipUpd.classList.remove('active');
          chipUpd.innerHTML = `<span class="material-symbols-rounded">sync_disabled</span>`;
        }
      }

      const psResStat = String(await Api.exec(`ps -ef | grep stat_daemon.sh | grep -v grep | wc -l`)).trim();
      this.statDaemonRunning = Number(psResStat) > 0;

      const chipStat = document.getElementById('chip-stat-daemon');
      if (chipStat) {
        if (this.statDaemonRunning) {
          chipStat.classList.add('active');
          chipStat.innerHTML = `<span class="material-symbols-rounded">query_stats</span>`;
        } else {
          chipStat.classList.remove('active');
          chipStat.innerHTML = `<span class="material-symbols-rounded">analytics</span>`;
        }
      }
    } catch (e) {
      console.error("Ошибка обновления статуса демона", e);
    }
  },

  async startService() {
    if (!this.activeConfig) {
      Toast.info("Выберите файл конфигурации");
      return;
    }
    try {
      const originalPath = `${MOD_PATH}/configs/${this.activeConfig}`;
      const tempReadPath = `${MOD_PATH}/webroot/_temp_read.json`;

      // Copy to webroot to bypass bridge limit
      await Api.exec(`cp ${shellQuote(originalPath)} ${shellQuote(tempReadPath)} && chmod 644 ${shellQuote(tempReadPath)}`);

      const response = await fetch(`_temp_read.json?v=${Date.now()}`);
      if (!response.ok) throw new Error("Не удалось загрузить временный файл через fetch");
      const raw = await response.text();

      // Cleanup temp read file
      Api.exec(`rm -f ${shellQuote(tempReadPath)}`);

      let config;
      try {
        config = JSON.parse(raw);
      } catch (e) {
        console.error("JSON Parse Error:", e, "Raw sample:", raw.substring(0, 100));
        throw new Error("Ошибка формата JSON (возможно, в файле есть комментарии)");
      }

      // Inject / Force clash_api settings
      if (!config.experimental) config.experimental = {};
      config.experimental.clash_api = {
        external_controller: "127.0.0.1:9090",
        external_ui: "secret"
      };

      // Save to temporary execution config (using chunked write to avoid bridge limits)
      const runConfigPath = `${MOD_PATH}/run_config.json`;
      const modifiedJson = JSON.stringify(config, null, 2);

      await this.safeWriteFile(runConfigPath, modifiedJson);

      await Api.exec(`chmod +x ${shellQuote(BIN_PATH)} 2>/dev/null || true`);
      await Api.exec(`chcon u:object_r:system_file:s0 ${shellQuote(BIN_PATH)} 2>/dev/null || true`);

      const cmd = `cd ${shellQuote(MOD_PATH)} && ( ${shellQuote(BIN_PATH)} run -c ${shellQuote(runConfigPath)} </dev/null >> run.log 2>&1 & echo $! )`;
      const pid = String(await Api.exec(cmd)).trim();

      if (pid && !isNaN(pid)) {
        await this.optimizeProcess(pid);
      }

      await wait(500);
      this.metadata.serviceStart = Date.now();
      await Api.saveMetadata(this.metadata);
      await this.updateStatus();
    } catch (e) {
      Toast.error(e.message || "Не удалось запустить sing-box");
      console.error(e);
    }
  },

  async safeWriteFile(path, content) {
    // Split into chunks of 2KB to stay safe within KSU bridge limits
    const b64 = btoa(unescape(encodeURIComponent(content)));
    const chunks = b64.match(/.{1,2048}/g) || [];

    const b64Path = `${path}.b64`;
    await Api.exec(`true > ${shellQuote(b64Path)}`);
    for (const chunk of chunks) {
      await Api.exec(`printf "%s" ${shellQuote(chunk)} >> ${shellQuote(b64Path)}`);
    }

    if (this.apiType == "apatch") {
      await Api.exec(`/data/adb/ap/bin/busybox base64 -d ${shellQuote(b64Path)} > ${shellQuote(path)} && rm -f ${shellQuote(b64Path)}`);
    } else {
      await Api.exec(`/data/adb/ksu/bin/busybox base64 -d ${shellQuote(b64Path)} > ${shellQuote(path)} && rm -f ${shellQuote(b64Path)}`);
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
      const cmd = `cd ${shellQuote(MOD_PATH)} && ( sh ${shellQuote(AUTOUPDATER_SCRIPT)} </dev/null >> /dev/null 2>&1 & echo $! )`;
      const pid = String(await Api.exec(cmd)).trim();

      if (pid && !isNaN(pid)) {
        await this.optimizeProcess(pid);
      }
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

  async startStatDaemon() {
    try {
      const scriptPath = MOD_PATH + '/stat_daemon.sh';
      await Api.exec(`chmod +x ${shellQuote(scriptPath)} 2>/dev/null || true`);
      const cmd = `cd ${shellQuote(MOD_PATH)} && ( sh ${shellQuote(scriptPath)} </dev/null >> /dev/null 2>&1 & echo $! )`;
      const pid = String(await Api.exec(cmd)).trim();

      if (pid && !isNaN(pid)) {
        await this.optimizeProcess(pid);
      }
      await wait(500);
      await this.updateDaemonStatus();
      Toast.success("Демон статистики запущен");
    } catch (e) {
      Toast.error("Не удалось запустить демона статистики");
    }
  },

  async stopStatDaemon() {
    try {
      await Api.exec(`ps -ef | grep stat_daemon.sh | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`);
      await wait(300);
      await this.updateDaemonStatus();
      Toast.info("Демон статистики остановлен");
    } catch (e) {
      Toast.error("Ошибка при остановке демона статистики");
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

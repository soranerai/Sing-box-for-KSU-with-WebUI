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
  
  async init() {
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
    } catch(e) {
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
    if(btnRefresh) btnRefresh.addEventListener('click', () => this.configManager.scanConfigs());
    
    const btnClearCache = document.getElementById('btn-clear-cache');
    if(btnClearCache) btnClearCache.addEventListener('click', async () => {
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
    if(btnOpenAdd) btnOpenAdd.addEventListener('click', () => {
      if(addDialog) addDialog.classList.add('open');
      document.getElementById('new-cfg-name').value = '';
      document.getElementById('new-cfg-url').value = '';
    });
    
    const btnCancelAdd = document.getElementById('btn-cancel-add');
    if(btnCancelAdd) btnCancelAdd.addEventListener('click', () => {
      if(addDialog) addDialog.classList.remove('open');
    });
    
    const btnDownload = document.getElementById('btn-download-config');
    if(btnDownload) btnDownload.addEventListener('click', () => this.configManager.downloadConfig());
    
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
      
      const sw = document.getElementById('main-switch');
      if (sw) sw.checked = this.serviceRunning;

      let uptimeStr = '';
      if (this.serviceRunning && this.metadata?.serviceStart) {
        const elapsed = Math.floor((Date.now() - Number(this.metadata.serviceStart)) / 1000);
        uptimeStr = formatDuration(elapsed);
      }

      const stLabel = document.getElementById('st-label');
      const stDetail = document.getElementById('st-detail');
      const chip = document.getElementById('chip-runtime');

      if (this.serviceRunning) {
        if(stLabel) {
          stLabel.textContent = 'Работает';
          stLabel.style.color = 'var(--md-sys-color-primary)';
        }
        if(stDetail) stDetail.textContent = `Конфиг: ${displayName(this.activeConfig)}`;
        if(chip) {
          chip.innerHTML = `<span class="material-symbols-rounded" style="color:var(--md-sys-color-success)">check_circle</span><span>PID ${pid} ${uptimeStr ? '· '+uptimeStr : ''}</span>`;
          chip.classList.add('active');
        }
      } else {
        if(stLabel) {
          stLabel.textContent = 'Выключен';
          stLabel.style.color = 'var(--md-sys-color-on-surface)';
        }
        if(stDetail) stDetail.textContent = 'Сервис не активен';
        if(chip) {
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
          chipUpd.innerHTML = `<span class="material-symbols-rounded" style="color:var(--md-sys-color-primary)">sync</span><span>Обновления</span>`;
          chipUpd.classList.add('active');
        } else {
          chipUpd.innerHTML = `<span class="material-symbols-rounded">sync_disabled</span><span>Обновления</span>`;
          chipUpd.classList.remove('active');
        }
      }

      const psResStat = String(await Api.exec(`ps -ef | grep stat_daemon.sh | grep -v grep | wc -l`)).trim();
      this.statDaemonRunning = Number(psResStat) > 0;

      const chipStat = document.getElementById('chip-stat-daemon');
      if (chipStat) {
        if (this.statDaemonRunning) {
          chipStat.innerHTML = `<span class="material-symbols-rounded" style="color:var(--md-sys-color-primary)">query_stats</span><span>Статистика</span>`;
          chipStat.classList.add('active');
        } else {
          chipStat.innerHTML = `<span class="material-symbols-rounded">analytics</span><span>Статистика выкл.</span>`;
          chipStat.classList.remove('active');
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
      await Api.exec(`chmod +x ${shellQuote(BIN_PATH)} 2>/dev/null || true`);
      const cmd = `cd ${shellQuote(MOD_PATH)} && nohup ${shellQuote(BIN_PATH)} run -c ${shellQuote(MOD_PATH + '/configs/' + this.activeConfig)} >> run.log 2>&1 &`;
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

  async startStatDaemon() {
    try {
      await Api.exec(`chmod +x ${shellQuote(MOD_PATH + '/stat_daemon.sh')} 2>/dev/null || true`);
      const cmd = `cd ${shellQuote(MOD_PATH)} && nohup sh stat_daemon.sh >> /dev/null 2>&1 &`;
      await Api.exec(cmd);
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

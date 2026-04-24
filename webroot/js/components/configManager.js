import { MOD_PATH, BIN_PATH, shellQuote, displayName, wait, Toast } from '../utils.js';
import { Api } from '../api.js';

export class ConfigManager {
  constructor(app) {
    this.app = app;
  }

  async scanConfigs() {
    try {
      await Api.exec(`mkdir -p ${shellQuote(MOD_PATH)}/configs`);
      const out = await Api.exec(`sh -c 'first=1; for f in ${shellQuote(MOD_PATH)}/configs/*.json; do [ -f "$f" ] || continue; b=\$(basename "\$f"); [ "\$b" = ".metadata.json" ] && continue; if [ \$first -eq 0 ]; then printf ";"; fi; printf "%s" "\$b"; first=0; done; printf "\\n"'`);
      if (out === 'error') throw new Error("Не удалось просканировать директорию");
      
      const files = String(out || '').split(';').map(s => s.trim()).filter(f => f.endsWith('.json') && f !== '.metadata.json');
      const records = [];
      
      for (const file of files) {
        const meta = (this.app.metadata?.configs || {})[file];
        records.push({ 
          file, 
          meta: meta || null, 
          isSelected: file === this.app.activeConfig 
        });
      }
      
      records.sort((a, b) => {
        if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
        return a.file.localeCompare(b.file);
      });
      
      this.app.configs = records;
      if (this.app.configs.length && !this.app.configs.some(c => c.file === this.app.activeConfig)) {
        this.app.activeConfig = this.app.configs[0].file;
        localStorage.setItem('active_cfg', this.app.activeConfig);
        this.app.configs[0].isSelected = true;
      }
      this.renderConfigs();
    } catch (e) {
      Toast.error("Ошибка при сканировании файлов");
      this.app.configs = [];
      this.renderConfigs();
    }
  }

  renderConfigs() {
    const list = document.getElementById('config-list');
    if (!list) return;
    list.innerHTML = '';
    
    const summary = document.getElementById('cfg-summary');
    if (summary) summary.textContent = `Конфигов: ${this.app.configs.length}`;

    for (const cfg of this.app.configs) {
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
  }

  async selectConfig(file) {
    if (!file || this.app.activeConfig === file) return;
    const wasRunning = this.app.serviceRunning;
    this.app.activeConfig = file;
    localStorage.setItem('active_cfg', file);
    
    for (const cfg of this.app.configs) {
      cfg.isSelected = (cfg.file === file);
    }
    
    this.renderConfigs();
    if (wasRunning) {
      try {
        await Api.exec('pkill -9 sing-box');
        await wait(400);
        await this.app.startService();
      } catch (e) {
        Toast.error("Ошибка при перезапуске сервиса");
      }
    }
    await this.app.updateStatus();
  }

  async downloadConfig(targetFile = null, targetUrl = null, autoUpdate = null, interval = null) {
    const url = (targetUrl || document.getElementById('new-cfg-url').value || '').trim();
    let name = (targetFile || document.getElementById('new-cfg-name').value || '').trim();
    const autoUpdateCheck = document.getElementById('cfg-auto-update');
    const isAutoUpdate = autoUpdate !== null ? autoUpdate : (autoUpdateCheck ? autoUpdateCheck.checked : false);
    const intervalSelect = document.getElementById('cfg-update-interval');
    const updateIntervalHours = interval !== null ? interval : Number(intervalSelect ? intervalSelect.value : 24);
    
    if (!url) { Toast.info("Введите ссылку"); return false; }
    if (!name) name = `remote_${Date.now().toString().slice(-6)}`;
    if (!name.endsWith('.json')) name += '.json';

    const addPanel = document.getElementById('add-panel');
    if(addPanel) addPanel.classList.remove('open');
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

      await Api.exec(`mv -f ${shellQuote(temp)} ${shellQuote(`${MOD_PATH}/configs/${name}`)}`);
      
      if (!this.app.metadata.configs) this.app.metadata.configs = {};
      this.app.metadata.configs[name] = {
        url: url,
        autoUpdate: isAutoUpdate,
        updateIntervalHours: updateIntervalHours
      };
      await Api.saveMetadata(this.app.metadata);
      
      await this.scanConfigs();
      await this.selectConfig(name);
      Toast.success("Конфиг добавлен и проверен", "Успех");
      
      return true;
    } catch (e) {
      Toast.error(e.message, "Ошибка добавления");
      console.error(e);
      return false;
    }
  }

  async forceUpdateConfig(file) {
    const meta = (this.app.metadata?.configs || {})[file];
    if (meta && meta.url) {
      Toast.info(`Обновление ${file}...`);
      await this.downloadConfig(file, meta.url, meta.autoUpdate, meta.updateIntervalHours);
    }
  }

  async deleteConfig(file) {
    if (!confirm(`Удалить конфигурацию ${file}?`)) return;
    try {
      await Api.exec(`rm -f ${shellQuote(`${MOD_PATH}/configs/${file}`)}`);
      if (this.app.metadata?.configs) {
        delete this.app.metadata.configs[file];
      }
      await Api.saveMetadata(this.app.metadata);
      
      if (this.app.activeConfig === file) {
        this.app.activeConfig = '';
        localStorage.removeItem('active_cfg');
        await this.app.stopService();
      }
      await this.scanConfigs();
    } catch (e) {
      Toast.error("Ошибка при удалении");
    }
  }
}

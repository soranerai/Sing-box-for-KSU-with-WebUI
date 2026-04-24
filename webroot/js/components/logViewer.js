import { Api } from '../api.js';
import { MOD_PATH } from '../utils.js';

export class LogViewer {
  constructor(appTokenProvider) {
    this.getToken = appTokenProvider;
    this.active = false;
    this.lastSize = 0;
    this.logBuffer = "";
    
    this.container = document.getElementById('logs-body');
    this.searchInput = document.getElementById('logs-search');
    this.levelSelect = document.getElementById('log-level-select');
    this.btnClear = document.getElementById('btn-clear-logs');
    
    this.maxLines = 300;
    this.lines = [];
    this.filterQuery = '';

    this.bindEvents();
  }

  bindEvents() {
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.filterQuery = e.target.value.toLowerCase();
        this.render();
      });
    }

    if (this.levelSelect) {
      this.levelSelect.addEventListener('change', () => {
        this.clear();
        this.lastSize = 0; // Reset offset on level change to reload from file
      });
    }

    if (this.btnClear) {
      this.btnClear.addEventListener('click', () => {
        this.clear();
      });
    }
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

  start() {
    if (this.active) return;
    this.active = true;
    this.connectLogs();
  }

  stop() {
    this.active = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  connectLogs() {
    if (!this.active) return;
    try {
      if (this.ws) this.ws.close();
      const level = this.levelSelect?.value || 'info';
      const url = `ws://127.0.0.1:9090/logs?token=${encodeURIComponent(this.getToken())}&level=${encodeURIComponent(level)}`;
      this.ws = new WebSocket(url);
      
      this.ws.onmessage = (ev) => {
        if (!this.active) return;
        const parts = String(ev.data).split(/\r?\n/).filter(Boolean);
        for (const p of parts) {
          try {
            const o = JSON.parse(p);
            if (o?.payload) this.pushLog(String(o.type || 'info').toLowerCase(), o.payload);
          } catch (e) { continue; }
        }
      };
      
      this.ws.onerror = () => {
        // suppress
      };
      
      this.ws.onclose = () => {
        this.ws = null;
        if (this.active) setTimeout(() => this.connectLogs(), 3000);
      };
    } catch (e) {
      if (this.active) setTimeout(() => this.connectLogs(), 3000);
    }
  }
}

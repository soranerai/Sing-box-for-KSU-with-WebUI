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
    
    this.maxLines = 500;
    this.lines = [];
    this.filterQuery = '';
    this.lastTs = 0;

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
        this.render();
      });
    }

    if (this.btnClear) {
      this.btnClear.addEventListener('click', () => {
        this.clear();
      });
    }
  }

  pushLog(level, text, ts) {
    // If no ts provided, use current
    const logTs = ts || Math.floor(Date.now() / 1000);
    const date = new Date(logTs * 1000);
    const tsStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    const fullText = `[${tsStr}] ${text}`;
    
    this.lines.push({ level, text: fullText, ts: logTs });
    
    // Keep only last 5 minutes of logs in memory
    const fiveMinsAgo = Math.floor(Date.now() / 1000) - 300;
    while (this.lines.length > 0 && this.lines[0].ts < fiveMinsAgo) {
      this.lines.shift();
    }

    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
    
    this.appendLogDOM({ level, text: fullText });
  }

  appendLogDOM(log) {
    if (this.filterQuery && !log.text.toLowerCase().includes(this.filterQuery)) return;
    
    const selectedLevel = this.levelSelect?.value || 'info';
    if (this.shouldFilterByLevel(log.level, selectedLevel)) return;

    const el = document.createElement('div');
    el.className = `log-line ${log.level}`;
    el.textContent = log.text;
    this.container.appendChild(el);

    this.container.scrollTop = this.container.scrollHeight;
    
    if (this.container.childElementCount > this.maxLines) {
      this.container.removeChild(this.container.firstElementChild);
    }
  }

  shouldFilterByLevel(logLevel, selectedLevel) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const logIdx = levels.indexOf(logLevel);
    const selIdx = levels.indexOf(selectedLevel);
    return logIdx < selIdx;
  }

  render() {
    this.container.innerHTML = '';
    const selectedLevel = this.levelSelect?.value || 'info';
    const filtered = this.lines.filter(l => {
      const matchSearch = !this.filterQuery || l.text.toLowerCase().includes(this.filterQuery);
      const matchLevel = !this.shouldFilterByLevel(l.level, selectedLevel);
      return matchSearch && matchLevel;
    });

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
    this.poll();
  }

  stop() {
    this.active = false;
  }

  async poll() {
    if (!this.active) return;
    try {
      const res = await fetch(`/logs.log?t=${Date.now()}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const text = await res.text();

      const parts = text.match(/\{[^{}]*\}/g) || [];
      const entries = [];
      for (const p of parts) {
        try {
          const o = JSON.parse(p);
          if (o.ts && o.ts > this.lastTs) entries.push(o);
        } catch(e) {}
      }

      if (entries.length > 0) {
        // Sort by timestamp
        entries.sort((a, b) => a.ts - b.ts);
        
        let added = false;
        for (const o of entries) {
          if (o.ts < this.lastTs) continue;
          
          // Deduplicate logs in the same second
          if (o.ts === this.lastTs && o.payload) {
            const isDup = this.lines.some(l => l.ts === o.ts && l.text.includes(o.payload));
            if (isDup) continue;
          }

          if (o.payload) {
            this.pushLog(String(o.type || 'info').toLowerCase(), o.payload, o.ts);
            added = true;
          }
        }
        
        this.lastTs = entries[entries.length - 1].ts;
        if (added) this.render();
      }
    } catch(e) {
      console.error("LogViewer poll error", e);
    }
    if (this.active) setTimeout(() => this.poll(), 1000);
  }
}

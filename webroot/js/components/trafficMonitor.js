import { MOD_PATH, formatBytesPerSec, formatBytes, Toast } from '../utils.js';
import { Api, Debug } from '../api.js';

function fmtMBs(bytes) {
  const mb = bytes / 1048576;
  return mb >= 0.01 ? mb.toFixed(2) + ' MB/s' : (bytes / 1024).toFixed(1) + ' KB/s';
}

function fmtMB(bytes) {
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export class TrafficMonitor {
  constructor() {
    this.active = false;
    this.maxPoints = 300;

    this.upHistory = Array(this.maxPoints).fill(null);
    this.downHistory = Array(this.maxPoints).fill(null);
    this.connHistory = Array(this.maxPoints).fill(null);
    this.memHistory = Array(this.maxPoints).fill(null);

    this.buffer = "";
    this.lastSize = 0;
    this.lastTs = 0;

    // Correct element IDs from home.html
    this.els = {
      up: document.getElementById('up-value'),
      down: document.getElementById('down-value'),
      conn: document.getElementById('conn-value'),
      mem: document.getElementById('mem-value')
    };

    this.initCharts();
  }

  initCharts() {
    const mkOptions = (yLabel) => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { display: false },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 9 }, callback: yLabel }
        }
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      elements: { line: { tension: 0.2, borderWidth: 1.5 }, point: { radius: 0 } }
    });

    const labels = Array(this.maxPoints).fill('');

    this.chartUp = new Chart(document.getElementById('chart-up'), {
      type: 'line',
      data: { labels, datasets: [{ data: this.upHistory, borderColor: '#ff5252', backgroundColor: 'rgba(255,82,82,0.15)', fill: true, spanGaps: false }] },
      options: mkOptions(v => v >= 1048576 ? (v/1048576).toFixed(1)+'M' : v >= 1024 ? (v/1024).toFixed(0)+'K' : v+'B')
    });

    this.chartDown = new Chart(document.getElementById('chart-down'), {
      type: 'line',
      data: { labels, datasets: [{ data: this.downHistory, borderColor: '#448aff', backgroundColor: 'rgba(68,138,255,0.15)', fill: true, spanGaps: false }] },
      options: mkOptions(v => v >= 1048576 ? (v/1048576).toFixed(1)+'M' : v >= 1024 ? (v/1024).toFixed(0)+'K' : v+'B')
    });

    // Note: canvas id is "chart-conns" in home.html
    this.chartConns = new Chart(document.getElementById('chart-conns'), {
      type: 'line',
      data: { labels, datasets: [{ data: this.connHistory, borderColor: '#7c4dff', backgroundColor: 'rgba(124,77,255,0.15)', fill: true, spanGaps: false }] },
      options: mkOptions(v => Math.floor(v))
    });

    this.chartMem = new Chart(document.getElementById('chart-mem'), {
      type: 'line',
      data: { labels, datasets: [{ data: this.memHistory, borderColor: '#00e676', backgroundColor: 'rgba(0,230,118,0.15)', fill: true, spanGaps: false }] },
      options: mkOptions(v => (v/1048576).toFixed(0)+'M')
    });
  }

  async poll() {
    if (!this.active) return;
    try {
      // Use fetch() — reads directly from webroot, no ksu.exec buffer limit
      const res = await fetch(`/stats.log?t=${Date.now()}`);
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
      entries.sort((a, b) => a.ts - b.ts);

      if (entries.length > 0) {
        if (this.lastTs === 0) {
          // Initial load: populate full chart from history
          const upArr = entries.map(o => o.up || 0);
          const downArr = entries.map(o => o.down || 0);
          const connArr = entries.map(o => o.conn || 0);
          const memArr = entries.map(o => o.mem || 0);

          while (upArr.length < this.maxPoints) { upArr.unshift(0); downArr.unshift(0); connArr.unshift(0); memArr.unshift(0); }

          this.chartUp.data.datasets[0].data = upArr;
          this.chartDown.data.datasets[0].data = downArr;
          this.chartConns.data.datasets[0].data = connArr;
          this.chartMem.data.datasets[0].data = memArr;

          this.upHistory = upArr;
          this.downHistory = downArr;
          this.connHistory = connArr;
          this.memHistory = memArr;
        } else {
          // Incremental update: shift left, push new entries
          for (const o of entries) {
            if (this.upHistory.length >= this.maxPoints) { this.upHistory.shift(); this.downHistory.shift(); this.connHistory.shift(); this.memHistory.shift(); }
            this.upHistory.push(o.up || 0);
            this.downHistory.push(o.down || 0);
            this.connHistory.push(o.conn || 0);
            this.memHistory.push(o.mem || 0);
          }
        }

        const last = entries[entries.length - 1];
        this.lastTs = last.ts;
        if (this.els.up) this.els.up.textContent = fmtMBs(last.up || 0);
        if (this.els.down) this.els.down.textContent = fmtMBs(last.down || 0);
        if (this.els.conn) this.els.conn.textContent = String(last.conn || 0);
        if (this.els.mem) this.els.mem.textContent = fmtMB(last.mem || 0);

        this.chartUp.update('none');
        this.chartDown.update('none');
        this.chartConns.update('none');
        this.chartMem.update('none');
      }
    } catch(e) {
      console.error("TrafficMonitor poll error", e);
    }
    setTimeout(() => this.poll(), 1500);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.poll();
  }

  stop() {
    this.active = false;
  }
}

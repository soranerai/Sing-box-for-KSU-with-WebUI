/* app.js — extracted from index.html to improve readability */

const MOD_PATH = "/data/adb/modules/singbox_ksu";
const BIN_PATH = `${MOD_PATH}/sing-box`;
const META_PATH = `${MOD_PATH}/.metadata.json`;

const state = {
  activeConfig: localStorage.getItem('active_cfg') || 'config.json',
  metadata: {},
  configs: [],
  sortAsc: true,
  logOffset: 0,
  logBuffer: '',
  logInitialized: false,
  logTail: 250,
  logPollingId: null,
  seenLogs: new Set(),
  recentLogs: [],
  logPollInterval: 500,
  logsPoolSize: 300,
  logsMaxLines: 2000,
  logsPool: null,
  logsWriteIndex: 0,
  logsCount: 0,
  logsWs: null,
  logsAbortController: null,
  token: localStorage.getItem('ksu_token') || '',
  serviceRunning: false,
  currentPid: ''
};

function getToken() {
  return (state.token || (state.metadata && state.metadata.token) || localStorage.getItem('ksu_token') || '');
}

const els = {
  chipRuntime: document.getElementById('chip-runtime'),
  stLabel: document.getElementById('st-label'),
  stDetail: document.getElementById('st-detail'),
  statConfig: document.getElementById('stat-config'),
  mainSwitch: document.getElementById('main-switch'),
  configList: document.getElementById('config-list'),
  cfgSummary: document.getElementById('cfg-summary'),
  chartUp: document.getElementById('chart-up'),
  chartDown: document.getElementById('chart-down'),
  upValue: document.getElementById('up-value'),
  downValue: document.getElementById('down-value'),
  chartConns: document.getElementById('chart-conns'),
  chartMem: document.getElementById('chart-mem'),
  connValue: document.getElementById('conn-value'),
  memValue: document.getElementById('mem-value'),
  tabLogs: document.getElementById('tab-logs'),
  logsBody: document.getElementById('logs-body'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  logsSearch: document.getElementById('logs-search'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  logLevelSelect: document.getElementById('log-level-select'),
  btnRefreshConfigs: document.getElementById('btn-refresh-configs'),
  btnDownload: document.getElementById('btn-download-config')
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `"'"`) }'`;
}

async function exec(cmd) {
  try {
    return await ksu.exec(cmd);
  } catch (e) {
    return 'error';
  }
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function decodeBase64Utf8(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  if (!clean) return '';
  try {
    const bin = atob(clean);
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) { return ''; }
}

function encodeTextToShellOneliner(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\\$');
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const days = Math.floor(sec / 86400);
  sec -= days * 86400;
  const hours = Math.floor(sec / 3600);
  sec -= hours * 3600;
  const minutes = Math.floor(sec / 60);
  const seconds = sec - minutes * 60;
  if (days) return `${days}д ${hours}ч`;
  if (hours) return `${hours}ч ${minutes}м`;
  if (minutes) return `${minutes}м ${seconds}с`;
  return `${seconds}с`;
}

function relativeTimeFromDate(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}с назад`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч назад`;
  const days = Math.floor(h / 24);
  return `${days}д назад`;
}

function formatUpdated(raw) {
  if (!raw || raw === '—') return '—';
  let iso = String(raw).trim();
  iso = iso.replace(/\s+/g, ' ');
  iso = iso.split('+')[0].split('- ')[0];
  iso = iso.replace(' ', 'T');
  let d = new Date(iso);
  if (isNaN(d.getTime())) d = new Date(String(raw).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(raw);
  const local = `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const rel = relativeTimeFromDate(d);
  return `${local} · ${rel}`;
}

function displayName(file) { if (!file) return ''; return String(file).replace(/\.json$/i, ''); }

async function loadMetadata() {
  const res = await exec(`[ -f ${shellQuote(META_PATH)} ] && cat ${shellQuote(META_PATH)} || echo '{}'`);
  try { state.metadata = JSON.parse(res || '{}') || {}; } catch (e) { state.metadata = {}; }
}

async function saveMetadata() {
  const json = JSON.stringify(state.metadata);
  const cmd = `cat > ${shellQuote(META_PATH)} <<'EOF'\n${json}\nEOF`;
  await exec(cmd);
}

function setTab(tabId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`.tab-item[data-tab="${tabId}"]`).classList.add('active');
  if (tabId === 'tab-config') renderConfigList();
  if (tabId === 'tab-logs') startLogsSocket(); else stopLogsSocket();
}

function updateUiSummary() { if (els.cfgSummary) els.cfgSummary.textContent = `Конфигов: ${state.configs.length}`; }

function normalizeFileList(raw) {
  return String(raw || '').split(';').map(s => s.trim()).filter(Boolean).filter(f => f.endsWith('.json') && f !== '.metadata.json');
}

async function scanConfigs() {
  const out = await exec(`sh -lc 'first=1; for f in ${shellQuote(MOD_PATH)}/*.json; do [ -f "$f" ] || continue; b=$(basename "$f"); [ "$b" = ".metadata.json" ] && continue; if [ $first -eq 0 ]; then printf ";"; fi; printf "%s" "$b"; first=0; done; printf "\n"'`);
  if (out === 'error') { state.configs = []; renderConfigList(true); updateUiSummary(); return; }
  const files = normalizeFileList(out);
  const records = [];
  for (const file of files) {
    const statOut = await exec(`stat -c '%y|%s' ${shellQuote(`${MOD_PATH}/${file}`)} 2>/dev/null || echo '—|0'`);
    const [mtimeRaw, sizeRaw] = String(statOut || '—|0').trim().split('|');
    const updated = (mtimeRaw || '—').split('.')[0];
    const size = Number(sizeRaw || 0);
    records.push({ file, updated, size, hasUrl: Boolean(state.metadata[file]), isSelected: file === state.activeConfig });
  }
  records.sort((a, b) => {
    if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
    const an = a.file.toLowerCase(); const bn = b.file.toLowerCase();
    return state.sortAsc ? an.localeCompare(bn) : bn.localeCompare(an);
  });
  state.configs = records;
  if (state.configs.length && !state.configs.some(cfg => cfg.file === state.activeConfig)) {
    const fallback = state.configs[0].file; state.activeConfig = fallback; localStorage.setItem('active_cfg', fallback);
  }
  renderConfigList(); updateUiSummary();
}

function createActionButton(label, title, className, handler) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = className; btn.textContent = label; btn.title = title; btn.addEventListener('click', handler);
  return btn;
}

function renderConfigList(forceEmpty = false) {
  const list = els.configList; if (!list) return; list.innerHTML = '';
  const items = state.configs;
  if (forceEmpty || !items || !items.length) {
    const box = document.createElement('div'); box.className = 'config-empty'; box.textContent = 'Список конфигураций пуст'; list.appendChild(box); return;
  }
  for (const cfg of items) {
    const item = document.createElement('div');
    const isSelected = cfg.file === state.activeConfig;
    item.className = `config-item${isSelected ? ' selected' : ''}`;
    item.onclick = (e) => { if (e.target.closest('.cfg-actions')) return; selectConfig(cfg.file); };
    item.innerHTML = `
      <div class="cfg-info">
        <div class="cfg-name">
        ${displayName(cfg.file)}${isSelected ? ' <span class="active-badge">· активен</span>' : ''}
        </div>
          <div class="cfg-meta">
          Обновлён: <span class="cfg-updated" title="${String(cfg.updated || '')}">${formatUpdated(cfg.updated || '—')}</span> · 
          Размер: ${cfg.size || 0} B 
          ${cfg.hasUrl ? ' · <span style="color:var(--accent)">есть ссылка</span>' : ''}
          </div>
      </div>
      <div class="cfg-actions">
        ${cfg.hasUrl ? `<button class="btn btn-mini btn-primary" data-action="update" title="Обновить">↻</button>` : ''}
        <button class="btn btn-mini btn-danger" data-action="delete" title="Удалить">✕</button>
      </div>
    `;
    const btnUpdate = item.querySelector('[data-action="update"]');
    const btnDel = item.querySelector('[data-action="delete"]');
    if (btnUpdate) btnUpdate.onclick = (e) => { e.stopPropagation(); updateConfig(cfg.file); };
    if (btnDel) btnDel.onclick = (e) => { e.stopPropagation(); deleteConfig(cfg.file); };
    list.appendChild(item);
  }
  if (typeof updateUiSummary === 'function') updateUiSummary();
}

async function updateStatus() {
  const pidRaw = String(await exec('pidof sing-box')).trim();
  const pid = (pidRaw || '').split(/\s+/)[0] || '';
  const running = Boolean(pid && pid !== 'error');
  state.serviceRunning = running; state.currentPid = running ? pid : '';
  let uptimeStr = '';
  if (running) {
    try {
      const svcStart = state.metadata && (state.metadata.__service_start || state.metadata._service_start);
      if (svcStart) {
        const startMs = Number(svcStart);
        if (!isNaN(startMs) && startMs > 0) {
          const elapsed = Math.floor((Date.now() - startMs) / 1000);
          uptimeStr = formatDuration(elapsed);
        }
      }
      if (!uptimeStr) {
        const out = String(await exec(`ps -p ${shellQuote(pid)} -o etimes=`)).trim();
        const first = (out || '').split(/\n/).map(s => s.trim()).filter(Boolean)[0];
        uptimeStr = first ? formatDuration(Number(first)) : '';
      }
    } catch (e) { uptimeStr = ''; }
  }
  if (els.mainSwitch) els.mainSwitch.classList.toggle('on', running);
  if (els.chipRuntime) els.chipRuntime.textContent = running ? `Процесс активен · PID ${pid}${uptimeStr ? ' · Аптайм: ' + uptimeStr : ''}` : 'Процесс остановлен';
  if (els.stLabel) { els.stLabel.textContent = running ? 'Работает' : 'Выключен'; els.stLabel.style.color = running ? 'var(--success)' : 'var(--text)'; }
  if (els.stDetail) els.stDetail.textContent = running ? `Активный конфиг: ${state.activeConfig ? displayName(state.activeConfig) : 'не выбран'}` : 'Сервис не активен';
  updateUiSummary();
}

function ensureLogsPool() {
  if (state.logsPool) return;
  const body = document.getElementById('logs-body'); if (!body) return;
  const pool = [];
  for (let i=0;i<state.logsPoolSize;i++) {
    const d = document.createElement('div'); d.className = 'log-line info'; d.style.display = 'none'; pool.push(d); body.appendChild(d);
  }
  state.logsPool = pool; state.logsWriteIndex = 0; state.logsCount = 0;
}

function pushLogLine(level, text) {
  ensureLogsPool(); if (!state.logsPool) return;
  const idx = state.logsWriteIndex % state.logsPool.length; const node = state.logsPool[idx];
  node.className = 'log-line ' + (level || 'info');
  const now = new Date(); const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const fullText = `[${ts}] ${String(text)}`;
  node.textContent = fullText; node.dataset.text = String(text) || '';
  const q = (state.logsFilter || '').toLowerCase();
  if (q && !((node.dataset.text || '').toLowerCase().includes(q))) node.style.display = 'none'; else node.style.display = 'block';
  const body = document.getElementById('logs-body'); if (body && node.parentElement === body) body.appendChild(node);
  state.logsWriteIndex++; state.logsCount = Math.min(state.logsCount + 1, state.logsMaxLines);
  if (state.logsWriteIndex > state.logsPool.length) { const hideIdx = state.logsWriteIndex % state.logsPool.length; const hideNode = state.logsPool[hideIdx]; if (hideNode) hideNode.style.display = 'none'; }
  try { if (body) body.scrollTop = body.scrollHeight; } catch (e) {}
}

function startLogsSocket() {
  ensureLogsPool();
  const levelSelect = document.getElementById('log-level-select');
  const levelDisplay = document.getElementById('logs-level-display');
  const level = (levelSelect && levelSelect.value) || 'info'; if (levelDisplay) levelDisplay.textContent = level;
  try {
    const token = getToken() || '';
    const url = `ws://127.0.0.1:9090/logs?token=${encodeURIComponent(token)}&level=${encodeURIComponent(level)}`;
    state.logsWs = new WebSocket(url);
    state.logsWs.onopen = () => {};
    state.logsWs.onmessage = (ev) => {
      let data = ev.data; if (!data) return; const parts = String(data).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      for (const p of parts) {
        try {
          const o = JSON.parse(p); if (!o || !o.payload) continue; const lvl = String(o.type || 'info').toLowerCase(); pushLogLine(lvl, o.payload);
        } catch (e) { continue; }
      }
    };
    state.logsWs.onclose = () => { state.logsWs = null; setTimeout(startLogsSocket, 1000); };
    state.logsWs.onerror = () => {};
  } catch (e) { state.logsWs = null; }
}

function applyLogFilter() {
  const q = (els.logsSearch && els.logsSearch.value || '').toLowerCase(); state.logsFilter = q; if (!state.logsPool || !state.logsPool.length) return;
  for (const n of state.logsPool) {
    const txt = (n.dataset.text || '').toLowerCase(); n.style.display = (!q || txt.includes(q)) ? (txt ? 'block' : 'none') : 'none';
  }
  try { if (!q) { const b = document.getElementById('logs-body'); if (b) b.scrollTop = b.scrollHeight; } } catch (e) {}
}

function stopLogsSocket() { try { if (state.logsWs) { try { state.logsWs.close(); } catch (e) {} state.logsWs = null; } } catch (e) {} }

const traffic = { ws: null, upHistory: [], downHistory: [], maxPoints: 60, drawIntervalId: null, reconnectTimeout: 1000, connHistory: [], memHistory: [], connPollId: null };

function resizeCanvasToDisplaySize(canvas) { if (!canvas) return; const dpr = window.devicePixelRatio || 1; const width = Math.floor(canvas.clientWidth * dpr); const height = Math.floor(canvas.clientHeight * dpr); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } }

function drawSparkline(canvas, data, color, maxOverride) {
  if (!canvas) return; resizeCanvasToDisplaySize(canvas); const ctx = canvas.getContext('2d'); const w = canvas.width; const h = canvas.height; ctx.clearRect(0,0,w,h); if (!data || data.length === 0) return; const rawMax = Math.max(...data, 1); const max = (typeof maxOverride === 'number' && !isNaN(maxOverride) && maxOverride > 0) ? maxOverride : rawMax; ctx.beginPath(); ctx.lineWidth = Math.max(2, Math.floor(w / 200)); ctx.strokeStyle = color; for (let i=0;i<data.length;i++) { const x = Math.floor((i/(data.length-1))*(w-4)) + 2; const y = Math.floor(h - (data[i]/max)*(h-6) - 3); if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.stroke(); ctx.lineTo(w-2, h-2); ctx.lineTo(2, h-2); ctx.closePath(); ctx.fillStyle = color + '22'; ctx.fill();
}

function formatBytesPerSec(n) { n = Number(n) || 0; if (n >= 1e9) return (n/1e9).toFixed(2)+' GB/s'; if (n >= 1e6) return (n/1e6).toFixed(2)+' MB/s'; if (n >= 1e3) return (n/1e3).toFixed(1)+' KB/s'; return n+' B/s'; }
function formatBytes(n) { n = Number(n) || 0; if (n >= 1e9) return (n/1e9).toFixed(2)+' GB'; if (n >= 1e6) return (n/1e6).toFixed(2)+' MB'; if (n >= 1e3) return (n/1e3).toFixed(1)+' KB'; return n+' B'; }

function handleTrafficMessage(obj) {
  const up = Number(obj.up) || 0; const down = Number(obj.down) || 0; traffic.upHistory.push(up); traffic.downHistory.push(down); if (traffic.upHistory.length > traffic.maxPoints) traffic.upHistory.shift(); if (traffic.downHistory.length > traffic.maxPoints) traffic.downHistory.shift(); if (els.upValue) els.upValue.textContent = formatBytesPerSec(up); if (els.downValue) els.downValue.textContent = formatBytesPerSec(down);
}

function connectTrafficSocket() {
  try {
    if (traffic.ws) { try { traffic.ws.close(); } catch (e) {} traffic.ws = null; }
    const token = getToken() || '';
    const url = `ws://127.0.0.1:9090/traffic?token=${encodeURIComponent(token)}`;
    traffic.ws = new WebSocket(url);
    traffic.ws.onopen = () => { traffic.reconnectTimeout = 1000; };
    traffic.ws.onmessage = (ev) => { try { const obj = JSON.parse(ev.data); handleTrafficMessage(obj); } catch (e) {} };
    traffic.ws.onclose = () => { traffic.ws = null; setTimeout(connectTrafficSocket, traffic.reconnectTimeout); traffic.reconnectTimeout = Math.min(30000, traffic.reconnectTimeout * 1.5); };
    traffic.ws.onerror = () => {};
  } catch (e) { setTimeout(connectTrafficSocket, 2000); }
}

function startTrafficDrawing() { if (traffic.drawIntervalId) return; traffic.drawIntervalId = setInterval(() => { drawSparkline(els.chartUp, traffic.upHistory.map(v=>v), '#5b8cff'); drawSparkline(els.chartDown, traffic.downHistory.map(v=>v), '#ff6b6b'); drawSparkline(els.chartConns, traffic.connHistory.map(v=>v), '#39d98a', 100); drawSparkline(els.chartMem, traffic.memHistory.map(v=>v), '#bd5cff', 50 * 1024 * 1024); }, 1000); }
function stopTrafficDrawing() { if (!traffic.drawIntervalId) return; clearInterval(traffic.drawIntervalId); traffic.drawIntervalId = null; }

function initTrafficCharts() { traffic.upHistory = []; traffic.downHistory = []; traffic.connHistory = []; traffic.memHistory = []; connectTrafficSocket(); startTrafficDrawing(); window.addEventListener('resize', () => { drawSparkline(els.chartUp, traffic.upHistory, '#5b8cff'); drawSparkline(els.chartDown, traffic.downHistory, '#ff6b6b'); drawSparkline(els.chartConns, traffic.connHistory, '#39d98a'); drawSparkline(els.chartMem, traffic.memHistory, '#bd5cff'); }); }

async function fetchConnections() { try { const res = await fetch('http://127.0.0.1:9090/connections'); if (!res.ok) return; const j = await res.json(); const conns = Array.isArray(j.connections) ? j.connections.length : 0; const mem = Number(j.memory) || 0; traffic.connHistory.push(conns); traffic.memHistory.push(mem); if (traffic.connHistory.length > traffic.maxPoints) traffic.connHistory.shift(); if (traffic.memHistory.length > traffic.maxPoints) traffic.memHistory.shift(); if (els.connValue) els.connValue.textContent = String(conns); if (els.memValue) els.memValue.textContent = formatBytes(mem); } catch (e) {} }
function startConnectionsPolling() { if (traffic.connPollId) return; fetchConnections(); traffic.connPollId = setInterval(fetchConnections, 1000); }

async function selectConfig(file) {
  if (!file || state.activeConfig === file) return;
  const wasRunning = state.serviceRunning;
  state.activeConfig = file; localStorage.setItem('active_cfg', file);
  renderConfigList(); try { const sel = document.querySelector('.config-item.selected'); if (sel && sel.scrollIntoView) setTimeout(() => sel.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); } catch (e) {}
  await updateStatus();
  if (wasRunning) { await exec('pkill -9 sing-box'); await wait(450); await startService(); }
}

async function startService() {
  if (!state.activeConfig) { Toast.info("Сначала выберите файл конфигурации <3"); return; }
  await exec(`chmod +x ${shellQuote(BIN_PATH)} 2>/dev/null || true`);
  const cmd = `cd ${shellQuote(MOD_PATH)} && nohup ${shellQuote(BIN_PATH)} run -c ${shellQuote(state.activeConfig)} >> /dev/null 2>&1 &`;
  await exec(cmd); await wait(500); await updateStatus();
  try { if (state.serviceRunning) { state.metadata.__service_start = Date.now(); await saveMetadata(); } } catch (e) {}
}

async function stopService() { await exec('pkill -9 sing-box 2>/dev/null || true'); await wait(350); try { if (state.metadata && (state.metadata.__service_start || state.metadata._service_start)) { delete state.metadata.__service_start; delete state.metadata._service_start; await saveMetadata(); } } catch (e) {} await updateStatus(); }

async function toggleService(forceStart = false) { const pid = String(await exec('pidof sing-box')).trim(); const running = Boolean(pid && pid !== 'error'); if (running && !forceStart) { await stopService(); } else { await startService(); } }

async function downloadConfig(targetFile = null, targetUrl = null) {
  const url = (targetUrl || document.getElementById('new-cfg-url').value || '').trim(); let name = (targetFile || document.getElementById('new-cfg-name').value || '').trim();
  if (!url) { Toast.info("Сначала вставьте ссылку"); return; }
  if (!name) name = `remote_${Date.now().toString().slice(-6)}`;
  if (!name.endsWith('.json')) name += '.json';
  const temp = `${MOD_PATH}/.tmp_download.json`;
  await exec(`busybox wget -q --no-check-certificate -O ${shellQuote(temp)} ${shellQuote(url)}`);
  const check = await exec(`${shellQuote(BIN_PATH)} check -c ${shellQuote(temp)} >/dev/null 2>&1 && echo ok || echo fail`);
  if (!String(check).includes('ok')) { Toast.error("Ошибка валидации", "Конфиг не прошёл проверку sing-box:с"); await exec(`rm -f ${shellQuote(temp)}`); return; }
  await exec(`mv -f ${shellQuote(temp)} ${shellQuote(`${MOD_PATH}/${name}`)}`);
  state.metadata[name] = url; await saveMetadata(); await scanConfigs(); await selectConfig(name); try { closeAddPanel(); } catch (e) {}
  Toast.success("Ура!", "Конфиг добавлен и активирован, котик");
}

async function updateConfig(file) { const url = state.metadata[file]; if (!url) return; await downloadConfig(file, url); }
async function deleteConfig(file) { if (!file) return; if (!confirm(`Точно удалить ${file}?`)) return; await exec(`rm -f ${shellQuote(`${MOD_PATH}/${file}`)}`); delete state.metadata[file]; await saveMetadata(); if (state.activeConfig === file) { state.activeConfig = ''; localStorage.removeItem('active_cfg'); await stopService(); } await scanConfigs(); await updateStatus(); }

function bindEvents() {
  document.querySelectorAll('.tab-item').forEach(el => el.addEventListener('click', () => setTab(el.dataset.tab)));
  if (els.mainSwitch) els.mainSwitch.addEventListener('click', () => toggleService());
  if (els.btnDownload) els.btnDownload.addEventListener('click', () => downloadConfig());
  if (els.btnRefreshConfigs) els.btnRefreshConfigs.addEventListener('click', () => scanConfigs());
  if (els.btnClearLogs) els.btnClearLogs.addEventListener('click', () => { if (state.logsPool && state.logsPool.length) { for (const n of state.logsPool) { n.style.display = 'none'; n.textContent = ''; } } else { const b = document.getElementById('logs-body'); if (b) b.innerHTML = ''; } state.seenLogs.clear(); state.recentLogs = []; state.logsWriteIndex = 0; state.logsCount = 0; });
  if (els.logsSearch) els.logsSearch.addEventListener('input', () => applyLogFilter());
  if (els.btnClearSearch) els.btnClearSearch.addEventListener('click', () => { if (els.logsSearch) { els.logsSearch.value = ''; applyLogFilter(); } });
  if (els.logLevelSelect) els.logLevelSelect.addEventListener('change', () => { state.seenLogs.clear(); state.recentLogs = []; stopLogsSocket(); if (document.getElementById('tab-logs').classList.contains('active')) startLogsSocket(); });
  const btnOpenAdd = document.getElementById('btn-open-add'); const btnCancelAdd = document.getElementById('btn-cancel-add'); const inpName = document.getElementById('new-cfg-name'); const inpUrl = document.getElementById('new-cfg-url');
  if (btnOpenAdd) btnOpenAdd.addEventListener('click', toggleAddPanel); if (btnCancelAdd) btnCancelAdd.addEventListener('click', closeAddPanel);
  if (inpUrl) inpUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') downloadConfig(); });
  if (inpName) inpName.addEventListener('keydown', (e) => { if (e.key === 'Enter') downloadConfig(); });
  [inpName, inpUrl].forEach(i => { if (!i) return; i.addEventListener('focus', (ev) => { setTimeout(() => { try { ev.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }, 220); }); });
}

function openAddPanel() {
  const p = document.getElementById('add-panel'); if (!p) return; if (p.classList.contains('open')) return; p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); try { document.body.style.overflow = 'hidden'; } catch (e) {}
  const overlayClick = (ev) => { if (ev.target === p) closeAddPanel(); };
  const escHandler = (ev) => { if (ev.key === 'Escape') closeAddPanel(); };
  p.__overlayClick = overlayClick; p.__escHandler = escHandler; try { p.addEventListener('click', overlayClick); } catch (e) {} try { document.addEventListener('keydown', escHandler); } catch (e) {}
  const u = document.getElementById('new-cfg-url'); if (u) setTimeout(() => { try { u.focus(); } catch (e) {} }, 240);
}
function closeAddPanel() { const p = document.getElementById('add-panel'); if (!p || !p.classList.contains('open')) return; const u = document.getElementById('new-cfg-url'); if (u && document.activeElement === u) try { u.blur(); } catch (e) {} p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); try { document.body.style.overflow = ''; } catch (e) {} try { if (p.__overlayClick) { p.removeEventListener('click', p.__overlayClick); delete p.__overlayClick; } } catch (e) {} try { if (p.__escHandler) { document.removeEventListener('keydown', p.__escHandler); delete p.__escHandler; } } catch (e) {} }
function toggleAddPanel() { const p = document.getElementById('add-panel'); if (!p) return; if (p.classList.contains('open')) closeAddPanel(); else openAddPanel(); }

function refreshViewportVars() { const vv = window.visualViewport; const viewportHeight = (vv && vv.height) ? vv.height : window.innerHeight; const k = Math.max(0, window.innerHeight - viewportHeight); document.documentElement.style.setProperty('--vh', `${viewportHeight * 0.01}px`); document.documentElement.style.setProperty('--kbd', `${k}px`); }

window.addEventListener('resize', refreshViewportVars);
if (window.visualViewport) { window.visualViewport.addEventListener('resize', refreshViewportVars); window.visualViewport.addEventListener('scroll', refreshViewportVars); }
refreshViewportVars();

async function init() {
  bindEvents(); await loadMetadata(); await scanConfigs(); await updateStatus(); try { initTrafficCharts(); } catch (e) {}
  try { startConnectionsPolling(); } catch (e) {}
  setInterval(updateStatus, 1000);
  setInterval(() => { if (document.getElementById('tab-config').classList.contains('active')) scanConfigs(); }, 15000);
}

const Toast = {
  init() { this.container = document.getElementById('toast-container'); },
  show(title, message, type = 'info', duration = 4000) {
    if (!this.container) this.init();
    const toast = document.createElement('div'); toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', info: '✨' };
    toast.innerHTML = `
      <div class="toast-icon">${icons[type]}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
    `;
    toast.onclick = () => this.remove(toast);
    this.container.appendChild(toast);
    setTimeout(() => this.remove(toast), duration);
  },
  remove(toast) { toast.classList.add('hide'); toast.onanimationend = () => toast.remove(); },
  success(msg, title = 'Успешно') { this.show(title, msg, 'success'); },
  error(msg, title = 'Ошибка') { this.show(title, msg, 'error'); },
  info(msg, title = 'Инфо') { this.show(title, msg, 'info'); }
};

init();

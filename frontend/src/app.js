'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  // Calls into Go (app.go). Every method returns a Promise.
  const api = new Proxy({}, { get: (_, name) => (...args) => window.go.main.App[name](...args) });
  const on = (ev, cb) => window.runtime.EventsOn(ev, cb);

  // ---------------------------------------------------------------- icons
  const ICONS = {
    link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    folderOpen: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
    doc: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    pdf: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M9 15h1.5a1.5 1.5 0 0 0 0-3H9v6"/>',
    sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    slides: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    app: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/>',
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    retry: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    hardDrive: '<path d="M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    expand: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
    collapse: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
    reveal: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    skip: '<path d="m5 4 10 8-10 8V4zM19 5v14"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  };
  const FILLED = new Set(['play', 'pause', 'stop']);
  const icon = (name, cls = '') => `<svg class="i${FILLED.has(name) ? ' fill' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      if (el.dataset.iconDone) return;
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
      el.dataset.iconDone = '1';
    });
  }

  // ---------------------------------------------------------------- format
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtBytes(b) {
    if (b == null || b < 0) return '—';
    if (b < 1024) return `${b} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
    return `${b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)} ${u[i]}`;
  }
  const fmtSpeed = (bps) => (bps < 1 ? '0 B/s' : `${fmtBytes(Math.round(bps))}/s`);
  function fmtDur(s) {
    if (s == null || s < 0 || !isFinite(s)) return '—';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 99) return '> 99h';
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
  }
  const fmtNum = (n) => Number(n || 0).toLocaleString();
  function errText(e) {
    let s = typeof e === 'string' ? e : (e && e.message) || String(e);
    s = s.trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------------------------------------------------------------- file kinds
  // Monochrome: folders in silver, files in grey; the glyph tells the type.
  const KIND_COLOR = new Proxy({}, { get: (_, kind) => (kind === 'folder' ? 'var(--kind-folder)' : 'var(--kind-file)') });
  const EXT_KIND = {};
  const addExt = (kind, list) => list.split(' ').forEach((e) => { EXT_KIND[e] = kind; });
  addExt('video', 'mp4 mkv mov avi webm m4v wmv flv mpg mpeg 3gp ts m2ts vob');
  addExt('image', 'jpg jpeg png gif webp bmp svg heic heif tif tiff raw cr2 nef psd ico avif');
  addExt('audio', 'mp3 wav flac aac m4a ogg opus wma aiff');
  addExt('archive', 'zip rar 7z tar gz tgz bz2 xz iso dmg');
  addExt('pdf', 'pdf');
  addExt('doc', 'doc docx odt rtf txt md pages epub');
  addExt('sheet', 'xls xlsx csv ods numbers');
  addExt('slides', 'ppt pptx odp key');
  addExt('code', 'js ts py go java c cpp h cs html css json xml sh rb php rs kt swift sql yml yaml ipynb');
  addExt('app', 'exe msi apk bat cmd');
  function kindOf(n) {
    if (n.f) return 'folder';
    const m = n.m || '';
    if (m.endsWith('.document')) return 'doc';
    if (m.endsWith('.spreadsheet')) return 'sheet';
    if (m.endsWith('.presentation')) return 'slides';
    const dot = n.n.lastIndexOf('.');
    return (dot > 0 && EXT_KIND[n.n.slice(dot + 1).toLowerCase()]) || 'file';
  }
  const KIND_ICON = { folder: 'folder', video: 'video', image: 'image', audio: 'audio', archive: 'archive', pdf: 'pdf', doc: 'doc', sheet: 'sheet', slides: 'slides', code: 'code', app: 'app', file: 'file' };

  // ---------------------------------------------------------------- state
  const ROW_H = 42;
  const LIMIT_STEPS = [128, 256, 512, 1024, 2048, 3072, 5120, 8192, 10240, 15360, 20480, 30720, 51200, 102400, 0]; // KB/s, 0 = unlimited
  const S = {
    settings: null,
    phase: 'empty', // empty | scanning | job
    job: null,
    nodes: [],
    end: null, // subtree end (exclusive) for each node; nodes are in depth-first order
    checked: null,
    expanded: null,
    agg: null,
    tick: null,
    state: 'idle',
    tab: 'all',
    search: '',
    rows: [],
    rowsDirty: true,
    speed: [],
    clipOffered: '',
  };
  const canEdit = () => ['ready', 'stopped', 'done'].includes(S.state);
  const busy = () => S.state === 'running' || S.state === 'paused';

  // ---------------------------------------------------------------- toasts
  function toast(kind, title, msg = '', action = null, ms = 5000) {
    const el = document.createElement('div');
    const ic = { ok: 'checkCircle', err: 'xCircle', warn: 'alert', info: 'info' }[kind];
    el.className = `toast ${kind}`;
    el.innerHTML = `<span class="t-ic">${icon(ic)}</span><div class="t-body"><div class="t-title">${esc(title)}</div>${msg ? `<div class="t-msg">${esc(msg)}</div>` : ''}${action ? `<div class="t-act"><button class="btn small-btn">${esc(action.label)}</button></div>` : ''}</div><button class="t-x" title="Dismiss">${icon('x')}</button>`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
    el.querySelector('.t-x').onclick = close;
    if (action) el.querySelector('.t-act button').onclick = () => { action.run(); close(); };
    $('toasts').appendChild(el);
    if (ms) setTimeout(close, ms);
  }

  // ---------------------------------------------------------------- theme
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(theme) {
    const t = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = t;
    $('themeBtn').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    $('themeBtn').title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    drawGraph();
  }
  mq.addEventListener('change', () => S.settings && S.settings.theme === 'system' && applyTheme('system'));

  // ---------------------------------------------------------------- settings
  let savedTimer;
  async function saveSettings(patch) {
    try {
      S.settings = await api.SaveSettings({ ...S.settings, ...patch });
      const n = $('savedNote');
      n.classList.add('on');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => n.classList.remove('on'), 1400);
    } catch (e) {
      toast('err', 'Could not save settings', errText(e));
    }
    renderSettingsBits();
  }

  function renderSettingsBits() {
    const s = S.settings;
    $('destPath').textContent = s.downloadDir;
    $('destPath').title = s.downloadDir;
    $('setDir').textContent = s.downloadDir;
    renderProfile();
    setSeg('segOverwrite', s.overwrite ? 'overwrite' : 'skip');
    setSeg('segDocs', s.docsFormat);
    setSeg('segTheme', s.theme);
    $('setRetries').value = String([0, 1, 2, 3, 5].includes(s.retries) ? s.retries : 3);
    $('setSleep').checked = s.preventSleep;
    $('setOpenDone').checked = s.openWhenDone;
    renderLimit(s.speedLimitKB);
    $('parValue').textContent = s.parallel;
    $('changeDirBtn').disabled = busy();
    $('destPath').disabled = busy();
  }

  function setSeg(id, v) {
    $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }

  function openDrawer(focusKey = false) {
    $('setKey').value = S.settings.apiKey || '';
    $('keyResult').hidden = true;
    $('scrim').hidden = false;
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    if (focusKey) setTimeout(() => $('setKey').focus(), 250);
  }
  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('scrim').hidden = true;
  }

  // ---------------------------------------------------------------- speed limit
  function nearestStep(kb) {
    if (!kb) return LIMIT_STEPS.length - 1;
    let best = 0;
    LIMIT_STEPS.forEach((v, i) => {
      if (v && Math.abs(v - kb) < Math.abs(LIMIT_STEPS[best] - kb)) best = i;
    });
    return best;
  }
  function renderLimit(kb) {
    const r = $('limitRange');
    r.max = String(LIMIT_STEPS.length - 1);
    r.value = String(nearestStep(kb));
    r.style.setProperty('--fill', `${(100 * r.value) / r.max}%`);
    $('limitValue').textContent = kb ? fmtSpeed(kb * 1024) : 'Unlimited';
  }
  let limitTimer;
  function setLimit(kb, immediate = false) {
    S.settings.speedLimitKB = kb;
    renderLimit(kb);
    clearTimeout(limitTimer);
    const run = () => api.SetSpeedLimit(kb).catch((e) => toast('err', 'Could not set speed limit', errText(e)));
    if (immediate) run();
    else limitTimer = setTimeout(run, 200);
    drawGraph();
  }

  // ---------------------------------------------------------------- speed graph
  function drawGraph() {
    const c = $('speedGraph');
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const N = 120;
    const data = S.speed.slice(-N);
    const limit = S.settings && S.settings.speedLimitKB ? S.settings.speedLimitKB * 1024 : 0;
    let max = Math.max(1024 * 256, ...data) * 1.15;
    if (limit && limit * 1.12 > max) max = limit * 1.12;

    // baseline grid
    g.strokeStyle = css.getPropertyValue('--border').trim();
    g.lineWidth = 1;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(0, h - 0.5);
    g.lineTo(w, h - 0.5);
    g.stroke();

    if (data.length > 1) {
      const step = w / (N - 1);
      const x0 = w - (data.length - 1) * step;
      const y = (v) => h - 2 - (v / max) * (h - 8);
      const line = css.getPropertyValue('--accent-line').trim();
      g.beginPath();
      data.forEach((v, i) => {
        const px = x0 + i * step, py = y(v);
        if (i === 0) g.moveTo(px, py);
        else {
          const ppx = x0 + (i - 1) * step, ppy = y(data[i - 1]);
          g.bezierCurveTo((ppx + px) / 2, ppy, (ppx + px) / 2, py, px, py);
        }
      });
      g.strokeStyle = line;
      g.lineWidth = 2;
      g.stroke();
      g.lineTo(w, h);
      g.lineTo(x0, h);
      g.closePath();
      const fill = g.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, document.documentElement.dataset.theme === 'light' ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)');
      fill.addColorStop(1, 'rgba(128,128,128,0)');
      g.fillStyle = fill;
      g.fill();
    }
    if (limit) {
      const ly = h - 2 - (limit / max) * (h - 8);
      g.strokeStyle = css.getPropertyValue('--text-3').trim();
      g.globalAlpha = 0.9;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(0, ly);
      g.lineTo(w, ly);
      g.stroke();
      g.globalAlpha = 1;
      g.setLineDash([]);
    }
  }

  // ---------------------------------------------------------------- phases
  function setPhase(p) {
    S.phase = p;
    $('emptyState').hidden = p !== 'empty';
    $('scanState').hidden = p !== 'scanning';
    $('jobState').hidden = p !== 'job';
    $('scanBtn').disabled = p === 'scanning';
    if (p === 'job') requestAnimationFrame(() => { renderList(); drawGraph(); });
  }

  function showLinkError(msg) {
    const el = $('linkError');
    el.innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
    el.hidden = false;
  }
  const hideLinkError = () => { $('linkError').hidden = true; };

  // ---------------------------------------------------------------- scanning
  async function scan() {
    const input = $('linkInput').value.trim();
    hideRecent();
    $('clipHint').hidden = true;
    if (!input) {
      showLinkError('Paste a Google Drive folder or file link first.');
      $('linkInput').focus();
      return;
    }
    if (busy()) {
      toast('warn', 'A download is running', 'Stop it before opening another link.');
      return;
    }
    hideLinkError();
    const prev = S.phase;
    $('scanTitle').textContent = 'Reading from Google Drive…';
    $('scanStats').textContent = 'Connecting';
    setPhase('scanning');
    try {
      const res = await api.Scan(input);
      loadJob(res);
    } catch (e) {
      const msg = errText(e);
      setPhase(prev === 'scanning' ? 'empty' : prev);
      if (!/cancelled/i.test(msg)) showLinkError(msg);
    }
  }

  function loadJob(res) {
    const N = res.nodes.length;
    S.job = { title: res.title, usingAPI: res.usingAPI, warnings: res.warnings || [] };
    S.nodes = res.nodes.map((n) => ({ ...n, st: n.f ? '' : n.na ? 'na' : 'queued', dn: 0, sp: 0, e: n.na || '' }));
    S.end = new Int32Array(N);
    const stack = [];
    for (let i = 0; i < N; i++) {
      while (stack.length && S.nodes[i].d <= S.nodes[stack[stack.length - 1]].d) S.end[stack.pop()] = i;
      if (S.nodes[i].f) stack.push(i);
      else S.end[i] = i + 1;
    }
    while (stack.length) S.end[stack.pop()] = N;
    S.checked = new Uint8Array(N);
    S.expanded = new Uint8Array(N);
    S.nodes.forEach((n, i) => {
      if (!n.f && !n.na) S.checked[i] = 1;
      if (n.f && (n.d === 0 || N <= 400)) S.expanded[i] = 1;
    });
    S.agg = {
      all: new Int32Array(N), sel: new Int32Array(N), fin: new Int32Array(N), unk: new Int32Array(N),
      size: new Float64Array(N), done: new Float64Array(N), started: new Uint8Array(N),
      sizeAll: new Float64Array(N), unkAll: new Int32Array(N),
    };
    S.tab = 'all';
    S.search = '';
    $('searchInput').value = '';
    S.speed = [];
    S.state = 'ready';
    renderWarnings();
    applyTick(res.tick);
    $('list').scrollTop = 0;
    setPhase('job');
    if (N === 0 || !S.nodes.some((n) => !n.f)) toast('info', 'This folder is empty', 'Nothing to download.');
  }

  function renderWarnings() {
    const w = $('warnings');
    const list = (S.job && S.job.warnings) || [];
    if (!list.length) { w.hidden = true; return; }
    w.innerHTML = list.slice(0, 6).map((m, i) => `<div class="w">${icon('alert')}<span>${esc(m)}</span>${i === 0 ? `<button class="icon-btn small w-close" title="Dismiss">${icon('x')}</button>` : ''}</div>`).join('')
      + (list.length > 6 ? `<div class="w"><span>…and ${list.length - 6} more</span></div>` : '');
    w.querySelector('.w-close').onclick = () => { w.hidden = true; };
    w.hidden = false;
  }

  // ---------------------------------------------------------------- aggregates
  const FIN = new Set(['done', 'skipped']);
  function recomputeAgg() {
    const { all, sel, fin, unk, size, done, started, sizeAll, unkAll } = S.agg;
    all.fill(0); sel.fill(0); fin.fill(0); unk.fill(0); size.fill(0); done.fill(0); started.fill(0); sizeAll.fill(0); unkAll.fill(0);
    const nodes = S.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i], p = n.p;
      if (!n.f) {
        if (n.st === 'na') continue;
        all[i] = 1;
        if (n.s >= 0) sizeAll[i] = n.s; else unkAll[i] = 1;
        if (S.checked[i]) {
          sel[i] = 1;
          if (n.s >= 0) size[i] = n.s; else unk[i] = 1;
          done[i] = FIN.has(n.st) && n.s >= 0 ? n.s : n.dn;
          fin[i] = FIN.has(n.st) ? 1 : 0;
          started[i] = n.st !== 'queued' ? 1 : n.dn > 0 ? 1 : 0;
        }
      }
      if (p >= 0) {
        all[p] += all[i]; sel[p] += sel[i]; fin[p] += fin[i]; unk[p] += unk[i];
        size[p] += size[i]; done[p] += done[i]; started[p] |= started[i];
        sizeAll[p] += sizeAll[i]; unkAll[p] += unkAll[i];
      }
    }
  }

  function selectionSummary() {
    let files = 0, all = 0, bytes = 0, unknown = 0;
    S.nodes.forEach((n, i) => {
      if (n.f || n.st === 'na') return;
      all++;
      if (!S.checked[i]) return;
      files++;
      if (n.s >= 0) bytes += n.s; else unknown++;
    });
    return { files, all, bytes, unknown };
  }

  // ---------------------------------------------------------------- ticks
  function applyTick(t) {
    if (!t) return;
    const prev = S.state;
    S.tick = t;
    S.state = t.state;
    const ups = t.updates || [];
    for (const u of ups) {
      const n = S.nodes[u.i];
      if (!n) continue;
      n.st = u.st;
      n.dn = u.d;
      n.s = u.s;
      n.sp = u.sp || 0;
      n.e = u.e || '';
      if (u.n) { n.n = u.n; n.path = u.path; }
      if (u.st === 'excluded') S.checked[u.i] = 0;
      else if (u.st !== 'na') S.checked[u.i] = 1;
    }
    if (ups.length || prev !== S.state) {
      recomputeAgg();
      if (S.tab !== 'all' || S.search) S.rowsDirty = true;
    }
    if (S.state === 'running' || (prev === 'running' && S.state !== 'running')) {
      S.speed.push(S.state === 'running' ? t.speed : 0);
      if (S.speed.length > 240) S.speed.splice(0, S.speed.length - 240);
    }
    if (prev !== S.state) renderSettingsBits();
    renderJob();
    renderTabs();
    renderList();
    drawGraph();
  }

  // ---------------------------------------------------------------- job header
  let actionsSig = '';
  function renderJob() {
    const t = S.tick;
    if (!t || !S.job) return;
    const f = t.files;
    const head = S.nodes.length === 1 ? S.nodes[0] : null;
    const jobKind = head && !head.f ? kindOf(head) : 'folder';
    const jobIcon = document.querySelector('.job-icon');
    if (jobIcon.dataset.kind !== jobKind) {
      jobIcon.dataset.kind = jobKind;
      jobIcon.innerHTML = icon(KIND_ICON[jobKind]);
      jobIcon.style.color = KIND_COLOR[jobKind];
      jobIcon.style.background = `color-mix(in srgb, ${KIND_COLOR[jobKind]} 14%, transparent)`;
    }
    $('jobTitle').textContent = S.job.title;
    $('jobTitle').title = S.job.title;

    const folders = S.nodes.filter((n) => n.f).length;
    const chips = [];
    chips.push(`<span class="chip">${icon('file')}${fmtNum(f.total)} file${f.total === 1 ? '' : 's'}</span>`);
    if (folders > 1) chips.push(`<span class="chip">${icon('folder')}${fmtNum(folders)} folders</span>`);
    const sizeHint = "Google doesn't list file sizes for public folders. Each size appears when its file starts downloading.";
    if (t.totalBytes > 0) chips.push(`<span class="chip${t.unknownSize ? ' hint' : ''}"${t.unknownSize ? ` title="${esc(sizeHint)}"` : ''}>${icon('hardDrive')}${fmtBytes(t.totalBytes)}${t.unknownSize ? '+' : ''}</span>`);
    else if (t.unknownSize > 0) chips.push(`<span class="chip hint" title="${esc(sizeHint)}">${icon('info')}Sizes appear while downloading</span>`);
    if (f.na) chips.push(`<span class="chip hint" title="Google Forms and similar items have no downloadable file.">${icon('ban')}${f.na} can't download</span>`);
    $('jobChips').innerHTML = chips.join('');

    const badge = $('jobBadge');
    const labels = { ready: 'Ready', running: 'Downloading', paused: 'Paused', stopped: 'Stopped', done: f.failed ? 'Finished with errors' : 'Completed', idle: 'Ready' };
    const cls = { running: 'running', paused: 'paused', done: f.failed ? 'failed' : 'done' }[t.state] || '';
    badge.className = `job-badge ${cls}`;
    badge.innerHTML = `<span class="dot"></span>${labels[t.state] || t.state}`;

    const bar = $('mainBar');
    bar.style.width = `${Math.max(0, Math.min(100, t.percent))}%`;
    bar.parentElement.className = `bar big ${t.state === 'running' ? 'running' : t.state === 'paused' ? 'paused' : t.state === 'done' && !f.failed ? 'done' : ''}`;
    $('pctText').textContent = Math.floor(t.percent);
    $('bytesText').textContent = t.unknownSize ? fmtBytes(t.doneBytes) : `${fmtBytes(t.doneBytes)} of ${fmtBytes(t.totalBytes)}`;
    $('filesText').innerHTML = `${fmtNum(f.done + f.skipped)} / ${fmtNum(f.total)}${f.failed ? ` <span style="color:var(--err)">· ${fmtNum(f.failed)} failed</span>` : ''}`;
    $('etaText').textContent = t.state === 'running' && t.eta >= 0 ? `${t.etaApprox ? '~' : ''}${fmtDur(t.eta)}` : '—';
    $('etaText').title = t.etaApprox ? 'Estimated: some file sizes are not known yet' : '';
    $('elapsedText').textContent = t.elapsed > 0 ? fmtDur(t.elapsed) : '—';
    $('speedText').textContent = fmtSpeed(t.state === 'running' ? t.speed : 0);
    if (t.parallel) $('parValue').textContent = t.parallel;

    const sel = canEdit() ? selectionSummary() : null;
    const remaining = sel ? S.nodes.some((n, i) => !n.f && S.checked[i] && !FIN.has(n.st) && n.st !== 'na' && n.st !== 'failed') : false;
    const sig = [t.state, f.failed, sel && sel.files, sel && sel.bytes, sel && sel.unknown, remaining].join('|');
    if (sig === actionsSig) return;
    actionsSig = sig;
    const btn = (id, cls, ic, label, dis = false) => `<button class="btn ${cls}" id="${id}" title="${label}"${dis ? ' disabled' : ''}>${icon(ic)}<span>${label}</span></button>`;
    const html = [];
    switch (t.state) {
      case 'ready':
        html.push(btn('actStart', 'primary big', 'download', 'Start download', !sel.files));
        break;
      case 'running':
        html.push(btn('actPause', '', 'pause', 'Pause'), btn('actStop', 'danger', 'stop', 'Stop'));
        break;
      case 'paused':
        html.push(btn('actResume', 'primary', 'play', 'Resume'), btn('actStop', 'danger', 'stop', 'Stop'));
        break;
      case 'stopped':
        html.push(btn('actStart', 'primary', 'play', 'Continue', !sel.files));
        break;
      case 'done':
        if (f.failed) html.push(btn('actRetry', 'primary', 'retry', `Retry ${fmtNum(f.failed)} failed`));
        if (remaining) html.push(btn('actStart', f.failed ? '' : 'primary', 'download', 'Download selected'));
        break;
    }
    if (f.failed && t.state === 'running') html.push(btn('actRetry', '', 'retry', `Retry ${fmtNum(f.failed)} failed`));
    html.push(`<button class="btn icon-only" id="actOpen" title="Open the download folder">${icon('folderOpen')}</button>`);
    let selText = '';
    if (sel) {
      const size = sel.bytes ? ` · ${fmtBytes(sel.bytes)}${sel.unknown ? '+' : ''}` : '';
      selText = `${sel.files === sel.all ? 'All' : `${fmtNum(sel.files)} of`} ${fmtNum(sel.all)} files selected${size}`;
    }
    $('selInfo').textContent = selText;
    $('jobActions').innerHTML = html.join('');
  }

  async function startDownload() {
    const files = S.nodes.filter((n) => !n.f && n.st !== 'na');
    const selected = files.filter((n) => S.checked[n.i]).map((n) => n.i);
    try {
      await api.Start(selected.length === files.length ? null : selected);
    } catch (e) {
      toast('err', "Couldn't start", errText(e));
    }
  }

  $('jobActions').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const id = b.id;
    if (id === 'actStart') startDownload();
    else if (id === 'actPause') api.Pause();
    else if (id === 'actResume') api.Resume();
    else if (id === 'actStop') api.Stop();
    else if (id === 'actRetry') api.RetryFailed().catch((err) => toast('err', "Couldn't retry", errText(err)));
    else if (id === 'actOpen') api.OpenDownloadFolder();
  });

  // ---------------------------------------------------------------- tabs
  const TABS = [
    ['all', 'All'],
    ['active', 'Downloading'],
    ['queued', 'Queued'],
    ['done', 'Completed'],
    ['failed', 'Failed'],
  ];
  const TAB_MATCH = {
    active: (s) => s === 'active' || s === 'retrying',
    queued: (s) => s === 'queued' || s === 'paused',
    done: (s) => s === 'done' || s === 'skipped',
    failed: (s) => s === 'failed',
  };
  let tabsSig = '';
  function renderTabs() {
    const f = (S.tick && S.tick.files) || {};
    const counts = { all: f.total || 0, active: f.active || 0, queued: f.queued || 0, done: (f.done || 0) + (f.skipped || 0), failed: f.failed || 0 };
    const sig = S.tab + JSON.stringify(counts);
    if (sig !== tabsSig) {
      tabsSig = sig;
      $('tabs').innerHTML = TABS.map(([k, label]) => `<button class="tab${S.tab === k ? ' on' : ''}" data-tab="${k}">${label}<span class="n${k === 'failed' && counts.failed ? ' has' : ''}">${fmtNum(counts[k])}</span></button>`).join('');
    }
    const ca = $('checkAll');
    const sel = S.agg ? S.nodes.reduce((a, n, i) => a + (!n.f && n.st !== 'na' && S.checked[i] ? 1 : 0), 0) : 0;
    const all = S.nodes.reduce((a, n) => a + (!n.f && n.st !== 'na' ? 1 : 0), 0);
    ca.checked = all > 0 && sel === all;
    ca.indeterminate = sel > 0 && sel < all;
    ca.disabled = !canEdit();
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    S.tab = b.dataset.tab;
    S.rowsDirty = true;
    $('list').scrollTop = 0;
    renderTabs();
    renderList();
  });

  // ---------------------------------------------------------------- list
  const list = $('list');
  const pool = [];

  function computeRows() {
    const rows = [];
    const nodes = S.nodes;
    if (S.tab === 'all' && !S.search) {
      for (let i = 0; i < nodes.length;) {
        rows.push(i);
        i = nodes[i].f && !S.expanded[i] ? S.end[i] : i + 1;
      }
    } else {
      const q = S.search.toLowerCase();
      const match = TAB_MATCH[S.tab];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.f) continue;
        if (match && !match(n.st)) continue;
        if (q && !n.path.toLowerCase().includes(q)) continue;
        rows.push(i);
      }
    }
    S.rows = rows;
  }

  let listQueued = false;
  function queueList() {
    if (listQueued) return;
    listQueued = true;
    requestAnimationFrame(() => { listQueued = false; renderList(); });
  }

  function renderList() {
    if (S.phase !== 'job') return;
    if (S.rowsDirty) { computeRows(); S.rowsDirty = false; }
    const total = S.rows.length;
    $('listSpacer').style.height = `${total * ROW_H}px`;
    const top = list.scrollTop, h = list.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW_H) - 4);
    const last = Math.min(total, Math.ceil((top + h) / ROW_H) + 4);
    const count = Math.max(0, last - first);
    while (pool.length < count) {
      const el = document.createElement('div');
      el.className = 'row';
      list.appendChild(el);
      pool.push(el);
    }
    for (let k = 0; k < pool.length; k++) {
      const el = pool[k];
      if (k < count) {
        const pos = first + k;
        el.style.transform = `translateY(${pos * ROW_H}px)`;
        renderRow(el, S.rows[pos]);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    }
    $('listEmpty').hidden = total > 0;
    $('listEmpty').textContent = S.search ? 'No files match your filter' : S.tab === 'failed' ? 'No failed files' : S.tab === 'active' ? 'Nothing downloading right now' : 'Nothing here';
  }

  function statusCell(n, i) {
    const pct = n.s > 0 ? Math.min(100, (100 * n.dn) / n.s) : 0;
    const err = n.e ? ` title="${esc(n.e)}"` : '';
    switch (n.st) {
      case 'active':
        return n.s > 0
          ? `<div class="bar running"><div class="bar-fill" style="width:${pct}%"></div></div><span class="pct">${Math.floor(pct)}%</span><span class="spd">${fmtSpeed(n.sp)}</span>`
          : `<div class="bar running"><div class="bar-fill" style="width:100%;opacity:.35"></div></div><span class="spd">${fmtBytes(n.dn)}</span>`;
      case 'retrying':
        return `<span class="st retrying"${err}>${icon('retry')}${esc(n.e || 'Retrying…')}</span>`;
      case 'paused':
        return `<div class="bar paused"><div class="bar-fill" style="width:${pct}%"></div></div><span class="pct">${Math.floor(pct)}%</span><span class="spd">Paused</span>`;
      case 'done':
        return `<span class="st done">${icon('checkCircle')}Done</span>`;
      case 'skipped':
        return `<span class="st skipped" title="This file was already in the download folder">${icon('checkCircle')}Already saved</span>`;
      case 'failed':
        return `<span class="st failed"${err}>${icon('xCircle')}${esc(n.e || 'Failed')}</span>`;
      case 'excluded':
        return `<span class="st excluded">${icon('skip')}Not selected</span>`;
      case 'na':
        return `<span class="st na"${err}>${icon('ban')}Can't download</span>`;
      default:
        if (n.dn > 0 && n.s > 0) return `<div class="bar paused"><div class="bar-fill" style="width:${pct}%"></div></div><span class="pct">${Math.floor(pct)}%</span><span class="spd">Queued</span>`;
        return `<span class="st queued">${icon('clock')}${S.checked[i] ? 'Queued' : 'Not selected'}</span>`;
    }
  }

  function folderStatus(i) {
    const a = S.agg;
    if (!a.all[i]) return '<span class="st queued">Empty</span>';
    if (!a.started[i]) return `<span class="st queued">${fmtNum(a.sel[i])}${a.sel[i] !== a.all[i] ? ` of ${fmtNum(a.all[i])}` : ''} file${a.all[i] === 1 ? '' : 's'}</span>`;
    const pct = a.size[i] > 0 && !a.unk[i] ? (100 * a.done[i]) / a.size[i] : a.sel[i] ? (100 * a.fin[i]) / a.sel[i] : 0;
    const full = a.fin[i] === a.sel[i] && a.sel[i] > 0;
    return `<div class="bar${full ? ' done' : ''}"><div class="bar-fill" style="width:${Math.min(100, pct)}%"></div></div><span class="spd">${fmtNum(a.fin[i])}/${fmtNum(a.sel[i])}</span>`;
  }

  function renderRow(el, i) {
    const n = S.nodes[i];
    const flat = S.tab !== 'all' || !!S.search;
    const kind = kindOf(n);
    const a = S.agg;
    const edit = canEdit();
    let checked, indet = false;
    if (n.f) {
      checked = a.sel[i] > 0 && a.sel[i] === a.all[i];
      indet = a.sel[i] > 0 && a.sel[i] < a.all[i];
    } else checked = !!S.checked[i];
    const sig = n.f
      ? `F${i}|${flat}|${S.expanded[i]}|${a.sel[i]}|${a.fin[i]}|${a.done[i]}|${a.size[i]}|${a.sizeAll[i]}|${a.started[i]}|${edit}`
      : `f${i}|${flat}|${n.st}|${n.dn}|${n.s}|${Math.round(n.sp / 1024)}|${n.e}|${checked}|${edit}|${n.n}`;
    if (el._sig === sig) return;
    el._sig = sig;
    el.dataset.i = i;
    el.className = `row${n.f ? ' folder' : ''}${!n.f && (n.st === 'excluded' || n.st === 'na' || !checked) ? ' dim' : ''}`;

    const color = KIND_COLOR[kind];
    const indent = flat ? 0 : n.d * 20;
    const chev = n.f && !flat
      ? `<button class="chev${S.expanded[i] ? ' open' : ''}" data-act="toggle" title="${S.expanded[i] ? 'Collapse' : 'Expand'}">${icon('chevron')}</button>`
      : flat ? '' : '<span class="chev-space"></span>';
    const disabled = !edit || n.st === 'na' || (n.f && !a.all[i]);
    const cbx = `<label class="cbx" title="${edit ? 'Include in download' : 'Selection is locked while downloading'}"><input type="checkbox" data-act="check"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}><span class="cb"></span></label>`;
    let sub = '';
    if (flat) {
      const slash = n.path.lastIndexOf('/');
      sub = slash > 0 ? `<span class="sub">${esc(n.path.slice(0, slash))}</span>` : '';
    }
    const size = n.f ? (a.sizeAll[i] > 0 ? fmtBytes(a.sizeAll[i]) + (a.unkAll[i] ? '+' : '') : '—') : fmtBytes(n.s);
    const act = !n.f && FIN.has(n.st)
      ? `<button class="icon-btn" data-act="reveal" title="Show in folder">${icon('reveal')}</button>`
      : '';
    el.innerHTML = `<div class="cell-name"><span class="indent" style="width:${indent}px"></span>${chev}${cbx}<span class="ficon" style="color:${color};background:${color}1f">${icon(KIND_ICON[kind])}</span><div class="name-wrap"><span class="name" title="${esc(n.path)}">${esc(n.n)}</span>${sub}</div></div>`
      + `<div class="cell-size">${size}</div><div class="cell-status">${n.f ? folderStatus(i) : statusCell(n, i)}</div><div class="cell-act">${act}</div>`;
    if (indet) el.querySelector('input').indeterminate = true;
  }

  function toggleCheck(i) {
    if (!canEdit()) return;
    const n = S.nodes[i];
    if (n.f) {
      const v = S.agg.sel[i] < S.agg.all[i] ? 1 : 0;
      for (let j = i + 1; j < S.end[i]; j++) if (!S.nodes[j].f && S.nodes[j].st !== 'na') S.checked[j] = v;
    } else {
      S.checked[i] = S.checked[i] ? 0 : 1;
    }
    afterSelection();
  }
  function afterSelection() {
    recomputeAgg();
    renderJob();
    renderTabs();
    renderList();
  }

  list.addEventListener('scroll', queueList, { passive: true });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const i = Number(row.dataset.i);
    const actEl = e.target.closest('[data-act]');
    const act = actEl && actEl.dataset.act;
    if (act === 'check') return; // handled on change
    if (e.target.closest('.cbx')) return;
    if (act === 'reveal') { api.RevealFile(i); return; }
    if (S.nodes[i].f && !(S.tab !== 'all' || S.search)) {
      S.expanded[i] = S.expanded[i] ? 0 : 1;
      S.rowsDirty = true;
      renderList();
    }
  });
  list.addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'check') return;
    toggleCheck(Number(e.target.closest('.row').dataset.i));
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('.cbx')) return;
    const i = Number(row.dataset.i);
    if (!S.nodes[i].f && FIN.has(S.nodes[i].st)) api.RevealFile(i);
  });
  $('checkAll').addEventListener('change', (e) => {
    if (!canEdit()) return;
    const v = e.target.checked ? 1 : 0;
    S.nodes.forEach((n, i) => { if (!n.f && n.st !== 'na') S.checked[i] = v; });
    afterSelection();
  });
  $('expandBtn').onclick = () => { S.nodes.forEach((n, i) => { if (n.f) S.expanded[i] = 1; }); S.rowsDirty = true; renderList(); };
  $('collapseBtn').onclick = () => { S.nodes.forEach((n, i) => { if (n.f) S.expanded[i] = n.d === 0 ? 1 : 0; }); S.rowsDirty = true; list.scrollTop = 0; renderList(); };
  let searchTimer;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.search = e.target.value.trim();
      S.rowsDirty = true;
      list.scrollTop = 0;
      renderList();
    }, 120);
  });

  // ---------------------------------------------------------------- link input
  const linkInput = $('linkInput');
  function showRecent() {
    const r = (S.settings && S.settings.recentLinks) || [];
    if (!r.length || linkInput.value.trim()) { hideRecent(); return; }
    const box = $('recentList');
    box.innerHTML = `<div class="recent-h">Recent links</div>${r.slice(0, 6).map((l) => `<button class="recent-item" data-link="${esc(l)}">${icon('history')}<span>${esc(l)}</span></button>`).join('')}`;
    box.hidden = false;
  }
  function hideRecent() { $('recentList').hidden = true; }
  $('recentList').addEventListener('mousedown', (e) => {
    const b = e.target.closest('.recent-item');
    if (!b) return;
    e.preventDefault();
    linkInput.value = b.dataset.link;
    hideRecent();
    scan();
  });
  linkInput.addEventListener('focus', showRecent);
  linkInput.addEventListener('blur', () => setTimeout(hideRecent, 120));
  linkInput.addEventListener('input', () => { hideLinkError(); showRecent(); });
  linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') scan();
    if (e.key === 'Escape') hideRecent();
  });
  $('scanBtn').onclick = scan;
  $('cancelScanBtn').onclick = () => api.CancelScan();
  $('pasteBtn').onclick = async () => {
    try {
      const text = (await window.runtime.ClipboardGetText()) || '';
      if (!text.trim()) { toast('info', 'Clipboard is empty', 'Copy a Google Drive link first.'); return; }
      linkInput.value = text.trim();
      hideLinkError();
      linkInput.focus();
      hideRecent();
    } catch (e) {
      linkInput.focus();
    }
  };

  async function offerClipboard() {
    if (setupNeeded()) return;
    if (S.phase === 'scanning' || linkInput.value.trim() || busy()) { $('clipHint').hidden = true; return; }
    let link = '';
    try { link = await api.ClipboardLink(); } catch (e) { return; }
    if (!link || link === S.clipOffered) return;
    const hint = $('clipHint');
    hint.innerHTML = `${icon('clipboard')}<b>Use the Drive link you copied?</b><span class="clip-url">${esc(link)}</span>`;
    hint.hidden = false;
    hint.onclick = () => { S.clipOffered = link; linkInput.value = link; hint.hidden = true; scan(); };
  }
  window.addEventListener('focus', offerClipboard);

  // Drag a link from the browser onto the window.
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('linkWrap').classList.add('drop'); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('linkWrap').classList.remove('drop'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('linkWrap').classList.remove('drop');
    if (setupNeeded()) return;
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text && text.trim()) {
      linkInput.value = text.trim().split(/\s+/).filter((l) => !l.startsWith('#')).join(' ');
      scan();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('docModal').hidden) $('docModal').hidden = true;
      else if (setupNeeded()) { /* setup can't be skipped */ }
      else if (!$('noticePanel').hidden) $('noticePanel').hidden = true;
      else if (!$('updateModal').hidden) closeUpdate();
      else if (!$('supportModal').hidden) closeSupport();
      else if (!$('regModal').hidden) $('regModal').hidden = true;
      else if (!$('limitModal').hidden) $('limitModal').hidden = true;
      else if ($('drawer').classList.contains('open')) closeDrawer();
    }
    if (setupNeeded() || !$('regModal').hidden || !$('supportModal').hidden) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      linkInput.value = '';
      linkInput.focus();
    }
  });

  // ---------------------------------------------------------------- destination
  async function chooseDir() {
    if (busy()) return;
    try {
      const dir = await api.ChooseFolder();
      if (dir) { S.settings.downloadDir = dir; renderSettingsBits(); }
    } catch (e) {
      toast('err', "Couldn't change folder", errText(e));
    }
  }
  $('destPath').onclick = chooseDir;
  $('changeDirBtn').onclick = chooseDir;
  $('setDirBtn').onclick = chooseDir;
  $('openDirBtn').onclick = () => (S.phase === 'job' ? api.OpenDownloadFolder() : api.OpenPath(''));

  // ---------------------------------------------------------------- speed controls
  $('limitRange').addEventListener('input', (e) => setLimit(LIMIT_STEPS[Number(e.target.value)]));
  $('limitValue').onclick = () => {
    const kb = S.settings.speedLimitKB;
    const mb = kb >= 1024 || !kb;
    $('limitUnit').value = mb ? '1048576' : '1024';
    $('limitInput').value = kb ? (mb ? +(kb / 1024).toFixed(2) : kb) : 0;
    $('limitModal').hidden = false;
    setTimeout(() => $('limitInput').select(), 30);
  };
  const applyCustomLimit = () => {
    const v = parseFloat($('limitInput').value);
    const unit = Number($('limitUnit').value);
    const kb = !v || v <= 0 ? 0 : Math.max(32, Math.round((v * unit) / 1024));
    setLimit(kb, true);
    $('limitModal').hidden = true;
  };
  $('limitApply').onclick = applyCustomLimit;
  $('limitInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomLimit(); });
  $('limitCancel').onclick = () => { $('limitModal').hidden = true; };
  $('limitModal').addEventListener('mousedown', (e) => { if (e.target.id === 'limitModal') $('limitModal').hidden = true; });

  function setParallel(n) {
    n = Math.max(1, Math.min(8, n));
    S.settings.parallel = n;
    $('parValue').textContent = n;
    api.SetParallel(n).catch((e) => toast('err', "Couldn't change", errText(e)));
  }
  $('parMinus').onclick = () => setParallel(S.settings.parallel - 1);
  $('parPlus').onclick = () => setParallel(S.settings.parallel + 1);

  // ---------------------------------------------------------------- settings drawer
  $('settingsBtn').onclick = () => openDrawer();
  $('helpBtn').onclick = () => openSupport();
  $('openSupport').onclick = () => openSupport();
  $('closeDrawer').onclick = closeDrawer;
  $('scrim').onclick = closeDrawer;
  $('themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    saveSettings({ theme: next });
  };
  $('segOverwrite').onclick = (e) => { const b = e.target.closest('button'); if (b) saveSettings({ overwrite: b.dataset.v === 'overwrite' }); };
  $('segDocs').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    saveSettings({ docsFormat: b.dataset.v });
    if (S.phase === 'job') toast('info', 'Applies to the next scan', 'Scan the link again to save Docs in the new format.');
  };
  $('segTheme').onclick = (e) => { const b = e.target.closest('button'); if (b) { applyTheme(b.dataset.v); saveSettings({ theme: b.dataset.v }); } };
  $('setRetries').onchange = (e) => saveSettings({ retries: Number(e.target.value) });
  $('setSleep').onchange = (e) => saveSettings({ preventSleep: e.target.checked });
  $('setOpenDone').onchange = (e) => saveSettings({ openWhenDone: e.target.checked });
  $('keyEye').onclick = () => {
    const k = $('setKey');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('keyEye').innerHTML = icon(k.type === 'password' ? 'eye' : 'eyeOff');
  };
  function keyResult(ok, msg) {
    const r = $('keyResult');
    r.className = `key-result ${ok ? 'ok' : 'bad'}`;
    r.textContent = msg;
    r.hidden = false;
  }
  $('keyTest').onclick = async () => {
    const b = $('keyTest');
    b.disabled = true;
    b.textContent = 'Testing…';
    try { keyResult(true, await api.TestAPIKey($('setKey').value)); } catch (e) { keyResult(false, errText(e)); }
    b.disabled = false;
    b.textContent = 'Test';
  };
  $('keySave').onclick = async () => {
    const key = $('setKey').value.trim();
    await saveSettings({ apiKey: key });
    keyResult(true, key ? 'Saved. It will be used from the next scan.' : 'Key removed.');
  };
  document.querySelectorAll('[data-url]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); api.OpenURL(a.dataset.url); });
  });

  // ---------------------------------------------------------------- events from Go
  on('scan:progress', (p) => {
    $('scanTitle').textContent = p.current ? `Reading “${p.current}”…` : 'Reading from Google Drive…';
    $('scanStats').textContent = `${fmtNum(p.folders)} folder${p.folders === 1 ? '' : 's'} · ${fmtNum(p.files)} file${p.files === 1 ? '' : 's'} found`;
  });
  on('job:tick', applyTick);
  on('job:finished', (c) => {
    if (c.failed) {
      toast('warn', 'Finished with errors', `${fmtNum(c.done + c.skipped)} saved, ${fmtNum(c.failed)} failed. Hover a failed file to see why.`, { label: 'Retry failed', run: () => api.RetryFailed() }, 12000);
    } else {
      toast('ok', 'Download complete', `${fmtNum(c.done + c.skipped)} file${c.done + c.skipped === 1 ? '' : 's'} saved.`, { label: 'Open folder', run: () => api.OpenDownloadFolder() }, 12000);
    }
  });

  window.addEventListener('resize', () => { queueList(); drawGraph(); });

  // ---------------------------------------------------------------- profile & registration
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function renderProfile() {
    const s = S.settings;
    const name = (s.userName || '').trim();
    $('profileName').textContent = name || 'Not registered yet';
    $('profileEmail').textContent = s.userEmail || '';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
    $('profileAvatar').textContent = initials;
  }

  function openProfile() {
    const s = S.settings;
    $('regName').value = s.userName || '';
    $('regEmail').value = s.userEmail || '';
    $('regError').hidden = true;
    ['regName', 'regEmail'].forEach((id) => $(id).classList.remove('bad'));
    $('regModal').hidden = false;
    setTimeout(() => $('regEmail').focus(), 60);
  }

  function formError(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.hidden = !msg;
  }

  $('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('regName').value.trim().replace(/\s+/g, ' ');
    const email = $('regEmail').value.trim();
    $('regName').classList.toggle('bad', name.length < 2);
    $('regEmail').classList.toggle('bad', !EMAIL_RE.test(email));
    if (name.length < 2) return formError('regError', 'Please enter your name.');
    if (!EMAIL_RE.test(email)) return formError('regError', 'Please enter a valid email address.');
    formError('regError', '');
    const btn = $('regSubmit');
    btn.disabled = true;
    try {
      S.settings = await api.Register(name, email);
      $('regModal').hidden = true;
      renderProfile();
      toast('ok', 'Profile updated');
    } catch (err) {
      formError('regError', errText(err));
    } finally {
      btn.disabled = false;
    }
  });
  $('regCancel').onclick = () => { $('regModal').hidden = true; };
  $('profileEdit').onclick = openProfile;

  // ---------------------------------------------------------------- welcome
  // New users must register (name, email, accepting the terms) before the
  // app can be used; the Go side refuses to scan or download until then.
  const OB = { page: 1 };

  function onboarding(on) {
    document.body.classList.toggle('onboarding', on);
  }

  function showObPage(n) {
    OB.page = n;
    document.querySelectorAll('#welcome .ob-page').forEach((p) => { p.hidden = Number(p.dataset.page) !== n; });
    document.querySelectorAll('#welcome .ob-steps i').forEach((d, i) => d.classList.toggle('on', i === n - 1));
    if (n === 2) setTimeout(() => $(S.settings.userName ? 'obEmail' : 'obName').focus(), 60);
    if (n === 3) setTimeout(() => $('obFinish').focus(), 60);
  }

  function openWelcome() {
    const s = S.settings;
    $('obName').value = s.userName || '';
    $('obEmail').value = s.userEmail || '';
    $('obAgree').checked = false;
    formError('obError', '');
    onboarding(true);
    $('welcome').hidden = false;
    showObPage(1);
    setTimeout(() => $('obStart').focus(), 60);
  }

  $('obStart').onclick = () => showObPage(2);
  $('obAgree').addEventListener('change', () => {
    if ($('obAgree').checked) { $('obAgreeLine').classList.remove('bad'); formError('obError', ''); }
  });
  $('obBack').onclick = () => showObPage(1);
  $('obForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('obName').value.trim().replace(/\s+/g, ' ');
    const email = $('obEmail').value.trim();
    $('obName').classList.toggle('bad', name.length < 2);
    $('obEmail').classList.toggle('bad', !EMAIL_RE.test(email));
    $('obAgreeLine').classList.toggle('bad', !$('obAgree').checked);
    if (name.length < 2) return formError('obError', 'Please enter your name.');
    if (!EMAIL_RE.test(email)) return formError('obError', 'Please enter a valid email address.');
    if (!$('obAgree').checked) return formError('obError', 'Please accept the Terms and Conditions, Privacy Policy and Disclaimer to continue.');
    formError('obError', '');
    const btn = $('obSubmit');
    btn.disabled = true;
    try {
      S.settings = await api.Register(name, email);
      renderProfile();
      $('obDoneTitle').textContent = `You're all set, ${name.split(' ')[0]}`;
      showObPage(3);
    } catch (err) {
      formError('obError', errText(err));
    } finally {
      btn.disabled = false;
    }
  });
  $('obFinish').onclick = () => {
    $('welcome').hidden = true;
    onboarding(false);
    linkInput.focus();
    offerClipboard();
  };

  // Existing users accept changed terms once.
  function openTermsUpdate() {
    onboarding(true);
    formError('termsError', '');
    $('termsUpdate').hidden = false;
    setTimeout(() => $('termsAccept').focus(), 60);
  }
  $('termsAccept').onclick = async () => {
    const btn = $('termsAccept');
    btn.disabled = true;
    try {
      S.settings = await api.AcceptTerms();
      $('termsUpdate').hidden = true;
      onboarding(false);
      offerClipboard();
    } catch (err) {
      formError('termsError', errText(err));
    } finally {
      btn.disabled = false;
    }
  };
  $('termsQuit').onclick = () => window.runtime.Quit();

  const setupNeeded = () => !$('welcome').hidden || !$('termsUpdate').hidden;

  // ---------------------------------------------------------------- contact support
  function openSupport() {
    $('supName').value = S.settings.userName || '';
    $('supEmail').value = S.settings.userEmail || '';
    $('supMessage').value = S.supportDraft || '';
    formError('supError', '');
    ['supName', 'supEmail', 'supMessage'].forEach((id) => $(id).classList.remove('bad'));
    $('supportForm').hidden = false;
    $('supportSent').hidden = true;
    $('supportModal').hidden = false;
    setTimeout(() => $(S.settings.userName ? 'supMessage' : 'supName').focus(), 60);
  }
  function closeSupport() { $('supportModal').hidden = true; }
  $('supportClose').onclick = closeSupport;
  $('supportCancel').onclick = closeSupport;
  $('sentClose').onclick = closeSupport;
  $('supMessage').addEventListener('input', (e) => { S.supportDraft = e.target.value; });
  $('supportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const req = {
      name: $('supName').value.trim(),
      email: $('supEmail').value.trim(),
      topic: $('supTopic').value,
      message: $('supMessage').value.trim(),
      includeDetails: $('supDetails').checked,
    };
    $('supName').classList.toggle('bad', req.name.length < 2);
    $('supEmail').classList.toggle('bad', !EMAIL_RE.test(req.email));
    $('supMessage').classList.toggle('bad', req.message.length < 10);
    if (req.name.length < 2) return formError('supError', 'Please enter your name.');
    if (!EMAIL_RE.test(req.email)) return formError('supError', 'Please enter a valid email address so we can reply.');
    if (req.message.length < 10) return formError('supError', 'Please describe your question in a few words.');
    formError('supError', '');
    const btn = $('supportSend');
    btn.disabled = true;
    btn.lastChild.textContent = 'Sending…';
    try {
      const r = await api.SendSupport(req);
      S.supportDraft = '';
      $('sentTitle').textContent = r === 'sent' ? 'Message sent' : 'Message saved';
      $('sentText').textContent = r === 'sent'
        ? "Thanks for reaching out. We'll reply to your email as soon as we can."
        : "You seem to be offline. We'll send your message automatically as soon as you're connected.";
      $('supportForm').hidden = true;
      $('supportSent').hidden = false;
    } catch (err) {
      formError('supError', errText(err));
    } finally {
      btn.disabled = false;
      btn.lastChild.textContent = 'Send message';
    }
  });

  // ---------------------------------------------------------------- legal documents
  const docCache = {};
  function renderMd(md) {
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    let html = '', para = [], list = null, code = null;
    const flushPara = () => {
      if (!para.length) return;
      const text = para.join(' ');
      html += `<p${/^Eastape Downloader · /.test(text) ? ' class="meta"' : ''}>${inline(text)}</p>`;
      para = [];
    };
    const flushList = () => {
      if (list) html += `<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
      list = null;
    };
    for (const line of md.replace(/\r/g, '').split('\n')) {
      if (code) {
        if (line.startsWith('```')) { html += `<pre>${esc(code.join('\n'))}</pre>`; code = null; } else code.push(line);
        continue;
      }
      if (line.startsWith('```')) { flushPara(); flushList(); code = []; continue; }
      const h = line.match(/^(#{1,3}) (.*)/);
      if (h) { flushPara(); flushList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
      const li = line.match(/^- (.*)/);
      if (li) { flushPara(); (list = list || []).push(li[1]); continue; }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      para.push(line.trim());
    }
    flushPara();
    flushList();
    return html;
  }
  async function openDoc(name) {
    $('docModal').hidden = false;
    $('docTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.doc === name));
    const body = $('docBody');
    if (!docCache[name]) {
      body.innerHTML = '<p class="meta">Loading…</p>';
      try {
        const r = await fetch(`legal/${name}.md`);
        docCache[name] = renderMd(await r.text());
      } catch (e) {
        body.innerHTML = '<p>This document could not be opened. Please reinstall Eastape Downloader.</p>';
        return;
      }
    }
    body.innerHTML = docCache[name];
    body.scrollTop = 0;
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-doc]');
    if (!a) return;
    e.preventDefault();
    openDoc(a.dataset.doc);
  });
  $('docClose').onclick = () => { $('docModal').hidden = true; };
  $('docModal').addEventListener('mousedown', (e) => { if (e.target.id === 'docModal') $('docModal').hidden = true; });

  // Tap the logo in About five times.
  let logoTaps = 0, logoTimer;
  $('aboutLogo').addEventListener('click', () => {
    clearTimeout(logoTimer);
    logoTimer = setTimeout(() => { logoTaps = 0; }, 2500);
    if (++logoTaps >= 5) { $('credits').hidden = false; logoTaps = 0; }
  });

  // ---------------------------------------------------------------- updates
  // The app checks at start and every few hours (updates.go). An update is
  // offered with a pill in the top bar; a required one opens right away.
  const U = { info: null, toasted: '' };
  let IS_MAC = false; // set from AppInfo at start

  function renderUpdate(info) {
    U.info = info;
    const avail = ['available', 'downloading', 'installing', 'failed'].includes(info.state);
    $('updatePill').hidden = !avail;
    $('updatePillText').textContent = info.state === 'downloading' ? `Updating ${Math.round(info.progress)}%` : `Update to ${info.version}`;
    $('updateStatus').textContent = avail
      ? `Version ${info.version} is available`
      : info.checked ? "You're up to date" : 'Checks for updates automatically';

    // Dialog contents
    $('updTitle').textContent = info.mandatory ? `Please update to version ${info.version}` : `Version ${info.version} is available`;
    $('updSub').textContent = `You have version ${info.current}${info.size ? ` · download ${fmtBytes(info.size)}` : ''}`;
    $('updNotes').textContent = info.notes || 'Improvements and fixes.';
    $('updNotes').classList.toggle('empty', !info.notes);
    const working = info.state === 'downloading' || info.state === 'installing';
    $('updProgress').hidden = !working;
    $('updBar').style.width = `${info.progress || 0}%`;
    $('updProgressText').textContent = info.state === 'installing'
      ? 'Installing… Eastape Downloader will close and open again by itself.'
      : `Downloading… ${Math.round(info.progress || 0)}%`;
    $('updError').hidden = info.state !== 'failed';
    $('updError').textContent = info.error || '';
    $('updNow').disabled = working;
    $('updNowText').textContent = !info.canInstall ? 'Download' : info.state === 'failed' ? 'Try again' : 'Update now';
    $('updLater').hidden = info.mandatory;

    if (info.state === 'available' && info.mandatory && $('updateModal').hidden) openUpdate();
    if (info.state === 'available' && !info.mandatory && U.toasted !== info.version) {
      U.toasted = info.version;
      const how = info.canInstall
        ? 'Update in one click. Your downloads and settings stay as they are.'
        : 'Download it, then replace the old version. Your downloads and settings stay as they are.';
      toast('info', `Version ${info.version} is available`, how, { label: 'See what\'s new', run: openUpdate }, 9000);
    }
  }

  function openUpdate() {
    if (!U.info) return;
    $('updateModal').hidden = false;
    renderUpdate(U.info);
  }
  function closeUpdate() {
    if (U.info && U.info.mandatory && U.info.state !== 'failed') return;
    if (U.info && (U.info.state === 'downloading' || U.info.state === 'installing')) return;
    $('updateModal').hidden = true;
  }
  $('updatePill').onclick = openUpdate;
  $('updLater').onclick = closeUpdate;
  $('updNow').onclick = async () => {
    try {
      await api.InstallUpdate();
      if (U.info && !U.info.canInstall) {
        $('updateModal').hidden = true;
        if (IS_MAC) toast('info', 'Downloading the new version', 'Open it when it finishes and drag Eastape Downloader into Applications, replacing the old one.');
        else toast('info', 'Downloading the new Setup', 'Run it when it finishes to update Eastape Downloader.');
      }
    } catch (e) {
      $('updError').hidden = false;
      $('updError').textContent = errText(e);
    }
  };
  $('checkUpdatesBtn').onclick = async () => {
    const b = $('checkUpdatesBtn');
    b.disabled = true;
    $('updateStatus').textContent = 'Checking…';
    try {
      const info = await api.CheckForUpdates();
      renderUpdate(info);
      if (info.state === 'none') toast('ok', "You're up to date", `Version ${info.current} is the latest.`);
      else openUpdate();
    } catch (e) {
      $('updateStatus').textContent = errText(e);
    } finally {
      b.disabled = false;
    }
  };
  on('cloud:update', renderUpdate);

  // ---------------------------------------------------------------- news
  const N = { list: [] };
  const LEVEL_ICON = { info: 'info', success: 'checkCircle', warning: 'alert', critical: 'alert' };
  const LEVEL = (l) => (LEVEL_ICON[l] ? l : 'info');
  const shortDate = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

  function renderNotices(list) {
    N.list = list || [];
    const open = N.list.filter((n) => !n.dismissed);
    const unseen = open.filter((n) => !n.seen).length;
    $('noticeCount').hidden = !unseen;
    $('noticeCount').textContent = unseen > 9 ? '9+' : String(unseen);
    $('noticeBtn').title = unseen ? `${unseen} new from Eastape` : 'News from Eastape';

    $('noticeList').innerHTML = open.length
      ? open.map((n) => `<div class="np-item" data-level="${LEVEL(n.level)}">
          <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}
          <div class="np-meta"><span>${esc(shortDate(n.startsAt))}</span>${n.ctaUrl ? `<button class="ghost-btn small" data-open="${n.id}">${esc(n.ctaLabel || 'Open')}</button>` : ''}</div>
          ${n.dismissible ? `<button class="icon-btn small np-x" data-dismiss="${n.id}" title="Remove">${icon('x')}</button>` : ''}
        </div>`).join('')
      : '<div class="np-empty">No news right now.</div>';

    // Banner: the newest unseen message, or any important one still open.
    const banner = open.find((n) => !n.seen) || open.find((n) => n.level === 'critical' || n.level === 'warning');
    const el = $('noticeBanner');
    if (!banner) { el.hidden = true; return; }
    el.dataset.level = LEVEL(banner.level);
    el.innerHTML = `<span class="nb-ic">${icon(banner.level === 'success' ? 'megaphone' : LEVEL_ICON[LEVEL(banner.level)])}</span>
      <div class="nb-text"><b>${esc(banner.title)}</b>${banner.body ? `<span>${esc(banner.body)}</span>` : ''}</div>
      <div class="nb-actions">${banner.ctaUrl ? `<button class="ghost-btn small" data-open="${banner.id}">${esc(banner.ctaLabel || 'Open')}</button>` : ''}
      ${banner.dismissible ? `<button class="icon-btn small" data-dismiss="${banner.id}" title="Dismiss">${icon('x')}</button>` : ''}</div>`;
    el.hidden = false;
    if (!banner.seen) api.MarkNoticesSeen([banner.id]).catch(() => {});
  }

  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { api.OpenNotice(Number(o.dataset.open)).catch(() => {}); return; }
    const d = e.target.closest('[data-dismiss]');
    if (d) { api.DismissNotice(Number(d.dataset.dismiss)).catch(() => {}); return; }
    if (!$('noticePanel').hidden && !e.target.closest('.notice-wrap')) $('noticePanel').hidden = true;
  });
  $('noticeBtn').onclick = () => {
    const p = $('noticePanel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      const ids = N.list.filter((n) => !n.dismissed && !n.seen).map((n) => n.id);
      if (ids.length) api.MarkNoticesSeen(ids).catch(() => {});
    }
  };
  $('noticeClose').onclick = () => { $('noticePanel').hidden = true; };
  on('cloud:notices', renderNotices);

  // ---------------------------------------------------------------- start
  async function init() {
    hydrateIcons();
    let termsVersion = '';
    try {
      S.settings = await api.GetSettings();
      const info = await api.AppInfo();
      termsVersion = info.termsVersion || '';
      IS_MAC = info.platform === 'darwin';
      document.documentElement.classList.toggle('mac', IS_MAC);
      $('aboutVersion').textContent = `Version ${info.shortVersion} · ${info.language}`;
      $('regVersion').textContent = `Version ${info.shortVersion}`;
    } catch (e) {
      S.settings = { downloadDir: '', speedLimitKB: 0, parallel: 3, theme: 'dark', docsFormat: 'office', retries: 3, recentLinks: [] };
    }
    applyTheme(S.settings.theme);
    renderSettingsBits();
    setPhase('empty');
    api.GetUpdate().then(renderUpdate).catch(() => {});
    api.GetNotices().then(renderNotices).catch(() => {});
    if (!S.settings.registeredAt) openWelcome();
    else if (termsVersion && S.settings.termsAccepted !== termsVersion) openTermsUpdate();
    else offerClipboard();
  }
  init();
})();

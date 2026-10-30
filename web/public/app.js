// Eastape Downloader admin dashboard. Plain JS, no build step.
// Everything that comes from the API is inserted as text, never as HTML.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const state = { user: null, days: 30, cleanup: null, refresh: null, openTickets: 0, updatedAt: 0 };

// ---------------------------------------------------------------- tiny DOM helpers

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (sel, el = document) => el.querySelector(sel);

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style') el.style.cssText = v; // CSSOM, allowed by the page's CSP
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && !(el instanceof SVGElement) && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

function h(tag, attrs, ...kids) {
  return append(setAttrs(document.createElement(tag), attrs), kids);
}

function s(tag, attrs, ...kids) {
  return append(setAttrs(document.createElementNS(SVG_NS, tag), attrs), kids);
}

const ICONS = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 1 0 8a4 4 0 1 1 0-8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  support: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  releases: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  announcements: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  team: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  key: 'M15.5 7.5l3 3L22 7l-3-3 M21 2l-9.6 9.6 M7.5 11a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11',
  plus: 'M12 5v14 M5 12h14',
  search: 'M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14 M21 21l-4.35-4.35',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  copy: 'M9 9h11v11H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
  edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  x: 'M18 6L6 18 M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
  play: 'M5 3l14 9-14 9z',
  refresh: 'M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  more: 'M12 5h.01 M12 12h.01 M12 19h.01',
  alert: 'M12 9v4 M12 17h.01 M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  ok: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0 M12 2v10',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 1 0 8a4 4 0 1 1 0-8',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  sun: 'M12 7a5 5 0 1 1 0 10a5 5 0 1 1 0-10 M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  monitor: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 21h8 M12 17v4',
  laptop: 'M5 4h14a1 1 0 0 1 1 1v10H4V5a1 1 0 0 1 1-1z M2 19h20l-2-4H4z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M18 15l-6-6-6 6',
  arrowUp: 'M12 19V5 M5 12l7-7 7 7',
  arrowDown: 'M12 5v14 M19 12l-7 7-7-7',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  clock: 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20 M12 6v6l4 2',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  keyboard: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M6 9h.01 M10 9h.01 M14 9h.01 M18 9h.01 M6 13h.01 M18 13h.01 M10 13h4 M7 16h10',
};

function icon(name) {
  return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    s('path', { d: ICONS[name] || ICONS.more }));
}

// ---------------------------------------------------------------- formatting

const nf = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function fmtNum(n) {
  n = Number(n || 0);
  return Math.abs(n) >= 10000 ? compact.format(n) : nf.format(Math.round(n));
}

function fmtBytes(b) {
  b = Number(b || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${units[i]}`;
}

const fmtSpeed = (bps) => `${fmtBytes(bps)}/s`;

function fmtDuration(sec) {
  sec = Math.round(Number(sec || 0));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  if (hrs < 48) return `${hrs}h ${m % 60}m`;
  return `${fmtNum(Math.floor(hrs / 24))}d ${hrs % 24}h`;
}

function fmtDate(v, withTime = true) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('en-GB', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(v) {
  if (!v) return 'never';
  const sec = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)} d ago`;
  return fmtDate(v, false);
}

const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const plural = (n, word) => `${fmtNum(n)} ${word}${Number(n) === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- API

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') headers['x-eastape-dashboard'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 && path !== '/api/admin/login') {
    showLogin(data?.error);
    throw new ApiError(data?.error || 'Please sign in.', 401);
  }
  if (!res.ok || !data || data.ok === false) throw new ApiError(data?.error || `Something went wrong (HTTP ${res.status}).`, res.status);
  return data;
}

// ---------------------------------------------------------------- toasts, modals, menus, tooltips

function toast(message, kind = 'good') {
  const el = h('div', { class: `toast ${kind}` }, icon(kind === 'bad' ? 'alert' : 'ok'), h('span', null, message));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
}

function modal({ title, body, actions = [], wide = false, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = h('div', { class: 'modal-foot' });
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    foot);
  for (const a of actions) {
    foot.append(h('button', { class: `btn ${a.kind || ''}`, type: 'button', onclick: () => a.run(close) }, a.label));
  }
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (box.querySelector('input, textarea, select') || box.querySelector('.modal-foot .btn:last-child'))?.focus(), 30);
  return { close, box, foot };
}

function confirmBox(title, text, label, kind = 'primary') {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: h('p', { class: 'muted', style: 'margin:0' }, text),
      actions: [
        { label: 'Cancel', run: (close) => close() },
        { label, kind, run: (close) => { done = true; close(); } },
      ],
      onClose: () => resolve(done),
    });
  });
}

function menu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const el = h('div', { class: 'menu', role: 'menu' },
    items.map((it) => (it.sep ? h('hr') : it.heading ? h('div', { class: 'menu-label' }, it.heading)
      : h('button', { type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked === undefined ? null : String(it.checked), onclick: () => { el.remove(); it.run(); } },
        icon(it.icon), it.label, it.checked ? h('span', { class: 'tick' }, icon('check')) : null))));
  const onKey = (e) => { if (e.key === 'Escape') { el.remove(); document.removeEventListener('keydown', onKey); anchor.focus(); } };
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, ht = el.offsetHeight;
  el.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w))}px`;
  el.style.top = `${r.top - ht - 6 > 8 ? r.top - ht - 6 : r.bottom + 6}px`;
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!el.contains(e.target)) { el.remove(); document.removeEventListener('mousedown', off); }
  }), 0);
  el.querySelector('button')?.focus();
}

const tip = {
  show(x, y, value, label) {
    const el = $('#tooltip');
    el.replaceChildren(h('b', null, value), h('span', null, label));
    el.hidden = false;
    const w = el.offsetWidth, ht = el.offsetHeight;
    el.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    el.style.top = `${y - ht - 12 < 8 ? y + 16 : y - ht - 12}px`;
  },
  hide() { $('#tooltip').hidden = true; },
};

async function copyText(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast("Couldn't copy. Select the text and copy it yourself.", 'bad');
  }
}

/** Runs an async action on a button, disabling it meanwhile and showing errors. */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'bad');
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------------------------------------------------------------- charts
// One series per chart (slot 1), thin marks, hairline grid, crosshair or
// per-bar tooltips, and a table view under each chart.

/** A round step for 3 gridlines that covers `max` (whole numbers when `integer`, powers of 1024 for bytes). */
function niceStep(max, { integer = false, base = 10 } = {}) {
  let unit = 1;
  if (base === 1024) while (max / 3 >= unit * 1024) unit *= 1024;
  const raw = max / 3 / unit;
  if (raw <= 0) return unit;
  const p = 10 ** Math.floor(Math.log10(raw));
  let step = 10 * p;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) { step = m * p; break; }
  step *= unit;
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

/**
 * Draws a column or area chart into `host`, redrawing when it resizes.
 * rows: [{ day: 'YYYY-MM-DD', ... }], value: row => number, format: number => text
 */
function timeChart(host, rows, { value, format, kind = 'columns', label, integer = false, base = 10 }) {
  const draw = () => {
    const width = Math.max(260, host.clientWidth);
    const height = 190;
    const pad = { l: 44, r: kind === 'area' ? 44 : 6, t: 12, b: 24 };
    const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
    const vals = rows.map(value);
    const step = niceStep(Math.max(0, ...vals), { integer, base });
    const max = step * 3;
    const y = (v) => pad.t + ih - (v / max) * ih;
    const band = iw / rows.length;
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', 'aria-label': label });

    for (let i = 0; i <= 3; i++) {
      const v = step * i, yy = Math.round(y(v)) + 0.5;
      svg.append(s('line', { class: i === 0 ? 'baseline' : 'gridline', x1: pad.l, x2: width - pad.r, y1: yy, y2: yy }));
      svg.append(s('text', { class: 'tick', x: pad.l - 8, y: yy + 4, 'text-anchor': 'end' }, format(v, true)));
    }
    const ticks = rows.length <= 8 ? rows.map((_, i) => i) : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
    for (const i of ticks) {
      const anchor = i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle';
      const x = i === 0 ? pad.l : i === rows.length - 1 ? width - pad.r : pad.l + band * (i + 0.5);
      svg.append(s('text', { class: 'tick', x, y: height - 6, 'text-anchor': anchor }, shortDay(rows[i].day)));
    }

    if (kind === 'columns') {
      const bw = Math.max(1, Math.min(24, band - 2));
      const r = Math.min(4, bw / 2);
      rows.forEach((row, i) => {
        const v = vals[i];
        const x = pad.l + band * i + (band - bw) / 2;
        const top = y(v), floor = y(0);
        let bar = null;
        if (v > 0) {
          const hgt = Math.max(2, floor - top);
          const t = floor - hgt, rr = Math.min(r, hgt);
          bar = s('path', {
            class: 'bar',
            d: `M${x},${floor}V${t + rr}Q${x},${t} ${x + rr},${t}H${x + bw - rr}Q${x + bw},${t} ${x + bw},${t + rr}V${floor}Z`,
          });
          svg.append(bar);
        }
        const hit = s('rect', { class: 'hit', x: pad.l + band * i, y: pad.t, width: band, height: ih });
        hit.addEventListener('pointermove', (e) => tip.show(e.clientX, e.clientY, format(v), shortDay(row.day)));
        hit.addEventListener('pointerenter', () => bar?.classList.add('hot'));
        hit.addEventListener('pointerleave', () => { bar?.classList.remove('hot'); tip.hide(); });
        svg.append(hit);
      });
    } else {
      const xs = rows.map((_, i) => pad.l + band * (i + 0.5));
      const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y(vals[i]).toFixed(1)}`).join('');
      svg.append(s('path', { class: 'area', d: `${line}L${xs[xs.length - 1]},${y(0)}L${xs[0]},${y(0)}Z` }));
      svg.append(s('path', { class: 'line', d: line }));
      const last = rows.length - 1;
      svg.append(s('circle', { class: 'enddot', cx: xs[last], cy: y(vals[last]), r: 4 }));
      svg.append(s('text', { class: 'endlabel', x: xs[last] + 8, y: y(vals[last]) + 4 }, format(vals[last], true)));
      const cross = s('line', { class: 'cross', y1: pad.t, y2: pad.t + ih, visibility: 'hidden' });
      const dot = s('circle', { class: 'enddot', r: 4, visibility: 'hidden' });
      svg.append(cross, dot);
      const hit = s('rect', { class: 'hit', x: pad.l, y: pad.t, width: iw, height: ih });
      hit.addEventListener('pointermove', (e) => {
        const box = svg.getBoundingClientRect();
        const px = ((e.clientX - box.left) / box.width) * width;
        const i = Math.max(0, Math.min(last, Math.round((px - pad.l) / band - 0.5)));
        cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', xs[i]); dot.setAttribute('cy', y(vals[i])); dot.setAttribute('visibility', 'visible');
        tip.show(box.left + (xs[i] / width) * box.width, box.top + (y(vals[i]) / height) * box.height, format(vals[i]), shortDay(rows[i].day));
      });
      hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hide(); });
      svg.append(hit);
    }
    host.replaceChildren(svg);
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  return () => ro.disconnect();
}

function chartCard(title, sub, rows, opts, cleanups) {
  const host = h('div', { class: 'chart' });
  const total = rows.reduce((a, r) => a + opts.value(r), 0);
  const card = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, title), h('div', { class: 'sub' }, sub(total))), null),
    host,
    h('details', { class: 'table-toggle' }, h('summary', null, 'Show as table'),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', { class: 'r' }, title))),
        h('tbody', null, [...rows].reverse().map((r) => h('tr', null, h('td', null, fmtDate(`${r.day}T12:00:00`, false)), h('td', { class: 'r' }, opts.format(opts.value(r))))))))));
  // Draw after the card is in the page so it can measure its width.
  requestAnimationFrame(() => {
    if (!rows.some((r) => opts.value(r) > 0)) {
      host.replaceChildren(h('div', { class: 'chart-empty' }, 'No data for this period yet'));
      return;
    }
    cleanups.push(timeChart(host, rows, { ...opts, label: title }));
  });
  return card;
}

function barList(title, rows, format = fmtNum, empty = 'Nothing yet') {
  const max = Math.max(0, ...rows.map((r) => r.n));
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, title), h('span', { class: 'sub' }, 'last 30 days')),
    rows.length
      ? h('div', { class: 'hbars' }, rows.map((r) => h('div', { class: 'hbar', title: `${r.name}: ${format(r.n)}` },
        h('span', { class: 'name' }, r.name),
        h('span', { class: 'track' }, h('span', { class: 'fill', style: `display:block;width:${max ? (r.n / max) * 100 : 0}%` })),
        h('span', { class: 'val' }, format(r.n)))))
      : h('div', { class: 'empty' }, empty));
}

const tileEl = (label, value, note, hero = false) =>
  h('div', { class: `tile${hero ? ' hero' : ''}` }, h('div', { class: 'label' }, label), h('div', { class: 'value', title: String(value) }, value), note ? h('div', { class: 'note' }, note) : null);

// ---------------------------------------------------------------- figures (KPI tiles)

/** Change against the previous period: colour = direction × whether up is good, with an arrow and a sign. */
function deltaEl(cur, prev, { upIsGood = true, format = fmtNum } = {}) {
  const was = `Previous period: ${format(prev)}`;
  if (!prev && !cur) return h('span', { class: 'delta', title: 'Nothing in either period' }, '—');
  if (!prev) return h('span', { class: 'delta', title: was }, 'New');
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return h('span', { class: 'delta', title: was }, '0%');
  const up = pct > 0;
  const shown = Math.abs(pct) >= 1000 ? `${fmtNum(Math.round(Math.abs(pct) / 100) / 10)}k` : fmtNum(Math.round(Math.abs(pct)));
  return h('span', { class: `delta ${up === upIsGood ? 'good' : 'bad'}`, title: was },
    icon(up ? 'arrowUp' : 'arrowDown'), `${up ? '+' : '−'}${shown}%`,
    h('span', { class: 'sr-only' }, up ? ' up from the previous period' : ' down from the previous period'));
}

/** A small trend line: the period in a quiet grey, today marked in the series colour. */
function sparkline(values, label) {
  const w = 200, ht = 34, n = values.length;
  const max = Math.max(...values, 0);
  const svg = s('svg', { class: 'spark', viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label });
  if (n < 2 || max <= 0) return svg;
  const x = (i) => (i / (n - 1)) * w;
  const y = (v) => ht - 3 - (v / max) * (ht - 6);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  svg.append(s('path', { class: 's-area', d: `${line}L${w},${ht}L0,${ht}Z` }), s('path', { class: 's-line', d: line, 'vector-effect': 'non-scaling-stroke' }));
  svg.append(s('circle', { class: 's-dot', cx: x(n - 1), cy: y(values[n - 1]), r: 3.2, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

function kpi({ label, ic, value, cmp, format = fmtNum, note, spark, upIsGood = true }) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'label' }, icon(ic), label),
    h('div', { class: 'row' }, h('div', { class: 'value', title: String(value) }, value), cmp ? deltaEl(cmp.current, cmp.previous, { upIsGood, format }) : null),
    note ? h('div', { class: 'note' }, note) : null,
    spark ? sparkline(spark, `${label} per day`) : null);
}

const skeletons = (n, cls) => Array.from({ length: n }, () => h('div', { class: `skel ${cls}` }));

// ---------------------------------------------------------------- activity

const ACTIVITY_TYPES = [
  ['all', 'Everything'], ['installs', 'Installs'], ['registrations', 'Sign-ups'], ['links', 'Links'], ['downloads', 'Downloads'],
  ['problems', 'Problems'], ['support', 'Support'], ['updates', 'Updates'], ['sessions', 'App opens'],
  ['announcements', 'Announcements'], ['settings', 'Settings'],
];

const FEATURE_NAMES = {
  speed_limit: 'speed limit', parallel: 'parallel downloads', api_key: 'API key', retry_failed: 'retry failed',
  open_folder: 'open folder', reveal_file: 'show file', pause: 'pause', resume: 'resume', stop: 'stop', theme: 'theme', paste: 'paste link',
  check_updates: 'check for updates',
};

/** [icon, sentence, tone] for one event. */
function describe(ev) {
  const p = ev.props || {};
  const v = p.version || ev.version;
  switch (ev.type) {
    case 'install': return ['download', `installed Eastape Downloader${ev.version ? ` ${ev.version}` : ''}`, 'good'];
    case 'reinstall': return ['download', `reinstalled${ev.version ? ` ${ev.version}` : ''}`];
    case 'update': return ['refresh', `updated${p.prevVersion ? ` from ${p.prevVersion}` : ''}${ev.version ? ` to ${ev.version}` : ''}`, 'good'];
    case 'first_run': return ['power', 'opened the app for the first time', 'good'];
    case 'register': return ['user', p.updated ? 'updated their profile' : 'signed up', 'good'];
    case 'support': return ['support', `sent a support message${p.topic ? ` (${p.topic})` : ''}`, 'info'];
    case 'session_start': return ['power', 'opened the app'];
    case 'session_end': return ['power', `closed the app after ${fmtDuration(p.durationSec)}`];
    case 'scan': return p.ok
      ? ['link', `added ${p.kind === 'file' ? 'a file link' : p.links > 1 ? `${p.links} links` : 'a folder link'}${p.files ? ` · ${plural(p.files, 'file')}` : ''}${p.bytes ? `, ${fmtBytes(p.bytes)}` : ''}`]
      : ['alert', `couldn't open a link${p.errorKind ? ` (${String(p.errorKind).replace(/_/g, ' ')})` : ''}`, 'bad'];
    case 'job': {
      const what = `${plural(p.filesDone || 0, 'file')}, ${fmtBytes(p.bytes)}`;
      const how = p.result === 'stopped' ? 'stopped a download after' : p.result === 'failed' ? 'had a download fail after' : 'downloaded';
      return [p.result === 'failed' ? 'alert' : 'download', `${how} ${what}${p.durationSec ? ` in ${fmtDuration(p.durationSec)}` : ''}${p.filesFailed ? ` · ${p.filesFailed} failed` : ''}`, p.result === 'failed' ? 'bad' : null];
    }
    case 'feature': return ['sliders', `used ${FEATURE_NAMES[p.name] || String(p.name || 'a feature').replace(/_/g, ' ')}`];
    case 'setting': return ['edit', `changed ${String(p.name || 'a setting').replace(/_/g, ' ')}`];
    case 'error': return ['alert', `hit a problem: ${String(p.kind || 'other').replace(/_/g, ' ')}`, 'bad'];
    case 'update_offered': return ['releases', `was offered update ${v || ''}`];
    case 'update_started': return ['releases', `started updating to ${v || 'a new version'}`];
    case 'update_installed': return ['ok', `installed update ${v || ''}`, 'good'];
    case 'update_failed': return ['alert', `couldn't install update ${v || ''}${p.error ? ` (${p.error})` : ''}`, 'bad'];
    case 'announcement_seen': return ['announcements', 'saw an announcement'];
    case 'announcement_clicked': return ['announcements', 'opened an announcement link'];
    case 'announcement_dismissed': return ['announcements', 'dismissed an announcement'];
    case 'stats_enabled': return ['overview', 'turned usage stats on'];
    case 'stats_disabled': return ['overview', 'turned usage stats off'];
    default: return ['more', String(ev.type).replace(/_/g, ' ')];
  }
}

const dayKey = (v) => { const d = new Date(v); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(v) {
  const d = new Date(v);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const clock = (v) => new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function feedItem(ev, { showUser = true, fresh = false } = {}) {
  const [ic, text, tone] = describe(ev);
  const who = ev.name || `User ${ev.install}`;
  return h('div', { class: `feed-item${fresh ? ' fresh' : ''}` },
    h('span', { class: `feed-icon ${tone || ''}` }, icon(ic)),
    h('div', { class: 'feed-text' },
      showUser ? [h('button', { class: 'who-link', type: 'button', onclick: () => openUser(ev.installId) }, who), ' ', text]
        : text.charAt(0).toUpperCase() + text.slice(1),
      h('div', { class: 'feed-meta' },
        h('span', { title: fmtDate(ev.ts) }, clock(ev.ts)),
        ev.os ? h('span', null, ev.os) : null,
        ev.version ? h('span', null, `v${ev.version}`) : null)),
    h('span', { class: 'feed-time', title: fmtDate(ev.ts) }, timeAgo(ev.ts)));
}

/** Appends events to a feed, adding a heading whenever the day changes. */
function appendFeed(feed, items, opts = {}) {
  for (const ev of items) {
    const k = dayKey(ev.ts);
    if (feed.dataset.day !== k) {
      feed.dataset.day = k;
      feed.append(h('div', { class: 'feed-day' }, dayLabel(ev.ts)));
    }
    feed.append(feedItem(ev, opts));
  }
}

/**
 * An activity log that pages backwards ("Load more" / scrolling) and can fetch
 * newer events. query() returns the filters ({ group, q, install }).
 */
function activityLog({ query, showUser = true, pageSize = 50, onNew, emptyText = 'No activity yet.' }) {
  const feed = h('div', { class: 'feed' });
  const status = h('span', null);
  const moreBtn = h('button', { class: 'btn small', type: 'button', onclick: () => loadMore() }, 'Load more');
  const foot = h('div', { class: 'feed-more' }, moreBtn, status);
  const el = h('div', null, feed, foot);
  let next = null, newest = null, count = 0, loading = false, seq = 0, pending = [];

  const qs = (extra) => {
    const p = new URLSearchParams({ limit: String(pageSize) });
    for (const [k, v] of Object.entries({ ...query(), ...extra })) if (v && v !== 'all') p.set(k, v);
    return p.toString();
  };
  const paintFoot = () => {
    moreBtn.hidden = !next;
    status.textContent = count ? `${next ? 'Showing' : 'All'} ${plural(count, 'event')}${next ? '' : ' · that’s everything'}` : '';
  };

  async function reload() {
    const my = ++seq;
    loading = true;
    pending = [];
    onNew?.(0);
    if (!count) feed.replaceChildren(...skeletons(6, 'skel-row'));
    else feed.classList.add('loading-dim');
    try {
      const d = await api(`/api/admin/activity?${qs()}`);
      if (my !== seq) return;
      feed.replaceChildren();
      delete feed.dataset.day;
      appendFeed(feed, d.items, { showUser });
      next = d.next; newest = d.newest; count = d.items.length;
      if (!count) feed.replaceChildren(h('div', { class: 'empty' }, icon('activity'), emptyText));
      paintFoot();
    } catch (err) {
      if (err.status !== 401 && my === seq) feed.replaceChildren(h('div', { class: 'empty' }, err.message));
    } finally {
      if (my === seq) { loading = false; feed.classList.remove('loading-dim'); }
    }
  }

  async function loadMore() {
    if (!next || loading) return;
    const my = seq;
    loading = true;
    moreBtn.disabled = true;
    try {
      const d = await api(`/api/admin/activity?${qs({ before: next })}`);
      if (my !== seq) return;
      appendFeed(feed, d.items, { showUser });
      next = d.next; count += d.items.length;
      paintFoot();
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'bad');
    } finally {
      loading = false;
      moreBtn.disabled = false;
    }
  }

  /** Asks for events newer than the newest shown; they wait until showNew(). */
  async function poll() {
    if (loading || !newest) return;
    const my = seq;
    try {
      const d = await api(`/api/admin/activity?${qs({ after: newest, limit: '100' })}`);
      if (my !== seq || !d.items.length) return;
      pending = [...d.items, ...pending];
      newest = d.newest;
      onNew?.(pending.length);
    } catch { /* try again next time */ }
  }

  function showNew() {
    if (!pending.length) return;
    const items = pending;
    pending = [];
    onNew?.(0);
    const top = h('div', null);
    delete top.dataset.day;
    appendFeed(top, items, { showUser, fresh: true });
    // Drop the old first day heading if the new events continue that day.
    const first = feed.firstElementChild;
    if (first?.classList.contains('feed-day') && first.textContent === dayLabel(items[items.length - 1].ts)) first.remove();
    if (feed.querySelector('.empty')) feed.replaceChildren();
    feed.prepend(...top.children);
    count += items.length;
    paintFoot();
  }

  // Load the next page when the bottom comes into view.
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '300px' });
  io.observe(foot);
  return { el, reload, poll, showNew, destroy: () => io.disconnect() };
}

// ---------------------------------------------------------------- routing and refresh

/** "#users?sort=data" → { key: 'users', params } */
function route() {
  const [key, qs] = location.hash.slice(1).split('?');
  return { key: PAGES[key] ? key : 'overview', params: new URLSearchParams(qs || '') };
}

/** Changes the page's query (filters, sort, open user) without reloading it. */
function setParams(changes) {
  const { key, params } = route();
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '' || v === false) params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  history.replaceState(null, '', `#${key}${qs ? `?${qs}` : ''}`);
}

function markUpdated() {
  state.updatedAt = Date.now();
  paintUpdated();
}

function paintUpdated() {
  $('#updated').textContent = state.updatedAt ? `Updated ${timeAgo(state.updatedAt)}` : '';
}

async function refreshNow() {
  const btn = $('#refreshBtn');
  if (!state.user || btn.classList.contains('spin')) return;
  btn.classList.add('spin');
  try {
    if (state.refresh) await state.refresh();
    else await render();
    markUpdated();
  } finally {
    btn.classList.remove('spin');
  }
}

function searchBox(placeholder, value, onInput) {
  const input = h('input', { type: 'search', placeholder, 'aria-label': placeholder, value, dataset: { search: '1' } });
  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => onInput(input.value.trim()), 300); });
  return h('label', { class: 'search grow' }, icon('search'), input, h('kbd', null, '/'));
}

// ---------------------------------------------------------------- pages

function pageHead(title, sub, ...right) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'toolbar' }, right));
}

// ---- Overview

async function overviewPage(main) {
  const cleanups = [];
  const { params } = route();
  if ([7, 30, 90].includes(Number(params.get('days')))) state.days = Number(params.get('days'));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Period' });
  const paintSeg = () => seg.replaceChildren(...[7, 30, 90].map((d) => h('button', {
    type: 'button', 'aria-pressed': String(state.days === d),
    onclick: () => { state.days = d; setParams({ days: d === 30 ? null : d }); paintSeg(); loadAll(); },
  }, `${d} days`)));
  paintSeg();

  const liveTiles = h('div', { class: 'tiles live-tiles' }, ...skeletons(6, 'skel-tile'));
  const dot = h('span', { class: 'dot' });
  const periodTitle = h('div', { class: 'section-title' });
  const kpis = h('div', { class: 'kpis' }, ...skeletons(8, 'skel-tile'));
  const charts = h('div', { class: 'grid two' }, ...skeletons(4, 'skel-chart'));
  const allTime = h('div', { class: 'tiles four' });
  const breakdown = h('div', { class: 'grid two' });
  const feed = h('div', { class: 'feed' }, ...skeletons(5, 'skel-row'));
  const activityCard = h('div', { class: 'card flush' },
    h('div', { class: 'card-head' }, h('h2', null, 'Recent activity'), h('a', { class: 'linkish', href: '#activity' }, 'View all', icon('arrowRight'))),
    feed,
    h('div', { class: 'card-foot' }, h('span', null, 'Updates every 15 seconds'), h('a', { class: 'linkish', href: '#activity' }, 'Open the activity log', icon('arrowRight'))));

  main.replaceChildren(
    pageHead('Overview', 'How Eastape Downloader is being used, live.', seg),
    h('div', { class: 'card live-card' },
      h('div', { class: 'card-head' }, h('span', { class: 'live-badge' }, dot, 'Live now'), h('span', { class: 'sub' }, 'Last 15 minutes')),
      liveTiles),
    periodTitle, kpis,
    h('div', { class: 'section-title' }, 'Trends'), charts,
    h('div', { class: 'section-title' }, 'All time'), allTime,
    h('div', { class: 'grid side-by', style: 'margin-top:28px' },
      h('div', null, h('div', { class: 'section-title', style: 'margin-top:0' }, 'Breakdown', h('span', { class: 'sub' }, 'people active in the last 30 days')), breakdown),
      h('div', null, h('div', { class: 'section-title', style: 'margin-top:0' }, 'Activity'), activityCard)));

  const paintLive = (live, items) => {
    liveTiles.replaceChildren(
      tileEl('Using the app now', fmtNum(live.activeNow), 'seen in the last 15 minutes', true),
      tileEl('Downloading now', fmtNum(live.downloadingNow)),
      tileEl('Combined speed', fmtSpeed(live.speedNow)),
      tileEl('Downloaded today', fmtBytes(live.bytesToday)),
      tileEl('New installs today', fmtNum(live.installsToday)),
      tileEl('Open support messages', fmtNum(live.openTickets)));
    feed.replaceChildren();
    delete feed.dataset.day;
    if (items.length) appendFeed(feed, items);
    else feed.append(h('div', { class: 'empty' }, icon('activity'), 'No activity yet. It shows up here as soon as the app is used.'));
    setCount(live.openTickets);
  };

  let loadSeq = 0;
  const loadAll = async () => {
    const my = ++loadSeq;
    for (const el of [kpis, charts, allTime, breakdown]) el.classList.add('loading-dim');
    try {
      const d = await api(`/api/admin/overview?days=${state.days}&tz=${encodeURIComponent(TZ)}`);
      if (my !== loadSeq) return;
      paintLive(d.live, d.activity);
      for (const c of cleanups.splice(0)) c();
      const t = d.totals, c = d.compare, series = d.series;
      const col = (k) => series.map((r) => r[k]);
      periodTitle.replaceChildren(`Last ${d.days} days`, h('span', { class: 'sub' }, `compared with the ${d.days} days before`));
      kpis.replaceChildren(
        kpi({ label: 'Active users', ic: 'users', value: fmtNum(c.activeUsers.current), cmp: c.activeUsers, note: 'used the app at least once', spark: col('active') }),
        kpi({ label: 'New installs', ic: 'download', value: fmtNum(c.installs.current), cmp: c.installs, note: 'Windows and Mac', spark: col('installs') }),
        kpi({ label: 'Sign-ups', ic: 'user', value: fmtNum(c.registrations.current), cmp: c.registrations, note: 'entered name and email', spark: col('users') }),
        kpi({ label: 'Downloads', ic: 'check', value: fmtNum(c.downloads.current), cmp: c.downloads, note: 'downloads finished or stopped', spark: col('jobs') }),
        kpi({ label: 'Files downloaded', ic: 'file', value: fmtNum(c.files.current), cmp: c.files, spark: col('files') }),
        kpi({ label: 'Data downloaded', ic: 'releases', value: fmtBytes(c.bytes.current), cmp: c.bytes, format: fmtBytes, spark: col('bytes') }),
        kpi({ label: 'Links added', ic: 'link', value: fmtNum(c.links.current), cmp: c.links, spark: col('scans') }),
        kpi({ label: 'Time in the app', ic: 'clock', value: fmtDuration(c.seconds.current), cmp: c.seconds, format: fmtDuration, spark: col('seconds') }));
      charts.replaceChildren(
        chartCard('Active users per day', () => `${fmtNum(Math.max(0, ...col('active')))} on the busiest day`, series,
          { kind: 'area', integer: true, value: (r) => r.active, format: (v) => fmtNum(v) }, cleanups),
        chartCard('Data downloaded per day', (n) => `${fmtBytes(n)} in total`, series,
          { base: 1024, value: (r) => r.bytes, format: (v) => fmtBytes(v) }, cleanups),
        chartCard('New installs per day', (n) => `${fmtNum(n)} in total · ${fmtNum(series.reduce((a, r) => a + r.users, 0))} signed up`, series,
          { integer: true, value: (r) => r.installs, format: (v) => fmtNum(v) }, cleanups),
        chartCard('Time in the app per day', (n) => `${fmtDuration(n * 3600)} in total`, series,
          { value: (r) => r.seconds / 3600, format: (v, tick) => (tick ? `${v < 10 ? Number(v.toFixed(1)) : fmtNum(v)}h` : fmtDuration(v * 3600)) }, cleanups));
      allTime.replaceChildren(
        tileEl('Installs', fmtNum(t.installs), `${fmtNum(t.users)} signed up`),
        tileEl('Active users', fmtNum(t.active7d), `this week · ${fmtNum(t.active1d)} today · ${fmtNum(t.active30d)} this month`),
        tileEl('Data downloaded', fmtBytes(t.bytes), `${fmtNum(t.files)} files`),
        tileEl('Downloads', fmtNum(t.jobs)),
        tileEl('Links added', fmtNum(t.links), t.scanSuccess === null ? 'no links yet' : `${Math.round(t.scanSuccess)}% opened fine (30 days)`),
        tileEl('Time in the app', fmtDuration(t.seconds), `${fmtNum(t.sessions)} sessions`),
        tileEl('Average session', fmtDuration(t.avgSession), 'last 30 days'),
        tileEl('Average speed', t.avgSpeed ? fmtSpeed(t.avgSpeed) : '—', 'downloads over 1 MB, 30 days'));
      breakdown.replaceChildren(
        barList('Platforms', d.platforms),
        barList('App versions', d.versions.map((v) => ({ ...v, name: v.name === 'unknown' ? v.name : `v${v.name}` }))),
        barList('Operating systems', d.systems),
        barList('Link types', d.linkKinds),
        barList('Features used', d.features.map((f) => ({ ...f, name: FEATURE_NAMES[f.name] || f.name.replace(/_/g, ' ') }))),
        barList('Problems', d.errors.map((e) => ({ ...e, name: e.name.replace(/_/g, ' ') })), fmtNum, 'No problems reported'));
      markUpdated();
    } catch (err) {
      if (err.status !== 401 && my === loadSeq) kpis.replaceChildren(h('div', { class: 'card empty', style: 'grid-column:1/-1' }, err.message));
    } finally {
      if (my === loadSeq) for (const el of [kpis, charts, allTime, breakdown]) el.classList.remove('loading-dim');
    }
  };

  const loadLive = async () => {
    try {
      const d = await api(`/api/admin/live?tz=${encodeURIComponent(TZ)}`);
      paintLive(d.live, d.activity);
      dot.classList.remove('off');
      markUpdated();
    } catch {
      dot.classList.add('off');
    }
  };

  await loadAll();
  const liveTimer = setInterval(() => { if (!document.hidden) loadLive(); }, 15000);
  const fullTimer = setInterval(() => { if (!document.hidden) loadAll(); }, 5 * 60000);
  return {
    refresh: loadAll,
    cleanup: () => { clearInterval(liveTimer); clearInterval(fullTimer); for (const c of cleanups) c(); },
  };
}

// ---- Activity

async function activityPage(main) {
  const { params } = route();
  let group = ACTIVITY_TYPES.some(([k]) => k === params.get('type')) ? params.get('type') : 'all';
  let q = params.get('q') || '';
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Type of activity' });
  const pill = h('button', { class: 'new-pill', type: 'button', hidden: true, onclick: () => { log.showNew(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  const log = activityLog({
    query: () => ({ group, q }),
    pageSize: 50,
    emptyText: 'Nothing matches. Try another type or search.',
    onNew: (n) => { pill.hidden = !n; pill.replaceChildren(icon('arrowUp'), `${plural(n, 'new event')} · show`); },
  });
  const paintChips = () => chips.replaceChildren(...ACTIVITY_TYPES.map(([k, label]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(group === k),
    onclick: () => { group = k; setParams({ type: k === 'all' ? null : k }); paintChips(); log.reload(); },
  }, label)));
  paintChips();

  main.replaceChildren(
    pageHead('Activity', 'Everything people do in the app, newest first. Scroll or press Load more to go further back.'),
    h('div', { class: 'toolbar', style: 'margin-bottom:12px' },
      searchBox('Search by name, email or install ID', q, (v) => { q = v; setParams({ q: v || null }); log.reload(); })),
    h('div', { style: 'margin-bottom:16px' }, chips),
    pill,
    h('div', { class: 'card flush' }, log.el));

  await log.reload();
  markUpdated();
  const timer = setInterval(() => { if (!document.hidden) log.poll(); }, 15000);
  return {
    refresh: async () => { await log.reload(); },
    cleanup: () => { clearInterval(timer); log.destroy(); },
  };
}

// ---- Users

const USER_SORTS = [
  ['recent', 'Recently active'], ['newest', 'Newest installs'], ['oldest', 'Oldest installs'],
  ['name', 'Name A–Z'], ['name_desc', 'Name Z–A'], ['data', 'Most data downloaded'],
  ['downloads', 'Most downloads'], ['files', 'Most files'], ['time', 'Most time in the app'],
];
const USER_FILTERS = [
  ['all', 'Everyone'], ['registered', 'Signed up'], ['unregistered', 'Not signed up'],
  ['active', 'Active this week'], ['online', 'Online now'], ['downloading', 'Downloading now'],
];

const initials = (name, email) => {
  const src = (name || '').trim() || (email || '').split('@')[0];
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};
const avatar = (name, email, cls = '') => h('span', { class: `avatar ${name || email ? '' : 'anon'} ${cls}`, 'aria-hidden': 'true' }, initials(name, email));
const platformEl = (r) => r.os
  ? h('span', { class: 'plat' }, icon(r.platform === 'mac' ? 'laptop' : 'monitor'), r.os.split(' (')[0])
  : h('span', { class: 'faint' }, '—');

function userStatus(r) {
  const fresh = Date.now() - new Date(r.lastSeen).getTime() < 15 * 60000;
  if (fresh && r.state === 'downloading') return h('span', { class: 'badge good' }, 'Downloading');
  if (fresh) return h('span', { class: 'badge info' }, 'Online');
  return h('span', { class: 'faint', title: fmtDate(r.lastSeen) }, timeAgo(r.lastSeen));
}

async function usersPage(main) {
  const { params } = route();
  const pick = (key, list, fallback) => (list.some(([k]) => k === params.get(key)) ? params.get(key) : fallback);
  const st = {
    q: params.get('q') || '',
    filter: pick('filter', USER_FILTERS, 'all'),
    sort: pick('sort', USER_SORTS, 'recent'),
    platform: ['windows', 'mac'].includes(params.get('platform')) ? params.get('platform') : '',
    version: params.get('version') || '',
    page: Math.max(1, Number(params.get('page')) || 1),
    size: [25, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 50,
  };
  let facets = null, seq = 0;

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Who to show' });
  const platformSel = h('select', { 'aria-label': 'Platform' });
  const versionSel = h('select', { 'aria-label': 'App version' });
  const sortSel = h('select', { 'aria-label': 'Sort by' }, USER_SORTS.map(([k, label]) => h('option', { value: k, selected: st.sort === k }, `Sort: ${label}`)));
  const clearBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => { Object.assign(st, { q: '', filter: 'all', platform: '', version: '', page: 1 }); search.querySelector('input').value = ''; changed(); } }, icon('x'), 'Clear filters');
  const exportBtn = h('a', { class: 'btn', href: '#', download: '' }, icon('download'), 'Export CSV');
  const table = h('div', { class: 'table-wrap' }, ...skeletons(8, 'skel-row'));
  const pager = h('div', { class: 'pager' });
  const search = searchBox('Search name, email or install ID', st.q, (v) => { st.q = v; st.page = 1; changed(); });

  main.replaceChildren(
    pageHead('Users', 'Everyone who installed the app. Name and email appear once they sign up.', exportBtn),
    h('div', { style: 'margin-bottom:12px' }, chips),
    h('div', { class: 'toolbar', style: 'margin-bottom:16px' }, search, platformSel, versionSel, sortSel, clearBtn),
    h('div', { class: 'card flush' }, table, pager));

  const paintControls = () => {
    const f = facets || {};
    chips.replaceChildren(...USER_FILTERS.map(([k, label]) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(st.filter === k),
      onclick: () => { st.filter = k; st.page = 1; changed(); },
    }, k === 'online' || k === 'downloading' ? h('span', { class: 'dot', style: k === 'online' ? '' : 'background:var(--good)' }) : null,
    label, facets ? h('span', { class: 'n' }, fmtNum(k === 'all' ? f.all : f[k])) : null)));
    platformSel.replaceChildren(
      h('option', { value: '' }, 'All platforms'),
      h('option', { value: 'windows', selected: st.platform === 'windows' }, `Windows${facets ? ` · ${fmtNum(f.windows)}` : ''}`),
      h('option', { value: 'mac', selected: st.platform === 'mac' }, `macOS${facets ? ` · ${fmtNum(f.mac)}` : ''}`));
    const versions = facets?.versions || [];
    if (st.version && !versions.some((v) => v.name === st.version)) versions.unshift({ name: st.version, n: 0 });
    versionSel.replaceChildren(h('option', { value: '' }, 'All versions'),
      ...versions.map((v) => h('option', { value: v.name, selected: st.version === v.name }, `v${v.name} · ${fmtNum(v.n)}`)));
    sortSel.value = st.sort;
    clearBtn.hidden = !(st.q || st.filter !== 'all' || st.platform || st.version);
  };

  const query = () => {
    const p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.filter !== 'all') p.set('filter', st.filter);
    if (st.platform) p.set('platform', st.platform);
    if (st.version) p.set('version', st.version);
    p.set('sort', st.sort);
    return p;
  };

  // Column headers that sort; clicking the active one flips name and install date.
  const sortHead = (label, keys, cls = '') => {
    const active = keys.includes(st.sort);
    const dir = st.sort === 'name' || st.sort === 'oldest' ? 'ascending' : 'descending';
    return h('th', {
      class: `sortable ${cls}`, tabindex: '0', 'aria-sort': active ? dir : null, title: `Sort by ${label.toLowerCase()}`,
      onclick: () => { st.sort = active && keys[1] ? keys[keys.indexOf(st.sort) ^ 1] : keys[0]; st.page = 1; changed(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
    }, h('span', null, label, icon(active && dir === 'ascending' ? 'chevronUp' : 'chevronDown')));
  };

  const load = async () => {
    const my = ++seq;
    const p = query();
    exportBtn.href = `/api/admin/users.csv?${p}`;
    p.set('page', st.page);
    p.set('size', st.size);
    table.classList.add('loading-dim');
    try {
      const d = await api(`/api/admin/users?${p}`);
      if (my !== seq) return;
      facets = d.facets;
      paintControls();
      const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
      if (st.page > pages) { st.page = pages; changed(); return; }
      table.replaceChildren(d.rows.length ? h('table', null,
        h('thead', null, h('tr', null,
          sortHead('User', ['name', 'name_desc']),
          h('th', { class: 'hide-sm' }, 'Platform'),
          h('th', { class: 'hide-sm' }, 'Version'),
          sortHead('Downloads', ['downloads'], 'r hide-xs'),
          sortHead('Data', ['data'], 'r'),
          sortHead('Time in app', ['time'], 'r hide-sm'),
          sortHead('Installed', ['newest', 'oldest'], 'hide-sm'),
          sortHead('Last seen', ['recent']))),
        h('tbody', null, d.rows.map((r) => h('tr', {
          class: 'click', tabindex: '0', dataset: { install: r.install },
          onclick: () => openUser(r.install), onkeydown: (e) => { if (e.key === 'Enter') openUser(r.install); },
        },
        h('td', null, h('div', { class: 'who' }, avatar(r.name, r.email),
          h('div', null, h('b', null, r.name || 'Not signed up'), h('span', null, r.email || `Install ${r.install.slice(0, 8)}`)))),
        h('td', { class: 'hide-sm' }, platformEl(r)),
        h('td', { class: 'hide-sm' }, r.version ? `v${r.version}` : '—'),
        h('td', { class: 'r hide-xs' }, fmtNum(r.jobs)),
        h('td', { class: 'r' }, fmtBytes(r.bytes)),
        h('td', { class: 'r hide-sm' }, fmtDuration(r.seconds)),
        h('td', { class: 'hide-sm', title: fmtDate(r.installedAt || r.firstSeen) }, fmtDate(r.installedAt || r.firstSeen, false)),
        h('td', null, userStatus(r))))))
        : h('div', { class: 'empty' }, icon('users'), st.q || st.filter !== 'all' || st.platform || st.version ? 'No one matches these filters.' : 'No installs yet.'));
      const from = d.total ? (st.page - 1) * d.pageSize + 1 : 0, to = Math.min(d.total, st.page * d.pageSize);
      pager.replaceChildren(
        h('span', null, d.total ? `${fmtNum(from)}–${fmtNum(to)} of ${plural(d.total, 'person', )}`.replace(/persons$/, 'people') : 'No results'),
        h('div', { class: 'toolbar' },
          h('label', { class: 'check', style: 'gap:6px;color:var(--text-2)' }, 'Rows',
            h('select', { 'aria-label': 'Rows per page', onchange: (e) => { st.size = Number(e.target.value); st.page = 1; changed(); } },
              [25, 50, 100].map((n) => h('option', { value: n, selected: st.size === n }, String(n))))),
          h('span', { class: 'faint' }, `Page ${fmtNum(st.page)} of ${fmtNum(pages)}`),
          h('button', { class: 'btn small', type: 'button', disabled: st.page <= 1, onclick: () => { st.page--; changed(); } }, 'Previous'),
          h('button', { class: 'btn small', type: 'button', disabled: to >= d.total, onclick: () => { st.page++; changed(); } }, 'Next')));
      markUpdated();
    } catch (err) {
      if (err.status !== 401 && my === seq) table.replaceChildren(h('div', { class: 'empty' }, err.message));
    } finally {
      if (my === seq) table.classList.remove('loading-dim');
    }
  };

  function changed() {
    setParams({
      q: st.q || null, filter: st.filter === 'all' ? null : st.filter, platform: st.platform || null, version: st.version || null,
      sort: st.sort === 'recent' ? null : st.sort, page: st.page > 1 ? st.page : null, size: st.size === 50 ? null : st.size,
    });
    paintControls();
    return load();
  }

  platformSel.addEventListener('change', () => { st.platform = platformSel.value; st.page = 1; changed(); });
  versionSel.addEventListener('change', () => { st.version = versionSel.value; st.page = 1; changed(); });
  sortSel.addEventListener('change', () => { st.sort = sortSel.value; st.page = 1; changed(); });
  paintControls();
  await load();
  return { refresh: load };
}

// ---- One user, in a side panel

let drawer = null;

function closeUser() {
  if (!drawer) return;
  drawer.close();
}

async function openUser(id) {
  if (!/^[0-9a-f]{32}$/i.test(id || '')) return;
  drawer?.close({ keepParam: true });
  setParams({ user: id });
  const prevFocus = document.activeElement;
  const head = h('div', { class: 'drawer-head' }, h('span', { class: 'skel', style: 'width:52px;height:52px;border-radius:50%' }),
    h('div', { class: 't' }, h('span', { class: 'skel', style: 'height:18px;width:60%' })),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x')));
  const body = h('div', { class: 'drawer-body' }, ...skeletons(3, 'skel-tile'));
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'User' }, head, body);
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-back')) close(); };
  let log = null;
  function close({ keepParam = false } = {}) {
    scrim.remove(); panel.remove(); log?.destroy();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('locked');
    for (const tr of document.querySelectorAll('tr.selected')) tr.classList.remove('selected');
    if (drawer?.panel === panel) drawer = null;
    if (!keepParam) setParams({ user: null });
    prevFocus?.focus?.();
  }
  drawer = { close, panel };
  document.body.append(scrim, panel);
  document.body.classList.add('locked');
  document.addEventListener('keydown', onKey);
  document.querySelector(`tr[data-install="${id}"]`)?.classList.add('selected');
  setTimeout(() => head.querySelector('button')?.focus(), 30);

  try {
    const d = await api(`/api/admin/users/${id}`);
    if (drawer?.panel !== panel) return;
    const r = d.user;
    head.replaceChildren(avatar(r.name, r.email, 'lg'),
      h('div', { class: 't' }, h('h2', null, r.name || 'Not signed up'), h('span', null, r.email || `Install ${r.install.slice(0, 8)}`)),
      userStatus(r),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x')));
    log = activityLog({ query: () => ({ install: r.install }), showUser: false, pageSize: 30, emptyText: 'Nothing recorded for this person yet.' });
    const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
    body.replaceChildren(...[
      h('div', { class: 'toolbar' },
        r.email ? h('a', { class: 'btn small', href: `mailto:${encodeURIComponent(r.email).replace(/%40/g, '@')}` }, icon('mail'), 'Email') : null,
        r.email ? h('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.email, 'Email copied') }, icon('copy'), 'Copy email') : null,
        h('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.install, 'Install ID copied') }, icon('copy'), 'Copy install ID')),
      h('div', { class: 'tiles' },
        tileEl('Downloads', fmtNum(r.jobs)), tileEl('Files', fmtNum(r.files)), tileEl('Data', fmtBytes(r.bytes)),
        tileEl('Time in app', fmtDuration(r.seconds)), tileEl('Links added', fmtNum(r.links)), tileEl('Sessions', fmtNum(r.sessions))),
      h('div', null, h('h3', null, 'Details'), h('dl', { class: 'kv' },
        row('Signed up', r.registeredAt ? fmtDate(r.registeredAt) : 'Not yet'),
        row('Installed', fmtDate(r.installedAt || r.firstSeen)),
        row('Last seen', `${fmtDate(r.lastSeen)} (${timeAgo(r.lastSeen)})`),
        row('Last download', d.lastDownload ? `${fmtDate(d.lastDownload)} (${timeAgo(d.lastDownload)})` : 'None yet'),
        row('App version', r.version ? `v${r.version}` : '—'),
        row('System', r.os || '—'),
        row('Installed from', { installer: 'Windows installer', portable: r.platform === 'mac' ? 'Mac app' : 'Portable copy', app: 'The app' }[r.source] || r.source || '—'),
        row('Problems', d.problems ? plural(d.problems, 'problem') : 'None reported'),
        row('Install ID', h('span', { class: 'mono' }, r.install)))),
      d.tickets.length ? h('div', null, h('h3', null, `Support messages · ${d.tickets.length}`),
        h('div', { class: 'feed' }, d.tickets.map((t) => h('div', { class: 'feed-item' },
          h('span', { class: 'feed-icon info' }, icon('support')),
          h('div', { class: 'feed-text' }, h('a', { class: 'linkish', href: '#support' }, t.topic || 'Message'), h('div', { class: 'feed-meta' }, h('span', null, fmtDate(t.createdAt)))),
          h('span', { class: `badge ${{ open: 'info', answered: 'good', closed: 'plain' }[t.status]}` }, t.status[0].toUpperCase() + t.status.slice(1)))))) : null,
      h('div', null, h('h3', null, 'Activity'), log.el)].filter(Boolean));
    log.reload();
  } catch (err) {
    if (err.status === 401 || drawer?.panel !== panel) return;
    body.replaceChildren(h('div', { class: 'empty' }, icon('alert'), err.status === 404 ? 'This person isn’t in the records any more.' : err.message));
  }
}


// ---- Support

async function supportPage(main) {
  let status = 'open';
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Status' });
  const list = h('div', { class: 'items' });
  main.replaceChildren(pageHead('Support', 'Messages sent from the Contact support form in the app.'), tabs, list);

  const load = async () => {
    list.classList.add('loading-dim');
    try {
      const d = await api(`/api/admin/support${status === 'all' ? '' : `?status=${status}`}`);
      const c = d.counts;
      setCount(c.open || 0);
      tabs.replaceChildren(...[['open', 'Open'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']].map(([k, label]) =>
        h('button', { type: 'button', 'aria-pressed': String(status === k), onclick: () => { status = k; load(); } },
          k === 'all' ? label : `${label} · ${fmtNum(c[k] || 0)}`)));
      list.replaceChildren(...(d.rows.length ? d.rows.map(ticket) : [h('div', { class: 'card empty' }, status === 'open' ? 'All caught up. No open messages.' : 'Nothing here.')]));
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(h('div', { class: 'card empty' }, err.message));
    } finally {
      list.classList.remove('loading-dim');
    }
  };

  const ticket = (t) => {
    const badge = { open: ['info', 'Open'], answered: ['good', 'Answered'], closed: ['plain', 'Closed'] }[t.status];
    const note = h('textarea', { rows: 2, placeholder: 'Private note for the team (optional)' });
    note.value = t.note || '';
    const save = (patch, btn, msg) => busy(btn, async () => {
      await api(`/api/admin/support/${t.id}`, { method: 'PATCH', body: patch });
      toast(msg);
      load();
    });
    const reply = `mailto:${encodeURIComponent(t.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(`Re: Eastape Downloader support${t.topic ? ` — ${t.topic}` : ''}`)}`;
    const body = h('div', { class: 'item-body clamp' }, t.message);
    const more = t.message.length > 280 || t.message.split('\n').length > 3
      ? h('button', { class: 'btn small', type: 'button', onclick: (e) => { body.classList.toggle('clamp'); e.currentTarget.textContent = body.classList.contains('clamp') ? 'Show all' : 'Show less'; } }, 'Show all')
      : null;
    return h('div', { class: 'item' },
      h('div', { class: 'item-head' },
        h('div', null,
          h('div', { class: 'item-title' }, t.topic || 'Message', h('span', { class: `badge ${badge[0]}` }, badge[1])),
          h('div', { class: 'item-meta' }, h('span', null, t.name), h('span', null, t.email), h('span', { title: fmtDate(t.createdAt) }, timeAgo(t.createdAt)),
            t.version ? h('span', null, `v${t.version}`) : null, t.os ? h('span', null, t.os.split(' (')[0]) : null))),
      body, more,
      t.details ? h('details', { style: 'margin-top:10px' }, h('summary', { class: 'faint', style: 'cursor:pointer' }, 'Technical details from the app'), h('pre', { class: 'details mono' }, t.details)) : null,
      h('div', { style: 'margin-top:12px' }, note),
      h('div', { class: 'item-actions' },
        h('a', { class: 'btn small primary', href: reply }, icon('mail'), 'Reply by email'),
        t.status !== 'answered' ? h('button', { class: 'btn small', type: 'button', onclick: (e) => save({ status: 'answered', note: note.value }, e.currentTarget, 'Marked as answered') }, icon('check'), 'Mark answered') : null,
        t.status !== 'closed' ? h('button', { class: 'btn small', type: 'button', onclick: (e) => save({ status: 'closed', note: note.value }, e.currentTarget, 'Closed') }, 'Close') : null,
        t.status !== 'open' ? h('button', { class: 'btn small', type: 'button', onclick: (e) => save({ status: 'open', note: note.value }, e.currentTarget, 'Reopened') }, 'Reopen') : null,
        h('button', { class: 'btn small', type: 'button', onclick: (e) => save({ note: note.value }, e.currentTarget, 'Note saved') }, 'Save note')));
  };

  await load();
}

// ---- Releases (in-app updates)

async function releasesPage(main) {
  const list = h('div', { class: 'items' });
  const canWrite = state.user.role !== 'viewer';
  let info = { blob: false, publicKey: '' };
  main.replaceChildren(
    pageHead('Updates', 'Publish a new version and the app offers it to users, who update in one click.',
      canWrite ? h('button', { class: 'btn primary', type: 'button', onclick: () => newRelease(info, load) }, icon('plus'), 'New update') : null),
    list);

  async function load() {
    list.classList.add('loading-dim');
    try {
      const d = await api('/api/admin/releases');
      info = d;
      const how = h('details', { class: 'callout' },
        h('summary', { style: 'cursor:pointer' }, h('b', null, 'How updates work')),
        h('ol', { style: 'margin:10px 0 0;padding-left:18px;display:grid;gap:4px' },
          h('li', null, 'Build the new version and upload it here as a draft: the Setup .exe for Windows, or the .dmg for Mac.'),
          h('li', null, 'The server signs it. The app only installs updates with a valid signature.'),
          h('li', null, 'Publish it. Start with a small rollout (e.g. 10%) and raise it once it looks good.'),
          h('li', null, 'Pause it at any time to stop offering it.'),
          h('li', null, 'Windows users update in one click. Mac users get the new .dmg and replace the app themselves.')),
        h('div', { style: 'margin-top:10px' }, 'Update signing key (built into the app): ', h('span', { class: 'mono' }, d.publicKey || 'not set up')));
      list.replaceChildren(how, ...(d.rows.length ? d.rows.map(release) : [h('div', { class: 'card empty' }, 'No updates yet.')]));
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(h('div', { class: 'card empty' }, err.message));
    } finally {
      list.classList.remove('loading-dim');
    }
  }

  const release = (r) => {
    const badge = { draft: ['plain', 'Draft'], published: ['good', 'Published'], paused: ['warn', 'Paused'] }[r.status];
    const patch = (body, btn, msg) => busy(btn, async () => {
      await api(`/api/admin/releases/${r.id}`, { method: 'PATCH', body });
      toast(msg);
      load();
    });
    const range = h('input', { type: 'range', min: 0, max: 100, step: 5, value: r.rollout, 'aria-label': 'Rollout percentage', disabled: !canWrite });
    const pct = h('b', { class: 'num' }, `${r.rollout}%`);
    range.addEventListener('input', () => { pct.textContent = `${range.value}%`; });
    range.addEventListener('change', () => patch({ rollout: Number(range.value) }, range, `Now offered to ${range.value}% of users`));
    return h('div', { class: 'item' },
      h('div', { class: 'item-head' },
        h('div', null,
          h('div', { class: 'item-title' }, `Version ${r.version}`, h('span', { class: 'badge plain' }, r.channel === 'mac' ? 'Mac' : 'Windows'),
            h('span', { class: `badge ${badge[0]}` }, badge[1]),
            r.mandatory ? h('span', { class: 'badge bad' }, 'Required') : null),
          h('div', { class: 'item-meta' },
            h('span', null, r.fileName), h('span', null, fmtBytes(r.size)),
            h('span', null, r.publishedAt ? `published ${timeAgo(r.publishedAt)}` : `added ${timeAgo(r.createdAt)}`),
            h('span', null, `${plural(r.installs, 'user')} on this version`),
            r.minSupported ? h('span', null, `required below v${r.minSupported}`) : null)),
        h('div', { class: 'rollout' }, h('span', { class: 'faint' }, 'Offered to'), range, pct)),
      r.notes ? h('div', { class: 'item-body' }, r.notes) : h('div', { class: 'item-body faint' }, 'No release notes.'),
      canWrite ? h('div', { class: 'item-actions' },
        r.status !== 'published'
          ? h('button', { class: 'btn small primary', type: 'button', onclick: async (e) => {
            const btn = e.currentTarget;
            if (await confirmBox(`Publish version ${r.version}?`, `It will be offered to ${r.rollout}% of users on older versions the next time their app checks (at start and every few hours).`, 'Publish')) {
              patch({ status: 'published' }, btn, `Version ${r.version} published`);
            }
          } }, icon('play'), r.status === 'paused' ? 'Resume' : 'Publish')
          : h('button', { class: 'btn small', type: 'button', onclick: (e) => patch({ status: 'paused' }, e.currentTarget, 'Paused. The app stops offering it.') }, icon('pause'), 'Pause'),
        h('button', { class: 'btn small', type: 'button', onclick: () => editRelease(r, load) }, icon('edit'), 'Edit'),
        h('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.url, 'Download link copied') }, icon('link'), 'Copy download link'),
        !r.publishedAt ? h('button', { class: 'btn small danger', type: 'button', onclick: async (e) => {
          const btn = e.currentTarget;
          if (await confirmBox(`Delete version ${r.version}?`, 'The draft and its uploaded file will be removed.', 'Delete', 'danger')) {
            busy(btn, async () => { await api(`/api/admin/releases/${r.id}`, { method: 'DELETE' }); toast('Deleted'); load(); });
          }
        } }, icon('trash'), 'Delete') : null) : null);
  };

  await load();
}

function releaseFields(r = {}) {
  const notes = h('textarea', { rows: 5, placeholder: "What's new, in a few short lines. Users see this before updating." });
  notes.value = r.notes || '';
  const minSupported = h('input', { type: 'text', placeholder: 'e.g. 1.1.0', value: r.minSupported || '' });
  const mandatory = h('input', { type: 'checkbox', checked: Boolean(r.mandatory) });
  const rollout = h('input', { type: 'number', min: 0, max: 100, value: r.rollout ?? 100 });
  const el = h('div', { class: 'form-grid' },
    h('label', null, 'Release notes', notes),
    h('div', { class: 'form-row' },
      h('label', null, 'Offer to (% of users)', rollout),
      h('label', null, 'Required for versions below', minSupported)),
    h('label', { class: 'check' }, mandatory, 'Required update (users can’t skip it)'));
  return {
    el,
    values: () => ({ notes: notes.value, minSupported: minSupported.value.trim(), mandatory: mandatory.checked, rollout: Number(rollout.value) }),
  };
}

function newRelease(info, reload) {
  const version = h('input', { type: 'text', placeholder: '1.2.0', autocomplete: 'off' });
  const platform = h('select', null, h('option', { value: 'stable' }, 'Windows (.exe)'), h('option', { value: 'mac' }, 'Mac (.dmg)'));
  const file = h('input', { type: 'file', accept: '.exe' });
  const mac = () => platform.value === 'mac';
  platform.addEventListener('change', () => { file.accept = mac() ? '.dmg,.zip' : '.exe'; file.value = ''; });
  const link = h('input', { type: 'url', placeholder: 'https://github.com/…/EastapeDownloader-Setup-1.2.0.exe' });
  const useLink = !info.blob;
  const bar = h('div', null);
  const progress = h('div', { class: 'progress', hidden: true }, bar);
  const err = h('p', { class: 'form-error' });
  const fields = releaseFields();
  file.addEventListener('change', () => {
    const m = file.files[0]?.name.match(/(\d+\.\d+\.\d+)/);
    if (m && !version.value) version.value = m[1];
  });
  const m = modal({
    title: 'New update',
    wide: true,
    body: h('div', { class: 'form-grid' },
      h('div', { class: 'form-row' },
        h('label', null, 'Platform', platform),
        h('label', null, 'Version', version)),
      useLink ? h('label', null, 'Installer link (GitHub release)', link) : h('label', null, 'Installer file', file),
      useLink ? h('p', { class: 'hint', style: 'margin:0' }, 'File upload isn’t set up on this server yet, so use a GitHub release link.') : null,
      progress,
      fields.el,
      err),
    actions: [
      { label: 'Cancel', run: (close) => close() },
      {
        label: 'Upload as draft',
        kind: 'primary',
        run: async () => {
          err.textContent = '';
          const v = version.value.trim();
          if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v)) { err.textContent = 'Version must look like 1.2.0'; return; }
          const btn = m.foot.querySelector('.primary');
          btn.disabled = true;
          try {
            let url = link.value.trim(), fileName;
            if (!useLink) {
              const f = file.files[0];
              if (!f) throw new Error(mac() ? 'Choose the .dmg file.' : 'Choose the Setup .exe file.');
              if (mac() ? !/\.(dmg|zip)$/i.test(f.name) : !/\.exe$/i.test(f.name)) throw new Error(mac() ? 'Choose a .dmg file.' : 'Choose an .exe file.');
              progress.hidden = false;
              const { upload } = await import('/vendor/blob-client.js');
              const safe = f.name.replace(/[^\w.-]+/g, '-');
              const blob = await upload(`releases/${safe}`, f, {
                access: 'public',
                handleUploadUrl: '/api/admin/releases/upload',
                headers: { 'x-eastape-dashboard': '1' },
                contentType: 'application/octet-stream',
                multipart: f.size > 20 * 1024 * 1024,
                onUploadProgress: (p) => { bar.style.width = `${p.percentage}%`; },
              });
              url = blob.url;
              fileName = f.name;
            } else if (!/^https:\/\//.test(url)) {
              throw new Error('Paste the https:// link to the Setup file.');
            }
            btn.textContent = 'Checking and signing…';
            await api('/api/admin/releases', { method: 'POST', body: { version: v, channel: platform.value, url, fileName, ...fields.values() } });
            m.close();
            toast(`Version ${v} for ${mac() ? 'Mac' : 'Windows'} saved as a draft. Publish it when you're ready.`);
            reload();
          } catch (e) {
            if (e.status !== 401) err.textContent = e.message || 'Upload failed. Try again.';
            btn.disabled = false;
            btn.textContent = 'Upload as draft';
          }
        },
      },
    ],
  });
}

function editRelease(r, reload) {
  const fields = releaseFields(r);
  const err = h('p', { class: 'form-error' });
  modal({
    title: `Edit version ${r.version}`,
    body: h('div', { class: 'form-grid' }, fields.el, err),
    actions: [
      { label: 'Cancel', run: (close) => close() },
      {
        label: 'Save', kind: 'primary', run: async (close) => {
          try {
            await api(`/api/admin/releases/${r.id}`, { method: 'PATCH', body: fields.values() });
            close(); toast('Saved'); reload();
          } catch (e) { err.textContent = e.message; }
        },
      },
    ],
  });
}

// ---- Announcements

const LEVELS = { info: 'Info', success: 'Good news', warning: 'Heads up', critical: 'Important' };

async function announcementsPage(main) {
  const list = h('div', { class: 'items' });
  const canWrite = state.user.role !== 'viewer';
  main.replaceChildren(
    pageHead('Announcements', 'Messages shown inside the app: news, tips or important notices.',
      canWrite ? h('button', { class: 'btn primary', type: 'button', onclick: () => editAnnouncement(null, load) }, icon('plus'), 'New announcement') : null),
    list);

  async function load() {
    list.classList.add('loading-dim');
    try {
      const d = await api('/api/admin/announcements');
      list.replaceChildren(...(d.rows.length ? d.rows.map(item) : [h('div', { class: 'card empty' }, 'No announcements yet.')]));
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(h('div', { class: 'card empty' }, err.message));
    } finally {
      list.classList.remove('loading-dim');
    }
  }

  const item = (a) => {
    const now = Date.now();
    const live = a.active && new Date(a.startsAt).getTime() <= now && (!a.endsAt || new Date(a.endsAt).getTime() > now);
    const state_ = !a.active ? ['plain', 'Off'] : live ? ['good', 'Showing'] : new Date(a.startsAt).getTime() > now ? ['info', 'Scheduled'] : ['plain', 'Ended'];
    const audience = a.minVersion || a.maxVersion
      ? `Versions ${a.minVersion || 'any'} to ${a.maxVersion || 'latest'}` : 'All versions';
    return h('div', { class: 'item' },
      h('div', { class: 'item-head' },
        h('div', null,
          h('div', { class: 'item-title' }, a.title, h('span', { class: `badge ${state_[0]}` }, state_[1]), h('span', { class: 'badge plain' }, LEVELS[a.level])),
          h('div', { class: 'item-meta' },
            h('span', null, `From ${fmtDate(a.startsAt)}${a.endsAt ? ` to ${fmtDate(a.endsAt)}` : ''}`),
            h('span', null, audience),
            h('span', null, `Seen by ${fmtNum(a.seen)}`),
            a.ctaUrl ? h('span', null, `Button clicked by ${fmtNum(a.clicked)}`) : null))),
      a.body ? h('div', { class: 'item-body' }, a.body) : null,
      canWrite ? h('div', { class: 'item-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => editAnnouncement(a, load) }, icon('edit'), 'Edit'),
        h('button', { class: 'btn small', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          await api(`/api/admin/announcements/${a.id}`, { method: 'PATCH', body: { ...a, active: !a.active } });
          toast(a.active ? 'Turned off' : 'Turned on'); load();
        }) }, icon(a.active ? 'pause' : 'play'), a.active ? 'Turn off' : 'Turn on'),
        h('button', { class: 'btn small danger', type: 'button', onclick: async (e) => {
          const btn = e.currentTarget;
          if (await confirmBox('Delete this announcement?', 'It disappears from the app and its stats are removed from this list.', 'Delete', 'danger')) {
            busy(btn, async () => { await api(`/api/admin/announcements/${a.id}`, { method: 'DELETE' }); toast('Deleted'); load(); });
          }
        } }, icon('trash'), 'Delete')) : null);
  };

  await load();
}

function toLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function editAnnouncement(a, reload) {
  const title = h('input', { type: 'text', maxlength: 120, value: a?.title || '' });
  const body = h('textarea', { rows: 4, maxlength: 2000 });
  body.value = a?.body || '';
  const level = h('select', null, Object.entries(LEVELS).map(([k, v]) => h('option', { value: k, selected: (a?.level || 'info') === k }, v)));
  const ctaLabel = h('input', { type: 'text', maxlength: 40, placeholder: 'e.g. Learn more', value: a?.ctaLabel || '' });
  const ctaUrl = h('input', { type: 'url', placeholder: 'https://…', value: a?.ctaUrl || '' });
  const startsAt = h('input', { type: 'datetime-local', value: toLocalInput(a?.startsAt || new Date()) });
  const endsAt = h('input', { type: 'datetime-local', value: toLocalInput(a?.endsAt) });
  const minVersion = h('input', { type: 'text', placeholder: 'any', value: a?.minVersion || '' });
  const maxVersion = h('input', { type: 'text', placeholder: 'latest', value: a?.maxVersion || '' });
  const dismissible = h('input', { type: 'checkbox', checked: a ? a.dismissible : true });
  const active = h('input', { type: 'checkbox', checked: a ? a.active : true });
  const err = h('p', { class: 'form-error' });

  const pTitle = h('div', { class: 'p-title' }), pBody = h('div', { class: 'p-body' }), pCta = h('span', { class: 'btn small p-cta' });
  const preview = h('div', { class: 'preview' }, pTitle, pBody, pCta);
  const paint = () => {
    preview.dataset.level = level.value;
    pTitle.textContent = title.value || 'Title';
    pBody.textContent = body.value;
    pBody.hidden = !body.value;
    pCta.textContent = ctaLabel.value || 'Open';
    pCta.hidden = !ctaUrl.value;
  };
  for (const el of [title, body, level, ctaLabel, ctaUrl]) el.addEventListener('input', paint);
  paint();

  modal({
    title: a ? 'Edit announcement' : 'New announcement',
    wide: true,
    body: h('div', { class: 'form-grid' },
      h('label', null, 'Title', title),
      h('label', null, 'Message', body),
      h('div', { class: 'form-row' }, h('label', null, 'Type', level), h('label', null, 'Button text', ctaLabel), h('label', null, 'Button link', ctaUrl)),
      h('div', { class: 'form-row' }, h('label', null, 'Show from', startsAt), h('label', null, 'Until (optional)', endsAt)),
      h('div', { class: 'form-row' }, h('label', null, 'Only for versions from', minVersion), h('label', null, 'Up to', maxVersion)),
      h('div', { class: 'form-row' }, h('label', { class: 'check' }, dismissible, 'Users can dismiss it'), h('label', { class: 'check' }, active, 'Turned on')),
      h('div', { class: 'form-grid', style: 'gap:6px' }, h('span', { class: 'hint' }, 'Preview'), preview),
      err),
    actions: [
      { label: 'Cancel', run: (close) => close() },
      {
        label: a ? 'Save' : 'Publish', kind: 'primary', run: async (close) => {
          err.textContent = '';
          const payload = {
            title: title.value, body: body.value, level: level.value, ctaLabel: ctaLabel.value, ctaUrl: ctaUrl.value.trim(),
            startsAt: startsAt.value ? new Date(startsAt.value).toISOString() : null,
            endsAt: endsAt.value ? new Date(endsAt.value).toISOString() : null,
            minVersion: minVersion.value.trim(), maxVersion: maxVersion.value.trim(),
            dismissible: dismissible.checked, active: active.checked,
          };
          if (ctaLabel.value && !payload.ctaUrl) { err.textContent = 'Add a link for the button, or clear the button text.'; return; }
          try {
            await api(a ? `/api/admin/announcements/${a.id}` : '/api/admin/announcements', { method: a ? 'PATCH' : 'POST', body: payload });
            close(); toast(a ? 'Saved' : 'Announcement published'); reload();
          } catch (e) { err.textContent = e.message; }
        },
      },
    ],
  });
}

// ---- Team

async function teamPage(main) {
  const list = h('div', null);
  const owner = state.user.role === 'owner';
  main.replaceChildren(
    pageHead('Team', 'People who can sign in to this dashboard.',
      owner ? h('button', { class: 'btn primary', type: 'button', onclick: () => addMember(load) }, icon('plus'), 'Add person') : null),
    h('div', { class: 'card' }, list),
    h('div', { class: 'callout', style: 'margin-top:16px' },
      h('b', null, 'Roles. '), 'Owner: everything, including the team. Admin: publish updates, announcements and answer support. Viewer: can look, can’t change anything.'));

  async function load() {
    try {
      const d = await api('/api/admin/team');
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Person'), h('th', null, 'Role'), h('th', null, 'Last sign-in'), h('th', null, ''))),
        h('tbody', null, d.rows.map((m) => h('tr', null,
          h('td', null, h('div', { class: 'who' }, avatar(m.name, m.email), h('div', null, h('b', null, m.name || m.email), h('span', null, m.email)))),
          h('td', null, h('span', { class: `badge ${m.role === 'owner' ? 'info' : 'plain'}` }, m.role[0].toUpperCase() + m.role.slice(1))),
          h('td', null, m.lastLogin ? timeAgo(m.lastLogin) : 'Never'),
          h('td', { class: 'r' }, owner && m.role !== 'owner' ? h('button', { class: 'btn small danger', type: 'button', onclick: async (e) => {
            const btn = e.currentTarget;
            if (await confirmBox(`Remove ${m.email}?`, 'They are signed out and can no longer open the dashboard.', 'Remove', 'danger')) {
              busy(btn, async () => { await api(`/api/admin/team/${m.id}`, { method: 'DELETE' }); toast('Removed'); load(); });
            }
          } }, 'Remove') : null)))))));
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(h('div', { class: 'empty' }, err.message));
    }
  }
  await load();
}

function addMember(reload) {
  const email = h('input', { type: 'email', autocomplete: 'off' });
  const name = h('input', { type: 'text', autocomplete: 'off' });
  const role = h('select', null, h('option', { value: 'admin' }, 'Admin'), h('option', { value: 'viewer' }, 'Viewer'));
  const err = h('p', { class: 'form-error' });
  modal({
    title: 'Add person',
    body: h('div', { class: 'form-grid' }, h('label', null, 'Email', email), h('label', null, 'Name', name), h('label', null, 'Role', role), err),
    actions: [
      { label: 'Cancel', run: (close) => close() },
      {
        label: 'Add', kind: 'primary', run: async (close) => {
          try {
            const d = await api('/api/admin/team', { method: 'POST', body: { email: email.value.trim(), name: name.value.trim(), role: role.value } });
            close();
            reload();
            modal({
              title: 'Share these sign-in details',
              body: h('div', { class: 'form-grid' },
                h('p', { class: 'muted', style: 'margin:0' }, 'Send this one-time password privately. It is shown only once; they can change it after signing in.'),
                h('div', { class: 'secret' }, h('code', null, email.value.trim())),
                h('div', { class: 'secret' }, h('code', null, d.password), h('button', { class: 'btn', type: 'button', onclick: () => copyText(d.password, 'Password copied') }, icon('copy'), 'Copy'))),
              actions: [{ label: 'Done', kind: 'primary', run: (c) => c() }],
            });
          } catch (e) { err.textContent = e.message; }
        },
      },
    ],
  });
}

function changePassword() {
  const current = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
  const again = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('p', { class: 'form-error' });
  modal({
    title: 'Change password',
    body: h('div', { class: 'form-grid' },
      h('label', null, 'Current password', current),
      h('label', null, 'New password', next, h('span', { class: 'hint' }, 'At least 10 characters.')),
      h('label', null, 'New password again', again), err),
    actions: [
      { label: 'Cancel', run: (close) => close() },
      {
        label: 'Change password', kind: 'primary', run: async (close) => {
          if (next.value !== again.value) { err.textContent = 'The new passwords don’t match.'; return; }
          try {
            await api('/api/admin/password', { method: 'POST', body: { current: current.value, next: next.value } });
            close(); toast('Password changed. Other devices were signed out.');
          } catch (e) { err.textContent = e.message; }
        },
      },
    ],
  });
}

// ---------------------------------------------------------------- shell, routing, sign-in

const PAGES = {
  overview: ['Overview', overviewPage],
  activity: ['Activity', activityPage],
  users: ['Users', usersPage],
  support: ['Support', supportPage],
  releases: ['Updates', releasesPage],
  announcements: ['Announcements', announcementsPage],
  team: ['Team', teamPage],
};
const NAV = [['Insights', ['overview', 'activity', 'users']], ['Manage', ['support', 'releases', 'announcements']], ['Settings', ['team']]];

function setCount(n) {
  state.openTickets = n;
  const el = $('#nav a[data-page=support] .count');
  if (el) { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; }
}

function buildNav() {
  $('#nav').replaceChildren(...NAV.flatMap(([group, keys]) => [
    h('div', { class: 'nav-group' }, group),
    ...keys.map((key) => h('a', { href: `#${key}`, dataset: { page: key }, title: PAGES[key][0] }, icon(key), h('span', { class: 'label' }, PAGES[key][0]),
      key === 'support' ? h('span', { class: 'count', hidden: !state.openTickets }, String(state.openTickets)) : null)),
  ]));
}

const navOpen = (open) => {
  $('#shell').classList.toggle('nav-open', open);
  $('.scrim.nav')?.remove();
  if (open) document.body.append(h('div', { class: 'scrim nav', onclick: () => navOpen(false) }));
};

let renderSeq = 0, lastKey = null;
async function render() {
  if (!state.user) return;
  const { key, params } = route();
  navOpen(false);
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.page === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${PAGES[key][0]} · Eastape Downloader Admin`;
  $('#crumb').replaceChildren(icon(key), h('b', null, PAGES[key][0]));
  drawer?.close({ keepParam: true });
  state.cleanup?.();
  state.cleanup = null;
  state.refresh = null;
  tip.hide();
  if (key !== lastKey) { window.scrollTo(0, 0); lastKey = key; }
  const seq = ++renderSeq;
  const main = $('#main');
  try {
    const out = await PAGES[key][1](main);
    const cleanup = typeof out === 'function' ? out : out?.cleanup;
    if (seq === renderSeq) {
      state.cleanup = cleanup || null;
      state.refresh = out?.refresh || null;
      markUpdated();
      if (params.get('user')) openUser(params.get('user'));
    } else cleanup?.();
  } catch (err) {
    if (err.status !== 401) main.replaceChildren(h('div', { class: 'card empty' }, icon('alert'), err.message || 'Something went wrong.'));
  }
}

// ---- theme: system, light or dark, remembered in this browser
function currentTheme() {
  try { return localStorage.getItem('eastape-admin-theme') || 'system'; } catch { return 'system'; }
}
function setTheme(t) {
  try { if (t === 'system') localStorage.removeItem('eastape-admin-theme'); else localStorage.setItem('eastape-admin-theme', t); } catch { /* not remembered */ }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  render();
}

function showLogin(message) {
  state.cleanup?.();
  state.cleanup = null;
  state.refresh = null;
  state.user = null;
  drawer?.close({ keepParam: true });
  for (const el of document.querySelectorAll('.modal-back, .menu, .scrim')) el.remove();
  $('#boot').hidden = true;
  $('#shell').hidden = true;
  $('#login').hidden = false;
  $('#loginError').textContent = message && message !== 'Please sign in.' ? message : '';
  setTimeout(() => $('#loginEmail').focus(), 30);
}

function enter(user) {
  state.user = user;
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#shell').hidden = false;
  $('#meName').textContent = user.name || user.email.split('@')[0];
  $('#meEmail').textContent = `${user.email} · ${user.role[0].toUpperCase()}${user.role.slice(1)}`;
  $('#meAvatar').textContent = initials(user.name, user.email);
  buildNav();
  render();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#loginForm button');
  const err = $('#loginError');
  err.textContent = '';
  btn.disabled = true;
  try {
    const d = await api('/api/admin/login', { method: 'POST', body: { email: $('#loginEmail').value.trim(), password: $('#loginPassword').value } });
    $('#loginPassword').value = '';
    enter(d.user);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
});

$('#meMenu').append(icon('more'));
$('#meMenu').addEventListener('click', (e) => {
  const t = currentTheme();
  menu(e.currentTarget, [
    { heading: 'Theme' },
    { icon: 'monitor', label: 'Same as system', checked: t === 'system', run: () => setTheme('system') },
    { icon: 'sun', label: 'Light', checked: t === 'light', run: () => setTheme('light') },
    { icon: 'moon', label: 'Dark', checked: t === 'dark', run: () => setTheme('dark') },
    { sep: true },
    { icon: 'key', label: 'Change password', run: changePassword },
    { icon: 'keyboard', label: 'Keyboard shortcuts', run: shortcutsHelp },
    { icon: 'logout', label: 'Sign out', run: async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ } showLogin(); } },
  ]);
});

$('#menuBtn').append(icon('menu'));
$('#menuBtn').addEventListener('click', () => navOpen(!$('#shell').classList.contains('nav-open')));
$('#refreshIcon').replaceWith(icon('refresh'));
$('#refreshBtn').addEventListener('click', refreshNow);

function shortcutsHelp() {
  const row = (keys, what) => [h('dt', null, keys.map((k) => h('kbd', null, k)), ''), h('dd', null, what)];
  modal({
    title: 'Keyboard shortcuts',
    body: h('dl', { class: 'kv' },
      row(['R'], 'Refresh this page'), row(['/'], 'Search'), row(['Esc'], 'Close a panel or dialog'),
      row(['G', 'O'], 'Overview'), row(['G', 'A'], 'Activity'), row(['G', 'U'], 'Users'), row(['G', 'S'], 'Support')),
    actions: [{ label: 'Close', run: (close) => close() }],
  });
}

// R refreshes, / searches, G then a letter goes to a page.
let gPressed = 0;
document.addEventListener('keydown', (e) => {
  if (!state.user || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (typing || document.querySelector('.modal-back')) return;
  const k = e.key.toLowerCase();
  if (Date.now() - gPressed < 1200) {
    const to = { o: 'overview', a: 'activity', u: 'users', s: 'support', p: 'releases', n: 'announcements', t: 'team' }[k];
    gPressed = 0;
    if (to) { e.preventDefault(); location.hash = `#${to}`; }
    return;
  }
  if (k === 'g') gPressed = Date.now();
  else if (k === 'r') { e.preventDefault(); refreshNow(); } else if (k === '/') {
    const box = document.querySelector('#main [data-search]');
    if (box) { e.preventDefault(); box.focus(); }
  }
});

window.addEventListener('hashchange', render);
setInterval(paintUpdated, 5000);

(async () => {
  try {
    const d = await api('/api/admin/me');
    enter(d.user);
  } catch (err) {
    if (err.status !== 401) showLogin(err.message);
  }
})();

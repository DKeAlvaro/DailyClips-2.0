/** Tiny DOM helpers: h('div.cls', {onclick}, child, 'text'). */
export function h(spec, attrs, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
    else if (k === 'class') el.className += ' ' + v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el, ...kids) {
  el.textContent = '';
  add(el, kids);
  return el;
}

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>',
  mic: P('<rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" stroke="none"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>',
  replay: P('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/>'),
  next: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  share: P('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>'),
  trophy: P('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 3.5M16 6h3a3 3 0 0 1-3 3.5M12 13v4M8.5 20h7M10 17h4"/>'),
  chart: P('<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>'),
  user: P('<circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
  flame: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.6 2.2c.5 3.3-1 5-2.6 6.700C8.300 10.700 6.500 12.500 6.500 15.500a5.500 5.500 0 0 0 11 0c0-1.700-.6-3-1.400-4.100-.4 1.200-1 2-2 2.500.5-3.600-.4-8.300-1.500-11.700ZM12 20a2.700 2.700 0 0 1-2.700-2.700c0-1.500.900-2.400 1.700-3.300.500 1.300 1.300 2 2.500 2.300A2.700 2.700 0 0 1 12 20Z"/></svg>',
  lock: P('<rect x="5" y="10.500" width="14" height="9.500" rx="2"/><path d="M8 10.500V7.500a4 4 0 0 1 8 0v3"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: P('<path d="M4.500 12.500 10 18l9.500-11"/>'),
  down: P('<path d="m6 9.500 6 6 6-6"/>', 'style="width:14px;height:14px"'),
  out: P('<path d="M14 5h5v5M19 5l-8 8M10 5H6.500A1.500 1.500 0 0 0 5 6.500v11A1.500 1.500 0 0 0 6.500 19h11a1.500 1.500 0 0 0 1.500-1.500V14"/>'),
  ear: P('<path d="M7 9a5 5 0 0 1 10 0c0 3-2.500 3.500-3 6a3 3 0 0 1-5.500 1.500"/><path d="M9.500 9.500a2.500 2.500 0 0 1 5 0c0 1.200-1.500 1.800-2 3"/>'),
};

export function icon(name) {
  const s = document.createElement('span');
  s.style.display = 'contents';
  s.innerHTML = ICONS[name] || '';
  return s.firstChild;
}

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('in'), ms);
}

/** Animates a number inside `el` from 0 (or `from`) to `to`. */
export function countUp(el, to, ms = 900, from = 0) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = to;
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

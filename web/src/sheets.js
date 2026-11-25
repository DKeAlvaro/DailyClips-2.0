// Bottom sheets: stats, ranking, past clips, account, and the "this browser can't listen" help.
import { h, $, icon, toast } from './dom.js';
import { S, save, streak, resultList, addDays, resetIdentity } from './store.js';
import { api } from './api.js';
import { ctx, currentDay, isInApp, isIOS, isAndroid } from './ctx.js';
import { t, lang, setLang, fmtDay } from './i18n.js';
import { band } from './words.js';
import { strip, standing } from './result.js';
import { shareClip } from './share.js';
import { googleButton, loginAvailable, signedIn, logout, deleteAccount } from './auth.js';
import { tierPanel, soundsPanel } from './levels.js';

let current = null;

function open(title, build, { tabs = null, onTab = null } = {}) {
  const had = !!current;
  if (had) closeSheet(true); // reuse the history entry of the sheet being replaced
  const body = h('div.body');
  const shade = h('div.shade', { onclick: () => closeSheet() });
  let tabEls = null;
  if (tabs) {
    tabEls = h('div.tabs', tabs.map((label, i) => h('button.tab' + (i === 0 ? '.on' : ''), {
      onclick: (e) => {
        tabEls.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
        body.scrollTop = 0;
        onTab(i, body);
      },
    }, label)));
  }
  const head = h('div.sh', h('h2', title), h('button.icon', { onclick: () => closeSheet(), 'aria-label': 'close' }, icon('close')));
  const sheet = h('div.sheet', { role: 'dialog', 'aria-label': title }, h('div.grab'), head, tabEls, body);
  $('#sheets').append(shade, sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    shade.classList.add('in');
    sheet.classList.add('in');
  }));
  if (!had) history.pushState({ sheet: true }, '');
  current = { shade, sheet, body, build };
  dragToClose(sheet, head);
  build(body);
  return body;
}

export function closeSheet(fromPop = false) {
  if (!current) return false;
  const c = current;
  current = null;
  c.shade.classList.remove('in');
  c.sheet.classList.remove('in');
  c.sheet.style.transform = '';
  setTimeout(() => {
    c.shade.remove();
    c.sheet.remove();
  }, 360);
  if (!fromPop) history.back();
  return true;
}

function dragToClose(sheet, handle) {
  let y0 = null, dy = 0;
  const start = (e) => {
    y0 = e.touches[0].clientY;
    dy = 0;
    sheet.style.transition = 'none';
  };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sheet.style.transition = '';
    if (dy > 90) closeSheet();
    else sheet.style.transform = '';
  };
  for (const el of [handle, sheet.querySelector('.grab')]) {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
  }
}

const refresh = () => current && (current.body.textContent = '', current.build(current.body));
window.addEventListener('dc:profile', refresh);

// ------------------------------------------------------------------ stats

function chart(list) {
  const W = 320, H = 120, pad = 8;
  const n = list.length;
  const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => pad + ((100 - v) / 100) * (H - 2 * pad);
  const pts = list.map((r, i) => `${x(i).toFixed(1)},${y(r.score).toFixed(1)}`);
  const area = `M${pts[0]} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const dots = list.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.score).toFixed(1)}" r="${i === n - 1 ? 5 : 3}" fill="${i === n - 1 ? 'var(--good)' : '#0a0b0d'}" stroke="var(--good)" stroke-width="2"/>`).join('');
  const grid = [0, 50, 100].map((v) => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.08)"/><text x="${W - pad}" y="${y(v) - 3}" fill="#6d7069" font-size="9" text-anchor="end">${v}</text>`).join('');
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9f33f" stop-opacity=".28"/><stop offset="1" stop-color="#b9f33f" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#ga)"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--good)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
  return h('div', { html: svg });
}

function calendar(today) {
  const byDay = {};
  for (const r of resultList()) {
    const clipDay = r.onDay ? r.day : null;
    if (clipDay) byDay[clipDay] = { score: r.score, late: false };
  }
  // clips done after their day: mark the release day with an outline
  const d = new Date(today + 'T12:00:00Z');
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
  const first = addDays(monday, -28);
  const cal = h('div.cal', [...t('dow')].map((c) => h('div.dow', c)));
  for (let i = 0; i < 35; i++) {
    const day = addDays(first, i);
    const r = byDay[day];
    const cls = (r ? '.' + band(r.score) : '') + (day === today ? '.today' : '') + (day > today ? '.fut' : '');
    cal.append(h('i' + cls, String(Number(day.slice(8)))));
  }
  return cal;
}

export function openStats() {
  open(t('stats'), (body) => {
    const today = currentDay();
    const st = streak(today);
    const list = resultList().slice().sort((a, b) => a.at - b.at);
    const last7 = list.slice(-7);
    const avg = last7.length ? Math.round(last7.reduce((a, r) => a + r.score, 0) / last7.length) : null;
    body.append(h('div.kpis',
      h('div.kpi.fl', h('b', String(st.current)), h('span', t('k_streak'))),
      h('div.kpi', h('b', String(st.best)), h('span', t('k_best'))),
      h('div.kpi', h('b', String(list.length)), h('span', t('k_clips'))),
      h('div.kpi', h('b', avg == null ? '–' : String(avg)), h('span', t('k_avg')))));
    body.append(h('div.panel', h('h3', t('cal')), calendar(today)));
    const evo = h('div.panel', h('h3', t('evo')));
    if (list.length < 2) evo.append(h('div.empty', { html: t('evo_empty') }));
    else {
      const shown = list.slice(-30);
      evo.append(chart(shown));
      const k = Math.min(5, Math.floor(list.length / 2));
      const mean = (a) => Math.round(a.reduce((s, r) => s + r.score, 0) / a.length);
      const a = mean(list.slice(-k)), b = mean(list.slice(-2 * k, -k));
      evo.append(h('p.note', a > b ? t('evo_trend_up', { k, a, d: a - b }) : t('evo_trend_down', { k, a })));
    }
    body.append(evo, soundsPanel(list));
  });
}

// ------------------------------------------------------------------ ranking

function rankList(rows, meId, { unit = '' } = {}) {
  return h('ol.list', rows.map((r, i) => h('li.rk' + (r.u === meId ? '.me' : ''),
    h('span.pos', String(i + 1)),
    h('span.nm', r.name + (r.u === meId ? ` (${t('you').toLowerCase()})` : ''), r.days ? h('small', t('clips_n', { n: r.days })) : null),
    h('span.sc', String(r.score) + unit))));
}

async function rankToday(body) {
  body.textContent = '';
  const n = ctx.clip.n, mine = S.results[n], meId = S.user && S.user.id;
  let stats;
  try {
    stats = ctx.stats[n] = await api('/api/stats/' + n);
  } catch {
    return body.append(h('div.empty', t('net_fail')));
  }
  if (!stats.count) {
    return body.append(h('div.empty', { html: t('rank_empty') }));
  }
  const head = h('div.panel', h('h3', `Clip #${n}`, h('span', t(stats.count === 1 ? 'people_did_1' : 'people_did', { n: stats.count }))));
  if (mine) {
    const st = standing(stats, mine.score);
    head.append(h('p.lead', { html: st.total > 1 ? t('rank_of', { pos: st.pos, n: st.total }) : t('only_you') }));
  } else head.append(h('p.lead', t('rank_join')));
  head.append(strip(stats, { me: mine ? mine.score : null }));
  body.append(head, rankList(stats.top, meId));
  if (stats.count < 3) body.append(h('div.cta', h('button.btn.sm', { onclick: shareClip }, icon('share'), t('share_clip'))));
}

async function rankWeek(body) {
  body.textContent = '';
  let wk;
  try {
    wk = await api('/api/rank/week');
  } catch {
    return body.append(h('div.empty', t('net_fail')));
  }
  if (!wk.top.length) return body.append(h('div.empty', { html: t('week_empty') }));
  body.append(h('p.note', { style: { margin: '0 4px 8px' } }, `${fmtDay(wk.from)} – ${fmtDay(wk.to)} · ${t('week_sub')}`), rankList(wk.top, S.user && S.user.id));
}

export function openRank() {
  open(t('ranking'), rankToday, { tabs: [ctx.clip.n === ctx.today ? t('today') : `#${ctx.clip.n}`, t('week')], onTab: (i, body) => (i ? rankWeek(body) : rankToday(body)) });
}

// ------------------------------------------------------------------ past clips

export function openArchive() {
  open(t('clips'), async (body) => {
    let data;
    try {
      data = await api('/api/archive');
    } catch {
      return body.append(h('div.empty', t('net_fail')));
    }
    body.append(h('div', data.clips.map((c) => {
      const mine = S.results[c.n];
      return h('button.arc', {
        onclick: () => {
          closeSheet();
          setTimeout(() => ctx.act.openClip(c.n), 60);
        },
      },
      h('div.th', { style: { 'background-image': `url(https://i.ytimg.com/vi/${c.yt}/${c.ar < 1 ? 'oar2' : 'mqdefault'}.jpg)` } }),
      h('div', h('div.t', c.title), h('div.d', `#${c.n} · ${c.n === data.today ? t('today') : fmtDay(c.day)} · ${t('lines', { n: c.count })}`)),
      mine ? h('div.s.' + band(mine.score) + '-t', String(mine.score)) : h('div.s.no', t('not_done')));
    })));
  });
}

// ------------------------------------------------------------------ account

export function openAccount() {
  open(t('account'), (body) => {
    const u = S.user;
    const acc = h('div.panel');
    if (signedIn()) {
      acc.append(
        h('div.set', h('div', t('logged_as', { email: u.email || u.name || '' }))),
        h('button.set', {
          onclick: async () => {
            try {
              const p = await api('/api/me/name', { method: 'POST', body: { showName: !u.showName } });
              S.user = p.user;
              save();
              ctx.stats = {};
              refresh();
            } catch { toast(t('net_fail')); }
          },
        }, h('div', t('show_name'), h('small', t('show_name_sub', { alias: u.alias }))), h('span.sw' + (u.showName ? '.on' : ''))));
    } else if (loginAvailable()) {
      const g = h('div.gbtn', { style: { 'justify-content': 'flex-start' } });
      acc.append(h('p.lead', t('login_google')), h('p.sub', t('login_sub')), g);
      setTimeout(() => googleButton(g), 0);
      if (u) acc.append(h('p.note', t('rank_as', { alias: u.alias })));
    } else if (u) acc.append(h('p.note', { style: { margin: 0 } }, t('rank_as', { alias: u.alias })));
    if (acc.childNodes.length) body.append(acc);

    body.append(tierPanel(refresh));

    body.append(h('div.panel',
      h('button.set', {
        onclick: () => {
          setLang(lang() === 'es' ? 'en' : 'es');
          ctx.act.refreshTop();
          window.dispatchEvent(new CustomEvent('dc:profile'));
          $('.sheet h2').textContent = t('account');
        },
      }, h('div', t('language')), h('span.val', lang() === 'es' ? 'Español' : 'English')),
      h('button.set', {
        onclick: () => {
          S.sound = !S.sound;
          save();
          refresh();
        },
      }, h('div', t('sound_fx')), h('span.sw' + (S.sound ? '.on' : '')))));

    const misc = h('div.panel');
    if (signedIn()) {
      misc.append(h('button.set', {
        onclick: async () => {
          await logout();
          closeSheet();
        },
      }, t('logout')));
    }
    if (u || resultList().length) {
      misc.append(h('button.set.danger', {
        onclick: async () => {
          if (!confirm(t('delete_confirm'))) return;
          try {
            await deleteAccount();
            toast(t('deleted'));
            closeSheet();
          } catch (e) {
            if (e.status === 401) {
              resetIdentity();
              window.dispatchEvent(new CustomEvent('dc:profile'));
              closeSheet();
            } else toast(t('net_fail'));
          }
        },
      }, t('delete')));
    }
    if (misc.childNodes.length) body.append(misc);
    const q = lang() === 'en' ? '?l=en' : '';
    body.append(h('div.links', h('a', { href: '/privacy/' + q }, t('privacy')), h('a', { href: '/terms/' + q }, t('terms'))));
  });
}

// ------------------------------------------------------------------ browsers that cannot listen

export function openBlocked() {
  open(t('blocked_title'), (body) => {
    const url = location.href;
    const inApp = isInApp();
    const panel = h('div.panel', h('p.sub', { style: { margin: '0 0 14px', 'font-size': '15px', color: 'var(--ink)' } }, t(inApp ? 'blocked_inapp' : 'blocked_browser')));
    const btns = h('div.cta', { style: { 'margin-top': 0 } });
    if (isAndroid()) {
      btns.append(h('a.btn.pri', { href: `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end` }, icon('out'), t('open_chrome')));
    } else if (isIOS()) {
      btns.append(h('a.btn.pri', { href: 'x-safari-' + url }, icon('out'), t('open_safari')));
    }
    btns.append(h('button.btn', {
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast(t('copied'));
        } catch {
          window.prompt('', url);
        }
      },
    }, t('copy_link')));
    panel.append(btns);
    if (inApp) panel.append(h('p.note', t(isIOS() ? 'open_hint_ios' : 'open_hint_android')));
    body.append(panel, tierPanel(refresh, { only: 'alt' }));
  });
}

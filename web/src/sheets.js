// One bottom sheet with four tabs (You · Ranking · Clips · Account), plus the "this browser can't listen" help.
import { h, $, icon, toast } from './dom.js';
import { S, save, streak, resultList, addDays, resetIdentity } from './store.js';
import { api } from './api.js';
import { ctx, currentDay, isInApp, isIOS, isAndroid } from './ctx.js';
import { t, lang, setLang, fmtDay } from './i18n.js';
import { band } from './words.js';
import { standing } from './result.js';
import { shareClip } from './share.js';
import { googleButton, loginAvailable, signedIn, logout, deleteAccount } from './auth.js';
import { tierPanel, soundsPanel } from './levels.js';

let current = null;

const TABS = [['you', 'you_tab', statsTab], ['rank', 'ranking', rankTab], ['clips', 'clips', clipsTab], ['acct', 'account', accountTab]];

function open(build, { title = null, tab = null } = {}) {
  const had = !!current;
  if (had) closeSheet(true); // reuse the history entry of the sheet being replaced
  const body = h('div.body');
  const shade = h('div.shade', { onclick: () => closeSheet() });
  const head = h('div.sh',
    title ? h('h2', title) : h('div.tabs', TABS.map(([id, label]) => h('button.tab' + (id === tab ? '.on' : ''), { 'data-tab': id, onclick: () => openHub(id) }, t(label)))),
    h('button.icon', { onclick: () => closeSheet(), 'aria-label': 'close', id: 'closesheet' }, icon('close')));
  const sheet = h('div.sheet' + (title ? '.auto' : ''), { role: 'dialog', 'aria-label': title || 'DailyClips' }, h('div.grab'), head, body);
  $('#sheets').append(shade, sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    shade.classList.add('in');
    sheet.classList.add('in');
  }));
  if (!had) history.pushState({ sheet: true }, '');
  current = { shade, sheet, body, build, tab };
  dragToClose(sheet, head);
  build(body);
  return body;
}

/** Opens the sheet on a tab, or just switches tab when it is already open. */
function openHub(tab) {
  const build = TABS.find((x) => x[0] === tab)[2];
  if (current && current.tab) {
    current.tab = tab;
    current.build = build;
    current.sheet.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    current.body.scrollTop = 0;
    current.body.textContent = '';
    build(current.body);
    return;
  }
  open(build, { tab });
}

export const openStats = () => openHub('you');
export const openRank = () => openHub('rank');
export const openArchive = () => openHub('clips');
export const openAccount = () => openHub('acct');

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
window.addEventListener('dc:profile', () => {
  if (current && current.tab) current.sheet.querySelectorAll('.tab').forEach((b) => { b.textContent = t(TABS.find((x) => x[0] === b.dataset.tab)[1]); });
  refresh();
});

const blk = (label, ...kids) => h('div.blk', label ? h('div.lbl', label) : null, kids);

// ------------------------------------------------------------------ you: streak, calendar, trend, sounds

function chart(list) {
  const W = 320, H = 120, pad = 8;
  const n = list.length;
  const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => pad + ((100 - v) / 100) * (H - 2 * pad);
  const pts = list.map((r, i) => `${x(i).toFixed(1)},${y(r.score).toFixed(1)}`);
  const area = `M${pts[0]} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  const dots = list.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.score).toFixed(1)}" r="${i === n - 1 ? 5 : 3}" fill="${i === n - 1 ? 'var(--good)' : '#11120e'}" stroke="var(--good)" stroke-width="2"/>`).join('');
  const grid = [0, 50, 100].map((v) => `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(246,244,236,.14)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>`).join('');
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9f33f" stop-opacity=".26"/><stop offset="1" stop-color="#b9f33f" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#ga)"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--good)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
  return h('div', { html: svg });
}

function calendar(today) {
  const byDay = {};
  for (const r of resultList()) if (r.onDay) byDay[r.day] = r.score;
  const d = new Date(today + 'T12:00:00Z');
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
  const first = addDays(monday, -28);
  // five weeks of squares, Monday first: coloured = done that day, outlined = today
  const cal = h('div.cal', { 'aria-hidden': 'true' });
  for (let i = 0; i < 35; i++) {
    const day = addDays(first, i);
    const cls = (byDay[day] != null ? '.' + band(byDay[day]) : '') + (day === today ? '.today' : '') + (day > today ? '.fut' : '');
    cal.append(h('i' + cls));
  }
  return cal;
}

function statsTab(body) {
  const today = currentDay();
  const st = streak(today);
  const list = resultList().slice().sort((a, b) => a.at - b.at);
  const last7 = list.slice(-7);
  const avg = last7.length ? Math.round(last7.reduce((a, r) => a + r.score, 0) / last7.length) : null;
  const fact = (v, label, k) => h('div', { 'data-k': k }, h('b', String(v)), h('span.lbl', label));
  body.append(h('div.blk',
    h('p.say', { 'data-k': 'streak', 'data-v': st.current }, icon('flame'), st.current > 1 ? t('streak_n', { n: st.current }) : st.current === 1 ? t('streak_1') : t('no_streak')),
    h('div.facts', fact(st.best, t('best_streak'), 'best'), fact(list.length, t('done_clips'), 'clips'), fact(avg == null ? '–' : avg, t('avg7'), 'avg'))));
  body.append(blk(t('cal'), calendar(today)));
  if (list.length >= 2) { // one clip makes no trend: the chart waits for the second
    const k = Math.min(5, Math.floor(list.length / 2));
    const mean = (a) => Math.round(a.reduce((s, r) => s + r.score, 0) / a.length);
    const a = mean(list.slice(-k)), b = mean(list.slice(-2 * k, -k));
    body.append(blk(t('evo'), chart(list.slice(-30)), h('p.note', a > b ? t('evo_trend_up', { k, a, d: a - b }) : t('evo_trend_down', { k, a }))));
  }
  body.append(soundsPanel(list, () => openAccount()));
}

// ------------------------------------------------------------------ ranking: today and this week

function rankList(rows, meId) {
  // equal scores share a place (1, 1, 3), the same way the "you're #n" line counts
  // his own account also sees which players are invented (the server only marks them for him)
  const admin = !!(S.user && S.user.admin);
  let pos = 0;
  return h('ol.list', rows.map((r, i) => {
    if (!i || r.score !== rows[i - 1].score) pos = i + 1;
    return h('li.rk' + (r.u === meId ? '.me' : ''),
      h('span.pos' + (pos === 1 ? '.first' : ''), String(pos)),
      h('span.nm', r.name + (r.u === meId ? ` (${t('you').toLowerCase()})` : ''),
        admin && r.seed ? h('small.sd', t('seeded_chip')) : null,
        r.days ? h('small', t(r.days === 1 ? 'clips_1' : 'clips_n', { n: r.days })) : null),
      h('span.sc', String(r.score)));
  }));
}

let rankView = 'day';

async function rankTab(body) {
  const pick = h('div.pick', [['day', ctx.clip.n === ctx.today ? t('today') : fmtDay(ctx.clip.day)], ['week', t('week')]].map(([id, label]) =>
    h('button' + (rankView === id ? '.on' : ''), { 'data-rank': id, onclick: () => { rankView = id; refresh(); } }, label)));
  body.append(pick);
  const meId = S.user && S.user.id;
  if (rankView === 'week') {
    let wk;
    try {
      wk = await api('/api/rank/week');
    } catch {
      return body.append(h('div.empty', t('net_fail')));
    }
    if (!wk.top.length) return body.append(h('div.empty', { html: t('week_empty') }));
    body.append(rankList(wk.top, meId));
    if (wk.seeded != null) body.append(h('p.note', t('seeded_note', { n: wk.seeded, real: wk.count - wk.seeded })));
    return;
  }
  const n = ctx.clip.n, mine = S.results[n];
  let stats;
  try {
    stats = ctx.stats[n] = await api('/api/stats/' + n);
  } catch {
    return body.append(h('div.empty', t('net_fail')));
  }
  if (!stats.count) return body.append(h('div.empty', { html: t('rank_empty') }));
  if (mine) {
    const st = standing(stats, mine.score);
    const total = Math.max(st.total, st.pos);
    body.append(h('p.lead', { html: total > 1 ? t('among', { pos: st.pos, n: total }) : t('among_1') }));
  } else body.append(h('p.lead', t('rank_join')));
  body.append(rankList(stats.top, meId));
  if (stats.seeded != null) body.append(h('p.note', t('seeded_note', { n: stats.seeded, real: stats.real })));
  if (stats.count < 3) body.append(h('div.cta', h('button.btn.sm', { onclick: shareClip }, icon('share'), t('share_clip'))));
}

// ------------------------------------------------------------------ clips: today's and the earlier ones

async function clipsTab(body) {
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
    h('div', h('div.t', c.title), h('div.d', c.n === data.today ? t('today') : fmtDay(c.day))),
    mine ? h('div.s.' + band(mine.score) + '-t', String(mine.score)) : h('div.s.no', { 'aria-label': t('not_done') }, icon('play')));
  })));
}

// ------------------------------------------------------------------ account: sign-in, scoring level, settings

function accountTab(body) {
  const u = S.user;
  const acc = h('div.blk');
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
    const g = h('div.gbtn');
    acc.append(h('p.lead', t('login_google')), h('p.sub', t('login_sub')), g);
    setTimeout(() => googleButton(g), 0);
    if (u) acc.append(h('p.note', t('rank_as', { alias: u.alias })));
  } else if (u) acc.append(h('p.note', { style: { margin: 0 } }, t('rank_as', { alias: u.alias })));
  if (acc.childNodes.length) body.append(acc);

  body.append(tierPanel(refresh));

  body.append(blk(null,
    h('button.set', {
      onclick: () => {
        setLang(lang() === 'es' ? 'en' : 'es');
        ctx.act.refreshTop();
        window.dispatchEvent(new CustomEvent('dc:profile'));
      },
    }, h('div', t('language')), h('span.val', lang() === 'es' ? 'Español' : 'English')),
    h('button.set', {
      onclick: () => {
        S.sound = !S.sound;
        save();
        refresh();
      },
    }, h('div', t('sound_fx')), h('span.sw' + (S.sound ? '.on' : ''))),
    signedIn() ? h('button.set', {
      onclick: async () => {
        await logout();
        closeSheet();
      },
    }, t('logout')) : null,
    u || resultList().length ? h('button.set.danger', {
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
    }, t('delete')) : null));
  const q = lang() === 'en' ? '?l=en' : '';
  body.append(h('div.links', h('a', { href: '/privacy/' + q }, t('privacy')), h('a', { href: '/terms/' + q }, t('terms'))));
}

// ------------------------------------------------------------------ browsers that cannot listen

export function openBlocked() {
  open((body) => {
    const url = location.href;
    const inApp = isInApp();
    const btns = h('div.cta', { style: { 'margin-top': '14px' } });
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
    body.append(h('div.blk', h('p.sub', { style: { margin: 0, 'font-size': '15px', color: 'var(--ink)' } }, t(inApp ? 'blocked_inapp' : 'blocked_browser')), btns,
      inApp ? h('p.note', t(isIOS() ? 'open_hint_ios' : 'open_hint_android')) : null), tierPanel(refresh, { only: 'alt' }));
  }, { title: t('blocked_title') });
}

// The screen you land on after a clip: score, streak, where you fall among everyone, share, what's next.
import { h, $, icon, countUp } from './dom.js';
import { S, streak, addDays } from './store.js';
import { api } from './api.js';
import { ctx, now, currentDay } from './ctx.js';
import { t, fmtDay, lang } from './i18n.js';
import { band } from './words.js';
import { shareResult } from './share.js';
import { googleButton, oneTap, loginAvailable, signedIn } from './auth.js';
import { openStats, openRank, openArchive } from './sheets.js';

let el = null, timer = 0;

export function hideResult() {
  clearInterval(timer);
  if (el) el.remove();
  el = null;
}

const verdict = (s) => t(s >= 90 ? 'v90' : s >= 80 ? 'v80' : s >= 65 ? 'v65' : s >= 45 ? 'v45' : 'v0');

/** Position among everyone who did the clip, from the sparse {score: people} table. */
export function standing(stats, score) {
  let above = 0, below = 0, total = 0;
  for (const [k, v] of Object.entries(stats.scores || {})) {
    total += v;
    if (Number(k) > score) above += v;
    if (Number(k) < score) below += v;
  }
  return { pos: above + 1, total, below };
}

/** Everyone's score on a 0-100 line: one dot per person while they are few, bars when they are many. */
export function strip(stats, { me = null, vs = null } = {}) {
  const box = h('div.strip', h('div.axis'));
  for (const v of [0, 50, 100]) box.append(h('span.tick', { style: { left: v + '%' } }, String(v)));
  const people = [];
  for (const [k, v] of Object.entries(stats.scores || {})) for (let i = 0; i < v; i++) people.push(Number(k));
  if (me != null && !people.includes(me)) people.push(me);
  people.sort((a, b) => a - b);
  if (people.length > 40) {
    const bins = new Array(10).fill(0);
    for (const p of people) bins[Math.min(9, Math.floor(p / 10))]++;
    const max = Math.max(...bins);
    bins.forEach((b, i) => box.append(h('div.bar' + (me != null && Math.min(9, Math.floor(me / 10)) === i ? '.me' : ''),
      { style: { left: i * 10 + '%', height: Math.round((b / max) * 32) + 'px' } })));
    return box;
  }
  const rows = [];
  let meDone = false, vsDone = false;
  for (const p of people) {
    let r = 0;
    while (rows[r] != null && p - rows[r] < 3.4 && r < 2) r++;
    rows[r] = p;
    let cls = '';
    if (!meDone && p === me) { cls = '.me'; meDone = true; } else if (!vsDone && p === vs) { cls = '.vs'; vsDone = true; }
    box.append(h('div.dot' + cls, { style: { left: p + '%', bottom: 14 + r * 11 + (cls === '.me' ? -2 : 0) + 'px' } }));
  }
  return box;
}

function weekDots() {
  const today = currentDay();
  const d = new Date(today + 'T12:00:00Z');
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
  const done = streak(today).days;
  const names = t('dow');
  return h('div.week', [...names].map((c, i) => {
    const day = addDays(monday, i);
    return h('div' + (done.has(day) ? '.d' : '') + (day === today ? '.t' : ''), h('i'), c);
  }));
}

function peoplePanel(box) {
  const clip = ctx.clip, rec = S.results[clip.n], stats = ctx.stats[clip.n];
  box.textContent = '';
  box.append(h('h3', t('everyone'), h('button', { onclick: () => openRank() }, t('ranking'))));
  if (!stats) return box.append(h('p.sub', '…'));
  const st = standing(stats, rec.score);
  const total = Math.max(st.total, 1);
  if (total <= 1) {
    box.append(h('p.lead', t('only_you')), strip(stats, { me: rec.score, vs: ctx.vs && ctx.vs.score }));
    return;
  }
  box.append(h('p.lead', { html: t('rank_of', { pos: st.pos, n: total }) }),
    h('p.sub', [total >= 20 && st.below ? t('better_than', { p: Math.round((st.below / (total - 1)) * 100) }) : null,
      t(clip.n === ctx.today ? 'people_today' : 'people_did', { n: total }), stats.avg != null ? t('avg', { n: stats.avg }) : null].filter(Boolean).join(' · ')),
    strip(stats, { me: rec.score, vs: ctx.vs && ctx.vs.score }));
}

function duelPanel(rec) {
  const vs = ctx.vs;
  if (!vs || vs.n !== ctx.clip.n || (S.user && vs.id === rec.id) || vs.id === rec.id) return null;
  const d = rec.score - vs.score;
  const head = d > 0 ? t('duel_win', { name: vs.name, d }) : d < 0 ? t('duel_lose', { name: vs.name, d: -d }) : t('duel_tie', { name: vs.name });
  const grid = h('div.duel');
  rec.phrases.forEach((a, i) => {
    const b = vs.phrases[i] ?? 0;
    grid.append(h('div.a', String(a), h('i', { style: { width: Math.max(4, a * 0.9) + 'px' } })), h('div.k', String(i + 1)),
      h('div.b', h('i', { style: { width: Math.max(4, b * 0.9) + 'px' } }), String(b)));
  });
  return h('div.panel', h('h3', `${t('you')} ${rec.score} · ${vs.name} ${vs.score}`), h('p.lead', head), grid);
}

function nextPanel() {
  const clip = ctx.clip;
  if (clip.n !== ctx.today) {
    const todayDone = S.results[ctx.today];
    return h('div.panel', h('div.row', h('div', h('p.lead', t('today_clip')), h('p.sub', todayDone ? t('done_already', { score: todayDone.score }).replace(/<\/?b>/g, '') : t('streak_late'))),
      h('button.btn.sm.pri', { style: { flex: 'none', padding: '0 18px' }, onclick: () => ctx.act.openClip(ctx.today) }, t('go'))));
  }
  const count = h('div.count', '--:--:--');
  const wrap = h('div.panel', h('div.next',
    ctx.teaser ? h('div.th', { style: { 'background-image': `url(https://i.ytimg.com/vi/${ctx.teaser.yt}/${ctx.teaser.ar < 1 ? 'oar2' : 'mqdefault'}.jpg)` } }) : null,
    h('div', h('h3', { style: { margin: '0 0 8px' } }, t('next_in')), count)));
  const tick = () => {
    const left = Math.max(0, ctx.nextAt - now());
    if (left <= 0) {
      clearInterval(timer);
      wrap.textContent = '';
      wrap.append(h('div.row', h('p.lead', t('new_clip')), h('button.btn.sm.pri', { style: { flex: 'none', padding: '0 18px' }, onclick: () => location.assign('/') }, t('go'))));
      return;
    }
    const s = Math.floor(left / 1000), p = (n) => String(n).padStart(2, '0');
    count.textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  };
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  tick();
  return wrap;
}

export function showResult({ fresh = false, practiceScore = null, keepScroll = false } = {}) {
  const clip = ctx.clip, rec = S.results[clip.n];
  if (!rec) return;
  const scroll = el ? el.scrollTop : 0;
  hideResult();
  const st = streak(currentDay());
  const big = h('span', fresh ? '0' : String(rec.score));
  const people = h('div.panel');

  const streakText = st.current > 1 ? t('streak_n', { n: st.current }) : st.current === 1 ? t('streak_1') : t(rec.onDay ? 'streak_none' : 'streak_late');
  el = h('div.result', { id: 'result' },
    h('div.rhead',
      h('div.kicker', clip.n === ctx.today ? `${t('today_clip')} · #${clip.n}` : t('past_clip', { n: clip.n, date: fmtDay(clip.day) })),
      h('div.big.' + band(rec.score) + '-t', big, h('sup', '/100')),
      h('p.verdict', practiceScore != null ? `${t('practice_mode')} (${practiceScore})` : verdict(rec.score))),
    h('div.rsegs', rec.phrases.map((v, i) => h('div.rseg.' + band(v), { style: { '--i': i } }, h('i'), String(v)))),
    h('div.cta', h('button.btn.pri', { onclick: shareResult, id: 'share' }, icon('share'), t('share'))),
    duelPanel(rec),
    h('div.panel', h('h3', t('streak'), h('button', { onclick: () => openStats() }, t('stats'))),
      h('div.row.streakrow', h('div', h('div.n', icon('flame'), String(st.current)), h('div.l', streakText + (st.best > st.current ? ' · ' + t('streak_best', { n: st.best }) : ''))), weekDots())),
    people,
    nextPanel(),
    loginAvailable() && !signedIn()
      ? h('div.panel', { id: 'loginpanel' }, h('p.lead', t('save_streak')), h('p.sub', t('save_sub')), h('div.gbtn', { id: 'gbtn' }))
      : null,
    h('div.links',
      h('button', { onclick: () => ctx.act.practice() }, t('practice_again')),
      h('button', { onclick: () => openArchive() }, t('past_clips'))),
    h('div.links', { style: { 'margin-top': '6px' } },
      clip.src ? h('a', { href: `https://www.youtube.com/watch?v=${clip.yt}`, target: '_blank', rel: 'noopener' }, t('src', { ch: clip.src })) : null,
      h('a', { href: `/privacy/${lang() === 'en' ? '?l=en' : ''}` }, t('privacy')), h('a', { href: `/terms/${lang() === 'en' ? '?l=en' : ''}` }, t('terms'))));
  $('#app').append(el);
  if (keepScroll) el.scrollTop = scroll;
  if (fresh) countUp(big, rec.score, 1100);
  peoplePanel(people);
  if (!ctx.stats[clip.n]) {
    api('/api/stats/' + clip.n).then((s) => {
      ctx.stats[clip.n] = s;
      if (el) peoplePanel(people);
    }).catch(() => {});
  }
  const g = $('#gbtn', el);
  if (g) {
    googleButton(g);
    if (fresh) setTimeout(oneTap, 1800);
  }
}

window.addEventListener('dc:profile', () => {
  if (el && ctx.clip) (S.results[ctx.clip.n] ? showResult({ keepScroll: true }) : ctx.act.rerender());
});

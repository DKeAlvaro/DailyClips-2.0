// What you get after a clip: a ticket with your score, then the reasons to come back and compare.
// Order on screen: ticket (score, lines, streak, tomorrow) -> share -> where you stand -> challenge -> keep it.
import { h, $, icon, countUp } from './dom.js';
import { S, streak, addDays } from './store.js';
import { api } from './api.js';
import { ctx, now, currentDay } from './ctx.js';
import { t, fmtDay, lang } from './i18n.js';
import { band } from './words.js';
import { shareResult } from './share.js';
import { googleButton, oneTap, loginAvailable, signedIn } from './auth.js';
import { openRank, openArchive } from './sheets.js';

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
    box.append(h('div.dot' + cls, { style: { left: p + '%', bottom: 12 + r * 12 + (cls === '.me' ? -2 : 0) + 'px' } }));
  }
  return box;
}

/** This week, Monday to Sunday: a punched hole for every day done. */
function weekDots() {
  const today = currentDay();
  const d = new Date(today + 'T12:00:00Z');
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
  const done = streak(today).days;
  return h('div.week', [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const day = addDays(monday, i);
    return h('i' + (done.has(day) ? '.d' : '') + (day === today ? '.t' : ''));
  }));
}

/** Right half of the ticket stub: the countdown to tomorrow's clip, or the way back to today's. */
function tomorrow() {
  if (ctx.clip.n !== ctx.today) {
    return h('div.r', h('button.btn.sm', { style: { color: 'var(--pink)', 'border-color': 'var(--pink)', padding: '0 14px', flex: 'none' }, onclick: () => ctx.act.openClip(ctx.today) }, t('today_clip'), icon('next')));
  }
  const count = h('div.count', '--:--:--');
  const box = h('div.r', h('div.lbl', t('next_in')), count);
  const tick = () => {
    const left = Math.max(0, ctx.nextAt - now());
    if (left <= 0) {
      clearInterval(timer);
      box.textContent = '';
      box.append(h('button.btn.sm', { style: { color: 'var(--pink)', 'border-color': 'var(--pink)', padding: '0 14px' }, onclick: () => location.assign('/') }, t('new_clip'), icon('next')));
      return;
    }
    const s = Math.floor(left / 1000), p = (n) => String(n).padStart(2, '0');
    count.textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
  };
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  tick();
  return box;
}

function ticket(rec, { fresh, practiceScore }) {
  const clip = ctx.clip, st = streak(currentDay());
  const big = h('span.big' + (band(rec.score) === 'c' ? '.c-h' : band(rec.score) === 'm' ? '.m-h' : ''), fresh ? '0' : String(rec.score));
  const tierName = { web: 'web', dev: lang() === 'es' ? 'dispositivo' : 'device', pro: 'pro' }[rec.tier] || 'web';
  const node = h('div.ticket', { id: 'ticket' },
    h('div.thead', h('span.lbl', 'DailyClips · ' + fmtDay(clip.day, { day: 'numeric', month: 'short', year: 'numeric' })), h('span.lbl', 'Nº ' + String(clip.n).padStart(3, '0'))),
    h('div.ttitle', clip.title),
    h('div.tscore', big, h('small', '/100 · ' + t('ticket_level', { l: tierName }))),
    h('div.verdict.' + band(rec.score), practiceScore != null ? `${t('practice_again')}: ${practiceScore}` : verdict(rec.score)),
    h('div.rsegs', rec.phrases.map((v, i) => h('div.rseg.' + band(v), { style: { '--i': i } }, h('i'), String(v)))),
    h('div.tear'),
    h('div.stub',
      h('div', h('div.lbl', st.current > 1 ? t('streak_n', { n: st.current }) : st.current === 1 ? t('streak_1') : t('no_streak')),
        h('div.n', icon('flame'), String(st.current), weekDots())),
      tomorrow()));
  return { node, big };
}

function standingSection(box) {
  const clip = ctx.clip, rec = S.results[clip.n], stats = ctx.stats[clip.n];
  box.textContent = '';
  if (!stats) return;
  const st = standing(stats, rec.score);
  const total = Math.max(st.total, 1);
  box.append(h('h3', { html: total <= 1 ? t('among_1') : t('among', { pos: st.pos, n: total }) }));
  if (total > 1) {
    box.append(h('p.sub', [total >= 20 && st.below ? t('better_than', { p: Math.round((st.below / (total - 1)) * 100) }) : null,
      stats.avg != null ? t('avg', { n: stats.avg }) : null].filter(Boolean).join(' · ')));
  }
  box.append(strip(stats, { me: rec.score, vs: ctx.vs && ctx.vs.score }), h('button.more', { onclick: () => openRank() }, t('see_ranking') + ' →'));
}

function duelSection(rec) {
  const vs = ctx.vs;
  if (!vs || vs.n !== ctx.clip.n || vs.id === rec.id) return null;
  const d = rec.score - vs.score;
  const head = d > 0 ? t('duel_win', { name: vs.name, d }) : d < 0 ? t('duel_lose', { name: vs.name, d: -d }) : t('duel_tie', { name: vs.name });
  const grid = h('div.duel');
  rec.phrases.forEach((a, i) => {
    const b = vs.phrases[i] ?? 0;
    grid.append(h('div.a', String(a), h('i', { style: { width: Math.max(4, a * 0.9) + 'px' } })), h('div.k', String(i + 1)),
      h('div.b', h('i', { style: { width: Math.max(4, b * 0.9) + 'px' } }), String(b)));
  });
  return h('div.sec', h('h3', head), h('p.sub', `${t('you')} ${rec.score} · ${vs.name} ${vs.score}`), grid);
}

export function showResult({ fresh = false, practiceScore = null, keepScroll = false } = {}) {
  const clip = ctx.clip, rec = S.results[clip.n];
  if (!rec) return;
  const scroll = el ? el.scrollTop : 0;
  hideResult();
  const tk = ticket(rec, { fresh, practiceScore });
  const stand = h('div.sec');
  const q = lang() === 'en' ? '?l=en' : '';
  el = h('div.result', { id: 'result' },
    tk.node,
    h('div.cta', h('button.btn.pri', { onclick: shareResult, id: 'share' }, icon('share'), t('share'))),
    stand,
    duelSection(rec),
    loginAvailable() && !signedIn()
      ? h('div.sec', { id: 'loginpanel' }, h('h3', t('save_streak')), h('p.sub', t('save_sub')), h('div.gbtn', { id: 'gbtn' }))
      : null,
    h('div.links',
      h('button', { onclick: () => ctx.act.practice() }, t('practice_again')),
      h('button', { onclick: () => openArchive() }, t('past_clips')),
      clip.src ? h('a', { href: `https://www.youtube.com/watch?v=${clip.yt}`, target: '_blank', rel: 'noopener' }, t('src', { ch: clip.src })) : null,
      h('a', { href: '/privacy/' + q }, t('privacy')), h('a', { href: '/terms/' + q }, t('terms'))));
  $('#app').append(el);
  if (keepScroll) {
    el.scrollTop = scroll;
    tk.node.style.animation = 'none';
    el.querySelectorAll('.verdict, .rseg i').forEach((n) => { n.style.animation = 'none'; });
  }
  if (fresh) countUp(tk.big, rec.score, 1100);
  standingSection(stand);
  if (!ctx.stats[clip.n]) {
    api('/api/stats/' + clip.n).then((s) => {
      ctx.stats[clip.n] = s;
      if (el) standingSection(stand);
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

// What you get after a clip: a card with your score, then the reasons to come back and compare.
// Order on screen: score card (score, lines, streak, tomorrow) -> share -> where you stand -> challenge -> keep it.
import { h, $, icon, countUp } from './dom.js';
import { S, streak, addDays } from './store.js';
import { api } from './api.js';
import { ctx, now, currentDay } from './ctx.js';
import { t } from './i18n.js';
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
  const box = h('div.strip', h('div.axis'), h('span.tick', '0'), h('span.tick.end', '100'));
  const x = (v) => 3 + v * 0.94 + '%'; // 0-100 on 3-97 %, so a dot at either end stays whole
  const people = [];
  for (const [k, v] of Object.entries(stats.scores || {})) for (let i = 0; i < v; i++) people.push(Number(k));
  if (me != null && !people.includes(me)) people.push(me);
  people.sort((a, b) => a - b);
  if (people.length > 40) {
    const bins = new Array(10).fill(0);
    for (const p of people) bins[Math.min(9, Math.floor(p / 10))]++;
    const max = Math.max(...bins);
    bins.forEach((b, i) => box.append(h('div.bar' + (me != null && Math.min(9, Math.floor(me / 10)) === i ? '.me' : ''),
      { style: { left: x(i * 10), height: Math.round((b / max) * 32) + 'px' } })));
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
    box.append(h('div.dot' + cls, { style: { left: x(p), bottom: 12 + r * 12 + (cls === '.me' ? -2 : 0) + 'px' } }));
  }
  return box;
}

/** This week, Monday to Sunday: a filled dot for every day done. */
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

/** Right half of the card's last row: the countdown to tomorrow's clip, or the way back to today's. */
function tomorrow() {
  if (ctx.clip.n !== ctx.today) {
    return h('div.r', h('button.btn.sm', { style: { padding: '0 14px', flex: 'none' }, onclick: () => ctx.act.openClip(ctx.today) }, t('today_clip'), icon('next')));
  }
  const count = h('div.count', '--:--:--');
  const box = h('div.r', h('div.k', t('next_in')), count);
  const tick = () => {
    const left = Math.max(0, ctx.nextAt - now());
    if (left <= 0) {
      clearInterval(timer);
      box.textContent = '';
      box.append(h('button.btn.sm', { style: { padding: '0 14px' }, onclick: () => location.assign('/') }, t('new_clip'), icon('next')));
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

function scorecard(rec, { fresh, practiceScore }) {
  const clip = ctx.clip, st = streak(currentDay());
  const big = h('span.big.' + band(rec.score) + '-t', fresh ? '0' : String(rec.score));
  // title, the score in its colour and what it means, one bar per line (taller = better), then streak and the next clip
  const node = h('div.scorecard',
    h('div.ttitle', clip.title),
    h('div.tscore', big, h('div.verdict', practiceScore != null ? t('practice_score', { n: practiceScore }) : verdict(rec.score))),
    h('div.rsegs', { 'aria-hidden': 'true' }, rec.phrases.map((v, i) => h('div.rseg.' + band(v), { style: { '--i': i, '--v': Math.max(8, v) / 100 } }, h('i')))),
    h('div.stub',
      h('div.n', { 'aria-label': t('streak') }, icon('flame'), String(st.current), weekDots()),
      tomorrow()));
  return { node, big };
}

function standingSection(box) {
  const clip = ctx.clip, rec = S.results[clip.n], stats = ctx.stats[clip.n];
  box.textContent = '';
  if (!stats) return;
  const st = standing(stats, rec.score);
  const total = Math.max(st.total, st.pos, 1); // a result still on its way to the server is not in the table yet
  box.append(h('h3', { html: total <= 1 ? t('among_1') : t('among', { pos: st.pos, n: total }) }));
  // alone on the board there is nothing to plot or rank yet
  if (total > 1) box.append(strip(stats, { me: rec.score, vs: ctx.vs && ctx.vs.score }), h('button.more', { onclick: () => openRank() }, t('see_ranking') + ' →'));
}

function duelSection(rec) {
  const vs = ctx.vs;
  if (!vs || vs.n !== ctx.clip.n || vs.id === rec.id) return null;
  const d = rec.score - vs.score;
  const head = d > 0 ? t('duel_win', { name: vs.name, d }) : d < 0 ? t('duel_lose', { name: vs.name, d: -d }) : t('duel_tie', { name: vs.name });
  // line by line, back to back: your bars grow left, theirs right; the totals line doubles as the key
  const grid = h('div.duel', { 'aria-hidden': 'true' });
  rec.phrases.forEach((a, i) => {
    const b = vs.phrases[i] ?? 0;
    grid.append(h('div.a', h('i', { style: { width: Math.max(3, a) + '%' } })), h('div.b', h('i', { style: { width: Math.max(3, b) + '%' } })));
  });
  return h('div.sec', h('h3', head), h('p.sub.vs', h('span.a', `${t('you')} ${rec.score}`), ' · ', h('span.b', `${vs.name} ${vs.score}`)), grid);
}

export function showResult({ fresh = false, practiceScore = null, keepScroll = false } = {}) {
  const clip = ctx.clip, rec = S.results[clip.n];
  if (!rec) return;
  const scroll = el ? el.scrollTop : 0;
  hideResult();
  const tk = scorecard(rec, { fresh, practiceScore });
  const stand = h('div.sec');
  el = h('div.result', { id: 'result' },
    tk.node,
    h('div.cta', h('button.btn.pri', { onclick: shareResult, id: 'share' }, icon('share'), t('share'))),
    stand,
    duelSection(rec),
    loginAvailable() && !signedIn()
      ? h('div.sec', { id: 'loginpanel' }, h('h3', t('save_streak')), h('div.gbtn', { id: 'gbtn' }))
      : null,
    h('div.links',
      h('button', { onclick: () => ctx.act.practice() }, t('practice_again')),
      h('button', { onclick: () => openArchive() }, t('past_clips'))));
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

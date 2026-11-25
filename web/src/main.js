import { h, $, clear, icon, toast } from './dom.js';
import { S, save, streak } from './store.js';
import { api, syncResults, refreshMe } from './api.js';
import { YT, posterUrl } from './yt.js';
import { t, lang, fmtDay } from './i18n.js';
import { band } from './words.js';
import { sfx, buzz, scoreFx } from './fx.js';
import { listen, canListen, activeTier, warm } from './tiers.js';
import { ctx, MAX_TAKES, now, currentDay, isIOS } from './ctx.js';
import { showResult, hideResult } from './result.js';
import { openStats, openRank, openArchive, openAccount, openBlocked, closeSheet } from './sheets.js';
import { proReturn } from './billing.js';

const app = $('#app'), stage = $('#stage'), deck = $('#deck'), top = $('#top');
const poster = $('#poster'), backdrop = $('#backdrop'), tapcatch = $('#tapcatch'), ytMount = $('#yt');
let playBtn = null;
let raf = 0;
let startTimer = 0;

// ------------------------------------------------------------------ boot

const boot = JSON.parse($('#boot').textContent);
Object.assign(ctx, {
  cfg: boot.cfg, today: boot.today, day: boot.day, nextAt: boot.nextAt, skew: boot.now - Date.now(), vs: boot.vs, teaser: boot.teaser,
});
document.documentElement.lang = lang();
ctx.act = { loadClip, openClip, practice, refreshTop: renderTop, rerender };


window.addEventListener('resize', layoutStage);
window.addEventListener('popstate', () => {
  if (closeSheet(true)) return;
  const m = /^\/c\/(\d+)/.exec(location.pathname);
  const n = m ? Number(m[1]) : ctx.today;
  if (ctx.clip && n !== ctx.clip.n) openClip(n, { push: false });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ctx.session && ctx.session.handle) ctx.session.handle.stop();
  if (!document.hidden) syncResults();
});
window.addEventListener('online', () => syncResults());

// ------------------------------------------------------------------ clip loading

async function openClip(n, { push = true } = {}) {
  try {
    const r = await api('/api/clip/' + n);
    ctx.vs = null;
    loadClip(r.clip, { count: r.count, push });
  } catch {
    toast(t('net_fail'));
  }
}

function loadClip(clip, { count = 0, initial = false, push = true } = {}) {
  cancelAnimationFrame(raf);
  clearTimeout(startTimer);
  if (ctx.session && ctx.session.handle) ctx.session.handle.stop();
  if (ctx.player) ctx.player.destroy();
  hideResult();
  ctx.session = null;
  ctx.clip = clip;
  ctx.count = count;
  ctx.units = clip.phrases.map((p, idx) => ({ ...p, idx })).filter((p) => !p.skip);
  const path = clip.n === ctx.today && !ctx.vs ? '/' : '/c/' + clip.n + (ctx.vs ? location.search : '');
  if (!initial && push && location.pathname !== path) history.pushState({ n: clip.n }, '', path);

  const img = posterUrl(clip);
  poster.style.backgroundImage = `url(${img})`;
  backdrop.style.backgroundImage = `url(${img})`;
  poster.classList.remove('off');
  app.className = 'app idle loading' + (isIOS() ? ' through' : '');
  ctx.player = new YT(ytMount, {
    id: clip.yt,
    start: clipStart(),
    onReady: () => {
      app.classList.remove('loading');
      app.classList.add('ready');
      if (ctx.wantPlay) tryPlay();
    },
    onState: (st) => {
      if (st === 1 && !ctx.session) beginSession();
      if ((st === 3 || st === 1) && app.classList.contains('idle')) app.classList.add('loading');
    },
    onError: (code) => videoError(code),
  });
  ctx.wantPlay = false;
  layoutStage();
  renderTop();
  rerender();
}

function clipStart() {
  return ctx.clip.start != null ? ctx.clip.start : Math.max(0, ctx.units[0].t0 - 0.6);
}

/** Where the video sits: vertical clips cover the screen unless that would crop too much. */
function layoutStage() {
  if (!ctx.clip) return;
  const W = app.clientWidth, H = app.clientHeight, ar = ctx.clip.ar || 0.5625;
  let w, hh, x, y;
  if (ar < 1) {
    const coverW = Math.max(W, H * ar), coverH = coverW / ar;
    const crop = Math.max((coverW - W) / coverW, (coverH - H) / coverH) / 2;
    if (crop <= 0.07) { w = coverW; hh = coverH; } else { w = Math.min(W, H * ar); hh = w / ar; }
    x = (W - w) / 2;
    y = (H - hh) * (hh > H ? 0.5 : 0.36);
  } else {
    w = W; hh = W / ar; x = 0;
    y = Math.max(74, Math.min(H * 0.17, H - hh - 330));
  }
  for (const el of [ctx.player && ctx.player.iframe, poster]) {
    if (!el) continue;
    Object.assign(el.style, { width: w + 'px', height: hh + 'px', left: x + 'px', top: y + 'px', transform: 'none' });
  }
  ctx.box = { x, y, w, h: hh };
  if (playBtn) Object.assign(playBtn.style, { left: x + w / 2 + 'px', top: Math.min(y + hh / 2, H * 0.46) + 'px' });
}

function videoError(code) {
  api('/api/report', { method: 'POST', body: { n: ctx.clip.n, code: 'yt' + code } }).catch(() => {});
  app.className = 'app done';
  clear(deck, h('div.start', h('div.empty', { html: t('video_fail') }),
    h('div.btns', h('button.btn.pri', { onclick: () => openArchive() }, t('past_clips')))));
  if (playBtn) playBtn.remove();
}

// ------------------------------------------------------------------ top bar

function renderTop() {
  const s = ctx.session;
  const st = streak(currentDay());
  const done = S.results[ctx.clip.n];
  // one segment per line to say: only meaningful once the clip is under way or finished
  const segs = h('div.segs' + (s || (done && !ctx.practiceArmed) ? '' : '.off'), ctx.units.map((u, i) => {
    const v = s ? s.best[i] : done ? done.phrases[i] : null;
    return h('div.seg' + (v != null ? '.' + band(v) : '') + (s && s.i === i && s.state === 'playing' ? '.cur' : ''), h('i'));
  }));
  clear(top, segs, h('div.bar',
    h('button.brand', { onclick: () => ctx.clip.n !== ctx.today && openClip(ctx.today), 'aria-label': 'DailyClips' }, h('div', { html: 'Daily<b>Clips</b>' })),
    h('div.acts',
      h('button.streak' + (st.current ? '.on' : ''), { onclick: () => openStats(), 'aria-label': t('stats'), id: 'streakchip' }, icon('flame'), String(st.current)),
      h('button.icon', { onclick: () => openRank(), 'aria-label': t('menu'), id: 'menu' }, icon('menu')))));
}

// ------------------------------------------------------------------ start screen

function rerender() {
  if (ctx.session) return;
  const clip = ctx.clip, done = S.results[clip.n];
  if (done && !ctx.practiceArmed) {
    app.classList.add('done');
    if (playBtn) playBtn.remove();
    showResult({ fresh: false });
    return clear(deck);
  }
  hideResult();
  app.className = 'app idle ' + (ctx.player && ctx.player.ready ? 'ready' : 'loading') + (isIOS() ? ' through' : '');
  renderStart();
}

function renderStart() {
  const clip = ctx.clip, isToday = clip.n === ctx.today;
  const people = ctx.count === 1 ? t('people_today_1') : ctx.count ? t(isToday ? 'people_today' : 'people_did', { n: ctx.count }) : '';
  const newcomer = !Object.keys(S.results).length && !ctx.vs;
  if (playBtn) playBtn.remove();
  playBtn = h('div.playbtn', { style: { position: 'absolute', transform: 'translate(-50%,-50%)', margin: 0, 'pointer-events': 'none', 'z-index': 3 } }, icon('play'));
  stage.append(playBtn);
  deck.className = 'deck';
  // what it is (kicker, title, where it is from), then either how it works (first visit) or who is in
  clear(deck, h('div.start',
    ctx.vs && h('div.vsline', { html: t('vs_line', { name: ctx.vs.name, score: ctx.vs.score }) }),
    h('div', h('div.kicker', ctx.practiceArmed ? t('practice_mode') : isToday ? `${t('today_clip')} · Nº ${clip.n}` : `Nº ${clip.n} · ${fmtDay(clip.day)}`)),
    h('h1.title', clip.title),
    h('div.meta', [clip.src, t('lines', { n: ctx.units.length }), people].filter(Boolean).join(' · ')),
    newcomer && h('ol.how', h('li', t('how1')), h('li', t('how2')), h('li', t('how3')))));
  layoutStage();
}

// Starting the video. Browsers differ on who may start a video with sound:
//  - Chrome/Android lets the page start the embedded player after any tap on the page, so the tap is
//    caught here and the player is told to play.
//  - iOS only lets a video start from a tap inside the player's own frame, so there the first tap is
//    let through to the YouTube player ("through" mode). Anything that fails to start falls back to it.
tapcatch.addEventListener('click', onStageTap);
stage.addEventListener('click', (e) => {
  if (e.target !== tapcatch) onStageTap();
});
deck.addEventListener('click', (e) => {
  if (app.classList.contains('idle') && !e.target.closest('button')) onStageTap();
});
window.addEventListener('blur', () => {
  // focus moved into the iframe: the tap reached the player
  if (!app.classList.contains('idle') || document.activeElement !== (ctx.player && ctx.player.iframe)) return;
  app.classList.add('loading');
  clearTimeout(startTimer);
  startTimer = setTimeout(() => {
    if (ctx.session || !app.classList.contains('idle')) return;
    ctx.player.cmd('playVideo'); // the player was not listening yet: ask it, then let the next tap through again
    startTimer = setTimeout(() => {
      if (ctx.session || !app.classList.contains('idle')) return;
      app.classList.remove('loading');
      window.focus();
      toast(t('tap_video'));
    }, 1500);
  }, 1300);
});

function onStageTap() {
  if (!app.classList.contains('idle')) return;
  sfx.unlock();
  ctx.wantPlay = true;
  app.classList.add('loading');
  if (ctx.player.ready) tryPlay();
}

function tryPlay() {
  ctx.player.cmd('playVideo');
  clearTimeout(startTimer);
  startTimer = setTimeout(() => {
    if (ctx.session || !app.classList.contains('idle')) return;
    ctx.wantPlay = false;
    app.classList.remove('loading');
    app.classList.add('through');
    toast(t('tap_video'));
  }, 1800);
}

function practice() {
  // replay a clip that already has a score: nothing is saved
  ctx.practiceArmed = true;
  hideResult();
  app.className = 'app idle' + (ctx.player.ready ? ' ready' : ' loading'); // the player already played once: it may be started from here
  poster.classList.remove('off');
  renderStart();
  ctx.player.started = false;
  tryPlay();
}

// ------------------------------------------------------------------ the practice loop

function beginSession() {
  clearTimeout(startTimer);
  const units = ctx.units, clip = ctx.clip;
  const s = (ctx.session = {
    units, i: 0, state: 'playing', practice: !!ctx.practiceArmed || !!S.results[clip.n],
    best: units.map(() => null), detail: units.map(() => null), takes: units.map(() => 0), last: null, handle: null, showing: null,
  });
  ctx.practiceArmed = false;
  if (!s.practice && S.session && S.session.n === clip.n && S.session.best.length === units.length) {
    s.best = S.session.best.slice();
    s.takes = S.session.takes.slice();
    const k = s.best.findIndex((v) => v == null);
    s.i = k < 0 ? units.length - 1 : k;
  }
  if (playBtn) playBtn.remove();
  app.className = 'app play';
  poster.classList.add('off');
  if (!canListen()) openBlocked();
  warm(units[s.i]);
  playUnit(s.i, { first: true });
}

async function playUnit(i, { replay = false, slow = false, first = false } = {}) {
  const s = ctx.session, p = ctx.player, u = s.units[i];
  s.i = i;
  s.state = 'playing';
  s.showing = null;
  app.classList.remove('dim');
  const lead = Math.max(0, u.t0 - 0.18);
  const cur = p.now();
  let from = null;
  if (replay) from = lead;
  else if (first) {
    const st = i === 0 ? clipStart() : lead;
    if (cur < st - 0.3 || cur > st + 1.2) from = st;
  } else {
    const prev = s.units[i - 1];
    if (!(cur >= prev.t1 - 0.5 && cur <= u.t0 + 0.05)) from = lead;
  }
  renderTop();
  renderCard();
  karaoke();
  const why = await p.play({ from, to: u.t1, rate: slow ? 0.75 : 1 });
  if (ctx.session !== s || why !== 'end') return;
  cancelAnimationFrame(raf);
  if (slow) p.cmd('setPlaybackRate', 1);
  p.rate = 1;
  prompt();
}

/** While the video plays: show the line being said and light up its words. */
function karaoke() {
  cancelAnimationFrame(raf);
  const s = ctx.session;
  const loop = () => {
    if (ctx.session !== s || s.state !== 'playing') return;
    const tm = ctx.player.now(), u = s.units[s.i];
    let line = u;
    for (const ph of ctx.clip.phrases) if (ph.skip && tm >= ph.t0 - 0.1 && tm < ph.t1) line = ph;
    if (line !== s.showing) {
      s.showing = line;
      renderCard();
    }
    const spans = deck.querySelectorAll('.w');
    const k = Math.max(0, Math.min(1, (tm - line.t0) / Math.max(0.2, line.t1 - line.t0)));
    if (line.wt) spans.forEach((el, j) => el.classList.toggle('on', tm >= line.wt[j] - 0.04));
    else {
      const total = line.text.length;
      let acc = 0;
      spans.forEach((el) => {
        el.classList.toggle('on', tm >= line.t0 - 0.05 && acc / total <= k);
        acc += el.textContent.length;
      });
    }
    const seg = top.querySelector('.seg.cur');
    if (seg) seg.style.setProperty('--p', line === u ? k : 0);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function prompt(msg) {
  const s = ctx.session;
  s.state = 'prompt';
  app.classList.add('dim');
  renderTop();
  renderCard(msg);
}

async function startListening() {
  const s = ctx.session;
  if (!s || (s.state !== 'prompt' && s.state !== 'feedback')) return;
  if (!canListen()) return openBlocked();
  sfx.unlock();
  buzz(12);
  const u = s.units[s.i];
  s.state = 'listening';
  renderCard();
  const handle = (s.handle = listen(u, {
    maxMs: Math.min(16000, (u.t1 - u.t0) * 2200 + 5000),
    onInterim: (r) => deck.querySelectorAll('.w').forEach((el, j) => el.classList.toggle('hit', !!r.words[j] && r.words[j].c !== 'm')),
    onLevel: (v) => {
      const m = deck.querySelector('.mic');
      if (m) m.style.setProperty('--lvl', v);
    },
    onScoring: () => {
      s.state = 'scoring';
      renderCard();
    },
  }));
  const out = await handle.promise;
  s.handle = null;
  if (ctx.session !== s) return;
  if (!out.ok) {
    if (out.why === 'unsupported') openBlocked();
    const msg = { denied: 'mic_denied', nomic: 'mic_denied', network: 'net_fail', unsupported: 'blocked_title', model: 'model_fail' }[out.why];
    return prompt(t(msg || (String(out.why).startsWith('pro_') ? 'pro_busy' : 'nospeech')));
  }
  const i = s.i;
  s.takes[i]++;
  if (s.best[i] == null || out.score > s.best[i]) {
    s.best[i] = out.score;
    s.detail[i] = out;
  }
  s.last = out;
  s.state = 'feedback';
  if (!s.practice) {
    S.session = { n: ctx.clip.n, best: s.best, takes: s.takes };
    save();
  }
  renderTop();
  renderCard();
  scoreFx(out.score);
}

function next() {
  const s = ctx.session;
  if (s.i + 1 < s.units.length) playUnit(s.i + 1);
  else finish();
}

function finish() {
  const s = ctx.session, clip = ctx.clip;
  cancelAnimationFrame(raf);
  ctx.player.pause();
  const phrases = s.best.map((v) => v || 0);
  const score = Math.round(phrases.reduce((a, v) => a + v, 0) / phrases.length);
  const fresh = !S.results[clip.n] && !s.practice;
  if (fresh) {
    const today = currentDay();
    const sounds = soundTotals(s.detail);
    S.results[clip.n] = { n: clip.n, score, phrases, tier: s.detail.find(Boolean)?.tier || activeTier(), day: today, at: now(), onDay: clip.day === today, synced: false, ...(sounds ? { sounds } : {}) };
    S.session = null;
    save();
  }
  ctx.session = null;
  app.className = 'app done dim';
  clear(deck);
  renderTop();
  sfx.done();
  buzz([20, 60, 20, 60, 40]);
  showResult({ fresh, practiceScore: fresh ? null : score, practicePhrases: fresh ? null : phrases });
  if (fresh) {
    const chip = $('#streakchip');
    if (chip) chip.classList.add('bump');
    syncResults().then((resp) => {
      if (resp && resp.stats) {
        ctx.stats[clip.n] = resp.stats;
        ctx.count = resp.stats.count;
        showResult({ fresh: false, keepScroll: true });
      }
      renderTop();
    });
  }
}

/** { phone: [sum of scores, count] } over the best take of every phrase (phoneme levels only). */
function soundTotals(details) {
  const out = {};
  for (const d of details) {
    if (!d || !d.words) continue;
    for (const w of d.words) for (const ph of w.ph || []) {
      if (ph.s == null) continue;
      const e = out[ph.p] || (out[ph.p] = [0, 0]);
      e[0] += ph.s;
      e[1]++;
    }
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ the phrase card

function renderCard(msg) {
  const s = ctx.session;
  if (!s) return;
  const u = s.units[s.i], mode = s.state, i = s.i;
  const line = mode === 'playing' && s.showing ? s.showing : u;
  const res = mode === 'feedback' ? s.last : null;
  const words = line.text.split(/\s+/).filter(Boolean);
  const tip = h('div.wordtip');
  const phrase = h('p.phrase' + (line.text.length > 64 ? '.long' : '') + (line.skip ? '.ctx' : ''));
  words.forEach((w, j) => {
    const r = res && res.words[j];
    phrase.append(h('span.w' + (r ? '.' + (r.s == null ? 'n' : r.c) : ''), { style: { '--i': j }, onclick: r ? () => showTip(tip, r) : null }, w), j < words.length - 1 ? ' ' : '');
  });
  // takes: three dots, the filled ones are spent
  const takes = (used, label) => h('div.takes', [0, 1, 2].slice(0, MAX_TAKES).map((k) => h('i' + (k < used ? '.used' : ''))), h('span.lbl', label));
  deck.className = 'deck ' + mode + ' t-' + activeTier(u);
  const kids = [phrase];
  if (mode === 'prompt') {
    kids.push(msg || !S.seen.mic ? h('p.hint', { html: msg || t('your_turn') }) : takes(s.takes[i], s.practice ? t('practice_mode') : t('take_of', { a: Math.min(MAX_TAKES, s.takes[i] + 1), b: MAX_TAKES })),
      h('div.ctrl',
        h('button.side', { onclick: () => playUnit(i, { replay: true }), 'aria-label': t('again') }, icon('replay'), h('small', t('again'))),
        h('button.mic', { onclick: startListening, 'aria-label': 'mic', id: 'mic' }, icon('mic')),
        h('button.side', { onclick: () => playUnit(i, { replay: true, slow: true }), 'aria-label': t('slow') }, '0.75×', h('small', t('slow')))));
  } else if (mode === 'listening' || mode === 'scoring') {
    kids.push(h('p.hint', t(mode === 'listening' ? 'listening' : 'scoring')),
      h('div.ctrl', { style: { 'justify-content': 'center' } },
        h('button.mic', { onclick: () => s.handle && s.handle.stop(), 'aria-label': 'stop', id: 'mic' }, icon('stop'))));
  } else if (mode === 'feedback') {
    const left = MAX_TAKES - s.takes[i], last = i === s.units.length - 1;
    const better = s.best[i] > res.score ? ` · ${t('best_is', { n: s.best[i] })}` : '';
    kids.push(
      h('div.fb', h('div.stamp.fbscore.' + band(res.score) + '-t', String(res.score)), tip),
      takes(s.takes[i], s.practice ? t('practice_mode') : `${t('take_of', { a: s.takes[i], b: MAX_TAKES })} · ${t('best_counts')}${better}`),
      h('div.btns',
        h('button.btn', { disabled: !s.practice && left <= 0, onclick: () => playUnit(i, { replay: true }) }, icon('replay'), t('retry')),
        h('button.btn.' + (res.score >= 50 || left <= 0 ? 'pri' : 'wht'), { onclick: next, id: 'next' }, t(last ? 'finish' : 'next'), icon('next'))));
    const worst = res.words.filter((w) => w.c !== 'g' && w.s != null).sort((a, b) => a.s - b.s)[0];
    if (worst) showTip(tip, worst);
    else tip.innerHTML = t('all_good');
    if (!S.seen.mic) {
      S.seen.mic = true;
      save();
    }
  }
  clear(deck, h('div.card', kids));
}

function showTip(tip, w) {
  const word = w.t.replace(/^[^\w']+|[^\w']+$/g, '');
  let html = w.c === 'g' ? t('tip_good', { w: word }) : w.c === 'c' && w.heard ? t('tip_close', { w: word, h: w.heard }) : w.heard ? t('tip_miss_h', { w: word, h: w.heard }) : t('tip_miss', { w: word });
  if (w.rare) html = t('tip_rare', { w: word });
  if (w.ph) {
    html = `<b>${word}</b> · ${w.s}`;
    html += '<br><span class="ph">' + w.ph.map((p) => `<span class="${band(p.s == null ? 100 : p.s)}">${p.p}</span>`).join('') + '</span>';
    const off = w.ph.filter((p) => p.h && p.h !== p.p && p.s != null && p.s < 50).sort((a, b) => a.s - b.s)[0];
    if (off) html += '<br>' + t('tip_heard', { h: off.h, p: off.p });
  }
  tip.innerHTML = html;
}

// ------------------------------------------------------------------ go

loadClip(boot.clip, { count: boot.count, initial: true });
refreshMe().then(() => {
  renderTop();
  if (!ctx.session) rerender();
  proReturn(); // back from the payment page
});

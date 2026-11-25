import { S, streak } from './store.js';
import { ctx, currentDay } from './ctx.js';
import { t, lang } from './i18n.js';
import { toast } from './dom.js';

const square = (v) => (v >= 80 ? '🟩' : v >= 50 ? '🟨' : '🟥');

// Three short lines and the link last: what you did and your score, the grid (plus the streak), and a dare
// that fits the score. Plain text: t() would escape the show's name for HTML.
export function shareText(clip, rec) {
  const st = streak(currentDay());
  const b = rec.score >= 100 ? 'top' : rec.score >= 80 ? 'hi' : rec.score >= 50 ? 'mid' : 'lo';
  const what = clip.src || clip.title;
  return [
    t('share_did_' + (b === 'lo' ? 'lo' : 'hi')).replace('{s}', rec.score).replace('{what}', what),
    rec.phrases.map(square).join('') + (st.current > 1 ? ` 🔥${st.current}` : ''),
    t('share_dare_' + b),
  ].join('\n');
}

export function shareUrl(clip, rec) {
  const q = new URLSearchParams();
  if (rec && rec.id) q.set('vs', rec.id);
  if (lang() === 'en') q.set('l', 'en');
  const s = q.toString();
  return `${location.origin}/c/${clip.n}${s ? '?' + s : ''}`;
}

async function send(text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text + '\n' + url);
    toast(t('copied'));
  } catch {
    window.prompt('', text + ' ' + url);
  }
}

export function shareResult() {
  const clip = ctx.clip, rec = S.results[clip.n];
  return rec ? send(shareText(clip, rec), shareUrl(clip, rec)) : shareClip();
}

export function shareClip() {
  const clip = ctx.clip;
  return send(t('share_try').replace('{what}', clip.src || clip.title), shareUrl(clip, null));
}

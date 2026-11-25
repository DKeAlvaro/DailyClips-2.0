import { S, streak } from './store.js';
import { ctx, currentDay } from './ctx.js';
import { t, lang } from './i18n.js';
import { toast } from './dom.js';

const square = (v) => (v >= 80 ? '🟩' : v >= 50 ? '🟨' : '🟥');

export function shareText(clip, rec) {
  const st = streak(currentDay());
  const lines = [`DailyClips #${clip.n} · ${rec.score}/100`, rec.phrases.map(square).join('')];
  if (st.current > 1) lines.push(`🔥 ${t('days', { n: st.current })}`);
  lines.push(t('share_q'));
  return lines.join('\n');
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
  return send(`DailyClips #${clip.n}: ${clip.title}\n${t('share_try')}`, shareUrl(clip, null));
}

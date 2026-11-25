/** Raster mascot: cut-outs from tools/mascot/make.py, same API as mascot.js. */
export const MOODS = ['idle', 'happy', 'wow', 'almost', 'oops', 'listen', 'talk'];
const ok = (m) => (MOODS.includes(m) ? m : 'idle');
const imgs = {};
const pre = (m) => imgs[m] || (imgs[m] = Object.assign(new Image(), { src: `/assets/mascot1/${m}.webp` }));

/** An <img> of her with that mood. size: px (default 72). Decorative, so the alt is empty. */
export function mascot(mood = 'idle', { size = 72 } = {}) {
  const el = new Image(size, size);
  el.className = 'mascot';
  el.alt = '';
  el.decoding = 'async';
  el.draggable = false;
  el.dataset.mood = mood = ok(mood);
  el.src = pre(mood).src;
  return el;
}

// decode the next image before it replaces the current one (no blank frame)
function swap(el, m) {
  el._w = m;
  const n = pre(m);
  (n.decode ? n.decode() : Promise.resolve()).catch(() => {}).then(() => {
    if (el._w === m) el.src = n.src;
  });
}

/** Changes her mood in place. */
export function setMood(el, mood) {
  if (!el || !MOODS.includes(mood) || el.dataset.mood === mood) return;
  clearInterval(el._t);
  el.dataset.mood = mood;
  swap(el, mood);
}

/** Mouth moves while a voice line plays: pass as say()'s onTalk, e.g. (on) => talking(el, on). */
export function talking(el, on) {
  if (!el) return;
  clearInterval(el._t);
  if (!on) return swap(el, el.dataset.mood);
  let open = 0;
  el._t = setInterval(() => swap(el, (open ^= 1) ? 'talk' : 'idle'), 160);
}

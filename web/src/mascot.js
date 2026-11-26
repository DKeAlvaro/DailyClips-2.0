// The mascot: a girl in lime headphones, drawn inline (no images). One SVG holds every face;
// data-mood picks which eyes, brows and mouth show, so changing mood is just an attribute.
//   const m = mascot('idle', { size: 72 }); setMood(m, 'happy'); talking(m, true);
// Needs web/mascot.css.

const SKIN = '#f4c6a5', SHADE = '#e2a582', HAIR = '#c4572f', HAIR2 = '#9a3f20', BROW = '#6d2914', INK = '#2a1610', LIP = '#7a2b22', TONGUE = '#ff8a76';

// data-m: the moods an element belongs to (i idle, h happy, w wow, a almost, o oops, l listen, t talk)
const ART = `<svg class="mascot" viewBox="0 0 100 100" aria-hidden="true">
<path fill="${SKIN}" d="M43.5 62h13v24h-13z"/><path fill="${SHADE}" d="M43.5 64h13v8.5q-6.5 4.5-13 0z"/>
<path fill="#2e4a50" d="M14 100c0-11 10-18.4 24-19.6 3 3.6 21 3.6 24 0 14 1.2 24 8.6 24 19.6z"/>
<path fill="none" stroke="#4b6c71" stroke-width="2" d="M38.4 80.6c3 3.6 20.2 3.6 23.2 0"/>
<g class="mb"><g class="hd">
<g class="pt"><path fill="${HAIR}" d="M50 18C53 6 72 1 85 10c10 7 12 24 6 39-1.6 4-4 8.4-7.4 12 2.4-12 2.6-24-3-32-6-8.4-16-11-30.6-11z"/><path fill="none" stroke="${HAIR2}" stroke-width="1.6" stroke-linecap="round" d="M62 9.6c12-2 22 6 23 20"/></g>
<path fill="${HAIR}" d="M26.5 53C25 31 36 18 50 18s25 13 23.5 35z"/>
<path fill="${SKIN}" d="M30 46c0-13 9-20 20-20s20 7 20 20c0 14-8.6 26-20 26S30 60 30 46z"/>
<g class="bl"><ellipse cx="36.6" cy="57.4" rx="3.3" ry="2.1"/><ellipse cx="63.4" cy="57.4" rx="3.3" ry="2.1"/></g>
<g class="fr" fill="#c9774f" opacity=".6"><circle cx="43.2" cy="55" r=".6"/><circle cx="45" cy="56.4" r=".6"/><circle cx="42.4" cy="57.2" r=".6"/><circle cx="56.8" cy="55" r=".6"/><circle cx="55" cy="56.4" r=".6"/><circle cx="57.6" cy="57.2" r=".6"/></g>
<path fill="none" stroke="${SHADE}" stroke-width="1.3" stroke-linecap="round" d="M49.2 55.4q.8.8 1.6 0"/>
<g fill="${INK}" stroke="${INK}" stroke-width="1.4" stroke-linecap="round">
<g data-m="i t a" class="ey"><ellipse cx="41" cy="50" rx="3" ry="3.9"/><ellipse cx="59" cy="50" rx="3" ry="3.9"/><path d="M38.9 47.4l-2-1.3m24.2 1.3 2-1.3"/><circle fill="#fff" stroke="none" cx="42.1" cy="48.4" r="1.1"/><circle fill="#fff" stroke="none" cx="60.1" cy="48.4" r="1.1"/></g>
<g data-m="w" class="ey"><ellipse cx="41" cy="49.5" rx="3.5" ry="4.6"/><ellipse cx="59" cy="49.5" rx="3.5" ry="4.6"/><path d="M38.4 46.4l-2.1-1.4m25.4 1.4 2.1-1.4"/><g fill="#fff" stroke="none"><circle cx="42.3" cy="47.6" r="1.4"/><circle cx="60.3" cy="47.6" r="1.4"/><circle cx="39.9" cy="51.6" r=".7"/><circle cx="57.9" cy="51.6" r=".7"/></g></g>
<g data-m="l" class="ey"><ellipse cx="39.8" cy="49.3" rx="3" ry="3.9"/><ellipse cx="57.8" cy="49.3" rx="3" ry="3.9"/><path d="M37.7 46.7l-2-1.3m24.2 1.3 2-1.3"/><circle fill="#fff" stroke="none" cx="40.6" cy="47.7" r="1.1"/><circle fill="#fff" stroke="none" cx="58.6" cy="47.7" r="1.1"/></g>
</g>
<g fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round">
<path data-m="h o" d="M37.6 51q3.4-4.2 6.8 0m11.2 0q3.4-4.2 6.8 0M37.5 50.7l-1.3-.9m26.3.9 1.3-.9"/>
<path data-m="i t" class="mo" d="M46.2 60.2q3.8 3 7.6 0"/>
</g>
<g fill="none" stroke="${BROW}" stroke-width="1.9" stroke-linecap="round">
<path data-m="i t h" d="M37 43.2q4-2.2 7.6-.6m10.8 0q3.6-1.6 7.6.6"/>
<path data-m="w l o" d="M37 41q4-2.6 7.6-1m10.8 0q3.6-1.6 7.6 1"/>
<path data-m="a" d="M37 40.6q4-2.4 7.6-.8m11 3.6q3.6-1 7.4.8"/>
</g>
<ellipse class="mo" data-m="l" fill="${LIP}" cx="50" cy="61" rx="1.7" ry="1.4"/>
<g class="mo" data-m="h"><path fill="${LIP}" d="M44 58h12q0 7.6-6 7.6T44 58z"/><path fill="${TONGUE}" d="M46.8 63.6q3.2-2.6 6.4 0-1.2 2-3.2 2t-3.2-2z"/></g>
<g class="mo" data-m="w"><path fill="${LIP}" d="M43 57.4h14q0 9.4-7 9.4t-7-9.4z"/><path fill="#fff" d="M44 57.4h12l-.4 2H44.4z"/><path fill="${TONGUE}" d="M46.2 64.6q3.8-2.8 7.6 0-1.4 2.2-3.8 2.2t-3.8-2.2z"/></g>
<path class="mo" data-m="a" fill="${LIP}" d="M45.6 59.4q5 1 9.2-1.6c.4 4.2-1.8 6.6-4.6 6.6s-4.6-2.4-4.6-5z"/>
<g class="mo" data-m="o" stroke="${INK}"><path fill="#fff" stroke-width="1.4" stroke-linejoin="round" d="M43.6 58.4q6.4 1.6 12.8 0-.4 5.6-6.4 5.6t-6.4-5.6z"/><path fill="none" stroke-width="1" d="M44.6 61.2q5.4.9 10.8 0"/></g>
<g class="mt" data-m="t"><path fill="${LIP}" d="M45.4 59q4.6-1.6 9.2 0 0 6.4-4.6 6.4T45.4 59z"/><path fill="${TONGUE}" d="M47.4 63.8q2.6-2 5.2 0-1 1.6-2.6 1.6t-2.6-1.6z"/></g>
<path fill="${HAIR}" d="M30.4 45.4C29.6 32 38.6 24.6 50 24.6S70.4 32 70.6 45.4C66 39 58 35 41 30.6c-3.4 4-7 9-10.6 14.8z"/>
<path class="d" d="M27 42h5.6v15H27zm40.4 0H73v15h-5.6z"/>
<path class="gs" fill="none" stroke-width="5.4" stroke-linecap="round" d="M24.8 47C24 24 36 11 50 11s26 13 25.2 36"/>
<rect class="g" x="18.4" y="39" width="12" height="21" rx="6"/><rect class="g" x="69.6" y="39" width="12" height="21" rx="6"/>
<path class="d" d="M22.6 46.4v6.2l5-3.1zm51.2 0v6.2l5-3.1z"/>
<path data-m="w" class="g" d="M12 18.6q1.2 5.6 6 6.8-4.8 1.2-6 6.8-1.2-5.6-6-6.8 4.8-1.2 6-6.8zm8.6-10q.7 3.2 3.4 3.9-2.7.7-3.4 3.9-.7-3.2-3.4-3.9 2.7-.7 3.4-3.9z"/>
<path data-m="l" class="gs" fill="none" stroke-width="2.2" stroke-linecap="round" d="M13 43.5q-3 6 0 12m-4.6-15.6q-5 9.6 0 19.2"/>
<path data-m="o" fill="#f6f4ec" d="M15.6 27.6q3.6 4.8 3.6 7a3.6 3.6 0 0 1-7.2 0q0-2.2 3.6-7z"/>
</g></g></svg>`;

export const MOODS = ['idle', 'happy', 'wow', 'almost', 'oops', 'listen', 'talk'];

let tpl;

/** An <svg> of her with that mood. size: px (default 72). */
export function mascot(mood = 'idle', { size = 72 } = {}) {
  if (!tpl) {
    const d = document.createElement('div');
    d.innerHTML = ART;
    tpl = d.firstChild;
  }
  const el = tpl.cloneNode(true);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.dataset.mood = MOODS.includes(mood) ? mood : 'idle';
  if (size < 90) el.querySelector('.fr').remove(); // freckles are noise when small
  el.style.setProperty('--bd', (-Math.random() * 5).toFixed(2) + 's'); // several on screen do not blink in sync
  return el;
}

/** Changes her face; a small hop marks the change. */
export function setMood(el, mood) {
  if (!el || !MOODS.includes(mood) || el.dataset.mood === mood) return;
  el.dataset.mood = mood;
  el.classList.remove('hop');
  void el.getBoundingClientRect();
  el.classList.add('hop');
  // gone once played, so moving her to another card later does not replay it
  clearTimeout(el._hop);
  el._hop = setTimeout(() => el.classList.remove('hop'), 900);
}

/** Mouth moves while a voice line plays: pass as say()'s onTalk, e.g. (on) => talking(el, on). */
export function talking(el, on) {
  if (el) el.classList.toggle('talking', !!on);
}

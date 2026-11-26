// The mascot the screens use. Two looks: "a" drawn inline (mascot.js, the default) and "b" made of
// pictures (mascot-img.js, which only fetches its images when she is shown). Opening the site with
// ?mascot=a or ?mascot=b picks one for this device, remembers it and drops the parameter from the URL.
import { S, save } from './store.js';
import * as drawn from './mascot.js';
import * as pictures from './mascot-img.js';
import { say, sayAll } from './voice.js';

const asked = new URLSearchParams(location.search).get('mascot');
if (asked === 'a' || asked === 'b') {
  S.mascot = asked;
  save();
  const u = new URL(location.href);
  u.searchParams.delete('mascot');
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
}
const look = S.mascot === 'b' ? pictures : drawn;

export const MOODS = look.MOODS;
/** An element of her with that mood. size: px. */
export const mascot = (mood, opts) => look.mascot(mood, opts);
export const setMood = (el, mood) => look.setMood(el, mood);
export const talking = (el, on) => look.talking(el, on);

/** She says a moment (or a list, one after the other) and her mouth moves with it. Same options as say(). */
export function speak(el, what, opts = {}) {
  const onTalk = (on) => talking(el, on);
  return Array.isArray(what) ? sayAll(what, { ...opts, onTalk }) : say(what, { ...opts, onTalk });
}

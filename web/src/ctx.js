// Shared app context: what is on screen right now.
import { addDays } from './store.js';

export const ctx = {
  cfg: {},
  today: 0, // number of today's clip
  day: '', // server day (YYYY-MM-DD) at page load
  nextAt: 0, // server time of the next clip
  skew: 0, // server clock - device clock
  clip: null,
  units: [], // the phrases of the clip that are practised
  count: 0, // people who did the clip
  vs: null, // result we were challenged with
  teaser: null,
  stats: {}, // clip n -> global stats
  player: null,
  session: null,
  act: {}, // actions other modules can call: loadClip, practice, refreshTop...
};

export const MAX_TAKES = 3;
export const now = () => Date.now() + ctx.skew;
/** Product day right now, even if the page has been open since yesterday. */
export const currentDay = () => (now() >= ctx.nextAt ? addDays(ctx.day, 1) : ctx.day);
export const isInApp = () => {
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|FB_IAB|Line\/|Twitter|TikTok|musical_ly|Snapchat|WhatsApp|LinkedInApp|Pinterest|Telegram/i.test(ua) || (/Android/.test(ua) && /; wv\)/.test(ua));
};
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(navigator.userAgent || '');

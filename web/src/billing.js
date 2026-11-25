// Pro subscription in the UI: the card in the level picker (subscribe, use, cancel, resume) and the
// return from Stripe's checkout page.
import { h, toast } from './dom.js';
import { S, save, applyProfile } from './store.js';
import { t, extend, lang, fmtDay } from './i18n.js';
import { api, refreshMe } from './api.js';
import { ctx } from './ctx.js';

extend({
  es: {
    pro: 'Pro',
    pro_sub: 'Nota por sonido calculada en nuestro servidor con un modelo más grande. Sin descargar nada, sin gastar batería y en cualquier navegador.',
    pro_price: '{price} al mes',
    pro_get: 'Hazte Pro · {price}/mes',
    pro_login: 'Para suscribirte, primero entra con Google (arriba).',
    pro_fair: 'Pagar no da más nota: solo cambia cómo se calcula. Cancelas cuando quieras desde aquí.',
    pro_until: 'Se renueva el {d}.',
    pro_ends: 'Cancelada: tienes Pro hasta el {d}.',
    pro_cancel: 'Cancelar suscripción',
    pro_cancel_confirm: '¿Cancelar Pro? Lo sigues teniendo hasta el final del periodo pagado y no se cobra más.',
    pro_resume: 'Reanudar',
    pro_welcome: 'Ya tienes Pro. Gracias.',
    pro_pending: 'El pago está en camino. En cuanto llegue se activa Pro.',
    pro_past_due: 'No se pudo cobrar la última cuota. Revisa la tarjeta o se desactivará.',
    pro_fail: 'No se pudo abrir el pago. Prueba otra vez.',
    pro_err: 'No ha salido. Mira tu conexión y prueba otra vez.',
  },
  en: {
    pro: 'Pro',
    pro_sub: 'Sound-by-sound score computed on our server with a larger model. Nothing to download, no battery drain, any browser.',
    pro_price: '{price} a month',
    pro_get: 'Go Pro · {price}/month',
    pro_login: 'To subscribe, sign in with Google first (above).',
    pro_fair: "Paying doesn't raise your score: it only changes how it is computed. Cancel any time from here.",
    pro_until: 'Renews on {d}.',
    pro_ends: 'Cancelled: you keep Pro until {d}.',
    pro_cancel: 'Cancel subscription',
    pro_cancel_confirm: 'Cancel Pro? You keep it until the end of the paid period and are not charged again.',
    pro_resume: 'Resume',
    pro_welcome: 'You have Pro now. Thank you.',
    pro_pending: 'The payment is on its way. Pro switches on as soon as it lands.',
    pro_past_due: 'The last payment failed. Check your card or Pro will switch off.',
    pro_fail: "Couldn't open the payment page. Try again.",
    pro_err: "That didn't work. Check your connection and try again.",
  },
});

const offered = () => !!(ctx.cfg.pro && ctx.cfg.pro.enabled);
const mine = () => (S.user && S.user.pro) || {};
const day = (ms) => fmtDay(new Date(ms).toISOString().slice(0, 10), { day: 'numeric', month: 'long' });

async function act(path, refresh, body) {
  try {
    applyProfile(await api(path, { method: 'POST', body: body || {} }));
    window.dispatchEvent(new CustomEvent('dc:profile'));
  } catch {
    toast(t('pro_err'));
  }
  if (refresh) refresh();
}

/** The Pro card of the level picker. Nothing at all when the server has no billing configured. */
export function proCard(refresh) {
  const pro = mine();
  if (!offered() && !pro.active) return document.createDocumentFragment();
  const price = (ctx.cfg.pro && ctx.cfg.pro.price) || '';
  if (!pro.active) {
    const card = h('div.tier', h('b', t('pro'), h('em', t('pro_price', { price }))), h('small', t('pro_sub')));
    const google = !!(S.user && S.user.google);
    card.append(h('div.btns', { style: { 'margin-top': '12px' } }, h('button.btn.sm.pri', {
      id: 'gopro', disabled: google ? null : '',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const out = await api('/api/billing/checkout', { method: 'POST', body: { lang: lang() } });
          location.href = out.url;
        } catch (err) {
          if (err.status === 409) await refreshMe(); // already subscribed (paid in another tab)
          else toast(t('pro_fail'));
          refresh();
        }
      },
    }, t('pro_get', { price }))), h('p.note', google ? t('pro_fair') : t('pro_login')));
    return card;
  }
  const on = S.tier === 'pro';
  const card = h('div.tier' + (on ? '.on' : ''), h('b', t('pro'), h('em', on ? t('lv_on') : t('pro_price', { price }))), h('small', t('pro_sub')));
  const status = pro.status === 'past_due' ? t('pro_past_due') : pro.until ? t(pro.cancel ? 'pro_ends' : 'pro_until', { d: day(pro.until) }) : '';
  if (status) card.append(h('p.note', status));
  card.append(h('div.links', { style: { 'justify-content': 'flex-start', 'margin-top': '8px' } },
    on ? null : h('button', { id: 'usepro', onclick: () => { S.tier = 'pro'; save(); refresh(); } }, t('lv_use')),
    pro.cancel
      ? h('button', { id: 'resumepro', onclick: () => act('/api/billing/resume', refresh) }, t('pro_resume'))
      : h('button', { id: 'cancelpro', onclick: () => { if (confirm(t('pro_cancel_confirm'))) act('/api/billing/cancel', refresh); } }, t('pro_cancel'))));
  return card;
}

/**
 * Back from Stripe (?pro=ok&cs=...): confirm with the server, switch the level to Pro and say thanks.
 * Called once at start-up; cleans the address bar either way.
 */
export async function proReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('pro')) return;
  const cs = q.get('cs');
  const ok = q.get('pro') === 'ok';
  q.delete('pro');
  q.delete('cs');
  history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : ''));
  if (!ok || !cs) return;
  for (let i = 0; i < 4; i++) {
    try {
      applyProfile(await api('/api/billing/confirm', { method: 'POST', body: { cs } }));
    } catch { /* try again below */ }
    if (mine().active) {
      S.tier = 'pro';
      save();
      window.dispatchEvent(new CustomEvent('dc:profile'));
      return toast(t('pro_welcome'), 4000);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  toast(t('pro_pending'), 4000);
}

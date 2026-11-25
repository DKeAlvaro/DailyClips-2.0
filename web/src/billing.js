// Pro in the UI: the card in the level picker (buy once, then use) and the return from Stripe's checkout.
import { h, toast } from './dom.js';
import { S, save, applyProfile } from './store.js';
import { t, extend, lang } from './i18n.js';
import { api, refreshMe } from './api.js';
import { ctx } from './ctx.js';

extend({
  es: {
    pro: 'Pro',
    pro_sub: 'Nota por sonido calculada en nuestro servidor con un modelo más grande. Sin descargar nada y en cualquier navegador.',
    pro_once: 'Pago único',
    pro_get: 'Hazte Pro · {price}',
    pro_login: 'Para comprarlo, primero entra con Google (arriba).',
    pro_welcome: 'Ya tienes Pro. Gracias.',
    pro_pending: 'El pago está en camino. En cuanto llegue se activa Pro.',
    pro_fail: 'No se pudo abrir el pago. Prueba otra vez.',
  },
  en: {
    pro: 'Pro',
    pro_sub: 'Sound-by-sound score computed on our server with a larger model. Nothing to download, any browser.',
    pro_once: 'One-time payment',
    pro_get: 'Go Pro · {price}',
    pro_login: 'To buy it, sign in with Google first (above).',
    pro_welcome: 'You have Pro now. Thank you.',
    pro_pending: 'The payment is on its way. Pro switches on as soon as it lands.',
    pro_fail: "Couldn't open the payment page. Try again.",
  },
});

const offered = () => !!(ctx.cfg.pro && ctx.cfg.pro.enabled);
const mine = () => (S.user && S.user.pro) || {};

/** The Pro card of the level picker. Nothing at all when the server has no billing configured. */
export function proCard(refresh) {
  const pro = mine();
  if (!offered() && !pro.active) return document.createDocumentFragment();
  if (pro.active) {
    const on = S.tier === 'pro';
    const card = h('div.tier' + (on ? '.on' : ''), h('b', t('pro'), on ? h('em', t('lv_on')) : null), h('small', t('pro_sub')));
    if (!on) {
      card.append(h('div.links', { style: { 'justify-content': 'flex-start', 'margin-top': '8px' } },
        h('button', { id: 'usepro', onclick: () => { S.tier = 'pro'; save(); refresh(); } }, t('lv_use'))));
    }
    return card;
  }
  const price = (ctx.cfg.pro && ctx.cfg.pro.price) || '';
  const google = !!(S.user && S.user.google);
  const card = h('div.tier', h('b', t('pro'), h('em', t('pro_once'))), h('small', t('pro_sub')));
  card.append(h('div.btns', { style: { 'margin-top': '12px' } }, h('button.btn.sm.pri', {
    id: 'gopro', disabled: google ? null : '',
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        const out = await api('/api/billing/checkout', { method: 'POST', body: { lang: lang() } });
        location.href = out.url;
      } catch (err) {
        if (err.status === 409) await refreshMe(); // already bought (paid in another tab)
        else toast(t('pro_fail'));
        refresh();
      }
    },
  }, t('pro_get', { price }))), google ? null : h('p.note', t('pro_login')));
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

// Optional Google sign-in (Google Identity Services): One Tap where the browser supports it,
// the regular button everywhere else. The script is only loaded when it is about to be shown.
import { S, applyProfile, resetIdentity } from './store.js';
import { api, syncResults } from './api.js';
import { ctx } from './ctx.js';
import { t, lang } from './i18n.js';
import { toast } from './dom.js';

let loading = null, inited = false;

function loadGsi() {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => {
        loading = null;
        reject(new Error('gsi'));
      };
      document.head.append(s);
    });
  }
  return loading;
}

async function init() {
  await loadGsi();
  if (inited) return;
  inited = true;
  window.google.accounts.id.initialize({
    client_id: ctx.cfg.gid, callback: onCredential, auto_select: false, cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true, itp_support: true, context: 'signin',
  });
}

function profileChanged() {
  ctx.act.refreshTop();
  window.dispatchEvent(new CustomEvent('dc:profile'));
}

async function onCredential(resp) {
  try {
    await syncResults(); // what was done anonymously goes up first, so the account keeps it
    applyProfile(await api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } }));
    toast(t('login_ok'));
    profileChanged();
  } catch {
    toast(t('login_fail'));
  }
}

export const loginAvailable = () => !!ctx.cfg.gid;
export const signedIn = () => !!(S.user && S.user.google);

export async function googleButton(el) {
  if (!loginAvailable()) return;
  try {
    await init();
    window.google.accounts.id.renderButton(el, {
      theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', locale: lang(),
      width: Math.max(220, Math.min(340, el.clientWidth || 300)),
    });
  } catch { /* blocked script: the app works without login */ }
}

export async function oneTap() {
  if (!loginAvailable() || signedIn()) return;
  try {
    await init();
    window.google.accounts.id.prompt();
  } catch { /* ignore */ }
}

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch { /* offline: still forget locally */ }
  try {
    if (window.google) window.google.accounts.id.disableAutoSelect();
  } catch { /* ignore */ }
  resetIdentity();
  profileChanged();
}

export async function deleteAccount() {
  await api('/api/me', { method: 'DELETE' });
  resetIdentity();
  profileChanged();
}

// Staging only: lets automated tests sign in without Google.
if (typeof window !== 'undefined') {
  window.dcTestLogin = async (secret, sub, name) => {
    await syncResults();
    applyProfile(await api('/api/auth/test', { method: 'POST', body: { secret, sub, name } }));
    profileChanged();
    return S.user;
  };
}

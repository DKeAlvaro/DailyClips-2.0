import { S, save, applyProfile, resultList } from './store.js';

export async function api(path, { method = 'GET', body, raw, timeout = 12000, headers = {} } = {}) {
  const r = await fetch(path, {
    method,
    headers: {
      Authorization: 'Bearer ' + S.token,
      ...(body && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined,
  });
  let data = null;
  try {
    data = await r.json();
  } catch { /* empty body */ }
  if (!r.ok) {
    const e = new Error((data && data.error) || 'http_' + r.status);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

let syncing = null;
/** Uploads results the server has not seen yet. Returns the last server answer (profile + stats). */
export function syncResults() {
  if (syncing) return syncing;
  syncing = (async () => {
    let last = null;
    for (const r of resultList().filter((x) => !x.synced)) {
      try {
        last = await api('/api/results', { method: 'POST', body: { n: r.n, score: r.score, phrases: r.phrases, tier: r.tier, sounds: r.sounds } });
        r.synced = true;
        save();
      } catch (e) {
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
          r.synced = true; // the server will never take it (clip gone, invalid): stop retrying
          save();
        } else break; // offline or server down: try again later
      }
    }
    if (last) applyProfile(last);
    return last;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function refreshMe() {
  try {
    await syncResults();
    const me = await api('/api/me');
    if (me.user) applyProfile(me);
    return me;
  } catch {
    return null;
  }
}

import crypto from 'node:crypto';

let cache = { keys: [], exp: 0 };

async function googleKeys(force = false) {
  if (!force && Date.now() < cache.exp && cache.keys.length) return cache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('google certs ' + r.status);
  const maxAge = Number((/max-age=(\d+)/.exec(r.headers.get('cache-control') || '') || [])[1] || 3600);
  cache = { keys: (await r.json()).keys || [], exp: Date.now() + Math.min(maxAge, 86400) * 1000 };
  return cache.keys;
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Verifies a Google Identity Services ID token (RS256) and returns its claims. Throws when invalid. */
export async function verifyGoogleIdToken(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = b64json(parts[0]);
  const claims = b64json(parts[1]);
  if (header.alg !== 'RS256') throw new Error('bad alg');
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad signature');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('bad audience');
  if (!claims.sub || claims.exp * 1000 < Date.now() - 60e3) throw new Error('expired');
  return claims;
}

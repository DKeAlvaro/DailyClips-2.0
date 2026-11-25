// Pro is a single payment through Stripe Checkout, straight against Stripe's HTTP API (no SDK).
// A paid checkout switches Pro on for the account for good; a full refund or a dispute switches it off.
// On the user row: stripe_customer, stripe_sub = the payment intent that paid for Pro,
// pro_status = active | refunded, pro_until = FOREVER while it is on.
import crypto from 'node:crypto';

const FOREVER = Date.UTC(2099, 11, 31);
const EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'charge.dispute.created']);

/** { a: { b: 1 }, c: [{ d: 2 }] } -> a[b]=1&c[0][d]=2, the form encoding Stripe expects. */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

export function createBilling({ cfg, env, q, log, bad, isPro, allow, onChange }) {
  const key = env.STRIPE_SECRET_KEY || '';
  const hookSecret = env.STRIPE_WEBHOOK_SECRET || '';
  const price = env.STRIPE_PRICE_ID || '';
  const enabled = !!(key && hookSecret && price);

  async function stripe(method, path, params) {
    const r = await fetch('https://api.stripe.com/v1' + path, {
      method, body: params ? form(params) : undefined, signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + key },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error((data.error && data.error.message) || 'stripe ' + r.status);
      e.stripe = r.status;
      throw e;
    }
    return data;
  }

  const userBy = (col, v) => (v ? q(`SELECT * FROM users WHERE ${col} = ?`).get(v) : null);

  /** A paid Checkout session switches Pro on for the account it was opened from. */
  function grant(session, user = null) {
    if (session.mode !== 'payment' || session.payment_status !== 'paid') return null;
    user = user || userBy('pub', session.client_reference_id);
    if (!user) {
      log('paid checkout for an unknown user', session.id);
      return null;
    }
    q('UPDATE users SET stripe_customer = ?, stripe_sub = ?, pro_status = ?, pro_until = ?, pro_cancel = 0 WHERE id = ?')
      .run(session.customer ? String(session.customer) : null, String(session.payment_intent || session.id), 'active', FOREVER, user.id);
    onChange();
    log('pro on', user.pub);
    return userBy('id', user.id);
  }

  /** The payment was returned (refund in full, dispute): Pro goes with it. */
  function revoke(paymentIntent, why) {
    const user = userBy('stripe_sub', paymentIntent);
    if (!user) return;
    q('UPDATE users SET pro_status = ?, pro_until = 0 WHERE id = ?').run('refunded', user.id);
    onChange();
    log('pro off', user.pub, why);
  }

  function verified(raw, header) {
    const parts = String(header || '').split(',').map((kv) => kv.split('='));
    const t = (parts.find(([k]) => k === 't') || [])[1];
    if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
    const want = crypto.createHmac('sha256', hookSecret).update(`${t}.`).update(raw).digest();
    return parts.some(([k, v]) => {
      if (k !== 'v1') return false;
      const got = Buffer.from(v || '', 'hex');
      return got.length === want.length && crypto.timingSafeEqual(got, want);
    });
  }

  function handle(event) {
    const o = event.data.object;
    if (event.type.startsWith('checkout.session.')) grant(o);
    else if (event.type === 'charge.refunded') {
      if (o.refunded) revoke(o.payment_intent, 'refund');
    } else if (event.type === 'charge.dispute.created') revoke(o.payment_intent, 'dispute');
  }

  return {
    publicConfig: () => ({ enabled, price: env.DC_PRO_PRICE || '4,99 €' }),

    /** Nothing recurring to stop when an account is deleted. */
    async cancelNow() {},

    routes(route, { auth, readJson, readBody, profile }) {
      const signedIn = (req) => {
        if (!enabled) throw bad(404, 'not_found');
        const user = auth(req);
        if (!user || !user.google_sub) throw bad(401, 'login_needed');
        if (!allow('bill:' + user.id, 12, 60e3)) throw bad(429, 'slow_down');
        return user;
      };

      route('POST', /^\/api\/billing\/checkout$/, async (req) => {
        const user = signedIn(req);
        if (isPro(user)) throw bad(409, 'already_pro');
        const b = await readJson(req);
        const session = await stripe('POST', '/checkout/sessions', {
          mode: 'payment',
          line_items: [{ price, quantity: 1 }],
          client_reference_id: user.pub,
          ...(user.stripe_customer ? { customer: user.stripe_customer } : { customer_email: user.email || undefined, customer_creation: 'always' }),
          payment_intent_data: { metadata: { user: user.pub }, description: 'DailyClips Pro' },
          locale: b.lang === 'en' ? 'en' : 'es',
          success_url: `${cfg.baseUrl}/?pro=ok&cs={CHECKOUT_SESSION_ID}`,
          cancel_url: `${cfg.baseUrl}/?pro=back`,
        });
        return { url: session.url };
      });

      // back from Stripe: do not wait for the webhook to switch Pro on
      route('POST', /^\/api\/billing\/confirm$/, async (req) => {
        const user = signedIn(req);
        const b = await readJson(req);
        if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(b.cs || '')) throw bad(400, 'bad_session');
        const session = await stripe('GET', '/checkout/sessions/' + b.cs);
        if (session.client_reference_id !== user.pub) throw bad(403, 'not_yours');
        return profile(grant(session, user) || user);
      });

      route('POST', /^\/api\/billing\/webhook$/, async (req) => {
        if (!enabled) throw bad(404, 'not_found');
        const raw = await readBody(req, 512 * 1024);
        if (!verified(raw, req.headers['stripe-signature'])) throw bad(400, 'bad_signature');
        const event = JSON.parse(raw.toString('utf8'));
        if (!EVENTS.has(event.type) || q('SELECT 1 x FROM stripe_events WHERE id = ?').get(event.id)) return { ok: true };
        handle(event); // a failure answers 500 and Stripe sends the event again
        q('INSERT OR IGNORE INTO stripe_events (id, at) VALUES (?, ?)').run(event.id, Date.now());
        return { ok: true };
      });
    },
  };
}

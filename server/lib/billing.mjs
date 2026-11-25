// Stripe subscription for the Pro level, straight against Stripe's HTTP API (no SDK).
// Stripe is the source of truth: every webhook and every action re-reads the subscription and copies
// its status, period end and "cancels at period end" onto the user.
import crypto from 'node:crypto';

const EVENTS = new Set([
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed',
]);

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

  /** Copies the state of a Stripe subscription onto its user. Returns the fresh user row (or null). */
  function apply(sub, user = null) {
    user = user || userBy('stripe_sub', sub.id) || userBy('pub', sub.metadata && sub.metadata.user) || userBy('stripe_customer', sub.customer);
    if (!user) return null;
    const live = (s) => ['active', 'trialing', 'past_due'].includes(s);
    // a late event about an old subscription must not switch off a newer one
    if (user.stripe_sub && user.stripe_sub !== sub.id && live(user.pro_status) && !live(sub.status)) return user;
    const item = sub.items && sub.items.data && sub.items.data[0];
    const end = sub.current_period_end || (item && item.current_period_end) || 0;
    const cancel = sub.cancel_at_period_end || sub.cancel_at ? 1 : 0;
    q('UPDATE users SET stripe_customer = ?, stripe_sub = ?, pro_status = ?, pro_until = ?, pro_cancel = ? WHERE id = ?')
      .run(String(sub.customer), sub.id, sub.status, end * 1000, cancel, user.id);
    onChange();
    log('pro', user.pub, sub.status, cancel ? 'cancels at period end' : '');
    return userBy('id', user.id);
  }

  const refresh = async (subId, user) => (subId ? apply(await stripe('GET', '/subscriptions/' + subId), user) : null);

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

  async function handle(event) {
    const o = event.data.object;
    if (event.type === 'checkout.session.completed') {
      if (o.mode !== 'subscription') return;
      const user = userBy('pub', o.client_reference_id);
      if (!user) return log('checkout for an unknown user', o.id);
      q('UPDATE users SET stripe_customer = ? WHERE id = ?').run(String(o.customer), user.id);
      await refresh(o.subscription, user);
    } else if (event.type.startsWith('customer.subscription.')) {
      await refresh(o.id);
    } else {
      const d = o.parent && o.parent.subscription_details;
      await refresh(o.subscription || (d && d.subscription));
    }
  }

  return {
    publicConfig: () => ({ enabled, price: env.DC_PRO_PRICE || '2,99 €' }),

    /** Ends the subscription right away (the account is being deleted). */
    async cancelNow(user) {
      if (!enabled || !user.stripe_sub || !['active', 'trialing', 'past_due'].includes(user.pro_status)) return;
      await stripe('DELETE', '/subscriptions/' + user.stripe_sub);
    },

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
          mode: 'subscription',
          line_items: [{ price, quantity: 1 }],
          client_reference_id: user.pub,
          ...(user.stripe_customer ? { customer: user.stripe_customer } : { customer_email: user.email || undefined }),
          subscription_data: { metadata: { user: user.pub } },
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
        const fresh = session.subscription ? await refresh(session.subscription, user) : null;
        return profile(fresh || user);
      });

      const setCancel = (flag) => async (req) => {
        const user = signedIn(req);
        if (!user.stripe_sub) throw bad(404, 'no_subscription');
        const sub = await stripe('POST', '/subscriptions/' + user.stripe_sub, { cancel_at_period_end: flag });
        return profile(apply(sub, user) || user);
      };
      route('POST', /^\/api\/billing\/cancel$/, setCancel(true));
      route('POST', /^\/api\/billing\/resume$/, setCancel(false));

      route('POST', /^\/api\/billing\/webhook$/, async (req) => {
        if (!enabled) throw bad(404, 'not_found');
        const raw = await readBody(req, 512 * 1024);
        if (!verified(raw, req.headers['stripe-signature'])) throw bad(400, 'bad_signature');
        const event = JSON.parse(raw.toString('utf8'));
        if (!EVENTS.has(event.type) || q('SELECT 1 x FROM stripe_events WHERE id = ?').get(event.id)) return { ok: true };
        await handle(event); // a failure answers 500 and Stripe sends the event again
        q('INSERT OR IGNORE INTO stripe_events (id, at) VALUES (?, ?)').run(event.id, Date.now());
        return { ok: true };
      });
    },
  };
}

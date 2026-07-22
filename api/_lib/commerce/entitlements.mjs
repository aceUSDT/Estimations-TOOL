/* Entitlement records — who may download, stored in Netlify Blobs with
 * strong consistency. Keys are server-derived only; a client can never
 * choose or guess them:
 *
 *   entitlement:<checkout_session_id>
 *   email:<HMAC-SHA256(normalised_email)>          → entitlement key
 *   payment-intent:<stripe_payment_intent_id>      → entitlement key
 *   event:<stripe_event_id>                        → processed marker
 *   restore:<SHA-256(random_restore_token)>        → pending restore grant
 *
 * No card data, no raw email in keys, no customer documents — ever.
 * Fulfilment is idempotent: replaying the same Stripe event or session
 * yields the same record and no duplicate side effects.
 */
import { hmacEmail } from './commerce.mjs';

export const SCHEMA_VERSION = 1;

export async function realStore() {
  // Supabase is the system's single database: entitlements live in the
  // commerce_kv table (service-role only), not in Netlify Blobs.
  const { supabaseKvStore } = await import('./kv.mjs');
  return supabaseKvStore();
}

function entitlementKey(sessionId) { return `entitlement:${sessionId}`; }
function emailKey(hmac) { return `email:${hmac}`; }
function paymentIntentKey(pi) { return `payment-intent:${pi}`; }
function eventKey(id) { return `event:${id}`; }

/* Build an entitlement record from a (verified!) Stripe checkout session.
 * The caller has already checked payment_status and price. */
export function recordFromSession(session, env = process.env) {
  return {
    schemaVersion: SCHEMA_VERSION,
    checkoutSessionId: session.id,
    customerId: typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id) || null,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null,
    emailHmac: hmacEmail(session.customer_details && session.customer_details.email, env),
    priceId: env.STRIPE_PRICE_ID,
    status: 'active',
    purchasedAt: new Date((session.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    refundedAt: null,
    product: 'estimation-tools-desktop',
    versionEligibility: 'all-1.x',
  };
}

/* Idempotent fulfilment: safe under webhook replay AND the checkout-status
 * fallback racing the webhook. The entitlement key is derived from the
 * session id, so double writes converge on the same record. */
export async function fulfil(store, session, env = process.env) {
  const key = entitlementKey(session.id);
  const existing = await store.get(key, { type: 'json' }).catch(() => null);
  if (existing && existing.status) {
    return { record: existing, created: false };
  }
  const record = recordFromSession(session, env);
  await store.setJSON(key, record);
  if (record.emailHmac) await store.set(emailKey(record.emailHmac), key);
  if (record.paymentIntentId) await store.set(paymentIntentKey(record.paymentIntentId), key);
  return { record, created: true };
}

export async function getBySessionId(store, sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 128) return null;
  return store.get(entitlementKey(sessionId), { type: 'json' }).catch(() => null);
}

export async function getByEmail(store, email, env = process.env) {
  const pointer = await store.get(emailKey(hmacEmail(email, env))).catch(() => null);
  if (!pointer) return null;
  return store.get(pointer, { type: 'json' }).catch(() => null);
}

export async function getByPaymentIntent(store, paymentIntentId) {
  const pointer = await store.get(paymentIntentKey(paymentIntentId)).catch(() => null);
  if (!pointer) return null;
  const record = await store.get(pointer, { type: 'json' }).catch(() => null);
  return record ? { record, key: pointer } : null;
}

/* Refunds revoke: every download-link call re-reads the record, so marking
 * refunded immediately stops new links. */
export async function markRefunded(store, paymentIntentId) {
  const found = await getByPaymentIntent(store, paymentIntentId);
  if (!found) return false;
  found.record.status = 'refunded';
  found.record.refundedAt = new Date().toISOString();
  await store.setJSON(found.key, found.record);
  return true;
}

/* Webhook replay protection. Returns true when this event id is new. */
export async function markEventProcessed(store, eventId) {
  const key = eventKey(eventId);
  const seen = await store.get(key).catch(() => null);
  if (seen) return false;
  await store.set(key, new Date().toISOString());
  return true;
}

export function isActive(record) {
  return Boolean(record && record.status === 'active');
}

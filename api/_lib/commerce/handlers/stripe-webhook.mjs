/* POST /api/stripe-webhook — Stripe event ingestion.
 *
 * The ONLY authority for "this customer paid" is a signature-verified Stripe
 * event (constructEventAsync over the RAW body — never parsed JSON). Events
 * are idempotent via the event-id marker, so Stripe replays cannot double
 * fulfil. Refunds revoke the entitlement immediately.
 *
 * This endpoint is exempt from the same-origin guard by design: Stripe calls
 * it server-to-server, and the signature is the authentication.
 */
import { commerceState, json, getStripe } from '../commerce.mjs';
import { realStore, fulfil, markRefunded, markEventProcessed } from '../entitlements.mjs';

async function sessionIsPaidForOurPrice(stripe, sessionId, env) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
  if (!session || session.payment_status !== 'paid') return null;
  const items = (session.line_items && session.line_items.data) || [];
  const ours = items.some((li) => li.price && li.price.id === env.STRIPE_PRICE_ID);
  return ours ? session : null;
}

export async function handleStripeWebhook(req, deps) {
  const { env } = deps;
  if (!commerceState(env).enabled) return json(503, { error: 'commerce disabled' });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return json(400, { error: 'missing signature' });
  const rawBody = await req.text();
  if (rawBody.length > 65536) return json(400, { error: 'payload too large' });

  const stripe = await deps.getStripe(env);
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return json(400, { error: 'invalid signature' });
  }

  const fresh = await markEventProcessed(deps.store, event.id);
  if (!fresh) return json(200, { received: true, duplicate: true });

  if (event.type === 'checkout.session.completed') {
    // Re-retrieve rather than trusting the event payload's snapshot, and
    // confirm the paid line item is OUR price before granting anything.
    const session = await sessionIsPaidForOurPrice(stripe, event.data.object.id, env);
    if (session) await fulfil(deps.store, session, env);
    return json(200, { received: true });
  }

  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    const charge = event.data.object;
    const paymentIntent = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : (charge.payment_intent && charge.payment_intent.id);
    if (paymentIntent) await markRefunded(deps.store, paymentIntent);
    return json(200, { received: true });
  }

  return json(200, { received: true, ignored: event.type });
}


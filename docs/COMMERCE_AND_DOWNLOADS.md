# Commerce & Downloads — architecture

How a customer pays once and downloads signed installers, and why each part
is shaped the way it is. All hostnames below use `{ROOT_DOMAIN}` placeholders
— the real domain is configured at deploy time (see CUSTOM_DOMAIN_RUNBOOK.md).

## The flow

```
www.{ROOT_DOMAIN}/download/            static store page
        │  POST /api/create-checkout-session
        ▼
Stripe-hosted Checkout                 card details never touch our origin
        │  webhook: checkout.session.completed  (+ success-page fallback poll)
        ▼
Supabase entitlement record (commerce_kv) keyed by checkout session id
        │  signed __Host- cookie
        ▼
POST /api/download-link {platform,arch}
        │  entitlement re-read (refunds revoke) → manifest allow-list
        ▼
https://files.{ROOT_DOMAIN}/releases/…?token=<claim>     ≤5-minute HMAC claim
        ▼
Cloudflare Worker → private R2 bucket  exact key only, resumable, attachment
```

## Components

| Piece | Where | Job |
|---|---|---|
| `download/` | static pages | store, success, restore, legal — driven by `/api/store-config` |
| `api/_lib/commerce/handlers/store-config.mjs` | GET `/api/store-config` | commerce state + server-side price (the ONLY price source) |
| `create-checkout-session.mjs` | POST | starts Stripe Checkout; rejects any client-supplied price field |
| `stripe-webhook.mjs` | POST | signature-verified fulfilment; idempotent; refunds revoke |
| `checkout-status.mjs` | GET | success-page poll; fulfils if the webhook hasn't landed; sets cookie |
| `request-download-link.mjs` | POST | restore-by-email; anti-enumeration; single-use hashed token |
| `redeem-download-token.mjs` | GET | burns the token, sets the cookie, redirects to downloads |
| `download-link.mjs` | POST | cookie → entitlement → manifest → signed gateway claim (or presigned R2 fallback) |
| `workers/download-gateway/` | files.{ROOT_DOMAIN} | streams the private bucket with claim verification + ranges |
| `tools/release/` | CI | builds + validates the manifest, publishes to R2 (manifest last) |

## Security invariants (tested)

- **Server-only pricing.** The browser can neither read nor influence the
  price except through `/api/store-config`; `create-checkout-session`
  rejects requests containing price-like fields. (`test-commerce.mjs`)
- **Webhook truth.** Fulfilment requires a signature-verified Stripe event
  (or a server-side re-retrieve of the session on the status fallback), a
  `paid` status, and OUR price id on the line item. Event ids are replay-marked.
- **Idempotent fulfilment.** Webhook replay and the status-poll race converge
  on one record keyed by the checkout session id.
- **Refunds revoke immediately.** Every `download-link` call re-reads the
  entitlement; `charge.refunded` / dispute marks it refunded.
- **Manifest is the only bridge.** Customers never supply file names or
  object keys; `{platform, arch}` maps through the CI-validated manifest
  (4 builds, sha256 + size verified at publish). (`test-release-manifest.mjs`)
- **Claims pin everything.** The gateway token signs audience + exact object
  key + entitlement + ≤300 s expiry; the Worker and the API share one claim
  module, so mint and verify can't drift. (`test-download-gateway.mjs`)
- **Anti-enumeration restore.** Identical response for known/unknown emails,
  fail-closed rate limits, single-use 15-minute tokens stored only as hashes.
- **No document data anywhere.** The commerce service stores: session id,
  HMAC of email, payment-intent id, status. Never cards (Stripe's job),
  never customer documents (they stay on the customer's machine).
- **Ships disabled.** `COMMERCE_ENABLED=false` until the owner completes
  OWNER_LAUNCH_CHECKLIST.md; every endpoint 503s and the store shows a
  coming-soon state.

## Data model (Supabase `commerce_kv` — service-role only, RLS forced)

```
entitlement:<session_id>      {status, purchasedAt, emailHmac, priceId, …}
email:<hmac(email)>           → entitlement key
payment-intent:<pi_id>        → entitlement key
event:<stripe_event_id>       replay marker
restore:<sha256(token)>       {entitlementKey, expiresAt}   (single use)
rl:<scope>:<hash>:<window>    rate-limit counters
```

## Environment

Names only — see `.env.example`. Commerce requires every name in
`REQUIRED_ENV` (`api/_lib/commerce/commerce.mjs`) plus the flag;
anything missing keeps the store disabled rather than half-working.

## Tests

- `npm test` — includes commerce unit tests (mocked Stripe/R2/store/email),
  release-manifest validation, gateway claim loop, store static checks.
- `npm run test:store` — drives the real store pages in Chromium against a
  stubbed API server: coming-soon state, buy → success → download-link with
  SHA-256 shown, restore flow, 390 px responsiveness.

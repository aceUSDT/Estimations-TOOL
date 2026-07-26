# Owner launch checklist — turning the store ON

Commerce ships **disabled**. Work through this list top-to-bottom; the store
stays in "coming soon" until the final step, and nothing half-works in
between. Budget ~half a day plus waiting time for domain/identity approvals.

## 1. Accounts you need

- [ ] **Stripe** account activated for live payments (business details,
      bank account). Enable **Stripe Tax** if you want VAT handled.
- [ ] **Cloudflare** account with your domain `{ROOT_DOMAIN}` on it
      (R2 + Workers are used; free tier is fine to start).
- [ ] **Resend** account with a verified sending domain (for restore emails).
- [ ] **Azure Trusted Signing** (Windows) and **Apple Developer Program**
      (macOS) — required for signed installers; see the release runbook.

## 2. Stripe

- [ ] Create the product ("Estimation Tools — desktop licence") and ONE
      one-off **price**; note the `price_…` id.
- [ ] Add a webhook endpoint: `https://www.{ROOT_DOMAIN}/api/stripe-webhook`
      with events `checkout.session.completed`, `charge.refunded`,
      `charge.dispute.created`; note the `whsec_…` secret.
- [ ] Fill in your public business details (they appear on Stripe's checkout
      and receipts).

## 3. Cloudflare R2 + download gateway

- [ ] Create private bucket `estimation-tools-releases` (NO public access).
- [ ] Create an R2 API token scoped to that bucket (read/write); note
      account id, key id, secret.
- [ ] Deploy the gateway:
      `cd workers/download-gateway` → edit `wrangler.toml` (replace
      `{ROOT_DOMAIN}`) → `wrangler secret put DOWNLOAD_TOKEN_SECRET` →
      `wrangler deploy`. DNS for `files.{ROOT_DOMAIN}` is created by the route.

## 4. Vercel environment (Project → Settings → Environment Variables)

Set every name from `.env.example`:

- [ ] `SITE_URL=https://www.{ROOT_DOMAIN}`, `PRODUCT_DISPLAY_NAME`,
      `SUPPORT_EMAIL`, `LEGAL_SELLER_NAME`
- [ ] `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
      `STRIPE_TAX_ENABLED` if using Stripe Tax
- [ ] `DOWNLOAD_TOKEN_SECRET` — `openssl rand -base64 48`; the SAME value
      goes into the Worker secret (step 3)
- [ ] `FILES_DOWNLOAD_HOST=files.{ROOT_DOMAIN}`
- [ ] `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
      `R2_BUCKET=estimation-tools-releases`
- [ ] `RESEND_API_KEY`, `MAIL_FROM` (e.g. `downloads@{ROOT_DOMAIN}`)
- [ ] `GEMINI_API_KEY` + `GEMINI_MODEL` (extraction runtime — separate from
      commerce but same screen)
- [ ] Leave `COMMERCE_ENABLED` **unset/false** for now.

## 5. Legal page

- [ ] Read `download/legal/index.html` and adjust wording to your entity
      (seller name and support email are injected automatically; the refund
      window and licence wording are yours to own).

## 6. First release

- [ ] Complete `docs/PRODUCTION_RELEASE_RUNBOOK.md` §0–§3 — signed builds
      published to R2 with a validated manifest.

## 7. Dress rehearsal (Stripe test mode)

- [ ] Temporarily set the Stripe TEST keys + a test price, set
      `COMMERCE_ENABLED=true`, and buy with card `4242 4242 4242 4242`.
- [ ] Confirm: success page → 4 downloads work → SHA-256 matches → restore
      by email works → refund in Stripe dashboard kills the downloads.
- [ ] Swap back to LIVE keys.

## 8. Go live

- [ ] `COMMERCE_ENABLED=true` (with live keys) → redeploy → the store is on.
- [ ] Buy one real copy yourself and refund it (runbook §4).
- [ ] Calendar reminder: certificates (Apple, Azure) and the sending domain
      expire — check quarterly.

## If something goes wrong

Set `COMMERCE_ENABLED=false` and redeploy — the store returns to coming-soon
mode instantly; existing customers keep restore access disabled too, so only
do this for genuine incidents.

# Custom domain runbook — {ROOT_DOMAIN}

Every customer-visible URL uses your own domain; provider hostnames
(`*.vercel.app`, `*.workers.dev`, R2 endpoints) never appear in the product,
emails, or docs. Replace `{ROOT_DOMAIN}` with your real domain everywhere.

## Target layout

| Hostname | Serves | Hosted by |
|---|---|---|
| `www.{ROOT_DOMAIN}` | marketing + store (`/download/`) + `/api/*` + the web app | Vercel site |
| `app.{ROOT_DOMAIN}` | (optional) the application on its own hostname | Vercel site (second target) |
| `files.{ROOT_DOMAIN}` | paid installer downloads | Cloudflare Worker → private R2 |

A single Vercel site serving both marketing and app on `www` is the shipped
default; split `app.` out later without changing any code — the store only
uses relative `/api/…` paths.

## 1. DNS (at your registrar / Cloudflare)

- `www.{ROOT_DOMAIN}` → CNAME → your Vercel site's default hostname
  (Vercel → Domain management shows the exact target; use Vercel DNS or
  external DNS — either works).
- Apex `{ROOT_DOMAIN}` → redirect to `www` (Vercel does this automatically
  when both are added).
- `files.{ROOT_DOMAIN}` → created automatically by the Worker route when the
  zone is on Cloudflare (see step 3). If your DNS is NOT on Cloudflare, move
  the zone or delegate just that subdomain — R2 custom access requires
  Cloudflare in front.

## 2. Vercel

1. Site → Domain management → Add `www.{ROOT_DOMAIN}` (and the apex).
2. HTTPS is automatic (Let's Encrypt) once DNS resolves.
3. Set `SITE_URL=https://www.{ROOT_DOMAIN}` in the environment — the
   same-origin guard, Stripe redirect URLs, cookies, and restore links all
   derive from it. Nothing else needs editing.

## 3. Cloudflare Worker (files.)

```bash
cd workers/download-gateway
# edit wrangler.toml: replace both {ROOT_DOMAIN} occurrences
wrangler secret put DOWNLOAD_TOKEN_SECRET     # SAME value as Vercel's
wrangler deploy
```

The route `files.{ROOT_DOMAIN}/*` provisions DNS + TLS on the zone. Verify:

```bash
curl -sI https://files.{ROOT_DOMAIN}/releases/x
# → 403/404 from the Worker (NOT a Cloudflare error page)
```

Set `FILES_DOWNLOAD_HOST=files.{ROOT_DOMAIN}` in Vercel. Until this
variable exists, download links fall back to presigned R2 URLs — functional
for staging, but customer-visible R2 hostnames, so set it before launch.

## 4. Stripe + email alignment

- Webhook endpoint must use the final hostname:
  `https://www.{ROOT_DOMAIN}/api/stripe-webhook` (re-create it if you tested
  on a temporary hostname — the signing secret changes).
- Resend: verify `{ROOT_DOMAIN}` (or a subdomain) for sending;
  `MAIL_FROM=downloads@{ROOT_DOMAIN}` keeps restore emails on-brand and out
  of spam folders (set up SPF/DKIM as Resend instructs).

## 5. Verification sweep

```bash
# no provider hostnames leak to customers (also enforced by npm test):
node tools/coverage/test-store-static.mjs
# cookies are __Host- prefixed → require HTTPS + no Domain attribute: OK on
# any single hostname; nothing to change when you rename the site.
curl -s https://www.{ROOT_DOMAIN}/api/store-config | jq .
```

## Renaming later

Everything derives from `SITE_URL`, `FILES_DOWNLOAD_HOST`, and the Worker
route. To rebrand: update DNS, those two env vars, the wrangler route, and
the Stripe webhook endpoint. No code changes.

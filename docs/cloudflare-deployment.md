# Deploying Henna to Cloudflare Workers

Henna deploys to Workers through [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).
This document covers the adapter, Hyperdrive, Workers secrets, Resend DNS, and
the GitHub Actions pipeline.

---

## 1. What works on Workers, and what does not

| Component | On Workers | Notes |
| --- | --- | --- |
| Next.js App Router (SSR, Server Actions, Route Handlers) | Yes | Via OpenNext |
| `node:crypto` — scrypt, AES-256-GCM, HMAC | Yes | Requires `nodejs_compat` |
| TOTP (`otpauth`) | Yes | Pure TypeScript, no native code |
| PostgreSQL via Hyperdrive | Yes | See §3 |
| JMAP from the browser | Yes | The browser talks to upstream directly |
| IMAP/SMTP from the server | **No** | Workers has no raw TCP sockets |
| Node.js Middleware | **No** | See §2 — it is not a security boundary anyway |

**The IMAP/SMTP trade-off, stated plainly.** Workers cannot open a TCP socket, so
`imapflow` and `nodemailer` cannot run there. Rather than fake it, Henna scopes
the fallback honestly:

- On **Workers**, JMAP is the supported path. The IMAP/SMTP option is hidden, and
  the UI says why.
- On **self-hosted Node.js**, both paths are available, SMTP is restricted to
  587/465, and port 25 is refused outright.

`lib/mail/protocol.ts` exposes `supportsImapFallback(runtime)` so this decision
lives in one place.

## 2. Why Middleware is not the gate

Next.js Node.js middleware does not run on Workers. Henna never relied on it for
security, which is why this is a non-issue rather than a migration:

- Every protected Server Action, Route Handler and Server Component calls a DAL
  guard (`requirePrincipal`, `requireAdmin`, `requireOwnershipOrAdmin`).
- `middleware.ts` exists only for optimistic redirects — it saves an
  authenticated visitor a wasted render. Delete it and security is unchanged.

This is worth repeating for anyone reviewing the code: **if you find an access
control that only exists in middleware, it is a bug.**

## 3. Hyperdrive

Workers cannot use a long-lived `pg` pool the way Node.js can, so Henna connects
through Hyperdrive.

```bash
npx wrangler hyperdrive create henna-db \
  --connection-string="postgres://user:pass@db.example.com:5432/henna"
```

Put the returned ID into `wrangler.jsonc`:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "<HYPERDRIVE_CONFIG_ID>"
  }
]
```

Henna reads `env.HYPERDRIVE.connectionString` and, critically, **never calls
`pool.end()`** — the platform owns the socket lifecycle. `db/index.ts` switches
between Hyperdrive and `DATABASE_URL` with one factory function.

## 4. `wrangler.jsonc`

```jsonc
{
  "name": "henna",
  "main": ".open-next/worker.js",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "vars": {
    "DOMAIN": "[\"example.com\"]",
    "ADMIN": "root@example.com",
    "HENNA_TRUST_PROXY": "1"
  },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<HYPERDRIVE_CONFIG_ID>" }]
}
```

`compatibility_date` must be **2024-09-23 or later**, and `nodejs_compat` must be
on — without it, `node:crypto`'s scrypt is unavailable and every password
operation fails.

## 5. Workers secrets

Plain variables go in `vars`. Secrets never do:

```bash
npx wrangler secret put jwt_secret
npx wrangler secret put HENNA_CREDENTIAL_KEY
# Optional if you will configure them in /admin/settings:
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
```

Values pasted here are encrypted by Cloudflare and injected at runtime. They are
not in your repository and not in your build output.

## 6. Resend and DNS

1. Add your sending domain in Resend.
2. Add the DNS records it gives you:
   - **SPF** — a `TXT` record authorising Resend.
   - **DKIM** — a `CNAME` (or `TXT`) record for the selector Resend specifies.
   - **DMARC** — a `TXT` record at `_dmarc`, starting at `p=none` and tightening
     once you have confirmed legitimate mail is aligned.
3. Wait for verification (usually a few minutes, occasionally a few hours).
4. Put the API key and `From` address in `/admin/settings`.

Henna displays the upstream SPF/DKIM/DMARC verdicts on incoming messages and does
not soften a failure. That display is only as good as your domain's records —
with no DMARC policy, there is no policy to pass.

## 7. GitHub Actions pipeline

`.github/workflows/deploy.yml` runs on every push to `main`:

```
install → tsc --noEmit → biome → unit tests → Playwright E2E
                                                    ↓ (only if green)
                                    opennextjs-cloudflare build → wrangler deploy
```

The `deploy` job declares `needs: quality`. A failed typecheck, a lint error or a
red test means nothing ships.

**Repository secrets** (*Settings → Secrets and variables → Actions*):

| Secret | Required | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | Deployment credential, CI only |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Target account |
| `DOMAIN` | Yes | JSON array of mail domains |
| `ADMIN` | Yes | Bootstrap administrator |
| `JWT_SECRET` | Yes | Session signing key |
| `HENNA_CREDENTIAL_KEY` | Yes | Credential encryption key |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | No | Use `/admin/settings` instead |
| `RESEND_API_KEY` / `HENNA_EMAIL_FROM` | No | Use `/admin/settings` instead |

The deployment step uses `cloudflare/wrangler-action@v4`.

## 8. First boot on Workers

1. Visit `https://your-worker.workers.dev/api/health`. A `503` with an `issues`
   array tells you exactly which root variable is missing.
2. Fix it, redeploy, refresh. You want `"status": "ok"`.
3. Sign in as `ADMIN` with an email code, set a password, enable TOTP.
4. Configure GitHub OAuth and Resend in `/admin/settings`.
5. Set `AUTH_URL` to your real origin — the GitHub callback URL is derived from
   it and must match the OAuth app exactly.

## 9. Local development against Workers

```bash
cp .dev.vars.example .dev.vars   # fill in
npm run preview                  # opennextjs-cloudflare build && wrangler dev
```

`wrangler dev` runs the Worker locally with bindings, so you can exercise the
Hyperdrive path before deploying. For pure UI work, `npm run dev` (plain Next.js)
is faster.

## 10. Rollback

Workers keeps previous deployments. To roll back, re-run the workflow from an
earlier commit, or deploy a known-good build:

```bash
git checkout <known-good-sha>
npm run deploy
```

If the bad deployment involved a credential key change, remember that rolling
back the *code* does not roll back the *key*. Keep the previous key in
`HENNA_CREDENTIAL_KEY` until you are sure you do not need to roll back.

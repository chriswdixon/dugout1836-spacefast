# Dugout 1836 on Spacefast

A full-stack app (a youth-baseball parent portal) running **entirely on [Spacefast](https://spacefast.com)** — no external backend. It started life as a Lovable/Supabase app (TanStack Start SSR + Supabase Postgres/Auth/Storage) and was migrated onto Spacefast's **Functions** runtime.

Shared as a **reference implementation** for the FDE team: how to move a typical "AI-app-builder" stack onto Spacefast, and what the platform's runtimes actually give you.

**Live:** https://dugout1836.view.fast/

---

## What it demonstrates

- A **Spacefast Functions** worker (a Cloudflare Worker: `fetch`, WebCrypto, npm, an opt-in **MySQL** database via the `env.DB` D1-shaped binding, and object storage via `env.STORAGE`) serving a JSON API.
- A **static React + TanStack Router SPA** served from the same space; the worker owns `/api/*`, static files serve everything else, and the worker hands back the SPA shell for client routes.
- **Custom email/password auth** (PBKDF2 + CSPRNG bearer-token sessions), roles, invites, admin bootstrap, and password reset — built by hand because the platform's identity is federated (Google/Gravatar), not password-based.
- A **policy-driven generic data layer** (`/api/data/<table>`) that replaces per-row RLS with a small per-table access policy.
- **Source sync** (GameChanger + Five Tools) as deterministic, keyless scrapers (Jina Reader), writing into the worker DB.
- **Object storage** for photo/video uploads + a Google Photos importer, with relative (domain-agnostic) media URLs.
- A **Supabase-compatibility shim** so the existing React components kept calling `supabase.from(...)` / `.auth` / `.storage` while everything routed to the new API — the SSR→SPA and data-layer swap without rewriting every call site.

## Layout

```
spacefast/          # the Spacefast Functions worker (the backend)
  sf.jsonc          #   runtime: { kind: "functions", entry: "handler.ts", database: true }
  handler.ts        #   fetch handler + router; owns /api/*, serves the SPA shell otherwise
  db.ts             #   MySQL schema + idempotent migrations (env.DB is D1-shaped over MySQL)
  auth.ts           #   custom email/password auth (bearer sessions), guards
  data.ts           #   generic /api/data/<table> REST with a per-table access policy
  sync.ts,
  gamechanger.ts,
  fivetools.ts      #   deterministic Jina-based source sync
  storage.ts,
  gphotos.ts,
  phototags.ts      #   uploads (env.STORAGE), Google Photos import, AI jersey tagging
  resets.ts,
  importer.ts       #   password reset + one-time data import
src/                # the React/TanStack SPA (front-end)
  integrations/api/ #   session store, api client, and the Supabase-compat shim
scripts/deploy.sh   # build the SPA + assemble worker + publish to a space
docs/               # SPACEFAST_MIGRATION.md (full write-up) + FRONTEND_MIGRATION_SPEC.md
```

## Deploy

Needs the [`sf` CLI](https://spacefast.com/docs/cli) (`sf login`).

```bash
npm install
scripts/deploy.sh "my message"      # builds the SPA, assembles deploy/, publishes to a space
```

Set secrets on the space (see `.env.example` for the list):

```bash
sf env set ADMIN_EMAILS you@example.com    # first signup with this email becomes admin
sf env set SYNC_SECRET <random>            # then re-deploy
```

## Notes / gotchas worth knowing (the FDE-relevant part)

- Spacefast has two runtimes. **Zero** (a QuickJS capsule with its own DB) has **no `fetch` and no WebCrypto** — wrong fit for a scraping + password-auth app. **Functions** (a Cloudflare Worker) has both; that's what this uses.
- The Functions DB binding is **D1-shaped but backed by MySQL** — use MySQL DDL (`VARCHAR(n)` keys, `INSERT ... ON DUPLICATE KEY UPDATE`, `TINYINT` booleans).
- The CDN in front of the worker **strips `Set-Cookie`**, so sessions are **bearer tokens** (`Authorization: Bearer`), stored client-side.
- Store uploaded-media URLs **relative** (`/__stattic/…`) so they survive a space rename / custom domain.
- `sf dev` can't run the Functions runtime locally yet — you build with your framework's dev server and `sf publish`.

Full details, including the staged plan and every platform quirk found along the way, are in [`docs/SPACEFAST_MIGRATION.md`](docs/SPACEFAST_MIGRATION.md).

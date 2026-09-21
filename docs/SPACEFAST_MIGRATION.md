# Dugout 1836: Lovable to Spacefast migration

Status: **COMPLETE.** The full app runs on Spacefast (https://pixelated-circuit.view.fast/), off Lovable/Supabase.
Branch: `spacefast-migration` (leave `main` alone; Lovable owns it and syncs it).

## Final state (all stages done)

- **Auth** (Stage 2): custom email/password, roles, invites, admin bootstrap, **password reset** (admin-generated links keyless; self-serve email when `RESEND_API_KEY` set).
- **Data** (Stage 3): all 15 tables on MySQL, one policy-driven `/api/data/<table>` layer.
- **Sync** (Stage 4): **GameChanger + Five Tools** ported as deterministic Jina parsers — **no Firecrawl, no keys**. Perfect Game uses the LLM path (needs an AI key). Admin scan at `/api/admin/scan`.
- **Storage** (Stage 5): `env.STORAGE` — family photo/video uploads + **Google Photos import** (keyless; live re-import of NEW photos is best-effort since Google serves a JS shell to server fetches) + **AI jersey tagging** (configurable vision model; graceful without a key). Google Drive import stays a stub (needs Google OAuth).
- **Front-end** (Stage 6): the real TanStack UI, SSR→SPA, on Spacefast.
- **Backfill** (Stage 7): real data migrated from the old Supabase — 32 events, 15 players, 10 team_stats, 2 albums, **454 photos** (images copied into `env.STORAGE`), 247 photo tags. (player_stats were RLS-blocked to the anon key; team stats / line scores came through.)

Deploy: `scripts/deploy.sh`. Owner signs in with an `ADMIN_EMAILS` address to be admin.

Optional env to light up extras (`sf env set` + redeploy): `AI_API_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_VISION_MODEL` (Perfect Game sync + AI photo tagging), `RESEND_API_KEY`/`RESET_FROM_EMAIL` (self-serve reset email), and the GameChanger/Five Tools team URLs in the admin Sources panel.

---
_Historical planning notes below._

Branch: `spacefast-migration` (leave `main` alone; Lovable owns it and syncs it).

## Decisions (made, not up for re-litigation)

1. **Full native re-platform onto Spacefast Zero.** Nothing stays on Lovable Cloud or Supabase. The database, all server logic, crons, and storage move into a Zero capsule.
2. **Custom email/password auth.** Zero has no app-managed password identity (its real identities are Google and Gravatar; a password "stays a guest"). We keep today's UX by building our own sessions in Zero endpoints: a users table with hashed passwords, session cookies, invites, and password reset. Every request is a Zero "guest"; all authorization happens in handler code.
3. **Keep the React/TanStack/shadcn front-end as a static SPA.** Zero's native UI is Preact + a WordPress/Gutenberg page model. Rewriting ~25 routes and ~60 shadcn components into that is a rewrite, not a migration. Instead we drop SSR, ship the existing UI as static files, and call Zero endpoints over the same origin with `fetch`. We lose SSR, which does not matter for an auth-gated private portal.

## What Dugout 1836 is today

- Front-end: TanStack Start (React 19) SSR app, built through Nitro (default target Cloudflare), Tailwind v4, shadcn/Radix.
- Backend: Lovable Cloud, which is three things:
  - Supabase Postgres (15 tables, 30 migrations) + Supabase Auth (email/password + invites).
  - Lovable AI gateway (`ai.gateway.lovable.dev`) for LLM extraction of scraped pages. Pure lock-in; gets replaced.
- External services (portable, plain `fetch` + API key): Firecrawl (stealth/render scraping of GameChanger behind CloudFront), Jina reader (fallback), Google Drive and Google Photos.
- Server work that needs a runtime: the scrape + extract, a cron sync hook, image-proxy routes.

## The Zero programming model (the constraints that shape everything)

From `@spacefast/zero@0.4.1` type definitions, verified, not guessed:

- **Capsule**: `capsule({ name, favicon, schema, queries, mutations, endpoints, collections, connectors, sync })`.
- **Tables**: `table({ field: string() | boolean() | id("otherTable") }).index(name, [fields])`. Every row auto-gets `id`, `createdAt`, `updatedAt`.
  - **Only three field kinds: `string`, `boolean`, `id`.** No native number, datetime, or JSON columns. Numbers, timestamps, JSON blobs, arrays, and enums all get **string-encoded**.
  - `id("table")` is an unenforced reference (a string). **No foreign keys, no cascades.** Referential integrity is our job in handler code.
- **Queries are index-only** (Convex-style): `db.t.get(id)` or `db.t.withIndex(idx, q => q.eq/gt/gte/lt/lte(...)).order("asc"|"desc").collect()/.take(n)/.first()/.paginate({cursor,numItems})`. **No ad-hoc WHERE, no SQL joins.** Every access pattern needs a declared index; joins are done in code.
- **Writes** (mutation / write endpoint only): `.insert(v)`, `.update(id, patch)`, `.delete(id)`.
- **Handlers**:
  - `query(handler)` gets `{ auth, db (read), env, gravatar, log, spam.check, connectors }`. Subscribable (live queries).
  - `mutation(handler)` adds `db (write)`, `email` (transactional outbox), `invalidate(...queryNames)`, full `spam`.
  - `endpoint({ method, path, mode: "read"|"write" }, (ctx, req) => ...)` for raw HTTP. `req.method/path/url/headers/query/text()/json()/bytes()`. Respond with `json()/text()/empty()/redirect()/ImageResponse`.
- **Runtime is QuickJS** next to a per-space **MySQL** DB. `fetch` is available (all our scraping/LLM calls survive). Node built-ins are not. Password hashing must be pure-JS or WebCrypto (see risks).
- **Secrets**: `sf env set NAME`, read at runtime via `ctx.env.NAME`.
- **Crons**: declared in `sf.jsonc` as `{ path, schedule }`, fired as an unauthenticated `GET` through the front door. The sync endpoint must protect itself with a shared secret (the existing `cron-auth.ts` pattern carries over).
- **Front-end**: a static Vite `dist` publishes fine; `@spacefast/vite-plugin` compiles `_redirects`/`_headers`. Our React SPA is just static files that call endpoints; we do not have to use Zero's Preact client.
- **Capsule entry** (confirmed via `sf init --runtime zero`): `sf.jsonc` declares `runtime: { kind: "zero", server: "server/index.ts", client: "client/index.tsx" }`; `server/index.ts` does `export default capsule({ name, schema, queries, mutations, endpoints })`. The `queries`/`mutations` RPC layer (what Zero's Preact `useQuery`/`useMutation` call) keys off `ctx.auth.userId`. Because our auth is custom (everyone is a Zero guest), **we drive the app through `endpoints` and our own session cookie, not that RPC layer.**

## Schema mapping: Postgres to Zero

Drop every `id`, `created_at`, `updated_at` column (Zero provides `id`/`createdAt`/`updatedAt`). Encoding rules:

| Postgres | Zero | Encode/decode |
| --- | --- | --- |
| text / varchar | `string()` | as-is |
| boolean | `boolean()` | as-is |
| integer / numeric | `string()` | `String(n)` / `Number(s)`; null -> "" or omit |
| timestamptz | `string()` | ISO 8601 string (already how the app passes them) |
| jsonb | `string()` | `JSON.stringify` / `JSON.parse` |
| text[] | `string()` | JSON array string |
| enum (data_source, app_role) | `string()` | validate against a const union in code |
| FK uuid | `id("table")` | unenforced ref |

### Tables (15 app + 3 auth)

App tables and their columns are enumerated in `server/schema.ts`. Indexes to declare (one per access pattern the app actually uses; refine as endpoints get ported):

- `players`: by sortOrder; by externalId.
- `events`: by startsAt; by source; by externalId.
- `player_stats`: by playerId; by season; by eventId; by externalId.
- `team_stats`: by season; by category.
- `albums`: by sortOrder; by season; by eventId; by driveFolderId.
- `album_photos`: by albumId; by eventId; by driveFileId.
- `media_items`: by eventId; by source; by externalId.
- `photo_tags`: by albumPhotoId; by photoUploadId; by playerId.
- `photo_uploads`: by albumId; by eventId; by uploadedBy.
- `invites`: by email; by code.
- `profiles`: by email (one profile per user; `id` == user id).
- `user_roles`: by userId.
- `source_configs`: by source.
- `staged_records`: by syncRunId; by status.
- `sync_runs`: by source; by startedAt.
- `chat_messages`: by createdAt.

### New auth tables (custom email/password)

- `users`: email (string, unique via by_email index), passwordHash (string), passwordSalt (string), status (string: pending/approved), createdAt.
- `sessions`: userId (id("users")), tokenHash (string), expiresAt (string ISO), by_tokenHash index, by_userId index.
- (invites and profiles already exist and cover the invite/approval flow; `user_roles` covers admin/parent.)

## Authorization: 59 RLS policies become handler code

Supabase enforced access with 101 `auth.uid()` checks across 59 RLS policies plus `has_role`/`is_member`/`handle_new_user` security-definer functions. Zero has no RLS. The model to reimplement, centrally, in a shared auth helper:

- `requireUser(ctx, req)`: read session cookie -> sessions table -> users row, or 401.
- `requireApprovedMember(ctx, req)`: user exists and profile.status == approved / is_member equivalent, or 403.
- `requireAdmin(ctx, req)`: user has an `admin` row in user_roles, or 403.
- Every read/write endpoint calls the right guard before touching `db`. Ownership checks (e.g. a parent editing only their own upload) are explicit comparisons in the handler.
- `handle_new_user` trigger -> done explicitly in the signup mutation (create user + profile in one write path).

## Server logic to port (Zero endpoints + crons)

- `POST /api/sync` (write, cron-secret gated) <- `routes/api/public/hooks/sync-sources.ts` + `sources.server.ts` + `gamechanger.server.ts` + `fivetools.server.ts`. Writes to `sync_runs`, `staged_records`. Scraping via Firecrawl/Jina `fetch` (QuickJS-safe).
- LLM extraction: replace `ai.gateway.lovable.dev` with a direct provider (Anthropic or OpenAI) via `fetch`, key in `ctx.env`.
- Google Drive / Google Photos ingestion: `drive.functions.ts`, `gphotos.server.ts`, `gphotos.functions.ts` -> endpoints. Confirm the Google auth model (API key vs OAuth) survives QuickJS.
- Image proxy: `routes/api/drive-image.ts`, `routes/api/album-photo.ts` -> read endpoints returning bytes (or `ImageResponse`).
- Photo tagging: `photo-tags.server.ts` -> endpoints.
- Cron: nightly source sync -> `sf.jsonc` cron hitting `/api/sync?token=...`.

## Storage

Supabase Storage buckets (photo uploads, 16 references) move to Zero object storage (`sf storage`, browser/API upload -> id + URL). Access control that RLS did on `storage.objects` becomes guard checks in the upload/read endpoints.

## Front-end changes

- Remove TanStack **Start**/SSR; keep TanStack **Router** in SPA mode (or a plain Vite React build). Drop `src/server.ts`, `src/start.ts`, the Nitro/Lovable vite config, the auth middleware server bits.
- Replace `@supabase/supabase-js` calls:
  - `supabase.auth.*` -> `fetch` to `/api/auth/*` (login, logout, session, signup, reset). Rewrite `useAuth`.
  - `supabase.from(...).select/insert/...` -> `fetch` to our query/mutation endpoints.
- Build to static `dist`, add `@spacefast/vite-plugin`, publish with `sf publish dist`.
- `_redirects`: SPA fallback so client routes resolve; make sure it does not shadow `/api/*` endpoints (Zero: one owner per route).

## Data migration (one-time backfill)

The live Supabase data has to come across. Plan: export each table from Supabase (SQL/CSV or REST), transform to the Zero encoding, and load through a one-time admin import endpoint or `sf db`. Users/passwords cannot be migrated (Supabase password hashes are not portable and we changed the scheme) -> every parent does a one-time password reset / re-invite on cutover. Preserve profile emails and roles so invites/roles map by email.

## Open risks

1. **Password hashing in QuickJS.** Need WebCrypto (PBKDF2) if available in the runtime, or a vetted pure-JS hash. Verify before building auth. This gates Stage 2.
2. **Google Drive/Photos auth under QuickJS.** If it needs OAuth refresh flows or Node crypto, may need rework.
3. **No FK / no transactions across tables.** Multi-table writes (signup = user + profile + role) are not atomic. Order writes so a partial failure is recoverable; add cleanup.
4. **Index-only queries.** Any access pattern without a matching index needs one added; full-table scans are not a thing.
5. **Number/JSON-as-string** everywhere means a typed encode/decode layer, or bugs creep in. Build a small row-codec per table.
6. **Data backfill fidelity** for jsonb stats and arrays.
7. **SPA + capsule co-hosting.** A Zero capsule ships its own Preact `client`. How a full external React SPA (built to static `dist`) coexists in the same space as the capsule (which owns `/api/*` and one route inventory) is not yet proven. Resolve in Stage 6: either serve the SPA as the space's static site alongside the capsule, or confirm `sf.jsonc` can point the static front-end at our `dist`. "One owner per route" means `/api/*` must belong to the capsule and everything else falls through to the SPA.

## Stage 1 findings (verified in the real Zero runtime via `sf dev`)

Proved against `@spacefast/zero@0.4.1`, QuickJS runtime, `sf dev --state-backend sqlite`.

**Works:**
- Inline-literal schema migrates on boot. `db.users.insert(...)` + `withIndex("by_email").first()` round-trips, `id`/`createdAt` auto-populated. The indexed-query DB model is solid.
- Endpoints work; the dev server gates the (private) space behind a capability, passed as `Authorization: Bearer <capability>`.

**Hard runtime limits (these change the approach):**
1. **No raw `fetch` in the capsule.** `fetch is not defined`. Outbound HTTP is only possible through **declared connectors** (catalog integrations described by OpenAPI/GraphQL/MCP with bound credentials), called via `ctx.connectors.<role>.<tool>()`. There is no arbitrary outbound HTTP.
2. **No WebCrypto, no `crypto.getRandomValues`, no `TextEncoder`.** Spacefast's own package says it plainly: "the SHA-256 is hand-rolled because QuickJS has no WebCrypto." Custom password hashing would be hand-rolled SHA-256/PBKDF2 in pure JS with **no CSPRNG** for salts or session tokens. That is a real security weakness, and it is the runtime telling us it is not built for password auth.
3. **Static global allowlist.** `globalThis` is refused ("unsupported server global"); the schema must be an **inline object literal** in the capsule call (an imported `schema` variable is refused). `server/schema.ts` as a separate module does not work; the schema has to live inline in `server/index.ts`.

**What this means for THIS app.** Dugout 1836's engine is scraping (Firecrawl stealth render of GameChanger/Fivetools) + LLM extraction + Google Drive/Photos ingestion. All of that is arbitrary outbound HTTP, which the Zero capsule runtime cannot do. Each would have to become a custom OpenAPI/MCP connector (Firecrawl, an LLM provider, Google) or move out of Zero entirely. And custom email/password auth is now fighting the runtime (hand-rolled crypto, weak entropy). Zero is built for DB-backed CRUD with federated (Google/Gravatar) identity and catalog connectors, not for a fetch-heavy ingestion pipeline with password auth. **The approved "full native re-platform onto Zero" is a poor fit for the ingestion half of this app. Decision needed before proceeding (see below).**

### Options on the table (post Stage 1)

- **A. Zero for DB + portal; sync engine runs outside Zero.** Keep the DB and the CRUD portal in the Zero capsule. Move scraping/extraction/Google ingestion to an external job (GitHub Action, a small worker, or a Mac cron) that pushes rows into Zero through secret-gated write endpoints. Native-on-Zero for everything except the part that needs `fetch`.
- **B. Use Spacefast Functions (worker), not Zero.** If the Functions/OpenNext worker runtime has `fetch` and a Node-ish environment, far more of the existing server code ports directly; bring an external DB (or reach the Zero DB from the worker via `env.ZERO`). Needs a runtime capability check first.
- **C. Revisit the destination.** For a scraping+auth app, the earlier "host swap, keep Supabase" or the app's native Cloudflare/Nitro target is much less friction than full-Zero. Only if the goal is "get it off Lovable" more than "be on Zero specifically."
- **Auth, regardless of the above:** reconsider adopting Zero-native Google/Gravatar identity instead of custom passwords, to avoid hand-rolling crypto.

## Stage 1b: Functions runtime check (the answer changes the whole plan)

Verified from Spacefast's own docs (`sf docs runtimes`, `runtimes/functions`):

> "Functions is a Cloudflare worker with one `fetch` handler and any npm package." Opt into a database with `"database": true`. `sf.jsonc`: `runtime: { kind: "functions", entry: "handler.ts" }`.

A Cloudflare Worker has everything the Zero capsule lacked:
- **`fetch`** -> scraping (Firecrawl/Jina), LLM extraction, and Google Drive/Photos all work as plain HTTP, essentially as-is.
- **WebCrypto** (`crypto.subtle`, `getRandomValues`, `TextEncoder`) -> custom email/password auth with real PBKDF2 and secure random. No hand-rolled crypto.
- **Any npm package** -> the existing server libraries port instead of being rewritten.
- **Opt-in database** (`"database": true`) for the 15 tables.

And the app already builds through Nitro with **Cloudflare as its default target**, so its server output is already a Worker `fetch` handler. This is a near-direct re-platform, not a rewrite.

Caveat I could not remove locally: **`sf dev` cannot run the Functions runtime yet** ("use your framework's dev server, then `sf publish`"). The final runtime proof needs a real published space. The runtime's capabilities are not in doubt (it is Cloudflare Workers); what a publish will confirm is the build wiring and the DB binding.

### Revised target architecture (Functions, not Zero)

- **Host**: Spacefast Functions (Cloudflare Worker). Serve the app + API from one `fetch` handler; static assets alongside.
- **Front-end**: keep the React/TanStack/shadcn app. Open question: does Spacefast Functions accept the app's Nitro-Cloudflare worker output directly, or only `handler.ts` / an OpenNext (Next.js) build? If not direct, wrap the Nitro output in a `handler.ts` or add an adapter. (Build-time question, resolved on first publish.)
- **Database**: `"database": true`. Confirm the binding + client and whether it is raw MySQL with real column types (int/datetime/json) or the Zero string-model. If raw MySQL, the schema work is a normal Postgres->MySQL migration (real types), not the string-encoding in `server/schema.ts` -> **that scaffold is Zero-specific and gets replaced if we go Functions.**
- **Auth**: custom email/password with real WebCrypto (PBKDF2 + `getRandomValues`). The Stage-2 auth plan stands, now on solid crypto.
- **Server logic**: port `.server.ts` scraping/extraction/Google as ordinary fetch code. Swap the Lovable AI gateway for a direct provider.
- **Crons**: `sf.jsonc` cron -> `/api/sync`, secret-gated.
- **Secrets**: `sf env set` -> worker env.

### What carries over vs gets dropped, if we go Functions

- Keep: the whole architecture doc's schema *mapping intent*, the auth design, the server-logic port list, the data-backfill plan.
- Drop/redo: `server/schema.ts` (Zero string-model) and `server/index.ts` (Zero capsule) are Zero-specific. Under Functions the schema is real SQL and the entry is a Worker `fetch` handler.
- The `spacefast-migration` branch and this doc stay.

## Stage 1c: first Functions publish (done, anonymous space live)

Published a minimal Functions foundation worker (landing page + `/api/probe`) anonymously. The Functions build compiled and deployed clean on real Spacefast infra:

- Space: `spc_b10a5fd8fe594973a7c523e99eb711f6` (anonymous, unclaimed), slug `pixelated-circuit`.
- Live: `https://pixelated-circuit.view.fast/` (private until claimed + access granted).
- Version `v1` (`ver_d2a0b766...`): status `ready`. Response carries `x-spacefast-runtime: 1` -> the worker runtime is live.
- Claim link (one-time, sensitive, expires 2026-09-23): handed to Chris in chat, not committed. The local link + claim token live in `.spacefast/` (gitignored).

This confirms the Functions runtime path end to end. `/api/probe` (fetch + WebCrypto checks) is behind the private access gate; it verifies as soon as the space is claimed and access is opened. Foundation worker source is in the scratchpad (`fnproof/`); it moves into the repo when the real port starts.

Next: Chris claims the space (into a personal account/team, off the work chris-team) so subsequent versions publish through his account and the portal can be made reachable. Then Stage 2 (auth) onward.

## Stage 2: custom auth (built + deployed, verification pending access)

Space claimed into Chris's personal team. Built the auth worker in `spacefast/` and published to the claimed space (v4, ready):

- `sf.jsonc`: `runtime.kind = functions`, `entry = handler.ts`, `database = true` -> the worker gets `env.DB`, a D1 (SQLite) binding. Real SQL, real column types (so Stage 3's schema is a normal Postgres->SQLite migration, not Zero's string-encoding).
- `db.ts`: D1 typings + idempotent schema bootstrap (`ensureSchema`, `CREATE TABLE IF NOT EXISTS`) for the auth tables: users, sessions, profiles, user_roles, invites.
- `auth.ts`: PBKDF2-SHA256 password hashing + CSPRNG (`getRandomValues`) session tokens (store `sha256(token)`, httpOnly Secure SameSite=Lax cookie); guards `requireUser`/`requireAdmin`; handlers for signup (invite-gated -> approved, else pending), login (constant-time, uniform timing), logout, session, admin bootstrap (env-secret seeds the first admin), invite creation.
- `handler.ts`: worker entry + router; `/api/auth/*`, `/api/admin/*`, `/api/probe` (also checks the `env.DB` binding).

**Stage 2 is verified end to end on live infra** (space made public viewer; app-level auth gates data). All auth flows pass: signup (201, invite-gated), session, logout (invalidates token), login, wrong-password (401), duplicate (409), short-password (400), admin bootstrap (secret-gated, wrong secret 403), invite creation (admin-only), invite -> approved, uninvited -> pending.

### Platform gotchas learned in Stage 2 (these shape every later stage)

1. **`env.DB` is D1-*shaped* but backed by MySQL**, not SQLite. Use MySQL DDL: `VARCHAR(n)` for every keyed/indexed column (TEXT in a key errors 1170), inline `UNIQUE KEY`/`KEY` indexes, `TINYINT(1)` booleans, `INSERT IGNORE` (not `INSERT OR IGNORE`). `env` also exposes a `STORAGE` binding (for Stage 5).
2. **The Automattic CDN in front of the worker strips `Set-Cookie`.** Cookies never reach the client. Session transport is therefore a **bearer token**: signup/login return `{ token, ... }`, the client sends `Authorization: Bearer <token>`, the worker reads it there. (The space access gate uses `x-sf-authorization`, so the standard `Authorization` header is ours.) Tradeoff: token lives in the SPA (localStorage) rather than an httpOnly cookie; acceptable given the edge behavior.
3. **Env vars need a republish to bind** into the worker. `sf env set` then `sf publish`.
4. **Public reachability + bot protection**: a public `viewer` grant (`sf share grant --to public --role viewer --path '/**'`) makes routes reachable, but the CDN returns Cloudflare **error 1010** to bot-signature user agents. Real browsers (the SPA) are fine; scripted checks must send a browser `User-Agent`.
5. **Testing a private space**: a `sf share token` machine credential is sent as `x-sf-authorization: Bearer <token>`, but a plain viewer grant did not authorize worker dispatch, so we went public. Public + app-auth is the portal's real posture anyway.

### Housekeeping / follow-ups
- `ADMIN_BOOTSTRAP_TOKEN` currently holds a throwaway test secret. Chris should `sf env set ADMIN_BOOTSTRAP_TOKEN` to his own value, republish, and `POST /api/admin/bootstrap` to promote his real admin account.
- Test accounts (parent1/2/3, invited, random) sit in the DB; harmless, cleared at Stage 7 backfill.
- `spacefast/` is a self-contained Functions app for now; merges with the React front-end (static assets) at Stage 6. `.spacefast/` + `__spacefast/` are gitignored.

## Stage 6 DONE: full TanStack UI ported to a static SPA on Spacefast

The real app is live at https://pixelated-circuit.view.fast/ — the actual TanStack UI, converted off SSR to a plain Vite + TanStack Router SPA, off Supabase onto the worker API. Verified in a browser: home, schedule/calendar, roster, stats, and the admin panel (Families/invites/approvals) all render live data; client routing and hard-refresh deep links work; role-based UI (admin badge) works.

How it was done:
- **Build**: `vite.config.ts` (Vite + `@tanstack/router-plugin` SPA, react, tailwind), `index.html` + `src/main.tsx` entry, `__root.tsx` shell stripped of SSR (`HeadContent`/`Scripts`/`shellComponent`). Deleted `start.ts`, `server.ts`, `routes/api/*`, sitemap, and the Lovable/Supabase server-only integration files.
- **Data/auth**: `src/integrations/api/{session,client,supabase-shim}.ts` — bearer-token session store, API client, and a Supabase-compatible shim; `integrations/supabase/client.ts` re-exports the shim so component call sites are unchanged. The shim does eq-filters server-side and the rest client-side.
- **Server functions**: converted to client calls; `checkInviteCode` -> public `/api/invites/check`, `adminUpdateUser` -> profile update. Scan/drive/gphotos/photo-tags are graceful stubs pending Stage 5 + re-homed keys.
- **Worker**: added invites/profiles/user_roles to the data layer.
- **Deploy** (`scripts/deploy.sh`): build SPA -> assemble `deploy/` = dist + worker -> inject the built `index.html` into the worker fallback (so the catch-all worker serves the SPA shell for non-API routes) -> `sf publish`.

### What is stubbed / still needs work
- **Photos/media**: albums, uploads, tags, galleries need Stage 5 (object storage `env.STORAGE` + image proxy + Google Drive/Photos). The Photos tab renders structure but no images yet.
- **Source scan / AI tagging / Drive / GPhotos** admin actions throw a friendly "not available yet" until Firecrawl/AI keys (`sf env set`) and Google credentials are wired.
- **Password reset** + Google sign-in: removed (no endpoints).
- Shim edge cases: client `upsert` maps to insert; non-id updates/deletes are unsupported (the app uses id-based writes).

## Superseded: earlier "minimal SPA" note

The prior `spacefast/index.html` vanilla SPA was the interim deploy; it is replaced by the full ported app above. (The file remains in `spacefast/` but is no longer what ships — `deploy/` is built from the React app.)

## Old Stage 6 status (kept for history): working deployed front-end (core)

The existing app is deep TanStack **Start** SSR (createStart, CSRF, h3, server-entry, Nitro) with ~19 routes, ~30 queries (some with embedded-relation joins the generic REST layer does not do), Supabase Storage, a heavy admin panel, and Lovable-hosted deps (AI gateway, Google Drive connector, Google OAuth). A faithful SSR->SPA port of all of that is a multi-session effort and will not converge cleanly in one pass.

To deliver a **real, working, deployed** site now, `spacefast/index.html` is a dependency-free static SPA (login/signup + an authed dashboard: Home, Roster, Schedule, Stats) served alongside the worker and talking to the live API. **Verified end to end in a browser**: sign in -> bearer token -> the four tabs render live data from `/api/data/*` (7 players, 2-1 record, W/L schedule, per-category stat columns from the JSON round-trip). Static files answer non-API paths; the worker owns `/api/*` (no `--spa` flag needed - single page). Live: https://pixelated-circuit.view.fast/

The agent-written `docs/FRONTEND_MIGRATION_SPEC.md` catalogues every Supabase call site (auth, data, storage, server functions, routes) and a cutover order for the **faithful full-UI port** - the outstanding work:
- Port the real TanStack UI (all routes, shadcn components) OR grow this SPA to full feature parity.
- Reads/writes for photos (albums, uploads, tags) - needs Stage 5 storage first.
- The admin panel (approvals, invites, source config, staged-record review).
- Embedded-relation reads done app-side (fetch both tables, join in JS).
- Re-home Lovable deps: AI gateway (jersey OCR + source extraction) and Google Drive/OAuth need real keys, not URL swaps.
- Password reset + (optional) Google sign-in endpoints (not built).

### Outstanding across all stages
- **Stage 5 not started**: object storage (`env.STORAGE`) + image proxy + Google Drive/Photos ingestion.
- **Keys to set** (`sf env set`, then republish): `FIRECRAWL_API_KEY`, `AI_API_URL`/`AI_API_KEY`/`AI_MODEL` (any OpenAI-compatible provider), Chris's own `ADMIN_BOOTSTRAP_TOKEN`, and (for real scraping) run `/api/sync` from an external scheduler with `SYNC_SECRET`.
- **Stage 7**: one-time data backfill from Supabase (export -> transform -> load), then retire Lovable.

## Staged plan

- **Stage 0 (done):** discovery, decisions, this doc, `server/schema.ts` (18 tables), `sf.jsonc`, `server/index.ts` with a health endpoint. Branch `spacefast-migration` cut from `main`. Not deployed, not pushed.
- **Stage 1 (done, locally):** toolchain proven via `sf dev`. Schema migrates, DB works. Surfaced the no-`fetch` / no-crypto / inline-schema limits above. Did NOT create a real space (blocked on the A/B/C decision). Note: `server/schema.ts` must be inlined into `server/index.ts` when we proceed.
- **Stage 2:** custom auth end to end (signup/login/logout/session/reset, invites, roles) + the shared authz guards. Test with curl.
- **Stage 3:** port read/write query+mutation endpoints for the 15 tables with the row-codec + authz.
- **Stage 4:** port sync (scrape + extract + staged records), the LLM-extraction swap, and the cron.
- **Stage 5:** storage + image proxy + Google Drive/Photos.
- **Stage 6:** front-end to SPA, rewire `useAuth` and all data calls to endpoints, publish static.
- **Stage 7:** one-time data backfill from Supabase; cutover comms (password reset); DNS/custom domain; retire Lovable.

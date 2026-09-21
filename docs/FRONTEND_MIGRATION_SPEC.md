# Front-end Migration Spec: Supabase/Lovable to Spacefast Worker

Branch: `spacefast-migration`. Scope: everything under `src/`. The new backend worker in `spacefast/` is treated as an opaque API here.

Target backend contract (given):
- Auth: `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`. Login/signup return `{ token, user, profile, roles }`. Authed requests must send `Authorization: Bearer <token>`. Cookies do not work (CDN strips `Set-Cookie`).
- Data: generic REST at `/api/data/<table>`: `GET` list, `GET /<id>`, `POST`, `PATCH /<id>`, `DELETE /<id>`.

The current app uses two Supabase clients plus a bearer-token pattern that is already halfway to where we are going: TanStack server functions already receive `Authorization: Bearer <supabase access_token>` via a client middleware, and the server middleware already validates a bearer token. That plumbing is reusable; the identity provider behind it changes.

---

## 0. Current architecture in one paragraph

- Browser client: `src/integrations/supabase/client.ts` exports a lazy `supabase` proxy (anon/publishable key, `persistSession`, `autoRefreshToken`, custom storage). Used directly from React components and from all the read queries in `src/lib/portal-data.ts`.
- Server admin client: `src/integrations/supabase/client.server.ts` exports `supabaseAdmin` (service-role key, bypasses RLS). Used only inside `*.server.ts` and API route handlers.
- Per-request authed client: `src/integrations/supabase/auth-middleware.ts` (`requireSupabaseAuth`) builds a short-lived RLS-scoped client from the incoming bearer token and injects `{ supabase, userId, claims }` into server-function context.
- Token transport: `src/integrations/supabase/auth-attacher.ts` (`attachSupabaseAuth`) reads the current session and attaches `Authorization: Bearer <access_token>` to every server-function call. Registered globally in `src/start.ts`.
- Session state in React: `src/hooks/useAuth.tsx` (`getSession` + `onAuthStateChange`), plus `__root.tsx` and `reset-password.tsx` listeners.

Authorization model in the DB (must be reproduced by the worker):
- `app_role` enum: `admin | parent`. `data_source` enum values exist for events/players/etc.
- RLS + three Postgres RPCs enforce access: `is_member(_user_id)` (approved member gate), `has_role(_user_id, _role)` (admin gate), `my_status()` (returns `approved | pending | declined` for the caller). The worker needs equivalents, either as data endpoints or as claims baked into the login response `roles`/`profile`.

---

## 1. AUTH

### 1.1 Client + integration files to replace or delete

| File | Role today | Migration action |
|---|---|---|
| `src/integrations/supabase/client.ts` | Browser anon client (proxy, custom fetch, brokered storage) | Replace with a thin `apiClient` wrapper (fetch + bearer token from storage). Keep the `supabase`-shaped export only if you want a smaller diff; cleaner to introduce `src/integrations/api/client.ts` and a `session` store. |
| `src/integrations/supabase/client.server.ts` | Service-role client (`supabaseAdmin`) | Only used server-side (see Section 3). Becomes worker-internal or an admin-scoped fetch helper. Not shipped to browser. |
| `src/integrations/supabase/auth-middleware.ts` | `requireSupabaseAuth` server middleware, validates JWT via `supabase.auth.getClaims`, injects `{supabase,userId,claims}` | Rewrite to validate the worker bearer token (call `GET /api/auth/session` upstream, or verify locally) and inject `{ userId, roles, token }`. The `context.supabase` handle every server fn uses must be swapped for a data-access handle (see 3.1). |
| `src/integrations/supabase/auth-attacher.ts` | `attachSupabaseAuth` client middleware, attaches bearer to serverFn calls | Keep the shape. Change the token source from `supabase.auth.getSession()` to the new session store. |
| `src/integrations/supabase/previewAuthStorage.ts` | Lovable preview postMessage storage broker | Delete. Lovable-preview-only. Replace with plain `localStorage` (see 1.4). |
| `src/integrations/supabase/cron-auth.ts` | `authenticateCronRequest` shared-secret check (env `LOVABLE_CRON_SECRET`) | Not wired to any route in `src/` (only `SOURCE_SYNC_SECRET` is used by the hooks route). Verify with worker; likely delete or fold into the worker's own scheduled trigger. |
| `src/integrations/lovable/index.ts` | Google OAuth via `createLovableAuth()` then `supabase.auth.setSession` | Delete unless the worker offers Google OAuth. The single caller is `auth.tsx` (`google()`); remove that button or repoint to a worker OAuth flow. |
| `src/integrations/supabase/types.ts` | Generated DB types (`Database`) | Keep as the table/column type source until the worker ships its own types. Referenced widely (`portal-data.ts`, `calendar.tsx`, middleware). Swap later. |

### 1.2 Every `supabase.auth.*` call site

| # | File:line | Call | What it does | Rewire |
|---|---|---|---|---|
| A1 | `src/hooks/useAuth.tsx:13` | `supabase.auth.getSession()` | Initial session hydrate on mount | Read token from storage; if present, `GET /api/auth/session` (or trust cached `{user,profile,roles}`) to populate state. |
| A2 | `src/hooks/useAuth.tsx:18` | `supabase.auth.onAuthStateChange(cb)` | Subscribe to login/logout to update `session` state | No server push exists. Replace with a small in-app session store (module-level event emitter / Zustand / React context) that login/logout mutate. `useAuth` subscribes to that. See 1.4. |
| A3 | `src/integrations/supabase/auth-attacher.ts:9` | `supabase.auth.getSession()` | Read access_token to attach as bearer to serverFn calls | Read `token` from the session store synchronously (or from `localStorage`). |
| A4 | `src/integrations/supabase/auth-middleware.ts:94` | `supabase.auth.getClaims(token)` | Server-side token validation, extract `sub` | Validate worker token: call worker `GET /api/auth/session` with the bearer, or verify signature locally if the worker exposes a JWKS/secret. Extract `userId` + `roles`. |
| A5 | `src/integrations/lovable/index.ts:32` | `supabase.auth.setSession(result.tokens)` | Store tokens after Google OAuth | Delete with the Lovable OAuth path (or replace with worker OAuth callback that returns `{token,...}`). |
| A6 | `src/components/PortalLayout.tsx:79` | `supabase.auth.signOut()` | Sign out from header button | `POST /api/auth/logout` (best-effort), then clear the session store + `localStorage`, then `router.navigate({to:"/"})`. |
| A7 | `src/routes/auth.tsx:50` | `supabase.auth.resetPasswordForEmail(email, {redirectTo})` | Send reset email | Needs a worker endpoint (not in the given contract). Flag as a gap: add `POST /api/auth/reset-request` or hide "Forgot password" until it exists. |
| A8 | `src/routes/auth.tsx:65` | `supabase.auth.signInWithPassword({email,password})` | Email/password sign in | `POST /api/auth/login`. On `{token,user,profile,roles}`: write to session store + `localStorage`, then `router.navigate({to:"/"})`. |
| A9 | `src/routes/auth.tsx:95` | `supabase.auth.signUp({email,password,options:{data:{full_name,invite_code}}})` | Create account, carry `full_name` + `invite_code` in metadata; may or may not return a session (email confirm) | `POST /api/auth/signup` with `{email,password,full_name,invite_code}`. Decide whether signup auto-logs-in (returns token) or requires email confirm + admin approval (current behavior keys off `data.session` being present, see auth.tsx:108). Preserve the "pending approval" copy path. |
| A10 | `src/routes/reset-password.tsx:38` | `supabase.auth.onAuthStateChange` (waits for `PASSWORD_RECOVERY`) | Detect that the recovery link established a session | Depends on worker reset design. If reset uses a token in the URL, read it directly instead of waiting for an event. |
| A11 | `src/routes/reset-password.tsx:51` | `supabase.auth.updateUser({password})` | Set the new password | Needs worker endpoint, e.g. `POST /api/auth/reset-confirm` with `{token,password}`. Flag as a gap. |
| A12 | `src/routes/_authenticated/route.tsx:9` | `supabase.auth.getUser()` in `beforeLoad` | Route guard: redirect to `/auth` if not signed in | Read session store / `localStorage` token in `beforeLoad`. Note this route is `ssr:false`, so client-only storage is fine. Optionally validate via `GET /api/auth/session`. |
| A13 | `src/routes/__root.tsx:134` | `supabase.auth.onAuthStateChange` (SIGNED_IN/OUT/USER_UPDATED) | Invalidate router + react-query on auth change | Replace subscription target with the new session store; keep the `router.invalidate()` + `queryClient.invalidateQueries()` behavior. |

Also indirectly auth-related:
- `src/start.ts:4,29`: registers `attachSupabaseAuth` as global `functionMiddleware`. Keep the registration; the middleware internals change (A3).
- Admin/member gating RPCs (not `auth.*` but part of authZ): `useAuth.tsx:51` `rpc("my_status")`, `useAuth.tsx:35` `from("user_roles")` (admin check), and server-side `rpc("is_member")` / `rpc("has_role")` (see Section 4 RPC table). These must be served by the worker.

### 1.3 Token storage decision

- Cookies are out (CDN strips them), so the token lives in the browser. Use `localStorage` under a single key, e.g. `dugout.auth`, holding `{ token, user, profile, roles }`.
- Reads that must be synchronous (the `attachSupabaseAuth` client middleware, and the `_authenticated` `beforeLoad`) read `localStorage` directly. `onAuthStateChange` had async semantics; the new store can be synchronous, which is simpler.
- The old `previewAuthStorage.ts` async brokered storage is Lovable-only and should be dropped entirely.

### 1.4 Session state without `onAuthStateChange`

Introduce `src/integrations/api/session.ts`:
- `getSession(): Session | null` reads `localStorage` once, caches in a module variable.
- `setSession(s)` / `clearSession()` write `localStorage` + notify subscribers.
- `subscribe(cb)` simple listener set (replaces `onAuthStateChange`).
- Optional `refresh()` calls `GET /api/auth/session` to revalidate and refresh `{user,profile,roles}`.

Rewire consumers:
- `useAuth.tsx` (A1/A2): `useSyncExternalStore(subscribe, getSession)` instead of the effect + subscription. `user = session?.user`.
- `__root.tsx` (A13) and `reset-password.tsx` (A10): subscribe to the same store.
- `auth-attacher.ts` (A3): `getSession()?.token`.
- Login (A8), signup (A9), logout (A6): call `setSession` / `clearSession`.

### 1.5 Member/role gating (currently RPC-backed)

`useAuth.tsx` exposes three hooks the whole UI depends on:
- `useAuth()` -> `{session,user,loading}`.
- `useIsAdmin(user)` (line 30) -> queries `user_roles` for `role==='admin'`.
- `useMyStatus(user)` (line 46) -> `rpc("my_status")` returns `approved|pending|declined`.

Cleanest migration: the login/session response already returns `roles` and `profile`. Derive `isAdmin = roles.includes('admin')` and `status = profile.status` from the session store instead of extra round trips. That removes the `user_roles` select and the `my_status` RPC from the client entirely. If you keep them as endpoints, map to `GET /api/data/user_roles?user_id=` and a dedicated `GET /api/auth/session` field.

`PortalLayout.tsx` consumes all three (`useAuth`, `useIsAdmin`, `useMyStatus` at lines 69-72) to gate nav + show the "waiting for approval" screen. It keeps working unchanged if the hooks keep their signatures.

---

## 2. DATA (`supabase.from(...)` and `.rpc(...)`), grouped by table

Notes:
- Reads live almost entirely in `src/lib/portal-data.ts` as TanStack Query `queryOptions`. These call the browser `supabase` client directly (anon key + RLS). Under the worker they become `GET /api/data/<table>?...` fetches. The query keys and return shapes should be preserved so components do not change.
- Writes are split between React components (client, via anon-key RLS) and server functions (`context.supabase`, RLS-scoped by bearer). Client writes become `POST/PATCH/DELETE /api/data/<table>`. Server-fn writes become worker-internal or admin-scoped calls.
- Supabase query operators in use that the generic REST layer must support: `.select(cols)`, `.eq/.neq/.in/.is/.not`, `.order` (multi-key, `nullsFirst`), `.limit`, `.maybeSingle/.single`, `.upsert({onConflict})`, `.insert` (array + single), `.update`, `.delete`, embedded relations (`players(name,...)`, `album_photos(thumbnail_url)`), and `count:{ head:true }`. Any of these the worker cannot express becomes app-side filtering.

### events  (cols: id, created_at, updated_at, event_type, event_name, source, external_id, title, opponent, location, notes, recap, link_url, result, score_us, score_them, starts_at)
Reads:
- `portal-data.ts:80` `eventsQuery` select `*` order `starts_at` asc. (Used by home, calendar, photos*, stats, admin, roster.$playerId, tournaments.)
Writes (client):
- `calendar.tsx:303` insert (bulk practice/key-date rows, `source:manual`) via `TeamDateForm`.
- `calendar.tsx:500` delete by id (remove manual event).
- `calendar.tsx:153` update `{recap}` by id (`GameRecap`).
- `stats.tsx:283` update `{notes}` by id (`GameSummary` key plays).
- `admin.tsx:571` insert (SchedulePanel add event).
- `admin.tsx:593` delete by id (SchedulePanel remove).
- `admin.tsx:1174` (albums, see below) references events for the game dropdown (read only).
Writes (server fn / server):
- `sources.functions.ts:76` insert (approve staged event).
- `sources.functions.ts:127` delete by `source`+`starts_at` (remove pulled item).
- `sources.server.ts:173` upsert `onConflict:"source,external_id"`.
- `fivetools.server.ts:235` upsert `onConflict:"source,external_id"`.
- `gamechanger.server.ts:449` select existing by `source`+`external_id in`; `:554` upsert; `:567` re-select for box-score linking.
- `gphotos.server.ts:129` select `id,starts_at` (photo->game matching).

### players (cols: id, created_at, updated_at, name, jersey_number, positions, grad_year, bats, throws, photo_url, sort_order, source, external_id)
Reads:
- `portal-data.ts:176` `playersQuery` select `*` order `sort_order`,`name`; then `rewritePhotoField(...,'photo_url')`.
Writes (client):
- `admin.tsx:693` insert (RosterPanel add).
- `admin.tsx:714` delete by id.
- `roster.$playerId.tsx:62` update `{jersey_number}` by id.
- `PhotoTags.tsx:58` update `{photo_url}` by id (auto roster photo from a single-tag album photo).
Writes (server fn):
- `photo-tags.functions.ts:35` select `id,name,jersey_number` (jersey map for AI tagging).

### profiles (cols: id, created_at, updated_at, email, full_name, status, invited_by, approved_by, approved_at)
Reads:
- `portal-data.ts:642` `memberProfilesQuery` select subset order `created_at`.
Writes (client):
- `admin.tsx:251` update `{status,approved_by,approved_at}` by id (ApprovalsPanel approve/decline).
Writes (server fn):
- `users.functions.ts:28` update `{full_name,email}` by id (admin edit; also calls `supabaseAdmin.auth.admin.updateUserById`, see 3.2).

### user_roles (cols: id, created_at, user_id, role[app_role])
Reads (client):
- `useAuth.tsx:35` select `role` where `user_id`. Prefer replacing with `roles` from session (1.5).

### invites (cols: id, created_at, code, email, label, invited_by, accepted_at, auto_approve)
Reads:
- `portal-data.ts:398` `invitesQuery` select `*` order `created_at`.
Writes (client):
- `admin.tsx:421` insert (email invite), `:456` insert (generated code, retries on unique `invites_code_key`), `:436` delete by id.
Writes (server fn):
- `invites.functions.ts:10` select `id` where `ilike(code)` limit 1 (public invite-code check, runs via `supabaseAdmin`, unauthenticated).

### album_photos (cols: id, created_at, album_id, drive_file_id, name, mime_type, created_time, event_id, storage_path, thumbnail_url, width, height, ai_scanned_at)
Reads (portal-data.ts): `:304` latest-album photos; `:326` `albumPhotosQuery(albumId)`; `:343` `eventAlbumPhotosQuery(eventIds in ...)`; `:357` `albumPhotoGameLinksQuery` (`not event_id is null`, limit 2000); `:533` `albumPhotosForAlbumsQuery(album_id in ...)`; `:682` in `playerPhotosQuery` (`id in ...`); plus embedded reads at `:591` via photo_tags.
Reads (server/API): `photo-tags.functions.ts:48` unscanned (`is ai_scanned_at null`), `:138` update `ai_scanned_at`; `PhotoTags.tsx:49` select thumbnail; `api/album-photo.ts:49` select `storage_path,mime_type` by id (admin client); `api/drive-image.ts:24` select by `drive_file_id`.
Writes (server): `drive.functions.ts:139` upsert `onConflict:"album_id,drive_file_id"`; `gphotos.server.ts:153/174/209/227/238` select/upsert/update (storage copy + cover).

### albums (cols: id, created_at, title, description, cover_url, drive_folder_id, gphotos_url, event_id, season, photo_count, last_synced_at, sort_order)
Reads: `portal-data.ts:281` `albumsQuery` (+`rewritePhotoField('cover_url')`); `:294` latest album (`neq title 'Parents album'`).
Writes (client): `admin.tsx:1174` update `{season,event_id}` (AlbumFiling).
Writes (server): `drive.functions.ts:111` upsert `onConflict:"drive_folder_id"`; `gphotos.server.ts:135` upsert `onConflict:"gphotos_url"`, `:189/247` update `photo_count`/`cover_url`; `sync-sources.ts:86` select gphotos albums.

### media_items (cols: id, created_at, title, description, kind, source, external_id, media_url, storage_path, mime_type, thumbnail_url, event_id, submitted_by, published_at)
Reads: `portal-data.ts:216` `mediaQuery`; `:249` `teamVideosQuery` (+ signs storage paths).
Writes (client): `admin.tsx:812` insert / `:831` delete (VideosPanel); `share.tsx:265` insert (uploaded video), `:295` insert (linked video), `:318` delete (+ storage remove).

### player_stats (cols: id, created_at, updated_at, player_id, player_name, category, season, stats[Json], event_id, source, external_id, submitted_by)
Reads: `portal-data.ts:190` `playerStatsQuery`; `:549` `myStatsQuery(userId)`.
Writes (client): `stats.tsx:437` insert; `stats.tsx:344` delete by id.
Writes (server): `sources.functions.ts:90` insert (approve staged), `:133` delete by `source`+`player_name`; `sources.server.ts:179` upsert `onConflict:"source,external_id"`.

### team_stats (cols: id, created_at, updated_at, event_id, category, season, source, stats[Json])
Reads: `portal-data.ts:203` `gameLineScoresQuery` (`category==='line_score'`).
Writes (server): `gamechanger.server.ts:575` select existing line scores, `:613` upsert `onConflict:"event_id,category"`.

### source_configs (cols: id, updated_at, source, team_name, url, extra_urls, enabled, notes, last_run_at)
Reads: `portal-data.ts:388` `sourceConfigsQuery`; server: `sources.functions.ts:27` select by source (maybeSingle); `sync-sources.ts:28` select in-list.
Writes (client): `admin.tsx:904` update `{url}` by id (SourcesPanel).
Writes (server): `sources.server.ts:204`, `fivetools.server.ts:260`, `gamechanger.server.ts:640` update `{last_run_at}`.

### staged_records (cols: id, created_at, sync_run_id, source, kind, payload[Json], status)
Reads: `portal-data.ts:410` `stagedQuery` (`status==='pending'`), `:423` `pulledItemsQuery` (`status==='published'`, limit 40).
Writes (server): `sources.functions.ts:62` select by id, `:69/:100/:139` update status; `:116` select in removePulledItem; inserts of run logs at `sources.server.ts:184`, `fivetools.server.ts:240`, `gamechanger.server.ts:558`.

### sync_runs (cols: id, source, status, started_at, finished_at, items_found, message)
Reads: `portal-data.ts:437` `syncRunsQuery` (limit 10).
Writes (server): inserted/updated across `sources.server.ts:120/190/213`, `fivetools.server.ts:179/245/269`, `gamechanger.server.ts:414/622/656`.

### photo_tags (cols: id, created_at, updated_at, player_id, album_photo_id, photo_upload_id, jersey_number, confidence, method, created_by)
Reads: `portal-data.ts:576` `photoTagsQuery` (embeds `players(name,jersey_number)`, limit 4000); `:591` `playerTagPhotosQuery` (embeds `album_photos(thumbnail_url)`, limit 4000); `:667` in `playerPhotosQuery`.
Writes (client): `PhotoTags.tsx:31` insert (manual tag), `:44` count head, `:72` delete by id.
Writes (server): `photo-tags.functions.ts:122` insert (AI tag; ignores unique-violation `23505`).

### photo_uploads (cols: id, created_at, album_id, storage_path, caption, uploaded_by, event_id, mime_type, width, height, ai_scanned_at)
Reads: `portal-data.ts:502` `sharedPhotosQuery` (limit 500, then signs), `:517` `myPhotoUploadsQuery(userId)`, `:701` in `playerPhotosQuery`.
Writes (client): `share.tsx:105` insert (photo upload row), `:130` delete (+ storage remove).
Writes (server): `photo-tags.functions.ts:58` select unscanned, `:142` update `ai_scanned_at`.

### chat_messages
Present in `types.ts` only. No `src/` references. Ignore for migration (confirm the worker does not need it).

### `.rpc(...)` call sites
| File:line | RPC | Purpose |
|---|---|---|
| `useAuth.tsx:51` | `my_status()` | Caller's approval status. Serve from session `profile.status` or a `/api/auth/session` field. |
| `gphotos.functions.ts:6`, `sources.functions.ts:8`, `drive.functions.ts:29`, `photo-tags.functions.ts:6` | `is_member(_user_id)` | Server-side "approved member" gate (`assertAdmin` helpers). Reproduce as a worker authZ check on those endpoints. |
| `users.functions.ts:18` | `has_role(_user_id, _role:'admin')` | Server-side admin gate. Reproduce as worker role check. |

---

## 3. SERVER FUNCTIONS (`*.server.ts`, `*.functions.ts`)

`.functions.ts` = TanStack `createServerFn` handlers imported by the client bundle; they run server-side and (except the public one) use the `requireSupabaseAuth` middleware. `.server.ts` = server-only helper modules (scraping, parsing, storage copy) imported lazily inside handlers/API routes.

### 3.1 `*.functions.ts` (server functions)

| File | Exports | Auth | External deps | Migration target |
|---|---|---|---|---|
| `src/lib/invites.functions.ts` | `checkInviteCode({code})` | none (public) | `supabaseAdmin` -> `invites` ilike | Worker endpoint `POST /api/invites/check` (public), or `GET /api/data/invites?code=`. Must stay callable pre-auth (used on the signup screen). |
| `src/lib/users.functions.ts` | `adminUpdateUser({id,full_name,email})` | `requireSupabaseAuth` + `has_role admin` | updates `profiles` then `supabaseAdmin.auth.admin.updateUserById` (email + user_metadata) | Worker endpoint. The auth-admin update (change login email, confirm, set metadata) has no client equivalent; must be a worker-side admin operation. |
| `src/lib/sources.functions.ts` | `runSourceScan({source})`, `decideStagedRecord({id,approve})`, `removePulledItem({id})` | `requireSupabaseAuth` + `is_member` | reads `source_configs`; dynamically imports `fivetools/gamechanger/sources.server`; writes `events/player_stats/staged_records` | Worker endpoints. These orchestrate scraping + DB writes; keep them server-side (they call Firecrawl/Jina and need service-role writes). Do NOT turn into client fetches. |
| `src/lib/photo-tags.functions.ts` | `scanPhotosForPlayers({limit})` -> ScanResult | `requireSupabaseAuth` + `is_member` | reads players/album_photos/photo_uploads; signs storage URLs; imports `photo-tags.server` (Lovable AI gateway); writes `photo_tags`, updates `ai_scanned_at` | Worker endpoint. Vision/AI + storage signing + writes: stays server-side. |
| `src/lib/drive.functions.ts` | `listDriveFolders()`, `syncDriveAlbum({folder,title,description})` | `requireSupabaseAuth` + `is_member` | Google Drive via Lovable connector gateway (`LOVABLE_API_KEY` + `GOOGLE_DRIVE_API_KEY`); upserts albums/album_photos | Worker endpoint. Depends on the Lovable connector gateway; if that goes away with Lovable, this needs a real Google Drive credential path on the worker. Flag. |
| `src/lib/gphotos.functions.ts` | `syncGooglePhotosAlbum({url,title,description})` | `requireSupabaseAuth` + `is_member` | imports `gphotos.server` (Firecrawl scrape + storage copy) | Worker endpoint. Server-side. |

Client call sites of these server functions (must switch from `useServerFn`/direct import to worker fetch, or keep the serverFn shim pointing at the worker):
- `auth.tsx:45` `useServerFn(checkInviteCode)`.
- `admin.tsx`: `scanPhotosForPlayers` (:1131), `adminUpdateUser` (:182), `listDriveFolders`/`syncDriveAlbum` (:955/:976), `syncGooglePhotosAlbum` (:967), `runSourceScan`/`decideStagedRecord`/`removePulledItem` (:1275/:1290/:1296).

### 3.2 `*.server.ts` (server-only helpers)

| File | Exports | External APIs | Notes |
|---|---|---|---|
| `src/lib/sources.server.ts` | `scrape` (Firecrawl v2), `extract` (Lovable AI gateway, gemini), `publishScan`, `CUTOFF_ISO`, types | `FIRECRAWL_API_KEY`, `LOVABLE_API_KEY` | Generic scrape+LLM-extract+upsert for a source. Worker-internal. |
| `src/lib/gamechanger.server.ts` | `syncGameChanger`, `parseScheduleIndex`, `parseRecap`, `parseBoxScore`, ... | Jina Reader (`r.jina.ai`, no key) + Firecrawl fallback | Heaviest module. Deterministic parsers + concurrent fetch. Worker-internal. |
| `src/lib/fivetools.server.ts` | `syncFiveTools`, `parseSchedule`, `findEventUrls` | Firecrawl (`scrape`) | Worker-internal. |
| `src/lib/gphotos.server.ts` | `syncGooglePhotos`, `extractPhotos`, `gameForPhoto`, `resolveShareUrl`, `copyAlbumPhotosToStorage` | Firecrawl v2; `supabaseAdmin` storage upload to `team-photos` | Copies Google Photos into own storage. Storage-bucket dependency (Section 5). |
| `src/lib/photo-tags.server.ts` | `fetchAsDataUrl`, `readJerseyNumbers` (jersey OCR) | Lovable AI gateway (`LOVABLE_API_KEY`, gemini vision) | Worker-internal. |

All `.server.ts` modules become worker code. The main coupling to remove is the Lovable AI gateway (`ai.gateway.lovable.dev`) and the Lovable Drive connector gateway (`connector-gateway.lovable.dev`); those are Lovable-hosted and will not survive the platform move without new credentials/endpoints. Firecrawl and Jina are independent third parties and can stay as-is with their own keys.

### 3.3 Server-mediated API routes (see also Section 4)
- `src/routes/api/album-photo.ts`, `src/routes/api/drive-image.ts`: image proxies using `supabaseAdmin` + storage/Drive. Become worker image endpoints.
- `src/routes/api/public/hooks/sync-sources.ts`: scheduled sync trigger (shared secret `SOURCE_SYNC_SECRET`), calls the `.server.ts` sync fns with `supabaseAdmin`. Becomes a worker cron endpoint.

---

## 4. ROUTES (`src/routes/`)

Auth gating model: two mechanisms.
1. `_authenticated/route.tsx` `beforeLoad` guard (hard redirect to `/auth`) wraps `share`, `stats`, `admin`.
2. `PortalLayout requireAuth` prop (soft, client-side `<Navigate to="/auth">` after load) plus the `useMyStatus` "waiting for approval" gate, used by most content pages.

| Route file | Path | Data loaded (queries) | Auth gating | Migration notes |
|---|---|---|---|---|
| `__root.tsx` | root | none (sets `onAuthStateChange` listener, A13) | none | Swap auth listener to session store. |
| `index.tsx` | `/` | `eventsQuery`, `playersQuery`, `mediaQuery`, `sharedPhotosQuery`, `albumPhotoGameLinksQuery` | none (public home). `PortalLayout` w/o `requireAuth` | Public; queries hit `/api/data/*`. |
| `auth.tsx` | `/auth` | none | none | A7/A8/A9 + `checkInviteCode` serverFn + Google (A5). |
| `reset-password.tsx` | `/reset-password` | none | none | A10/A11; needs worker reset endpoints. |
| `dashboard.tsx` | `/dashboard` | none | `beforeLoad` redirect -> `/` | Static redirect, no change. |
| `schedule.tsx` | `/schedule` | none | `beforeLoad` redirect -> `/calendar` | Static redirect, no change. |
| `calendar.tsx` | `/calendar` | `eventsQuery`, `gameLineScoresQuery` | `PortalLayout requireAuth` | Writes events (insert/delete/update recap). Client writes -> `/api/data/events`. |
| `roster.index.tsx` | `/roster` | `playersQuery`, `photoTagsQuery`, `playerTagPhotosQuery` | `requireAuth` | Read-only. |
| `roster.$playerId.tsx` | `/roster/$playerId` | `playersQuery`, `eventsQuery`, `playerPhotosQuery(id)`, `teamVideosQuery` | `requireAuth` | Client update `players.jersey_number`. |
| `tournaments.$eventId.tsx` | `/tournaments/$eventId` | `eventsQuery` | `requireAuth` | Read-only. |
| `photos.tsx` | `/photos` | none (Outlet) | none (children gate) | Layout only. |
| `photos.index.tsx` | `/photos/` | `albumsQuery`, `eventsQuery`, `sharedPhotosQuery`, `albumPhotoGameLinksQuery`, `teamVideosQuery` | `requireAuth` | Read-only. |
| `photos.$albumId.tsx` | `/photos/$albumId` | `albumsQuery`, `eventsQuery`, `albumPhotosQuery(id)`, `sharedPhotosQuery` | `requireAuth` | Read-only + `PhotoTagBar`. |
| `photos.game.$eventId.tsx` | `/photos/game/$eventId` | `eventsQuery`, `albumsQuery`, `sharedPhotosQuery`, `teamVideosQuery`, `albumPhotosForAlbumsQuery`, `eventAlbumPhotosQuery` | `requireAuth` | Read-only. |
| `photos.season.$season.tsx` | `/photos/season/$season` | `albumsQuery`, `eventsQuery`, `sharedPhotosQuery`, `albumPhotosForAlbumsQuery` | `requireAuth` | Read-only. |
| `_authenticated/route.tsx` | `/_authenticated` | none | `beforeLoad` `getUser()` guard (A12), `ssr:false` | Guard reads session store/`localStorage`. |
| `_authenticated/admin.tsx` | `/admin` | many (invites, profiles, events, players, media, albums, sources, staged, syncRuns, photoTags) | route guard + `useIsAdmin` in-component | Heaviest write surface (invites/events/players/media/albums/source_configs) + all sync serverFns. |
| `_authenticated/share.tsx` | `/share` | `albumsQuery`, `eventsQuery`, `myPhotoUploadsQuery`, `teamVideosQuery` | route guard | Storage uploads + inserts (photo_uploads, media_items). |
| `_authenticated/stats.tsx` | `/stats` | `playerStatsQuery`, `playersQuery`, `eventsQuery`, `gameLineScoresQuery` | route guard + `useIsAdmin` | Writes player_stats + events.notes. |
| `api/album-photo.ts` | `/api/album-photo` | server handler, `supabaseAdmin` + storage | none (public image) | Worker image endpoint. |
| `api/drive-image.ts` | `/api/drive-image` | server handler, `supabaseAdmin` + Drive gateway | none (public image) | Worker image endpoint. |
| `api/public/hooks/sync-sources.ts` | `/api/public/hooks/sync-sources` | server handler, shared-secret POST | `SOURCE_SYNC_SECRET` | Worker cron endpoint. |
| `sitemap[.]xml.ts` | `/sitemap.xml` | static route inventory | none | No backend dependency; keep. |

---

## 5. STORAGE (`supabase.storage.*`)

Two private buckets. Signed URLs are generated per read (TTL varies). The worker needs an equivalent object store plus a signing endpoint, or the app must proxy every image (the app already partly does via `/api/album-photo`).

Buckets:
- `team-photos`: album photos (imported from Google Photos/Drive) and family uploads. Layout: `album/<albumId>/<photoId>.jpg` (imported, `gphotos.server.ts:221`), `thumbs/<id>.jpg` (thumbnails, `portal-data.ts:121`, `:160`), `<userId>/<ts>-<name>` (family uploads, `share.tsx:97`).
- `team-videos`: family video uploads. Layout: `<userId>/<ts>-<name>` (`share.tsx:254`).

Every `supabase.storage.*` call site:
| File:line | Bucket | Op |
|---|---|---|
| `portal-data.ts:104` | team-photos | `createSignedUrls(chunk, 7d)` (batch sign, 100/req) |
| `portal-data.ts:260` | team-videos | `createSignedUrls(paths, 1h)` |
| `portal-data.ts:491` | team-photos | `createSignedUrls(paths, 1h)` (shared photos) |
| `photo-tags.functions.ts:72` | team-photos | `createSignedUrl(storage_path, 10m)` (album photo for AI) |
| `photo-tags.functions.ts:83` | team-photos | `createSignedUrl(storage_path, 10m)` (upload for AI) |
| `share.tsx:98` | team-photos | `upload(path, file)` (family photo) |
| `share.tsx:132` | team-photos | `remove([storage_path])` |
| `share.tsx:255` | team-videos | `upload(path, file, {contentType})` |
| `share.tsx:262` | team-videos | `createSignedUrl(path, 1h)` |
| `share.tsx:321` | team-videos | `remove([storage_path])` |
| `gphotos.server.ts:222` | team-photos | `upload(path, buf, {upsert})` (import copy) |
| `api/album-photo.ts:12` | team-photos | `createSignedUrl(path, 1h)` then streams upstream (admin) |

Migration considerations:
- Direct browser uploads (`share.tsx`) rely on RLS-scoped bucket writes keyed on `auth.uid()`. The worker needs either presigned upload URLs (`POST /api/uploads/sign` -> PUT to storage) or an upload-through-worker endpoint. The path prefix `<userId>/...` is used for ownership; preserve it.
- Batch signing (`createSignedUrls`, up to 100 paths, 7-day TTL) is a performance-critical path for galleries. The worker signing endpoint should accept an array to avoid N calls per gallery render.
- `/api/album-photo` already proxies images through the app using the admin client; the worker version can keep that model and skip client-side signing for imported photos.

---

## 6. Environment variables in use (`src/`)

Client (Vite, build-time): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` -> replace with `VITE_API_URL` (worker base).
Server: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` -> replace with worker DB creds. `LOVABLE_API_KEY` (AI gateway + Drive gateway), `GOOGLE_DRIVE_API_KEY` (Drive connector), `FIRECRAWL_API_KEY` (scraper), `SOURCE_SYNC_SECRET` (cron hook), `LOVABLE_CRON_SECRET` / `LOVABLE_CRON_SECRET_PREVIOUS` (unused in `src/`, only in `cron-auth.ts`).

Lovable-hosted dependencies to re-home or drop: `ai.gateway.lovable.dev` (jersey OCR + source extraction), `connector-gateway.lovable.dev/google_drive` (Drive listing/media), `@lovable.dev/cloud-auth-js` (Google OAuth), the preview postMessage storage broker.

---

## 7. Gaps / open questions for the worker owner

1. Password reset: no `resetPasswordForEmail` / `updateUser` equivalent in the given contract (A7/A11). Need `POST /api/auth/reset-request` + `POST /api/auth/reset-confirm`, or hide reset UI.
2. Google OAuth (A5, `auth.tsx:118` `google()`): keep or drop? If keep, needs a worker OAuth flow returning `{token,...}`.
3. Signup semantics (A9): does `POST /api/auth/signup` auto-login (return token) or require email confirm + admin approval? The current UI branches on session presence and shows a "waiting for admin approval" path. Preserve the `profiles.status` approval workflow (`pending/approved/declined`) and `invites` gating.
4. AuthZ RPC parity: `is_member`, `has_role`, `my_status`, and RLS row visibility must be reproduced. Simplest is to bake `roles` + `profile.status` into the login/session response and enforce row filters in the worker per endpoint.
5. Generic REST operator coverage: confirm `/api/data/<table>` supports multi-key ordering + `nullsFirst`, `in`/`is`/`not`, `upsert onConflict`, embedded relation selects, and `count head`. Where it does not, those reads move to app-side shaping (already isolated inside `portal-data.ts`, so the blast radius is contained).
6. Storage: presigned uploads vs proxy-through-worker, and a batch signing endpoint for galleries.
7. Lovable AI gateway replacement for jersey OCR and source extraction (bring-your-own model + key), and Google Drive credentials off the Lovable connector.

---

## 8. Suggested migration order

1. Land `src/integrations/api/{client,session}.ts` and swap `useAuth` + `attachSupabaseAuth` + `_authenticated` guard (Section 1). Everything else keeps compiling against the old `supabase` export until cut over.
2. Replace `portal-data.ts` query bodies with `/api/data/*` fetches (Section 2 reads). Query keys/shapes unchanged, so components are untouched.
3. Move client writes (calendar/admin/share/stats/roster/PhotoTags) to `/api/data/*` (Section 2 writes).
4. Re-home server functions + `.server.ts` into the worker; repoint client callers (Section 3).
5. Storage endpoints (Section 5), then image proxy routes.
6. Delete Lovable/Supabase integration files once no imports remain.

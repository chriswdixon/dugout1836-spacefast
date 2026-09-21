// Source sync: scrape external pages (GameChanger, Five Tools, Perfect Game),
// extract events + player stats with an LLM, and upsert onto the portal.
//
// Ported from the original TanStack server functions. All outbound calls are
// plain fetch, which the Functions (Cloudflare Worker) runtime supports.
// Secrets come from worker env (sf env set): FIRECRAWL_API_KEY, AI_API_URL,
// AI_API_KEY, AI_MODEL, SYNC_SECRET.

import type { Env, D1Database } from "./db";
import { ensureSchema } from "./db";
import { json, unauthorized } from "./http";
import { syncGameChanger } from "./gamechanger";
import { syncFiveTools } from "./fivetools";
import { requireAdmin } from "./auth";

type SourceKey = "gamechanger" | "fivetools" | "perfect_game";
const CUTOFF_ISO = "2026-09-12T00:00:00.000Z"; // ignore anything before the fall season

const PROMPTS: Record<SourceKey, string> = {
  gamechanger:
    "You are reading a GameChanger team page. Extract upcoming or completed games and any player stat lines you can see.",
  fivetools:
    "You are reading a Five Tools tournament schedule table for youth baseball. Each row has a date, start time, venue/field and two team names, sometimes with final scores. Extract every row as event_type 'game'. The 1836 Roughriders (Burnett 2029) are our team: put the OTHER team in opponent, our runs in score_us, theirs in score_them, and the venue in location. Leave scores null when the row shows no score. Put the tournament name in notes.",
  perfect_game:
    "You are reading a Perfect Game team page. Extract tournament/event listings with dates and locations, and any team results.",
};

// ---- scrape: Jina reader (keyless). No Firecrawl. ----
export async function scrape(url: string, _env: Env): Promise<string> {
  const jina = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: "text/markdown", "X-Return-Format": "markdown" },
  });
  if (jina.ok) return await jina.text();
  throw new Error(`The web reader failed [${jina.status}].`);
}

// ---- extract: OpenAI-compatible chat completions (provider-agnostic) ----
interface Extracted {
  events?: Array<Record<string, unknown>>;
  player_stats?: Array<Record<string, unknown>>;
}
export async function extract(markdown: string, source: SourceKey, env: Env): Promise<Extracted> {
  const apiUrl = env.AI_API_URL as string | undefined;
  const apiKey = env.AI_API_KEY as string | undefined;
  const model = (env.AI_MODEL as string | undefined) ?? "gpt-4o-mini";
  if (!apiUrl || !apiKey) throw new Error("AI extraction is not configured (set AI_API_URL, AI_API_KEY, AI_MODEL).");
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            `${PROMPTS[source]} Return ONLY JSON matching: {"events":[{"title","event_type","starts_at","location","opponent","result","score_us","score_them","notes"}],"player_stats":[{"player_name","category","season","stats"}]}. ` +
            "starts_at must be an ISO 8601 timestamp; skip anything without a clear date. event_type is one of game, tournament, practice. category is batting, pitching or fielding. Never invent data that is not on the page; return empty arrays if unsure.",
        },
        { role: "user", content: markdown.slice(0, 60000) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI extraction failed [${res.status}]`);
  const payload = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  try {
    return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as Extracted;
  } catch {
    return {};
  }
}

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));

async function upsertEvent(db: D1Database, e: Record<string, unknown>) {
  const id = uuid(), ts = nowIso();
  await db
    .prepare(
      `INSERT INTO events (id, title, event_type, starts_at, location, opponent, result, score_us, score_them, notes, source, external_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), event_type=VALUES(event_type), starts_at=VALUES(starts_at),
         location=VALUES(location), opponent=VALUES(opponent), result=VALUES(result), score_us=VALUES(score_us),
         score_them=VALUES(score_them), notes=VALUES(notes), updated_at=VALUES(updated_at)`,
    )
    .bind(id, e.title ?? null, e.event_type ?? "game", e.starts_at, e.location ?? null, e.opponent ?? null,
      e.result ?? null, numOrNull(e.score_us), numOrNull(e.score_them), e.notes ?? null, e.source, e.external_id, ts, ts)
    .run();
}
async function upsertStat(db: D1Database, s: Record<string, unknown>) {
  const id = uuid(), ts = nowIso();
  await db
    .prepare(
      `INSERT INTO player_stats (id, player_name, category, season, source, external_id, stats, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE player_name=VALUES(player_name), stats=VALUES(stats), updated_at=VALUES(updated_at)`,
    )
    .bind(id, s.player_name, s.category ?? "batting", s.season, s.source, s.external_id, JSON.stringify(s.stats ?? {}), ts, ts)
    .run();
}

export async function publishScan(db: D1Database, env: Env, source: SourceKey, url: string): Promise<Record<string, unknown>> {
  const runId = uuid();
  await db.prepare("INSERT INTO sync_runs (id, source, status, started_at, items_found) VALUES (?,?,?,?,0)")
    .bind(runId, source, "running", nowIso()).run();
  try {
    const markdown = await scrape(url, env);
    const found = await extract(markdown, source, env);

    let nEvents = 0, nStats = 0;
    for (const e of found.events ?? []) {
      const startsAt = e.starts_at ? new Date(String(e.starts_at)) : null;
      if (!startsAt || Number.isNaN(startsAt.getTime())) continue;
      const iso = startsAt.toISOString();
      if (iso < CUTOFF_ISO) continue;
      const label = String(e.opponent || e.title || "event");
      const external_id = `${source}:${iso.slice(0, 10)}:${slug(label)}`;
      await upsertEvent(db, { ...e, starts_at: iso, source, external_id });
      await db.prepare("INSERT INTO staged_records (id, sync_run_id, source, kind, status, payload, created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(uuid(), runId, source, "event", "published", JSON.stringify(e), nowIso()).run();
      nEvents++;
    }
    for (const s of found.player_stats ?? []) {
      if (!s.player_name || !s.stats) continue;
      const season = String(s.season ?? new Date().getFullYear());
      const category = String(s.category ?? "batting");
      const external_id = `${source}:${season}:${category}:${slug(String(s.player_name))}`;
      await upsertStat(db, { ...s, season, category, source, external_id });
      await db.prepare("INSERT INTO staged_records (id, sync_run_id, source, kind, status, payload, created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(uuid(), runId, source, "player_stat", "published", JSON.stringify(s), nowIso()).run();
      nStats++;
    }
    const total = nEvents + nStats;
    await db.prepare("UPDATE sync_runs SET status=?, items_found=?, finished_at=?, message=? WHERE id=?")
      .bind("succeeded", total, nowIso(),
        total === 0 ? "Nothing readable found on that page." : `Published ${nEvents} events and ${nStats} stat lines.`, runId).run();
    return { ok: true, events: nEvents, stats: nStats };
  } catch (e) {
    await db.prepare("UPDATE sync_runs SET status=?, finished_at=?, message=? WHERE id=?")
      .bind("failed", nowIso(), String(e), runId).run();
    return { ok: false, error: String(e) };
  }
}

// ---- endpoint: POST /api/sync (secret-gated; also the cron target) ----
export async function handleSync(req: Request, env: Env, pathToken?: string | null): Promise<Response> {
  const secret = env.SYNC_SECRET as string | undefined;
  const url = new URL(req.url);
  // Accept the secret via header (POST), query token (manual GET), or a path
  // segment (the sf.jsonc cron path, which cannot carry a query string).
  const provided =
    req.headers.get("x-sync-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("token") ??
    pathToken ??
    "";
  if (!secret || provided !== secret) return unauthorized();
  await ensureSchema(env.DB);
  return json(await runSync(env, url.searchParams.get("source")));
}

// Shared sync runner: GameChanger uses the deterministic Jina parser; the other
// sources use the generic Jina scrape + LLM extract (which needs AI keys).
export async function runSync(env: Env, only?: string | null): Promise<{ ok: true; results: Record<string, unknown> }> {
  await ensureSchema(env.DB);
  let sql = "SELECT id, source, url, extra_urls FROM source_configs WHERE enabled = 1 AND url IS NOT NULL AND source IN ('gamechanger','fivetools','perfect_game')";
  const binds: unknown[] = [];
  if (only) { sql += " AND source = ?"; binds.push(only); }
  const res = await env.DB.prepare(sql).bind(...binds).all<{ id: string; source: SourceKey; url: string; extra_urls: string | null }>();
  const results: Record<string, unknown> = {};
  for (const cfg of res.results ?? []) {
    if (cfg.source === "gamechanger") {
      let extra: string[] | null = null;
      try { extra = cfg.extra_urls ? (JSON.parse(cfg.extra_urls) as string[]) : null; } catch { extra = null; }
      results[cfg.source] = await syncGameChanger(env.DB, cfg.url, extra);
    } else if (cfg.source === "fivetools") {
      results[cfg.source] = await syncFiveTools(env.DB, env, cfg.url);
    } else {
      results[cfg.source] = await publishScan(env.DB, env, cfg.source, cfg.url);
    }
    await env.DB.prepare("UPDATE source_configs SET last_run_at = ? WHERE id = ?").bind(nowIso(), cfg.id).run();
  }
  return { ok: true, results };
}

// Admin-triggered scan (from the admin Sources panel). Auth-gated (admin), not
// secret-gated. Body: { source? } to scan one source, else all.
export async function handleAdminScan(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const admin = await requireAdmin(req, env.DB);
  if (admin instanceof Response) return admin;
  let source: string | null = null;
  try {
    const body = (await req.json()) as { source?: string };
    source = body?.source ?? null;
  } catch { source = null; }
  return json(await runSync(env, source));
}

// Admin bulk import (one-time data backfill from the old Supabase project).
//
// POST /api/admin/import { table, rows } — upserts rows by id, preserving ids
// and relationships. Admin-gated. Columns are whitelisted per table.

import type { D1Database, Env } from "./db";
import { ensureSchema } from "./db";
import { getAuthContext } from "./auth";
import { json, forbidden, unauthorized, badRequest } from "./http";

// All columns (besides the timestamps we set) accepted per table.
const COLUMNS: Record<string, string[]> = {
  events: ["id", "title", "event_name", "event_type", "starts_at", "source", "external_id", "opponent", "location", "result", "recap", "notes", "link_url", "score_us", "score_them"],
  players: ["id", "name", "external_id", "jersey_number", "positions", "bats", "throws", "grad_year", "photo_url", "sort_order", "source"],
  player_stats: ["id", "player_id", "player_name", "category", "season", "source", "external_id", "event_id", "stats", "submitted_by"],
  team_stats: ["id", "category", "season", "source", "event_id", "stats"],
  albums: ["id", "title", "description", "season", "event_id", "drive_folder_id", "gphotos_url", "cover_url", "photo_count", "sort_order", "last_synced_at"],
  album_photos: ["id", "album_id", "event_id", "drive_file_id", "name", "mime_type", "storage_path", "thumbnail_url", "width", "height", "created_time", "ai_scanned_at"],
  media_items: ["id", "title", "kind", "media_url", "source", "external_id", "event_id", "description", "mime_type", "thumbnail_url", "storage_path", "published_at", "submitted_by"],
  photo_tags: ["id", "player_id", "album_photo_id", "photo_upload_id", "jersey_number", "method", "confidence", "created_by"],
};
// JSON columns are serialized on the way in.
const JSON_COLS: Record<string, string[]> = { player_stats: ["stats"], team_stats: ["stats"] };
const hasCreated = new Set(["events", "players", "player_stats", "team_stats", "albums", "album_photos", "media_items", "photo_tags"]);
const hasUpdated = new Set(["events", "players", "player_stats", "team_stats", "photo_tags"]);

const nowIso = () => new Date().toISOString();

async function upsertRow(db: D1Database, table: string, cols: string[], row: Record<string, unknown>) {
  const jsonCols = JSON_COLS[table] ?? [];
  const present = cols.filter((c) => c in row);
  const names = [...present];
  const values: unknown[] = present.map((c) => {
    const v = row[c];
    if (v === undefined) return null;
    if (jsonCols.includes(c) && v !== null && typeof v !== "string") return JSON.stringify(v);
    return v;
  });
  const ts = nowIso();
  if (hasCreated.has(table)) { names.push("created_at"); values.push((row["created_at"] as string) || ts); }
  if (hasUpdated.has(table)) { names.push("updated_at"); values.push((row["updated_at"] as string) || ts); }
  const updates = names.filter((n) => n !== "id").map((n) => `${n}=VALUES(${n})`).join(", ");
  const sql = `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ON DUPLICATE KEY UPDATE ${updates}`;
  await db.prepare(sql).bind(...values).run();
}

export async function handleImport(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const ctx = await getAuthContext(req, env.DB);
  if (!ctx) return unauthorized();
  if (!ctx.isAdmin) return forbidden("admin only");
  const body = await req.json().catch(() => null) as { table?: string; rows?: Record<string, unknown>[] } | null;
  if (!body?.table || !Array.isArray(body.rows)) return badRequest("expected { table, rows }");
  const cols = COLUMNS[body.table];
  if (!cols) return badRequest(`table not importable: ${body.table}`);
  let n = 0;
  for (const row of body.rows) {
    try { await upsertRow(env.DB, body.table, cols, row); n++; }
    catch (e) { return json({ error: "import failed", detail: String(e), imported: n }, { status: 500 }); }
  }
  return json({ ok: true, table: body.table, imported: n });
}

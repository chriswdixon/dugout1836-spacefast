// Generic data REST layer: /api/data/<table> [ /<id> ].
//
// Replaces the Supabase `from(table)` surface with one policy-driven CRUD
// layer. Every table declares who may read/write and which columns are
// client-settable, so the 59 RLS policies become a small policy table checked
// in code. Column and table names come only from this registry (never from the
// request), so SQL identifiers are safe; values are always bound.

import type { D1Database, Env } from "./db";
import { ensureSchema } from "./db";
import { getAuthContext, type AuthCtx } from "./auth";
import { badRequest, forbidden, json, ok, readJson, unauthorized } from "./http";

type Access = "public" | "member" | "admin";

interface TableDef {
  insertable: string[];
  json?: string[]; // TEXT columns holding JSON, (de)serialized
  bool?: string[]; // TINYINT columns exposed as booleans
  num?: string[]; // numeric columns, coerced to Number on read
  read: Access;
  write: Access; // "member" write is further restricted to owner rows (unless admin)
  ownerCol?: string; // member-write ownership column
  forceUserCol?: string; // on create, server sets this column to the user id
  order?: { col: string; dir: "ASC" | "DESC" };
  filter: string[]; // query-param columns allowed as eq filters
  created?: boolean; // has created_at
  updated?: boolean; // has updated_at
}

const TABLES: Record<string, TableDef> = {
  players: {
    insertable: ["name", "external_id", "jersey_number", "positions", "bats", "throws", "grad_year", "photo_url", "sort_order", "source"],
    num: ["grad_year", "sort_order"],
    read: "public", write: "admin",
    order: { col: "sort_order", dir: "ASC" }, filter: ["source"], created: true, updated: true,
  },
  events: {
    insertable: ["title", "event_name", "event_type", "starts_at", "source", "external_id", "opponent", "location", "result", "recap", "notes", "link_url", "score_us", "score_them"],
    num: ["score_us", "score_them"],
    read: "public", write: "admin",
    order: { col: "starts_at", dir: "DESC" }, filter: ["source", "event_type"], created: true, updated: true,
  },
  player_stats: {
    insertable: ["player_id", "player_name", "category", "season", "source", "external_id", "event_id", "stats", "submitted_by"],
    json: ["stats"],
    read: "member", write: "admin",
    filter: ["player_id", "season", "event_id", "category"], created: true, updated: true,
  },
  team_stats: {
    insertable: ["category", "season", "source", "event_id", "stats"],
    json: ["stats"],
    read: "public", write: "admin",
    filter: ["season", "category"], created: true, updated: true,
  },
  albums: {
    insertable: ["title", "description", "season", "event_id", "drive_folder_id", "gphotos_url", "cover_url", "photo_count", "sort_order", "last_synced_at"],
    num: ["photo_count", "sort_order"],
    read: "public", write: "admin",
    order: { col: "sort_order", dir: "ASC" }, filter: ["season", "event_id"], created: true,
  },
  album_photos: {
    insertable: ["album_id", "event_id", "drive_file_id", "name", "mime_type", "storage_path", "thumbnail_url", "width", "height", "created_time", "ai_scanned_at"],
    num: ["width", "height"],
    read: "public", write: "admin",
    filter: ["album_id", "event_id"], created: true,
  },
  media_items: {
    // Members can submit their own videos (owner = submitted_by); admins manage all.
    insertable: ["title", "kind", "media_url", "source", "external_id", "event_id", "description", "mime_type", "thumbnail_url", "storage_path", "published_at"],
    read: "member", write: "member", ownerCol: "submitted_by", forceUserCol: "submitted_by",
    order: { col: "published_at", dir: "DESC" }, filter: ["event_id", "kind", "source"], created: true,
  },
  photo_tags: {
    insertable: ["player_id", "album_photo_id", "photo_upload_id", "jersey_number", "method", "confidence"],
    num: ["confidence"],
    read: "public", write: "member", ownerCol: "created_by", forceUserCol: "created_by",
    filter: ["album_photo_id", "photo_upload_id", "player_id"], created: true, updated: true,
  },
  photo_uploads: {
    insertable: ["album_id", "event_id", "storage_path", "caption", "mime_type", "width", "height", "ai_scanned_at"],
    num: ["width", "height"],
    read: "member", write: "member", ownerCol: "uploaded_by", forceUserCol: "uploaded_by",
    filter: ["album_id", "event_id"], created: true,
  },
  source_configs: {
    insertable: ["source", "enabled", "url", "extra_urls", "team_name", "notes", "last_run_at"],
    json: ["extra_urls"], bool: ["enabled"],
    read: "admin", write: "admin",
    filter: ["source"], updated: true,
  },
  sync_runs: {
    insertable: ["source", "status", "started_at", "finished_at", "items_found", "message"],
    num: ["items_found"],
    read: "admin", write: "admin",
    order: { col: "started_at", dir: "DESC" }, filter: ["source", "status"],
  },
  staged_records: {
    insertable: ["sync_run_id", "source", "kind", "status", "payload"],
    json: ["payload"],
    read: "admin", write: "admin",
    filter: ["sync_run_id", "status"], created: true,
  },
  chat_messages: {
    insertable: ["body", "author_name"],
    read: "member", write: "member", ownerCol: "author_id", forceUserCol: "author_id",
    order: { col: "created_at", dir: "ASC" }, filter: [], created: true,
  },

  // ---- auth-adjacent tables, admin-managed (approvals, invites, roles) ----
  profiles: {
    insertable: ["full_name", "email", "status", "approved_by", "approved_at"],
    read: "admin", write: "admin",
    order: { col: "created_at", dir: "DESC" }, filter: ["status", "user_id"], created: true, updated: true,
  },
  invites: {
    insertable: ["email", "code", "label", "auto_approve"],
    bool: ["auto_approve"],
    read: "admin", write: "admin",
    order: { col: "created_at", dir: "DESC" }, filter: ["email", "code"], created: true,
  },
  user_roles: {
    insertable: ["user_id", "role"],
    read: "admin", write: "admin",
    filter: ["user_id", "role"], created: true,
  },
};

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function canRead(def: TableDef, ctx: AuthCtx | null): boolean {
  if (def.read === "public") return true;
  if (!ctx) return false;
  if (def.read === "admin") return ctx.isAdmin;
  return ctx.isApproved; // member
}
function canWrite(def: TableDef, ctx: AuthCtx | null): boolean {
  if (!ctx) return false;
  if (def.write === "admin") return ctx.isAdmin;
  return ctx.isApproved; // member (ownership enforced per-row for update/delete)
}

function serializeIn(def: TableDef, col: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (def.json?.includes(col)) return typeof value === "string" ? value : JSON.stringify(value);
  if (def.bool?.includes(col)) return value ? 1 : 0;
  return value;
}
function deserializeRow(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const c of def.json ?? []) {
    if (typeof out[c] === "string") { try { out[c] = JSON.parse(out[c] as string); } catch { /* leave */ } }
  }
  for (const c of def.bool ?? []) if (c in out) out[c] = !!out[c];
  for (const c of def.num ?? []) if (out[c] != null) out[c] = Number(out[c]);
  return out;
}

async function context(req: Request, db: D1Database): Promise<AuthCtx | null> {
  return getAuthContext(req, db);
}

export async function handleData(req: Request, env: Env, table: string, id: string | null): Promise<Response> {
  const def = TABLES[table];
  if (!def) return json({ error: "unknown collection" }, { status: 404 });
  await ensureSchema(env.DB);
  const ctx = await context(req, env.DB);
  const method = req.method;

  if (method === "GET") {
    if (!canRead(def, ctx)) return ctx ? forbidden() : unauthorized();
    if (id) {
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
      if (!row) return json({ error: "not found" }, { status: 404 });
      return ok(deserializeRow(def, row));
    }
    const url = new URL(req.url);
    const wheres: string[] = [];
    const binds: unknown[] = [];
    for (const f of def.filter) {
      const v = url.searchParams.get(f);
      if (v !== null) { wheres.push(`${f} = ?`); binds.push(v); }
    }
    let sql = `SELECT * FROM ${table}`;
    if (wheres.length) sql += ` WHERE ${wheres.join(" AND ")}`;
    if (def.order) sql += ` ORDER BY ${def.order.col} ${def.order.dir}`;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 1000);
    sql += ` LIMIT ${limit}`;
    const res = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    return ok((res.results ?? []).map((r) => deserializeRow(def, r)));
  }

  if (method === "POST") {
    if (!canWrite(def, ctx)) return ctx ? forbidden() : unauthorized();
    const body = await readJson<Record<string, unknown>>(req);
    if (!body) return badRequest("invalid json");
    const cols = ["id"];
    const vals: unknown[] = [uuid()];
    for (const c of def.insertable) {
      if (c in body) { const v = serializeIn(def, c, body[c]); if (v !== undefined) { cols.push(c); vals.push(v); } }
    }
    if (def.forceUserCol && ctx) { cols.push(def.forceUserCol); vals.push(ctx.user.id); }
    const ts = nowIso();
    if (def.created) { cols.push("created_at"); vals.push(ts); }
    if (def.updated) { cols.push("updated_at"); vals.push(ts); }
    const placeholders = cols.map(() => "?").join(", ");
    await env.DB.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).bind(...vals).run();
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(vals[0]).first<Record<string, unknown>>();
    return json(deserializeRow(def, row!), { status: 201 });
  }

  if (method === "PATCH" || method === "PUT") {
    if (!id) return badRequest("id required");
    if (!canWrite(def, ctx)) return ctx ? forbidden() : unauthorized();
    const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!existing) return json({ error: "not found" }, { status: 404 });
    if (def.write === "member" && def.ownerCol && ctx && !ctx.isAdmin && existing[def.ownerCol] !== ctx.user.id) return forbidden();
    const body = await readJson<Record<string, unknown>>(req);
    if (!body) return badRequest("invalid json");
    const sets: string[] = [];
    const binds: unknown[] = [];
    for (const c of def.insertable) {
      if (c in body) { const v = serializeIn(def, c, body[c]); if (v !== undefined) { sets.push(`${c} = ?`); binds.push(v); } }
    }
    if (def.updated) { sets.push("updated_at = ?"); binds.push(nowIso()); }
    if (!sets.length) return badRequest("no updatable fields");
    binds.push(id);
    await env.DB.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    return ok(deserializeRow(def, row!));
  }

  if (method === "DELETE") {
    if (!id) return badRequest("id required");
    if (!canWrite(def, ctx)) return ctx ? forbidden() : unauthorized();
    if (def.write === "member" && def.ownerCol && ctx && !ctx.isAdmin) {
      const existing = await env.DB.prepare(`SELECT ${def.ownerCol} AS owner FROM ${table} WHERE id = ?`).bind(id).first<{ owner: string }>();
      if (existing && existing.owner !== ctx.user.id) return forbidden();
    }
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return ok({ ok: true });
  }

  return json({ error: "method not allowed" }, { status: 405 });
}

export const DATA_TABLES = Object.keys(TABLES);

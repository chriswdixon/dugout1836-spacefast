// Object storage for family photo/video uploads, via env.STORAGE.
//
// env.STORAGE.upload(blob, { filename }) -> { id, url, size, contentType }.
// The returned url is a stable, space-keyed URL that Spacefast serves directly,
// so we store the URL itself (the app treats storage_path as the image src and
// signing is an identity op). delete(id) removes an object.

import type { Env } from "./db";
import { getAuthContext } from "./auth";
import { json, unauthorized, forbidden, badRequest } from "./http";

interface StorageBinding {
  upload(data: Blob | ArrayBuffer | Uint8Array, opts?: { filename?: string }): Promise<{ id: string; url: string; size: number; contentType: string }>;
  get(id: string): Promise<unknown>;
  delete(id: string): Promise<unknown>;
}
const storage = (env: Env) => (env as unknown as { STORAGE: StorageBinding }).STORAGE;

// Store URLs relative (origin-stripped) so they keep working across space
// renames / custom domains (the object is served same-origin).
export function relativize(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "");
}

// Store raw bytes and return the served (relative) URL. Used by the photo importers.
export async function storeBytes(env: Env, bytes: ArrayBuffer | Uint8Array, contentType: string, filename: string): Promise<string> {
  const blob = new Blob([bytes], { type: contentType });
  const result = await storage(env).upload(blob, { filename });
  return relativize(result.url);
}

// Extract the object id from a stored URL (…/__stattic/u/<id>?k=…).
export function idFromUrl(url: string): string | null {
  const m = url.match(/\/__stattic\/u\/([a-f0-9]{32})/);
  return m?.[1] ?? null;
}

// POST /api/uploads  — raw body is the file; x-filename / content-type headers.
// DELETE /api/uploads?id=<id or url> — remove an object.
export async function handleUpload(req: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(req, env.DB);
  if (!ctx) return unauthorized();
  if (!ctx.isApproved) return forbidden("account not approved yet");

  if (req.method === "DELETE") {
    const raw = new URL(req.url).searchParams.get("id") ?? "";
    const id = raw.startsWith("http") ? idFromUrl(raw) : raw;
    if (id) await storage(env).delete(id).catch(() => undefined);
    return json({ ok: true });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });

  const contentType = req.headers.get("content-type") || "application/octet-stream";
  const filename = req.headers.get("x-filename") || "upload";
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return badRequest("empty file");
  if (bytes.byteLength > 50 * 1024 * 1024) return badRequest("file too large (50MB max)");

  const blob = new Blob([bytes], { type: contentType });
  const result = await storage(env).upload(blob, { filename });
  return json({ id: result.id, url: relativize(result.url), size: result.size, contentType: result.contentType }, { status: 201 });
}

// POST /api/admin/relativize — one-off: strip absolute origins off stored media
// URLs so they resolve on any domain (fixes a space rename breaking images).
export async function handleRelativize(req: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(req, env.DB);
  if (!ctx) return unauthorized();
  if (!ctx.isAdmin) return forbidden("admin only");
  const updates: [string, string][] = [
    ["album_photos", "storage_path"], ["album_photos", "thumbnail_url"],
    ["albums", "cover_url"], ["players", "photo_url"],
    ["media_items", "media_url"], ["media_items", "thumbnail_url"], ["media_items", "storage_path"],
    ["photo_uploads", "storage_path"],
  ];
  const done: Record<string, unknown> = {};
  for (const [table, col] of updates) {
    try {
      const r = await env.DB.prepare(
        `UPDATE ${table} SET ${col} = REGEXP_REPLACE(${col}, '^https?://[^/]+', '') WHERE ${col} LIKE 'http%//%/__stattic/%'`,
      ).run();
      done[`${table}.${col}`] = (r.meta as { changes?: number } | undefined)?.changes ?? "ok";
    } catch (e) {
      done[`${table}.${col}`] = "err: " + String(e).slice(0, 80);
    }
  }
  return json({ ok: true, updated: done });
}

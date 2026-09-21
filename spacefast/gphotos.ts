// Google Photos album import, ported from src/lib/gphotos.server.ts.
//
// Fetches the public share page's raw HTML directly (keyless, no Firecrawl),
// parses the embedded photo tokens, copies each image into env.STORAGE, and
// records album_photos linked to the game they were most likely taken at.

import type { D1Database, Env } from "./db";
import { getAuthContext } from "./auth";
import { storeBytes } from "./storage";
import { json, forbidden, unauthorized, badRequest } from "./http";

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export async function resolveShareUrl(input: string): Promise<string> {
  const trimmed = input.trim().replace(/photos\.google\.com\/u\/\d+\/share\//, "photos.google.com/share/");
  if (trimmed.includes("photos.google.com/share/")) return trimmed;
  if (trimmed.includes("photos.app.goo.gl")) {
    const res = await fetch(trimmed, { method: "HEAD", redirect: "follow" });
    if (res.url.includes("photos.google.com/share/")) return res.url;
  }
  throw new Error("That doesn't look like a Google Photos shared album link.");
}

export type PhotoMeta = { token: string; takenAt: string | null; width: number | null; height: number | null };

export function extractPhotos(html: string): PhotoMeta[] {
  const detailed = /"https:\/\/lh3\.googleusercontent\.com\/pw\/(AP1Gcz[A-Za-z0-9_-]+)",(\d+),(\d+),(?:(?!lh3\.googleusercontent)[\s\S]){0,400}?(\d{13})/g;
  const byToken = new Map<string, PhotoMeta>();
  for (const m of html.matchAll(detailed)) {
    const token = m[1]!;
    if (byToken.has(token)) continue;
    byToken.set(token, { token, takenAt: new Date(Number(m[4])).toISOString(), width: Number(m[2]) || null, height: Number(m[3]) || null });
  }
  const plain = html.match(/https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_\-=]+/g) ?? [];
  for (const url of plain) {
    const token = (url.split("/pw/")[1] ?? "").split("=")[0];
    if (!token || byToken.has(token)) continue;
    byToken.set(token, { token, takenAt: null, width: null, height: null });
  }
  return [...byToken.values()];
}

export function gameForPhoto(takenAt: string | null, games: { id: string; starts_at: string }[]): string | null {
  if (!takenAt) return null;
  const t = Date.parse(takenAt);
  let best: { id: string; start: number } | null = null;
  for (const g of games) {
    const start = Date.parse(g.starts_at);
    if (t >= start - 25 * 60_000 && t <= start + 4 * 3_600_000) {
      if (!best || start > best.start) best = { id: g.id, start };
    }
  }
  return best?.id ?? null;
}

async function fetchAlbumHtml(shareUrl: string): Promise<string> {
  const res = await fetch(shareUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; DugoutBot/1.0)", "accept-language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`Could not read the album [${res.status}].`);
  return await res.text();
}

export async function syncGooglePhotos(db: D1Database, env: Env, url: string, opts: { title?: string; description?: string } = {}): Promise<Record<string, unknown>> {
  const shareUrl = await resolveShareUrl(url);
  const html = await fetchAlbumHtml(shareUrl);
  const photos = extractPhotos(html);
  if (photos.length === 0) throw new Error("No photos were found at that link. Make sure the album is shared as 'anyone with the link'.");
  const pageTitle = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/ - Google Photos$/, "").trim();
  photos.sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? ""));

  const gamesRes = await db.prepare("SELECT id, starts_at FROM events ORDER BY starts_at ASC").all<{ id: string; starts_at: string }>();
  const gameRows = gamesRes.results ?? [];

  // Upsert album by gphotos_url.
  const existingAlbum = await db.prepare("SELECT id FROM albums WHERE gphotos_url = ?").bind(shareUrl).first<{ id: string }>();
  let albumId: string;
  const ts = nowIso();
  if (existingAlbum) {
    albumId = existingAlbum.id;
    await db.prepare("UPDATE albums SET title=?, description=?, last_synced_at=? WHERE id=?")
      .bind(opts.title?.trim() || pageTitle || "Team album", opts.description?.trim() || null, ts, albumId).run();
  } else {
    albumId = uuid();
    await db.prepare("INSERT INTO albums (id, title, description, gphotos_url, last_synced_at, photo_count, sort_order, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)")
      .bind(albumId, opts.title?.trim() || pageTitle || "Team album", opts.description?.trim() || null, shareUrl, ts, ts).run();
  }

  const known = new Set((await db.prepare("SELECT drive_file_id FROM album_photos WHERE album_id = ?").bind(albumId).all<{ drive_file_id: string }>()).results?.map((r) => r.drive_file_id) ?? []);
  const fresh = photos.filter((p) => !known.has(p.token));

  let added = 0, coverUrl: string | null = null;
  for (const p of fresh) {
    try {
      const img = await fetch(`https://lh3.googleusercontent.com/pw/${p.token}=w2000`);
      if (!img.ok) continue;
      const stored = await storeBytes(env, await img.arrayBuffer(), "image/jpeg", `${p.token}.jpg`);
      if (!coverUrl) coverUrl = stored;
      await db.prepare(
        `INSERT INTO album_photos (id, album_id, event_id, drive_file_id, mime_type, storage_path, thumbnail_url, width, height, created_time, created_at)
         VALUES (?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?)`,
      ).bind(uuid(), albumId, gameForPhoto(p.takenAt, gameRows), p.token, stored, stored, p.width, p.height, p.takenAt, nowIso()).run();
      added++;
    } catch { /* skip a photo that won't fetch */ }
  }

  const total = (await db.prepare("SELECT COUNT(*) AS n FROM album_photos WHERE album_id = ?").bind(albumId).first<{ n: number }>())?.n ?? added;
  const cover = coverUrl ?? (await db.prepare("SELECT storage_path FROM album_photos WHERE album_id = ? ORDER BY created_time ASC LIMIT 1").bind(albumId).first<{ storage_path: string }>())?.storage_path ?? null;
  await db.prepare("UPDATE albums SET photo_count = ?, cover_url = COALESCE(cover_url, ?) WHERE id = ?").bind(total, cover, albumId).run();

  return { ok: true, albumId, added, found: photos.length, total };
}

// POST /api/admin/gphotos { url, title?, description? }  (admin)
export async function handleGphotos(req: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(req, env.DB);
  if (!ctx) return unauthorized();
  if (!ctx.isAdmin) return forbidden("admin only");
  const body = await req.json().catch(() => null) as { url?: string; title?: string; description?: string } | null;
  if (!body?.url) return badRequest("url required");
  try {
    return json(await syncGooglePhotos(env.DB, env, body.url, { title: body.title, description: body.description }));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

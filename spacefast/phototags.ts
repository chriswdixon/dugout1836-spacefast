// AI jersey-number tagging for album photos.
//
// Uses an OpenAI-compatible vision model (env AI_API_URL / AI_API_KEY /
// AI_VISION_MODEL). Reads jersey numbers off photos and tags the matching
// roster player. Gracefully reports when no vision model is configured.

import type { D1Database, Env } from "./db";
import { getAuthContext } from "./auth";
import { json, forbidden, unauthorized } from "./http";

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

const SYSTEM_PROMPT = [
  "You read jersey numbers in youth baseball photos. Jersey numbers are the ONLY thing you report.",
  "Report a number only when you can literally see and read the printed digits on a uniform (front, back or sleeve).",
  "Never infer a number from a face, body shape, hair, skin tone, height, batting stance, fielding position, dugout order, background, caption or any other context.",
  "If a number is partly hidden, blurred, angled away, cut off or ambiguous, do not report it.",
  "Never report a person you cannot read a number for, and never report the same number twice.",
  "Give each reported number a confidence between 0 and 1 reflecting how clearly the digits are legible.",
  'Return ONLY JSON: {"jersey_numbers":[{"jersey_number":"12","confidence":0.9}],"numbers_unreadable":false}.',
].join(" ");

export type Sighting = { jersey_number: string; confidence: number };

async function readJerseyNumbers(imageUrl: string, env: Env): Promise<Sighting[]> {
  const apiUrl = env.AI_API_URL as string | undefined;
  const apiKey = env.AI_API_KEY as string | undefined;
  const model = (env.AI_VISION_MODEL as string | undefined) ?? (env.AI_MODEL as string | undefined) ?? "gpt-4o-mini";
  if (!apiUrl || !apiKey) throw new Error("AI vision is not configured (set AI_API_URL, AI_API_KEY, AI_VISION_MODEL).");
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: "Which jersey numbers can you read in this photo? If none are legible, say so." },
          { type: "image_url", image_url: { url: imageUrl } },
        ] },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI vision failed [${res.status}].`);
  const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let parsed: { jersey_numbers?: Sighting[] } = {};
  try { parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"); } catch { return []; }
  return (parsed.jersey_numbers ?? [])
    .map((s) => ({ jersey_number: String(s.jersey_number ?? "").replace(/[^0-9]/g, ""), confidence: typeof s.confidence === "number" ? s.confidence : 0.5 }))
    .filter((s) => s.jersey_number.length > 0);
}

// POST /api/admin/scan-photos { limit? }  (admin)
export async function handleScanPhotos(req: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(req, env.DB);
  if (!ctx) return unauthorized();
  if (!ctx.isAdmin) return forbidden("admin only");
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(body?.limit ?? 15, 40);

  const db: D1Database = env.DB;
  const players = (await db.prepare("SELECT id, jersey_number FROM players WHERE jersey_number IS NOT NULL AND jersey_number != ''").all<{ id: string; jersey_number: string }>()).results ?? [];
  const byJersey = new Map(players.map((p) => [String(p.jersey_number).replace(/[^0-9]/g, ""), p.id]));

  const photos = (await db.prepare("SELECT id, storage_path, thumbnail_url FROM album_photos WHERE ai_scanned_at IS NULL AND storage_path IS NOT NULL LIMIT ?").bind(limit).all<{ id: string; storage_path: string; thumbnail_url: string | null }>()).results ?? [];

  let scanned = 0, tagged = 0;
  try {
    for (const photo of photos) {
      const url = photo.storage_path || photo.thumbnail_url;
      if (!url) continue;
      const sightings = await readJerseyNumbers(url, env);
      for (const s of sightings) {
        const playerId = byJersey.get(s.jersey_number);
        if (!playerId) continue;
        const existing = await db.prepare("SELECT id FROM photo_tags WHERE album_photo_id = ? AND player_id = ?").bind(photo.id, playerId).first();
        if (existing) continue;
        const ts = nowIso();
        await db.prepare("INSERT INTO photo_tags (id, player_id, album_photo_id, jersey_number, method, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, 'ai', ?, ?, ?)")
          .bind(uuid(), playerId, photo.id, s.jersey_number, s.confidence, ts, ts).run();
        tagged++;
      }
      await db.prepare("UPDATE album_photos SET ai_scanned_at = ? WHERE id = ?").bind(nowIso(), photo.id).run();
      scanned++;
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), scanned, tagged }, { status: scanned ? 200 : 400 });
  }
  return json({ ok: true, scanned, tagged, remaining: photos.length === limit });
}

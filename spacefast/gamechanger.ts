// GameChanger sync, ported from src/lib/gamechanger.server.ts.
//
// Reads GameChanger's browser-rendered pages through the Jina Reader proxy
// (keyless) and parses them deterministically — NO Firecrawl, NO LLM. Writes
// events + box-score line scores to the worker's own database (env.DB).

import type { D1Database } from "./db";

export const CUTOFF_ISO = "2026-09-12T00:00:00.000Z";

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const monthNum = (name: string) => MONTH_MAP[name.toLowerCase()] ?? 0;
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chicagoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}
function toUtcIso(raw: string) {
  const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(raw.trim());
  if (hasZone) return new Date(raw).toISOString();
  const guess = new Date(`${raw.trim().replace(" ", "T")}Z`);
  const p = chicagoParts(guess);
  const offset = new Date(`${p.date}T${p.time}:00Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}
function gameIdOf(url: string) {
  const m = url.match(/\/schedule\/([a-f0-9-]+)\/recap/i);
  return m?.[1] ?? url.replace(/\/+$/, "").split("/").pop() ?? url;
}

export type ParsedGame = {
  gameId: string; starts_at: string; opponent: string; result: string | null;
  score_us: number | null; score_them: number | null; location: string | null; notes: string | null; link_url: string;
};

export function parseRecap(markdown: string, url: string): ParsedGame | null {
  const gameId = gameIdOf(url);
  const dtMatch = markdown.match(/([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*(CT)/i);
  if (!dtMatch) return null;
  const month = monthNum(dtMatch[2] ?? "");
  const day = Number(dtMatch[3] ?? "0");
  let hour = Number(dtMatch[4] ?? "0") % 12;
  if ((dtMatch[6] ?? "").toUpperCase() === "PM") hour += 12;
  const minute = dtMatch[5] ?? "00";
  const yearMatch = markdown.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  const year = yearMatch ? Number(yearMatch[3]) : new Date().getFullYear();
  if (month <= 0 || day <= 0) return null;
  const startsAt = toUtcIso(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00`);
  const titleMatch = markdown.match(/^#\s*(.+?)\s+(defeats|defeated|ties|played to|loses to|falls to)\s+(.+?)$/im);
  let opponent = "Opponent";
  if (titleMatch?.[1] && titleMatch?.[3]) {
    const left = titleMatch[1].trim(); const right = titleMatch[3].trim();
    opponent = left.toLowerCase().includes("1836 roughriders") ? right : left;
  } else {
    const vsMatch = markdown.match(/vs\.\s*(.+?)(?:\n|$)/i);
    if (vsMatch?.[1]) opponent = vsMatch[1].trim();
  }
  const abbrMatch = markdown.match(/\|\s*---\s*\|\s*\n\|\s*([^\n]+?)\s*\|\s*\n\|\s*([^\n]+?)\s*\|/);
  const abbrA = abbrMatch?.[1]?.trim() ?? ""; const abbrB = abbrMatch?.[2]?.trim() ?? "";
  const usRow = abbrA === "1836" ? 1 : abbrB === "1836" ? 2 : 0;
  const rheMatch = markdown.match(/\|\s*R\s*\|\s*H\s*\|\s*E\s*\|\s*\n\|\s*---[^\n]*\n\|\s*(\d+)[^\n]*\|\s*[^\n]*\|\s*[^\n]*\n\|\s*(\d+)[^\n]*\|\s*[^\n]*\|\s*[^\n]*/);
  const runsA = Number(rheMatch?.[1] ?? NaN); const runsB = Number(rheMatch?.[2] ?? NaN);
  let scoreUs: number | null = null, scoreThem: number | null = null, result: string | null = null;
  if (Number.isFinite(runsA) && Number.isFinite(runsB)) {
    if (usRow === 1) { scoreUs = runsA; scoreThem = runsB; }
    else if (usRow === 2) { scoreUs = runsB; scoreThem = runsA; }
    else { const aUs = /1836/i.test(abbrA); scoreUs = aUs ? runsA : runsB; scoreThem = aUs ? runsB : runsA; }
    if (scoreUs !== null && scoreThem !== null) result = scoreUs > scoreThem ? "W" : scoreUs < scoreThem ? "L" : "T";
  }
  return { gameId, starts_at: startsAt, opponent, result, score_us: scoreUs, score_them: scoreThem, location: null, notes: null, link_url: url };
}

export type BoxScore = {
  innings_us: number[]; innings_them: number[]; runs_us: number | null; runs_them: number | null;
  hits_us: number | null; hits_them: number | null; errors_us: number | null; errors_them: number | null;
};
const tableRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseBoxScore(markdown: string): BoxScore | null {
  const lines = markdown.split("\n");
  let usIndex = -1;
  for (let i = 0; i < lines.length - 3; i++) {
    if (!/^\|\s*\|$/.test(lines[i]!.trim())) continue;
    if (!/^\|\s*-+\s*\|$/.test(lines[i + 1]!.trim())) continue;
    const a = tableRow(lines[i + 2] ?? "")[0] ?? ""; const b = tableRow(lines[i + 3] ?? "")[0] ?? "";
    if (/1836/.test(a)) usIndex = 0; else if (/1836/.test(b)) usIndex = 1;
    if (usIndex >= 0) break;
  }
  if (usIndex < 0) return null;
  const numbersAfter = (headerTest: RegExp) => {
    for (let i = 0; i < lines.length - 3; i++) {
      if (!headerTest.test(lines[i]!.trim())) continue;
      if (!/^\|\s*-+/.test(lines[i + 1]!.trim())) continue;
      const first = tableRow(lines[i + 2] ?? "").map((v) => Number(v));
      const second = tableRow(lines[i + 3] ?? "").map((v) => Number(v));
      if (first.every((n) => Number.isFinite(n)) && second.every((n) => Number.isFinite(n))) return [first, second];
    }
    return null;
  };
  const innings = numbersAfter(/^\|\s*1\s*\|\s*2\s*\|/);
  const rhe = numbersAfter(/^\|\s*R\s*\|\s*H\s*\|\s*E\s*\|$/);
  if (!innings && !rhe) return null;
  const pick = (pair: number[][] | null, idx: number, col: number) => pair?.[idx]?.[col] ?? null;
  const them = usIndex === 0 ? 1 : 0;
  return {
    innings_us: innings?.[usIndex] ?? [], innings_them: innings?.[them] ?? [],
    runs_us: pick(rhe, usIndex, 0), runs_them: pick(rhe, them, 0),
    hits_us: pick(rhe, usIndex, 1), hits_them: pick(rhe, them, 1),
    errors_us: pick(rhe, usIndex, 2), errors_them: pick(rhe, them, 2),
  };
}
const boxScoreUrl = (gameId: string, teamPageUrl: string) => {
  const base = teamPageUrl.replace(/\/schedule.*$/i, "").replace(/\/+$/, "");
  return `${base}/schedule/${gameId}/box-score`;
};

const cleanMd = (md: string) =>
  md.replace(/\\\[/g, "[").replace(/\\\]/g, "]").replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\([@*_~|])/g, "$1");

// Jina Reader only (no Firecrawl fallback, per project decision).
async function fetchMarkdown(url: string, tries = 3): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      if (attempt > 0) await wait(12000 * attempt);
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/markdown", "X-Return-Format": "markdown" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429) { lastError = new Error("Reader is busy."); continue; }
      if (!res.ok) { lastError = new Error(`Reader failed [${res.status}].`); break; }
      const md = cleanMd(await res.text());
      if (md.trim().length > 400) return md;
      lastError = new Error("That page came back empty.");
    } catch (e) { lastError = e; }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read that page.");
}

async function mapConcurrent<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item);
    }
  });
  await Promise.all(workers);
  return results;
}

export type ScheduleRow = {
  gameId: string; recapUrl: string; gameUrl: string; starts_at: string; opponent: string;
  result: string | null; score_us: number | null; score_them: number | null;
};

export function parseScheduleIndex(markdown: string): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let month = 0, year = new Date().getFullYear(), day = 0;
  const headingAt = markdown.search(/^#\s*Schedule\s*$/m);
  const body = headingAt >= 0 ? markdown.slice(headingAt) : markdown;
  const token = /\n[ \t]*([A-Za-z]+)[ \t]+(\d{4})[ \t]*(?=\n)|\n[ \t]*(\d{1,2})[ \t]*(?=\n)|\[([^\]]+)\]\((https:\/\/web\.gc\.com\/teams\/[A-Za-z0-9]+\/schedule\/([a-f0-9-]{36}))[^)]*\)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(body)) !== null) {
    if (match[1] && match[2]) { const m = monthNum(match[1]); if (m > 0) { month = m; year = Number(match[2]); } continue; }
    if (match[3]) { const d = Number(match[3]); if (d >= 1 && d <= 31) day = d; continue; }
    const label = (match[4] ?? "").replace(/\\/g, " ").replace(/\s+/g, " ").trim();
    const gameUrl = match[5] ?? ""; const gameId = match[6] ?? "";
    if (!gameId || month <= 0 || day <= 0) continue;
    const opponentMatch = label.match(/(?:@|vs\.?)\s*(.+?)\s*(?:[WLT]\s*\d+-\d+|\d{1,2}:\d{2}\s*(?:AM|PM)|$)/i);
    const opponent = opponentMatch?.[1]?.trim() ?? "";
    if (!opponent) continue;
    const scoreMatch = label.match(/\b([WLT])\s*(\d+)-(\d+)\b/i);
    rows.push({
      gameId, gameUrl, recapUrl: `${gameUrl.replace(/\/+$/, "")}/recap`,
      starts_at: toUtcIso(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00`),
      opponent, result: scoreMatch?.[1] ? scoreMatch[1].toUpperCase() : null,
      score_us: scoreMatch?.[2] ? Number(scoreMatch[2]) : null, score_them: scoreMatch?.[3] ? Number(scoreMatch[3]) : null,
    });
  }
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.gameId) ? false : (seen.add(r.gameId), true)));
}

// ---- DB helpers (env.DB / MySQL) ----
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

async function selectIn<T = Record<string, unknown>>(db: D1Database, sql: string, ids: string[], extra: unknown[] = []): Promise<T[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const res = await db.prepare(sql.replace("__IN__", placeholders)).bind(...extra, ...ids).all<T>();
  return res.results ?? [];
}

export async function syncGameChanger(db: D1Database, teamPageUrl: string, extraUrls: string[] | null): Promise<Record<string, unknown>> {
  const runId = uuid();
  await db.prepare("INSERT INTO sync_runs (id, source, status, started_at, items_found) VALUES (?, 'gamechanger', 'running', ?, 0)").bind(runId, nowIso()).run();
  const problems: string[] = [];
  try {
    let listed: ScheduleRow[] = [];
    if (teamPageUrl && teamPageUrl.startsWith("http")) {
      try { listed = parseScheduleIndex(await fetchMarkdown(teamPageUrl)); }
      catch (e) { problems.push(`team schedule page: ${e instanceof Error ? e.message : "failed"}`); }
    }
    type Target = { id: string; url: string; listed: ScheduleRow | null };
    const targets = new Map<string, Target>();
    for (const row of listed) targets.set(row.gameId, { id: row.gameId, url: row.recapUrl, listed: row });
    for (const raw of extraUrls ?? []) {
      if (typeof raw !== "string" || !raw.startsWith("http")) continue;
      const id = gameIdOf(raw);
      if (!targets.has(id)) targets.set(id, { id, url: raw, listed: null });
    }
    if (targets.size === 0) throw new Error("No GameChanger games found yet.");

    const targetList = [...targets.values()];
    const externalIds = targetList.map((t) => `gc-${t.id}`);
    const existingGames = await selectIn<Record<string, unknown>>(
      db, "SELECT id, external_id, starts_at, opponent, result, score_us, score_them, location, notes, link_url FROM events WHERE source='gamechanger' AND external_id IN (__IN__)", externalIds,
    );
    const existingByExternal = new Map(existingGames.map((e) => [e["external_id"] as string, e]));

    const parsed = await mapConcurrent(targetList, 4, async (target) => {
      let game: ParsedGame | null = null;
      const existing = existingByExternal.get(`gc-${target.id}`);
      if (existing && target.listed) {
        game = {
          gameId: target.id, starts_at: existing["starts_at"] as string,
          opponent: target.listed.opponent || (existing["opponent"] as string),
          result: target.listed.result ?? (existing["result"] as string | null),
          score_us: target.listed.score_us ?? (existing["score_us"] as number | null),
          score_them: target.listed.score_them ?? (existing["score_them"] as number | null),
          location: existing["location"] as string | null, notes: existing["notes"] as string | null,
          link_url: target.listed.gameUrl || (existing["link_url"] as string),
        };
      } else {
        try { game = parseRecap(await fetchMarkdown(target.url), target.url); }
        catch (e) { problems.push(`${slug(target.url)}: ${e instanceof Error ? e.message : "failed"}`); }
      }
      if (!game && target.listed) {
        const r = target.listed;
        game = { gameId: r.gameId, starts_at: r.starts_at, opponent: r.opponent, result: r.result, score_us: r.score_us, score_them: r.score_them, location: null, notes: null, link_url: r.gameUrl };
      }
      if (!game) { problems.push(`${slug(target.url)}: could not read the scoreboard`); return null; }
      if (target.listed?.result) { game.result = target.listed.result; game.score_us = target.listed.score_us; game.score_them = target.listed.score_them; }
      if (game.starts_at < CUTOFF_ISO) return null;
      if (game.opponent === "Opponent" && target.listed?.opponent) game.opponent = target.listed.opponent;
      if (game.opponent === "Opponent" || /1836\s*roughriders/i.test(game.opponent)) { problems.push(`${slug(target.url)}: no opponent named, skipped`); return null; }
      return game;
    });

    const games = parsed.filter((g): g is ParsedGame => g !== null);
    for (const g of games) {
      const ts = nowIso();
      await db.prepare(
        `INSERT INTO events (id, event_type, starts_at, location, opponent, result, score_us, score_them, notes, link_url, source, external_id, created_at, updated_at)
         VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?, ?, 'gamechanger', ?, ?, ?)
         ON DUPLICATE KEY UPDATE starts_at=VALUES(starts_at), location=VALUES(location), opponent=VALUES(opponent),
           result=VALUES(result), score_us=VALUES(score_us), score_them=VALUES(score_them), notes=VALUES(notes),
           link_url=VALUES(link_url), updated_at=VALUES(updated_at)`,
      ).bind(uuid(), g.starts_at, g.location, g.opponent, g.result, g.score_us, g.score_them, g.notes, g.link_url, `gc-${g.gameId}`, ts, ts).run();
      await db.prepare("INSERT INTO staged_records (id, sync_run_id, source, kind, status, payload, created_at) VALUES (?, ?, 'gamechanger', 'event', 'published', ?, ?)")
        .bind(uuid(), runId, JSON.stringify(g), nowIso()).run();
    }

    // Box scores -> team_stats line_score (only for finished games).
    let boxScores = 0;
    const extIds = games.map((g) => `gc-${g.gameId}`);
    const saved = await selectIn<{ id: string; external_id: string; starts_at: string }>(
      db, "SELECT id, external_id, starts_at FROM events WHERE source='gamechanger' AND external_id IN (__IN__)", extIds,
    );
    const byExternal = new Map(saved.map((e) => [e.external_id, e]));
    const boxTargets = games.filter((g) => g.result && byExternal.has(`gc-${g.gameId}`));
    const lines = (await mapConcurrent(boxTargets, 3, async (g) => {
      const ev = byExternal.get(`gc-${g.gameId}`);
      if (!ev) return null;
      try {
        const box = parseBoxScore(await fetchMarkdown(boxScoreUrl(g.gameId, teamPageUrl)));
        if (!box) return null;
        return { eventId: ev.id, season: String(new Date(ev.starts_at).getUTCFullYear()), box };
      } catch (e) { problems.push(`box score ${g.gameId}: ${e instanceof Error ? e.message : "failed"}`); return null; }
    })).filter((l): l is NonNullable<typeof l> => l !== null);
    for (const l of lines) {
      const ts = nowIso();
      await db.prepare(
        `INSERT INTO team_stats (id, category, season, source, event_id, stats, created_at, updated_at)
         VALUES (?, 'line_score', ?, 'gamechanger', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE stats=VALUES(stats), season=VALUES(season), updated_at=VALUES(updated_at)`,
      ).bind(uuid(), l.season, l.eventId, JSON.stringify(l.box), ts, ts).run();
      boxScores++;
    }

    const msg = games.length === 0 ? "No new GameChanger games to publish."
      : `Published ${games.length} GameChanger game${games.length === 1 ? "" : "s"}` +
        (boxScores > 0 ? ` and ${boxScores} box score${boxScores === 1 ? "" : "s"}` : "") + "." +
        (problems.length ? ` Skipped: ${problems.join("; ")}` : "");
    await db.prepare("UPDATE sync_runs SET status='succeeded', items_found=?, finished_at=?, message=? WHERE id=?")
      .bind(games.length, nowIso(), msg, runId).run();
    return { ok: true, events: games.length, boxScores, problems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare("UPDATE sync_runs SET status='failed', finished_at=?, message=? WHERE id=?").bind(nowIso(), message, runId).run();
    return { ok: false, error: message };
  }
}

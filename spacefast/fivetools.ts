// Five Tools sync, ported from src/lib/fivetools.server.ts.
// Deterministic table parser over the Jina-read schedule pages. No Firecrawl.

import type { D1Database, Env } from "./db";
import { scrape } from "./sync";

const TEAM_MATCH = /1836\s*rough\s*riders.*burnett/i;
const CUTOFF_ISO = "2026-09-12T00:00:00.000Z";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function chicagoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}
const stamp = (iso: string) => { const p = chicagoParts(new Date(iso)); return `${p.date}${p.time}`.replace(/[-:]/g, ""); };
function toUtcIso(raw: string) {
  const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(raw.trim());
  if (hasZone) return new Date(raw).toISOString();
  const guess = new Date(`${raw.trim().replace(" ", "T")}Z`);
  const p = chicagoParts(guess);
  const offset = new Date(`${p.date}T${p.time}:00Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}
const eventSlugOf = (url: string) => url.replace(/\/+$/, "").split("/").pop() ?? url;

export function findEventUrls(markdown: string) {
  const found = new Set<string>();
  for (const m of markdown.matchAll(/https?:\/\/(?:events\.)?fivetool\.org\/events\/([a-z0-9-]+)/gi)) found.add(`https://events.fivetool.org/events/${m[1]}`);
  return [...found];
}

export type ParsedGame = { date: string; time: string; location: string | null; opponent: string; scoreUs: number | null; scoreThem: number | null; result: string | null; tournament: string };
const toNumber = (raw: string) => { const n = Number.parseInt(raw.replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; };

export function parseSchedule(markdown: string): ParsedGame[] {
  const lines = markdown.split("\n");
  const tournament = (markdown.match(/^\*\*(.+?)\*\*$/m)?.[1] ?? "Five Tool event").trim();
  const games: ParsedGame[] = [];
  let date: string | null = null;
  for (const line of lines) {
    const heading = line.match(/([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (heading && line.includes("######")) {
      const month = MONTHS.indexOf((heading[2] ?? "").toLowerCase());
      if (month >= 0) date = `${heading[4]}-${String(month + 1).padStart(2, "0")}-${(heading[3] ?? "").padStart(2, "0")}`;
      continue;
    }
    if (!date || !line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.length < 10) continue;
    const timeMatch = (cells[0] ?? "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch) continue;
    let hour = Number.parseInt(timeMatch[1] ?? "0", 10) % 12;
    if ((timeMatch[3] ?? "").toUpperCase() === "PM") hour += 12;
    const time = `${String(hour).padStart(2, "0")}:${timeMatch[2]}`;
    const teamA = (cells[6] ?? "").match(/\[([^\]]+)\]/)?.[1]?.trim() ?? "";
    const teamB = (cells[9] ?? "").match(/\[([^\]]+)\]/)?.[1]?.trim() ?? "";
    const usIsA = TEAM_MATCH.test(teamA), usIsB = TEAM_MATCH.test(teamB);
    if (usIsA === usIsB) continue;
    const opponent = usIsA ? teamB : teamA;
    const rawUs = toNumber((usIsA ? cells[7] : cells[8]) ?? "");
    const rawThem = toNumber((usIsA ? cells[8] : cells[7]) ?? "");
    const unscored = !rawUs && !rawThem;
    const scoreUs = unscored ? null : rawUs, scoreThem = unscored ? null : rawThem;
    const location = (cells[2] ?? "").replace(/\*\*\d+\*\*/g, "").trim() || null;
    const result = scoreUs === null || scoreThem === null ? null : scoreUs > scoreThem ? "W" : scoreUs < scoreThem ? "L" : "T";
    games.push({ date, time, location, opponent, scoreUs, scoreThem, result, tournament });
  }
  return games;
}

async function scrapeWithRetry(url: string, env: Env, tries = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try { if (attempt > 0) await wait(6000 * attempt); return await scrape(url, env); }
    catch (e) { lastError = e; }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read that page.");
}

export async function syncFiveTools(db: D1Database, env: Env, teamPageUrl: string): Promise<Record<string, unknown>> {
  const runId = uuid();
  await db.prepare("INSERT INTO sync_runs (id, source, status, started_at, items_found) VALUES (?, 'fivetools', 'running', ?, 0)").bind(runId, nowIso()).run();
  const problems: string[] = [];
  try {
    const teamMarkdown = await scrape(teamPageUrl, env);
    const eventUrls = findEventUrls(teamMarkdown);
    if (eventUrls.length === 0) throw new Error("No tournaments listed on that team page.");
    let count = 0;
    for (const eventUrl of eventUrls) {
      const eventSlug = eventSlugOf(eventUrl);
      try {
        const markdown = await scrapeWithRetry(`${eventUrl}/schedule/all?date=all`, env);
        const games = parseSchedule(markdown);
        if (games.length === 0) problems.push(`${eventSlug}: no games listed for us`);
        for (const g of games) {
          const startsAt = toUtcIso(`${g.date}T${g.time}:00`);
          if (startsAt < CUTOFF_ISO) continue;
          const externalId = `ft-${eventSlug}-${stamp(startsAt)}-${slug(g.opponent)}`;
          const ts = nowIso();
          await db.prepare(
            `INSERT INTO events (id, event_type, starts_at, location, opponent, result, score_us, score_them, notes, source, external_id, created_at, updated_at)
             VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?, 'fivetools', ?, ?, ?)
             ON DUPLICATE KEY UPDATE starts_at=VALUES(starts_at), location=VALUES(location), opponent=VALUES(opponent),
               result=VALUES(result), score_us=VALUES(score_us), score_them=VALUES(score_them), notes=VALUES(notes), updated_at=VALUES(updated_at)`,
          ).bind(uuid(), startsAt, g.location, g.opponent, g.result, g.scoreUs, g.scoreThem, g.tournament, externalId, ts, ts).run();
          await db.prepare("INSERT INTO staged_records (id, sync_run_id, source, kind, status, payload, created_at) VALUES (?, ?, 'fivetools', 'event', 'published', ?, ?)")
            .bind(uuid(), runId, JSON.stringify({ ...g, tournament_slug: eventSlug }), nowIso()).run();
          count++;
        }
      } catch (e) { problems.push(`${eventSlug}: ${e instanceof Error ? e.message : "failed"}`); }
    }
    const msg = count === 0 ? "No games readable on Five Tools right now."
      : `Refreshed ${count} game${count === 1 ? "" : "s"} from ${eventUrls.length} tournament${eventUrls.length === 1 ? "" : "s"}.` + (problems.length ? ` Skipped: ${problems.join("; ")}` : "");
    await db.prepare("UPDATE sync_runs SET status='succeeded', items_found=?, finished_at=?, message=? WHERE id=?").bind(count, nowIso(), msg, runId).run();
    return { ok: true, events: count, tournaments: eventUrls.length, problems };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.prepare("UPDATE sync_runs SET status='failed', finished_at=?, message=? WHERE id=?").bind(nowIso(), message, runId).run();
    return { ok: false, error: message };
  }
}

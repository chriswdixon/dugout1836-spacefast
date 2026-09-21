// Canonical baseball stat columns per category, in scorebook order.
export const BASEBALL_FIELDS: Record<string, string[]> = {
  batting: ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "BB", "SO", "AVG", "OBP", "SLG", "OPS"],
  pitching: ["W", "L", "SV", "G", "GS", "IP", "H", "R", "ER", "BB", "K", "ERA", "WHIP"],
  fielding: ["G", "PO", "A", "E", "DP", "FPCT"],
};

// Columns where the highest number leads (used to highlight team leaders).
export const LEADER_COLUMNS: Record<string, string[]> = {
  batting: ["AVG", "HR", "RBI", "SB", "H", "OPS"],
  pitching: ["W", "K", "SV"],
  fielding: ["FPCT"],
};

// Columns where the lowest number leads.
export const LOW_LEADER_COLUMNS: Record<string, string[]> = {
  pitching: ["ERA", "WHIP"],
};

export type StatMap = Record<string, string | number>;

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtAvg(n: number): string {
  // Baseball convention: .350 (no leading zero, three decimals)
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
}

/**
 * Fill in derived baseball stats from counting numbers when the
 * derived value itself wasn't provided.
 */
export function deriveStats(stats: StatMap, category: string): StatMap {
  const s = { ...stats };
  const get = (k: string) => num(s[k]);

  if (category === "batting") {
    const h = get("H");
    const ab = get("AB");
    if (s["AVG"] === undefined && h !== null && ab !== null && ab > 0) s["AVG"] = fmtAvg(h / ab);
    const obp = get("OBP");
    const slg = get("SLG");
    if (s["OPS"] === undefined && obp !== null && slg !== null) s["OPS"] = fmtAvg(obp + slg);
    // Estimate OBP from walks/hits when only counting stats exist.
    if (s["OBP"] === undefined && h !== null && ab !== null && ab > 0) {
      const bb = get("BB") ?? 0;
      s["OBP"] = fmtAvg((h + bb) / (ab + bb));
    }
  }

  if (category === "pitching") {
    const er = get("ER");
    const ip = get("IP");
    if (s["ERA"] === undefined && er !== null && ip !== null && ip > 0) s["ERA"] = ((er * 9) / ip).toFixed(2);
    const bb = get("BB");
    const h = get("H");
    if (s["WHIP"] === undefined && bb !== null && h !== null && ip !== null && ip > 0)
      s["WHIP"] = ((bb + h) / ip).toFixed(2);
  }

  if (category === "fielding") {
    const po = get("PO");
    const a = get("A");
    const e = get("E");
    if (s["FPCT"] === undefined && po !== null && a !== null && e !== null && po + a + e > 0)
      s["FPCT"] = fmtAvg((po + a) / (po + a + e));
  }

  return s;
}

/**
 * Merge multiple stat rows for the same player + season into one line,
 * summing counting stats where rows come from different sources.
 */
export function mergeByPlayer<T extends { player_name: string | null; season: string; stats: unknown }>(
  rows: T[],
  category: string,
): { player_name: string; season: string; sources: string[]; stats: StatMap; ids: string[] }[] {
  const out = new Map<
    string,
    { player_name: string; season: string; sources: string[]; stats: StatMap; ids: string[] }
  >();
  for (const row of rows) {
    const name = (row.player_name ?? "Unknown").trim();
    const key = `${name.toLowerCase()}|${row.season}`;
    const existing = out.get(key) ?? {
      player_name: name,
      season: row.season,
      sources: [] as string[],
      stats: {} as StatMap,
      ids: [] as string[],
    };
    const s = (row.stats ?? {}) as Record<string, string | number>;
    for (const [k, v] of Object.entries(s)) {
      const incoming = num(v);
      const current = num(existing.stats[k]);
      if (incoming === null) continue;
      // Sum counting stats across rows; keep the latest rate stat.
      if (current !== null && !["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "FPCT"].includes(k)) {
        existing.stats[k] = current + incoming;
      } else if (current === null) {
        existing.stats[k] = v;
      } else {
        existing.stats[k] = v;
      }
    }
    const src = (row as unknown as { source?: string }).source;
    if (src && !existing.sources.includes(src)) existing.sources.push(src);
    const id = (row as unknown as { id?: string }).id;
    if (id) existing.ids.push(id);
    out.set(key, existing);
  }
  const merged = Array.from(out.values()).map((r) => ({
    ...r,
    stats: deriveStats(r.stats, category),
  }));
  // Default sort: best hitters / pitchers first.
  const sortKey = category === "pitching" ? "K" : category === "fielding" ? "FPCT" : "AVG";
  merged.sort((a, b) => (num(b.stats[sortKey]) ?? -1) - (num(a.stats[sortKey]) ?? -1));
  return merged;
}

/** Ordered column list for a merged set of rows: canonical fields first, extras after. */
export function columnsFor(rows: { stats: StatMap }[], category: string): string[] {
  const present = new Set(rows.flatMap((r) => Object.keys(r.stats)));
  const canonical = (BASEBALL_FIELDS[category] ?? []).filter((f) => present.has(f));
  const extras = Array.from(present).filter((f) => !canonical.includes(f)).sort();
  return [...canonical, ...extras];
}

/** Find the leader value for a column so the table can highlight it. */
export function leaderValue(rows: { stats: StatMap }[], column: string, low = false): number | null {
  const vals = rows.map((r) => num(r.stats[column])).filter((v): v is number => v !== null);
  if (vals.length < 2) return null;
  return low ? Math.min(...vals) : Math.max(...vals);
}

export { num as statNum };

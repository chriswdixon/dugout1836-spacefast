export function seasonOf(iso: string | null | undefined): string {
  if (!iso) return "Undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Undated";
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m <= 1) return `Winter ${y}`;
  if (m <= 4) return `Spring ${y}`;
  if (m <= 7) return `Summer ${y}`;
  if (m <= 10) return `Fall ${y}`;
  return `Winter ${y + 1}`;
}

const ORDER = ["Winter", "Spring", "Summer", "Fall"];

/** Newest season first. */
export function compareSeasons(a: string, b: string) {
  const pa = a.split(" ");
  const pb = b.split(" ");
  const ya = Number(pa[1] ?? 0);
  const yb = Number(pb[1] ?? 0);
  if (ya !== yb) return yb - ya;
  return ORDER.indexOf(pb[0] ?? "") - ORDER.indexOf(pa[0] ?? "");
}

export function seasonSlug(season: string) {
  return season.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

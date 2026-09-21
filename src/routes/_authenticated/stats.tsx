import { createFileRoute } from "@tanstack/react-router";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import {
  eventsQuery,
  eventIdsOf,
  formatEventDate,
  gameLineScoresQuery,
  playerStatsQuery,
  playersQuery,
} from "@/lib/portal-data";

import {
  BASEBALL_FIELDS,
  columnsFor,
  deriveStats,
  mergeByPlayer,
  statNum,
  type StatMap,
} from "@/lib/baseball";

const CATEGORIES = ["batting", "pitching", "fielding"] as const;
type Category = (typeof CATEGORIES)[number];

type StatRow = {
  id: string;
  player_id: string | null;
  player_name: string | null;
  season: string;
  category: string;
  stats: unknown;
  event_id?: string | null;
  source: string;
};

export const Route = createFileRoute("/_authenticated/stats")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Player stats — 1836 - The DugOut" },
      {
        name: "description",
        content:
          "Private coaching view of 1836 Roughriders player stats, game by game and for the season.",
      },
      { property: "og:title", content: "Player stats — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Private player stats for 1836 Roughriders coaches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatsPage,
});

function StatsPage() {
  const { user, loading } = useAuth();
  const isAdmin = useIsAdmin(user);
  const allowed = isAdmin.data === true;

  return (
    <PortalLayout eyebrow="Private" title="Player stats">
      {loading || isAdmin.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !allowed ? (
        <EmptyState
          title="Stats are private"
          copy="Player numbers are only visible to the team's admin account."
        />
      ) : (
        <AdminStats />
      )}
    </PortalLayout>
  );
}

export function AdminStats() {
  const stats = useQuery(playerStatsQuery);
  const players = useQuery(playersQuery);
  const events = useQuery(eventsQuery);
  const lineScores = useQuery(gameLineScoresQuery);
  const rows = (stats.data ?? []) as unknown as StatRow[];
  const games = useMemo(
    () =>
      (events.data ?? [])
        .filter((e) => e.event_type === "game")
        .slice()
        .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1)),
    [events.data],
  );
  const lineScoreFor = (ids: string[]) =>
    ((lineScores.data ?? []) as Array<{ event_id: string | null; stats: unknown }>).find(
      (l) => l.event_id && ids.includes(l.event_id),
    )?.stats as LineScoreStats | undefined;

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Only this page shows player numbers. Each game's line score comes straight from
        GameChanger on the daily check; add player lines below and the season totals update
        automatically.
      </p>

      <Tabs defaultValue="games">
        <TabsList>
          <TabsTrigger value="games">Game by game</TabsTrigger>
          <TabsTrigger value="season">Season totals</TabsTrigger>
          <TabsTrigger value="add">Add a game line</TabsTrigger>
        </TabsList>

        <TabsContent value="games" className="mt-6 space-y-8">
          {games.length === 0 ? (
            <EmptyState title="No games yet" copy="Games appear here once the schedule is filled in." />
          ) : (
            games.map((game) => {
              const ids = eventIdsOf(game);
              const gameRows = rows.filter((r) => r.event_id && ids.includes(r.event_id));
              return (
                <section key={game.id} className="space-y-3">
                  <header>
                    <h2 className="font-display text-lg text-foreground">
                      {game.title ?? (game.opponent ? `vs ${game.opponent}` : "Game")}
                    </h2>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                      {formatEventDate(game.starts_at)}
                      {game.result ? ` · ${game.result} ${game.score_us ?? ""}-${game.score_them ?? ""}` : ""}
                    </p>
                  </header>
                  <LineScore data={lineScoreFor(ids)} opponent={game.opponent} />
                  <GameSummary game={game} rows={gameRows} />
                  {gameRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No player lines recorded for this game yet.</p>
                  ) : (
                    CATEGORIES.map((cat) => (
                      <StatTable key={cat} category={cat} rows={gameRows.filter((r) => r.category === cat)} deletable />
                    ))
                  )}
                </section>
              );
            })

          )}
        </TabsContent>

        <TabsContent value="season" className="mt-6 space-y-6">
          {rows.length === 0 ? (
            <EmptyState title="No stats yet" copy="Add a game line to start tracking numbers." />
          ) : (
            CATEGORIES.map((cat) => (
              <MergedTable key={cat} category={cat} rows={rows.filter((r) => r.category === cat)} />
            ))
          )}
        </TabsContent>

        <TabsContent value="add" className="mt-6">
          <AddLine games={games} players={players.data ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type LineScoreStats = {
  innings_us?: number[];
  innings_them?: number[];
  runs_us?: number | null;
  runs_them?: number | null;
  hits_us?: number | null;
  hits_them?: number | null;
  errors_us?: number | null;
  errors_them?: number | null;
};

function LineScore({ data, opponent }: { data: LineScoreStats | undefined; opponent: string | null }) {
  if (!data) return null;
  const us = data.innings_us ?? [];
  const them = data.innings_them ?? [];
  const innings = Math.max(us.length, them.length);
  const cell = "border border-border/60 px-2 py-1 text-center text-sm";
  const dash = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v);

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card/60 p-3">
      <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
        Line score · from GameChanger
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${cell} text-left`}>Team</th>
            {Array.from({ length: innings }, (_, i) => (
              <th key={i} className={cell}>{i + 1}</th>
            ))}
            <th className={cell}>R</th>
            <th className={cell}>H</th>
            <th className={cell}>E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${cell} text-left`}>1836</td>
            {Array.from({ length: innings }, (_, i) => (
              <td key={i} className={cell}>{dash(us[i])}</td>
            ))}
            <td className={`${cell} font-semibold`}>{dash(data.runs_us)}</td>
            <td className={cell}>{dash(data.hits_us)}</td>
            <td className={cell}>{dash(data.errors_us)}</td>
          </tr>
          <tr>
            <td className={`${cell} text-left`}>{opponent ?? "Opponent"}</td>
            {Array.from({ length: innings }, (_, i) => (
              <td key={i} className={cell}>{dash(them[i])}</td>
            ))}
            <td className={`${cell} font-semibold`}>{dash(data.runs_them)}</td>
            <td className={cell}>{dash(data.hits_them)}</td>
            <td className={cell}>{dash(data.errors_them)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function asMap(stats: unknown): StatMap {
  return (stats && typeof stats === "object" ? stats : {}) as StatMap;
}

type GameRow = {
  id: string;
  title: string | null;
  opponent: string | null;
  starts_at: string;
  result: string | null;
  score_us: number | null;
  score_them: number | null;
  notes: string | null;
};

function sumStat(rows: StatRow[], category: Category, field: string): number | null {
  let total = 0;
  let found = false;
  for (const r of rows.filter((x) => x.category === category)) {
    const n = statNum(asMap(r.stats)[field]);
    if (n !== null) {
      total += n;
      found = true;
    }
  }
  return found ? total : null;
}

function GameSummary({ game, rows }: { game: GameRow; rows: StatRow[] }) {
  const queryClient = useQueryClient();
  const [plays, setPlays] = useState(game.notes ?? "");
  const [dirty, setDirty] = useState(false);

  const totals = [
    { label: "Scoring (runs)", value: sumStat(rows, "batting", "R") },
    { label: "Hits", value: sumStat(rows, "batting", "H") },
    { label: "Assists", value: sumStat(rows, "fielding", "A") },
    { label: "Errors", value: sumStat(rows, "fielding", "E") },
  ];

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("events")
        .update({ notes: plays.trim() || null })
        .eq("id", game.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Key plays saved");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[auto_1fr] sm:gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {totals.map((t) => (
          <div key={t.label} className="rounded-md bg-secondary/50 px-3 py-2 text-center">
            <p className="font-display text-xl tabular-nums text-foreground">
              {t.value === null ? "—" : t.value}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`plays-${game.id}`} className="text-xs uppercase tracking-widest">
          Key plays
        </Label>
        <Textarea
          id={`plays-${game.id}`}
          value={plays}
          onChange={(e) => {
            setPlays(e.target.value);
            setDirty(true);
          }}
          placeholder="Big innings, clutch hits, defensive gems…"
          rows={2}
        />
        {dirty ? (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save key plays"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StatTable({
  category,
  rows,
  deletable,
}: {
  category: Category;
  rows: StatRow[];
  deletable?: boolean;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("player_stats").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Line removed");
      queryClient.invalidateQueries({ queryKey: ["player_stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rows.length === 0) return null;
  const prepared = rows.map((r) => ({ ...r, stats: deriveStats(asMap(r.stats), category) }));
  const columns = columnsFor(prepared, category);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60">
          <tr>
            <th className="px-3 py-2 text-left font-display text-xs uppercase tracking-widest">
              {category}
            </th>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-display text-xs uppercase tracking-widest">
                {c}
              </th>
            ))}
            {deletable ? <th className="w-10" /> : null}
          </tr>
        </thead>
        <tbody>
          {prepared.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 text-foreground">{r.player_name ?? "—"}</td>
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {r.stats[c] ?? "—"}
                </td>
              ))}
              {deletable ? (
                <td className="px-2 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove.mutate(r.id)}
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MergedTable({ category, rows }: { category: Category; rows: StatRow[] }) {
  if (rows.length === 0) return null;
  const merged = mergeByPlayer(
    rows.map((r) => ({ player_name: r.player_name, season: r.season, stats: r.stats })),
    category,
  ) as unknown as StatRow[];
  return <StatTable category={category} rows={merged.map((m, i) => ({ ...m, id: `${category}-${i}` }))} />;
}

function AddLine({
  games,
  players,
}: {
  games: { id: string; title: string | null; opponent: string | null; starts_at: string }[];
  players: { id: string; name: string; jersey_number: string | null }[];
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [eventId, setEventId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [category, setCategory] = useState<Category>("batting");
  const [values, setValues] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      const player = players.find((p) => p.id === playerId);
      if (!player) throw new Error("Pick a player");
      if (!eventId) throw new Error("Pick a game");
      const game = games.find((g) => g.id === eventId);
      const stats: StatMap = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim() !== "") stats[k] = v.trim();
      }
      if (Object.keys(stats).length === 0) throw new Error("Enter at least one number");
      const { error } = await supabase.from("player_stats").insert({
        player_id: player.id,
        player_name: player.name,
        season: game ? String(new Date(game.starts_at).getFullYear()) : "2026",
        category,
        stats,
        event_id: eventId,
        source: "manual",
        submitted_by: user?.id ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stat line saved");
      setValues({});
      queryClient.invalidateQueries({ queryKey: ["player_stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="game">Game</Label>
          <select
            id="game"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Pick a game…</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {formatEventDate(g.starts_at)} — {g.opponent ?? g.title ?? "Game"}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="player">Player</Label>
          <select
            id="player"
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Pick a player…</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jersey_number ? `#${p.jersey_number} ` : ""}
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as Category);
              setValues({});
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {(BASEBALL_FIELDS[category] ?? []).map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`f-${field}`} className="text-xs uppercase tracking-widest">
              {field}
            </Label>
            <Input
              id={`f-${field}`}
              inputMode="decimal"
              value={values[field] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save stat line"}
      </Button>
    </form>
  );
}

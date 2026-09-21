import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MapPin, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { eventIdsOf, eventsQuery, formatEventDate, gameLineScoresQuery, SOURCE_LABEL } from "@/lib/portal-data";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

function mapsUrl(location: string) {
  if (!location) return "";
  if (/^https?:\/\//i.test(location)) return location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function LocationLink({ location }: { location: string | null }) {
  if (!location) return null;
  return (
    <a
      href={mapsUrl(location)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary underline"
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin className="size-3" />
      {location}
    </a>
  );
}


/** Tournament weekends are key dates named "Tournament — …". */
function isTournament(e: { event_type: string; title: string | null }) {
  return e.event_type === "key_date" && /tournament/i.test(e.title ?? "");
}

function TournamentLink({ id }: { id: string }) {
  return (
    <Link
      to="/tournaments/$eventId"
      params={{ eventId: id }}
      className="mt-2 inline-block text-sm text-primary underline"
      onClick={(e) => e.stopPropagation()}
    >
      Tournament details
    </Link>
  );
}

type LineScore = {
  innings_us?: number[];
  innings_them?: number[];
  runs_us?: number | null;
  runs_them?: number | null;
  hits_us?: number | null;
  hits_them?: number | null;
  errors_us?: number | null;
  errors_them?: number | null;
};

/**
 * GameChanger box score for a game, matched by event id or — for duplicate
 * schedule rows from another source — by the same start time.
 */
function GameSummary({ event }: { event: EventRow }) {
  const lines = useQuery(gameLineScoresQuery);

  if (event.event_type !== "game") return null;

  const rows = lines.data ?? [];
  const ids = new Set(eventIdsOf(event));
  const row = rows.find((r) => r.event_id && ids.has(r.event_id));
  if (!row) return null;

  const s = (row.stats ?? {}) as LineScore;
  const us = s.innings_us ?? [];
  const them = s.innings_them ?? [];
  const innings = Math.max(us.length, them.length);
  if (innings === 0 && s.runs_us == null) return null;

  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/20 p-2">
      <p className="eyebrow mb-1.5">GameChanger box score</p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-1.5 py-1 text-left font-normal"> </th>
            {Array.from({ length: innings }, (_, i) => (
              <th key={i} className="px-1.5 py-1 text-center font-normal">
                {i + 1}
              </th>
            ))}
            <th className="px-1.5 py-1 text-center font-semibold">R</th>
            <th className="px-1.5 py-1 text-center font-semibold">H</th>
            <th className="px-1.5 py-1 text-center font-semibold">E</th>
          </tr>
        </thead>
        <tbody>
          {[
            { label: "1836", inn: us, r: s.runs_us, h: s.hits_us, e: s.errors_us },
            {
              label: event.opponent ?? "Opponent",
              inn: them,
              r: s.runs_them,
              h: s.hits_them,
              e: s.errors_them,
            },
          ].map((line) => (
            <tr key={line.label} className="border-t border-border/60">
              <td className="max-w-40 truncate px-1.5 py-1 text-left font-medium">{line.label}</td>
              {Array.from({ length: innings }, (_, i) => (
                <td key={i} className="px-1.5 py-1 text-center text-muted-foreground">
                  {line.inn[i] ?? "-"}
                </td>
              ))}
              <td className="px-1.5 py-1 text-center font-semibold">{line.r ?? "-"}</td>
              <td className="px-1.5 py-1 text-center">{line.h ?? "-"}</td>
              <td className="px-1.5 py-1 text-center">{line.e ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Lets a family paste the GameChanger write-up for a game and save it with
 * that game, so everyone reads the recap without leaving the portal.
 */
function GameRecap({ event }: { event: EventRow }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const saved = ((event as unknown as { recap?: string | null }).recap ?? "").trim();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(saved);

  const save = useMutation({
    mutationFn: async () => {
      const value = text.trim();
      const { error } = await supabase
        .from("events")
        .update({ recap: value || null } as never)
        .eq("id", event.id);
      if (error) throw error;
      return value;
    },
    onSuccess: (value) => {
      toast.success(value ? "Recap saved" : "Recap cleared");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (event.event_type !== "game") return null;
  // Only signed-in members can add or edit recaps — hide the control for visitors.
  if (!user) return null;

  return (
    <div className="mt-2">
      {!open ? (
        <Button
          variant="outline"
          size="sm"
          className="rounded-[20px]"
          onClick={() => {
            setText(saved);
            setOpen(true);
          }}
        >
          {saved ? "Edit recap" : "Add recap"}
        </Button>
      ) : (
        <div className="mt-1 w-full text-left sm:w-80">
          <Label htmlFor={`recap-${event.id}`} className="text-xs">
            Paste the GameChanger recap
          </Label>
          <Textarea
            id={`recap-${event.id}`}
            rows={6}
            className="mt-1"
            placeholder="Paste the recap text here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save recap"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The saved recap, shown in the body of a game card. */
function RecapText({ event }: { event: EventRow }) {
  const recap = ((event as unknown as { recap?: string | null }).recap ?? "").trim();
  if (!recap) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      <p className="eyebrow mb-1.5">Recap</p>
      <p className="whitespace-pre-line text-sm text-muted-foreground">{recap}</p>
    </div>
  );
}

export const Route = createFileRoute("/calendar")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Schedule & calendar — 1836 - The DugOut" },
      {
        name: "description",
        content:
          "1836 Roughriders games, practices and key dates in one place — month calendar, upcoming games and results.",
      },
      { property: "og:title", content: "Schedule & calendar — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Games, practices and key dates for the 1836 Roughriders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

type EventRow = Database["public"]["Tables"]["events"]["Row"];

const TYPE_STYLE: Record<string, string> = {
  game: "border-primary/60 bg-primary/15 text-primary",
  practice: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
  key_date: "border-amber-500/50 bg-amber-500/10 text-amber-400",
};

function typeLabel(t: string) {
  return t === "key_date" ? "Key date" : t.charAt(0).toUpperCase() + t.slice(1);
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const BLANK = {
  event_type: "practice",
  title: "",
  date: "",
  time: "18:00",
  location: "",
  notes: "",
  weeks: "1",
};

/** Lets any family add the team's own practices, key dates and other events. */
function TeamDateForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(BLANK);

  const add = useMutation({
    mutationFn: async () => {
      if (!form.date) throw new Error("Pick a date first.");
      const weeks = Math.min(Math.max(Number(form.weeks) || 1, 1), 26);
      const first = new Date(`${form.date}T${form.time || "18:00"}`);
      if (Number.isNaN(+first)) throw new Error("That date and time didn't look right.");

      const rows = Array.from({ length: weeks }, (_, i) => {
        const when = new Date(first);
        when.setDate(when.getDate() + i * 7);
        return {
          title:
            form.title ||
            (form.event_type === "practice"
              ? "Practice"
              : form.event_type === "key_date"
                ? "Key date"
                : "Team event"),
          event_type: form.event_type,
          starts_at: when.toISOString(),
          location: form.location || null,
          notes: form.notes || null,
          source: "manual" as const,
        };
      });

      const { error } = await supabase.from("events").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(count === 1 ? "Added to the calendar" : `Added ${count} dates`);
      setForm(BLANK);
      queryClient.invalidateQueries({ queryKey: ["events"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="panel mt-6 grid gap-4 rounded-lg p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="td-type">What is it?</Label>
        <select
          id="td-type"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={form.event_type}
          onChange={(e) => setForm({ ...form, event_type: e.target.value })}
        >
          <option value="practice">Practice</option>
          <option value="key_date">Key date</option>
          <option value="game">Game</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="td-title">Name (optional)</Label>
        <Input
          id="td-title"
          placeholder="Hitting practice"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="td-date">Date</Label>
        <Input
          id="td-date"
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="td-time">Start time</Label>
        <Input
          id="td-time"
          type="time"
          value={form.time}
          onChange={(e) => setForm({ ...form, time: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="td-loc">Where</Label>
        <Input
          id="td-loc"
          placeholder="Riders Field"
          value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="td-weeks">Repeat weekly for</Label>
        <Input
          id="td-weeks"
          type="number"
          min={1}
          max={26}
          value={form.weeks}
          onChange={(e) => setForm({ ...form, weeks: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">1 means just this date.</p>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="td-notes">Notes (optional)</Label>
        <Textarea
          id="td-notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add to calendar"}
        </Button>
      </div>
    </form>
  );
}


/** The game/results list that used to live on the separate Schedule page. */
function EventList({ items }: { items: EventRow[] }) {
  if (items.length === 0)
    return <EmptyState title="Nothing here yet" copy="Events appear once they're added." />;
  return (
    <ul className="grid gap-3">
      {items.map((e) => (
        <li key={e.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {e.source === "gamechanger" && e.link_url ? (
                <a
                  href={e.link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-display text-lg uppercase tracking-wide text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  {e.title ?? (e.opponent ? `vs ${e.opponent}` : e.event_name) ?? "Game"}
                </a>
              ) : (
                <p className="font-display text-lg uppercase tracking-wide">
                  {e.title ?? (e.opponent ? `vs ${e.opponent}` : e.event_name) ?? "Game"}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {formatEventDate(e.starts_at)}
                {e.location ? (
                  <>
                    {" · "}
                    <LocationLink location={e.location} />
                  </>
                ) : null}
              </p>
              {e.event_name && e.opponent ? (
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {e.event_name}
                </p>
              ) : null}
              {e.notes ? <p className="mt-2 text-sm text-muted-foreground">{e.notes}</p> : null}
              {isTournament(e) ? <TournamentLink id={e.id} /> : null}
              <GameSummary event={e} />
              <RecapText event={e} />
            </div>
            <div className="flex flex-col items-end gap-2 text-right">
              {e.result ? (
                <p className="font-display text-lg text-primary">
                  {e.result}
                  {e.score_us !== null && e.score_them !== null
                    ? ` ${e.score_us}-${e.score_them}`
                    : ""}
                </p>
              ) : null}
              <GameRecap event={e} />
              <span
                className={cn(
                  "inline-block rounded-full border px-3 py-1 text-xs uppercase tracking-widest",
                  TYPE_STYLE[e.event_type] ?? "border-border text-muted-foreground",
                )}
              >
                {typeLabel(e.event_type)}
              </span>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {SOURCE_LABEL[e.source] ?? e.source}
              </p>
              {e.link_url ? (
                <a
                  href={e.link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  {e.source === "gamechanger" ? "GameChanger summary →" : "Event page"}
                </a>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CalendarPage() {
  const { data, isLoading } = useQuery(eventsQuery);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const removeEvent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed from the calendar");
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of data ?? []) {
      const d = new Date(e.starts_at);
      const key = dayKey(d);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    for (const arr of map.values())
      arr.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
    return map;
  }, [data]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayKey = dayKey(today);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const shift = (n: number) => {
    setSelected(null);
    setCursor(new Date(year, month + n, 1));
  };

  const selectedEvents = selected ? (byDay.get(selected) ?? []) : [];
  const monthEvents = (data ?? [])
    .filter((e) => {
      const d = new Date(e.starts_at);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));

  const now = Date.now();
  const upcoming = (data ?? []).filter((e) => new Date(e.starts_at).getTime() >= now);
  const past = (data ?? [])
    .filter((e) => new Date(e.starts_at).getTime() < now)
    .sort((a, b) => +new Date(b.starts_at) - +new Date(a.starts_at));

  const nextUpcoming = upcoming.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))[0];
  const nextUpcomingKey = nextUpcoming ? dayKey(new Date(nextUpcoming.starts_at)) : null;

  const renderEventCard = (e: EventRow) => (
    <li key={e.id} className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {e.source === "gamechanger" && e.link_url ? (
            <a
              href={e.link_url}
              target="_blank"
              rel="noreferrer"
              className="font-display text-lg uppercase tracking-wide text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
            >
              {e.title ?? (e.opponent ? `vs ${e.opponent}` : e.event_name) ?? "Event"}
            </a>
          ) : (
            <p className="font-display text-lg uppercase tracking-wide">
              {e.title ?? (e.opponent ? `vs ${e.opponent}` : e.event_name) ?? "Event"}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {formatEventDate(e.starts_at)}
            {e.location ? (
              <>
                {" · "}
                <LocationLink location={e.location} />
              </>
            ) : null}
          </p>
          {e.notes ? <p className="mt-1 text-sm text-muted-foreground">{e.notes}</p> : null}
          {isTournament(e) ? <TournamentLink id={e.id} /> : null}
          <GameSummary event={e} />
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          {e.result ? (
            <p className="font-display text-lg text-primary">
              {e.result}
              {e.score_us !== null && e.score_them !== null
                ? ` ${e.score_us}-${e.score_them}`
                : ""}
            </p>
          ) : null}
          <GameRecap event={e} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs uppercase tracking-widest",
                TYPE_STYLE[e.event_type] ?? "border-border text-muted-foreground",
              )}
            >
              {typeLabel(e.event_type)}
            </span>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {SOURCE_LABEL[e.source] ?? e.source}
            </span>
            {user && e.source === "manual" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={removeEvent.isPending}
                onClick={() => removeEvent.mutate(e.id)}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <RecapText event={e} />
    </li>
  );

  return (
    <PortalLayout eyebrow="Season" title="Schedule & calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <p className="font-display text-xl uppercase tracking-wide min-w-44 text-center">
            {monthLabel}
          </p>
          <button
            onClick={() => shift(1)}
            aria-label="Next month"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Game
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-400" /> Practice
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-400" /> Key date
          </span>
        </div>
        {user ? (
          <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
            {adding ? (
              <>
                <X className="mr-1.5 size-4" /> Close
              </>
            ) : (
              <>
                <Plus className="mr-1.5 size-4" /> Add a team date
              </>
            )}
          </Button>
        ) : null}
      </div>

      {adding ? <TeamDateForm onDone={() => setAdding(false)} /> : null}


      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Tabs defaultValue="month" className="mt-6">
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Results ({past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="month" className="mt-5">
          <div className="mt-6 grid grid-cols-7 gap-1 text-center text-xs uppercase tracking-widest text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <p key={d} className="py-1">
                {d}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`blank-${i}`} />;
              const key = dayKey(d);
              const evts = byDay.get(key) ?? [];
              const isSelected = selected === key;
              const isPast = d < todayStart;
              const isNextUpcoming = key === nextUpcomingKey;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(isSelected ? null : key)}
                  className={cn(
                    "min-h-16 rounded-md border border-border bg-card p-1.5 text-left transition-colors hover:border-primary/60 sm:min-h-20",
                    isSelected && "border-primary",
                    key === todayKey && "ring-1 ring-primary/50",
                    isPast && "opacity-60 bg-muted/20",
                    isNextUpcoming && "ring-2 ring-accent/70 bg-accent/10 shadow-sm",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs",
                      key === todayKey ? "font-bold text-primary" : "text-muted-foreground",
                      isNextUpcoming && "font-semibold text-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {evts.slice(0, 3).map((e) => (
                      <span
                        key={e.id}
                        className={cn(
                          "size-2 rounded-full",
                          e.event_type === "practice"
                            ? "bg-emerald-400"
                            : e.event_type === "key_date"
                              ? "bg-amber-400"
                              : "bg-primary",
                        )}
                      />
                    ))}
                    {evts.length > 3 ? (
                      <span className="text-[10px] text-muted-foreground">+{evts.length - 3}</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 hidden truncate text-[11px] leading-tight text-foreground sm:block">
                    {evts[0] ? (evts[0].title ?? evts[0].opponent ?? evts[0].event_name) : ""}
                  </span>
                  {evts.some((e) => (e.recap ?? "").trim()) ? (
                    <span className="mt-0.5 hidden truncate text-[10px] font-medium uppercase tracking-wider text-accent sm:block">
                      Recap
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="mt-8">
              <h2 className="section-title text-xl">
                {new Date(
                  Number(selected.split("-")[0]),
                  Number(selected.split("-")[1]),
                  Number(selected.split("-")[2]),
                ).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </h2>
              <div className="mt-4">
                {selectedEvents.length === 0 ? (
                  <EmptyState
                    title="Nothing on this date"
                    copy="Games, practices and key dates show up here once they're added."
                  />
                ) : (
                  <ul className="grid gap-3">
                    {selectedEvents.map((e) => renderEventCard(e))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-8">
            <h2 className="section-title text-xl">{`${monthLabel} — everything`}</h2>
            <div className="mt-4">
              {monthEvents.length === 0 ? (
                <EmptyState
                  title="Nothing on this date"
                  copy="Games, practices and key dates show up here once they're added."
                />
              ) : (
                <ul className="grid gap-3">
                  {monthEvents.map((e) => renderEventCard(e))}
                </ul>
              )}
            </div>
          </div>
          </TabsContent>
          <TabsContent value="upcoming" className="mt-5">
            <EventList items={upcoming} />
          </TabsContent>
          <TabsContent value="past" className="mt-5">
            <EventList items={past} />
          </TabsContent>
        </Tabs>
      )}
    </PortalLayout>
  );
}


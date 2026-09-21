import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { eventsQuery, formatEventDate, SOURCE_LABEL } from "@/lib/portal-data";

export const Route = createFileRoute("/tournaments/$eventId")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Tournament details — 1836 - The DugOut" },
      {
        name: "description",
        content:
          "Dates, location, map and the teams we play at each 1836 Roughriders fall tournament.",
      },
      { property: "og:title", content: "Tournament details — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Everything for one 1836 Roughriders tournament weekend in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TournamentPage,
});

function mapsUrl(location: string) {
  if (/^https?:\/\//i.test(location)) return location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

const TZ = "America/Chicago";

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function timeLabel(iso: string) {
  return `${new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

function TournamentPage() {
  const { eventId } = Route.useParams();
  const events = useQuery(eventsQuery);
  const all = events.data ?? [];
  const event = all.find((e) => e.id === eventId);

  if (events.isLoading) {
    return (
      <PortalLayout eyebrow="Tournament" title="Loading…">
        <p className="text-sm text-muted-foreground">One moment…</p>
      </PortalLayout>
    );
  }

  if (!event) {
    return (
      <PortalLayout eyebrow="Tournament" title="Not found">
        <EmptyState
          title="Tournament not found"
          copy="This date may have been removed from the calendar."
        />
        <Link to="/calendar">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 size-4" /> Back to schedule
          </Button>
        </Link>
      </PortalLayout>
    );
  }

  // The tournament weekend: its own day plus the two days after it.
  const start = new Date(event.starts_at);
  const windowStart = new Date(start);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 3);

  const games = all
    .filter((e) => {
      if (e.event_type !== "game") return false;
      const t = new Date(e.starts_at).getTime();
      return t >= windowStart.getTime() && t < windowEnd.getTime();
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  // The same game is often listed by two sources at the same start time —
  // keep one row, favouring the one carrying a result, and borrow the field name.
  const uniqueGames = [...new Set(games.map((g) => g.starts_at))].map((when) => {
    const same = games.filter((g) => g.starts_at === when);
    const best = same.find((g) => g.result) ?? same[0]!;
    return {
      ...best,
      location: best.location ?? same.find((g) => g.location)?.location ?? null,
      notes: best.notes ?? same.find((g) => g.notes)?.notes ?? null,
    };
  });

  const dayGroups = [...new Set(uniqueGames.map((g) => dayKey(g.starts_at)))].map((key) => ({
    key,
    label: dayLabel(uniqueGames.find((g) => dayKey(g.starts_at) === key)!.starts_at),
    games: uniqueGames.filter((g) => dayKey(g.starts_at) === key),
  }));

  const opponents = [...new Set(uniqueGames.map((g) => g.opponent).filter(Boolean))] as string[];
  const venues = [
    ...new Set(
      [event.location, ...uniqueGames.map((g) => g.location)].filter(Boolean) as string[],
    ),
  ];
  const mapTarget = venues[0] ?? null;

  const title = event.title ?? event.event_name ?? "Tournament";

  return (
    <PortalLayout eyebrow="Tournament" title={title}>
      <Link to="/calendar">
        <Button variant="outline" size="sm">
          <ArrowLeft className="mr-2 size-4" /> Back to schedule
        </Button>
      </Link>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Dates</p>
          <p className="mt-1 font-display text-lg uppercase tracking-wide">
            {dayLabel(event.starts_at)}
          </p>
          {event.notes ? (
            <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p>
          ) : null}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Where</p>
          {venues.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">Location to come.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {venues.map((v) => (
                <li key={v}>
                  <a
                    href={mapsUrl(v)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary underline"
                  >
                    <MapPin className="size-3" />
                    {v}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Games</p>
          <p className="mt-1 font-display text-2xl text-primary">{uniqueGames.length}</p>
          <p className="text-sm text-muted-foreground">
            {uniqueGames.length === 0 ? "Schedule not out yet" : `${opponents.length} teams`}
          </p>
        </div>
      </div>

      {mapTarget ? (
        <section className="mt-8">
          <h2 className="section-title text-xl">Map</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <iframe
              title={`Map of ${mapTarget}`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(mapTarget)}&output=embed`}
              loading="lazy"
              className="h-72 w-full border-0"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <a
            href={mapsUrl(mapTarget)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline"
          >
            <MapPin className="size-3" /> Open directions
          </a>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="section-title text-xl">Teams we play</h2>
        {opponents.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            The bracket isn’t posted yet. Teams appear here as soon as the games are published.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {opponents.map((o) => (
              <li
                key={o}
                className="rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-sm text-primary"
              >
                {o}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="section-title text-xl">Schedule</h2>
        {dayGroups.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No games yet"
              copy="Games show up here automatically once the tournament schedule is posted."
            />
          </div>
        ) : (
          <div className="mt-3 space-y-6">
            {dayGroups.map((group) => (
              <div key={group.key}>
                <h3 className="font-display text-base uppercase tracking-wide">{group.label}</h3>
                <ul className="mt-2 grid gap-3">
                  {group.games.map((g) => (
                    <li key={g.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-lg uppercase tracking-wide">
                            {g.opponent ? `vs ${g.opponent}` : (g.title ?? "Game")}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {timeLabel(g.starts_at)}
                            {g.location ? (
                              <>
                                {" · "}
                                <a
                                  href={mapsUrl(g.location)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary underline"
                                >
                                  <MapPin className="size-3" />
                                  {g.location}
                                </a>
                              </>
                            ) : null}
                          </p>
                          {g.notes ? (
                            <p className="mt-1 text-sm text-muted-foreground">{g.notes}</p>
                          ) : null}
                          <Link
                            to="/photos/game/$eventId"
                            params={{ eventId: g.id }}
                            className="mt-2 inline-block text-sm text-primary underline"
                          >
                            Photos &amp; videos
                          </Link>
                        </div>
                        <div className="text-right">
                          {g.result ? (
                            <p className="font-display text-lg text-primary">
                              {g.result}
                              {g.score_us !== null && g.score_them !== null
                                ? ` ${g.score_us}-${g.score_them}`
                                : ""}
                            </p>
                          ) : null}
                          <p className="text-xs uppercase tracking-widest text-muted-foreground">
                            {SOURCE_LABEL[g.source] ?? g.source}
                          </p>
                          {g.link_url ? (
                            <a
                              href={g.link_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary underline"
                            >
                              Event page
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        Added {formatEventDate(event.starts_at)} · {SOURCE_LABEL[event.source] ?? event.source}
      </p>
    </PortalLayout>
  );
}

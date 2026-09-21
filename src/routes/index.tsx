import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { PortalLayout } from "@/components/PortalLayout";
import {
  albumPhotoGameLinksQuery,
  eventsQuery,
  
  mediaQuery,
  playersQuery,
  sharedPhotosQuery,
  tallyFor,
} from "@/lib/portal-data";
import fieldDusk from "@/assets/field-dusk.jpg";
import squadPhoto from "@/assets/squad-photo.jpg";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "1836 - The DugOut — Roughriders Family Hub" },
      {
        name: "description",
        content:
          "The 1836 Roughriders family dugout: game schedules, team photos, video highlights and recaps in one place.",
      },
      { property: "og:title", content: "1836 - The DugOut — Roughriders Family Hub" },
      {
        property: "og:description",
        content:
          "Schedules, photos, videos and recaps for the 1836 Roughriders — built for the families in the stands.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function monthDay(iso: string) {
  const d = new Date(iso);
  return {
    month: d.toLocaleDateString(undefined, { month: "short" }),
    day: d.getDate(),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    weekday: d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
  };
}

function typeLabel(t: string | null | undefined) {
  switch (t) {
    case "game":
      return "Game";
    case "practice":
      return "Practice";
    case "key_date":
      return "Key date";
    default:
      return "Team event";
  }
}

function Dashboard() {
  const events = useQuery(eventsQuery);
  const players = useQuery(playersQuery);
  const media = useQuery(mediaQuery);
  const sharedPhotos = useQuery(sharedPhotosQuery);
  const gameLinks = useQuery(albumPhotoGameLinksQuery);
  
  const latestPhotos = (sharedPhotos.data ?? []).filter((p) => p.url);

  const now = Date.now();
  const upcoming = (events.data ?? []).filter((e) => new Date(e.starts_at).getTime() >= now);
  const nextGame = upcoming.find((e) => e.event_type === "game") ?? upcoming[0];

  const gamePhotos = (gameLinks.data ?? []).filter((l) => l.thumbnail_url);
  // Only pictures with a direct storage link load fast enough for the collage.
  const fastPhotos = gamePhotos.filter((l) => /^https?:/.test(l.thumbnail_url ?? ""));
  const [heroImg, setHeroImg] = useState<string | null>(null);
  useEffect(() => {
    const pool = fastPhotos.length > 0 ? fastPhotos : gamePhotos;
    if (pool.length > 0 && !heroImg) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick?.thumbnail_url) setHeroImg(pick.thumbnail_url);
    }
  }, [gamePhotos, fastPhotos, heroImg]);

  const heroSrc = heroImg ?? latestPhotos[0]?.url ?? fieldDusk;
  const vaultCount = latestPhotos.length + gamePhotos.length;

  // The bottom row takes exactly the height the squad photo needs — nothing taller.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const squadHeadRef = useRef<HTMLDivElement | null>(null);
  const squadImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const apply = () => {
      const head = squadHeadRef.current?.getBoundingClientRect().height ?? 0;
      const img = squadImgRef.current?.getBoundingClientRect().height ?? 0;
      if (img > 0) grid.style.setProperty("--squad-h", `${Math.round(head + img)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    if (squadImgRef.current) ro.observe(squadImgRef.current);
    window.addEventListener("resize", apply);
    const img = squadImgRef.current;
    img?.addEventListener("load", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      img?.removeEventListener("load", apply);
    };
  }, []);

  // Latest drops: 4 cards (2 rows) when there's room, otherwise 2 cards in one row.
  const dropsRef = useRef<HTMLDivElement | null>(null);
  const [dropRows, setDropRows] = useState(2);
  useEffect(() => {
    const el = dropsRef.current;
    if (!el) return;
    const apply = () => {
      const head = el.firstElementChild?.getBoundingClientRect().height ?? 0;
      const avail = el.getBoundingClientRect().height - head;
      // each card needs ~72px to stay usable; two rows need that twice plus the gap
      setDropRows(avail >= 152 ? 2 : 1);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);
  const dropCount = dropRows === 2 ? 4 : 2;

  const photoCounts = new Map<string, number>();
  for (const link of gameLinks.data ?? []) {
    if (link.event_id) photoCounts.set(link.event_id, (photoCounts.get(link.event_id) ?? 0) + 1);
  }
  const games = (events.data ?? []).filter((e) => e.event_type === "game");
  const record = games.reduce(
    (acc, g) => {
      if (g.result === "W") acc.w += 1;
      else if (g.result === "L") acc.l += 1;
      else if (g.result === "T") acc.t += 1;
      return acc;
    },
    { w: 0, l: 0, t: 0 },
  );
  const recordLabel = record.t > 0 ? `${record.w}-${record.l}-${record.t}` : `${record.w}-${record.l}`;
  const played = record.w + record.l + record.t;
  const latestGameWithPhotos = [...games]
    .filter((g) => tallyFor(photoCounts, g) > 0)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];

  return (
    <PortalLayout fitScreen>
      <div className="-mx-4 -my-8 bg-paper px-4 py-10 font-work text-ink md:px-10 md:py-12 lg:mx-auto lg:flex lg:h-[calc(100dvh-67px)] lg:w-full lg:max-w-[1400px] lg:flex-col lg:overflow-hidden lg:py-4">
        {/* Print masthead */}
        <header className="flex flex-col justify-between gap-2 border-b border-ink/20 pb-6 md:flex-row md:items-end lg:shrink-0 lg:pb-3">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-seam">
              Fall 2026 • Est. 1836
            </p>
            <h1 className="font-print text-6xl leading-[0.85] tracking-tight uppercase md:text-7xl lg:text-5xl">
              The DugOut
            </h1>
          </div>
          <div className="flex items-end gap-6">
            <Link
              to="/calendar"
              className="flex flex-col items-start rounded-sm border border-ink/20 bg-white/50 px-5 py-3 transition-colors hover:border-ink/40 lg:px-4 lg:py-2"
            >
              <span className="text-[10px] font-bold tracking-[0.2em] text-seam uppercase">
                Record
              </span>
              <span className="font-print text-4xl leading-none lg:text-3xl">{recordLabel}</span>
              <span className="mt-1 text-[10px] tracking-widest uppercase opacity-60">
                {played === 0 ? "No games played" : `${played} game${played === 1 ? "" : "s"} • W-L${record.t > 0 ? "-T" : ""}`}
              </span>
            </Link>
          </div>
        </header>

        <div ref={gridRef} className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-12 lg:mt-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(190px,1fr)_minmax(150px,1fr)_minmax(140px,1fr)] lg:gap-3">
          {/* Featured next game */}
          <section className="group relative flex min-h-[380px] flex-col justify-end overflow-hidden rounded-sm bg-ink p-8 text-paper md:col-span-8 lg:min-h-[190px] lg:p-5">
            <img
              src={heroSrc}
              alt="Roughriders field"
              width={1600}
              height={1008}
              className="absolute inset-0 size-full object-cover opacity-50 grayscale transition-all duration-700 group-hover:grayscale-0"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
            <div className="relative z-10">
              <span className="mb-4 inline-block bg-seam px-3 py-1 text-[10px] font-bold tracking-widest uppercase lg:mb-2">
                {nextGame?.event_type === "game" ? "Next game" : "Next up"}
              </span>
              {nextGame ? (
                <>
                  <h2 className="mb-4 font-print text-5xl leading-tight italic md:text-6xl lg:mb-2 lg:text-4xl">
                    {nextGame.title ?? nextGame.opponent ?? nextGame.event_name ?? "Game"}
                  </h2>
                  <div className="flex flex-wrap items-center gap-8 text-xs font-bold tracking-widest uppercase">
                    <div className="flex flex-col">
                      <span className="mb-1 text-[9px] opacity-50">Date</span>
                      <span>{monthDay(nextGame.starts_at).weekday}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="mb-1 text-[9px] opacity-50">Time</span>
                      <span>{monthDay(nextGame.starts_at).time}</span>
                    </div>
                    {nextGame.location ? (
                      <div className="flex flex-col">
                        <span className="mb-1 text-[9px] opacity-50">Field</span>
                        <span className="normal-case">{nextGame.location}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <h2 className="font-print text-4xl italic">Nothing on the calendar yet</h2>
              )}
            </div>
          </section>

          {/* Schedule feed */}
          <div className="rounded-sm border border-ink/10 bg-white/40 p-8 md:col-span-8 lg:col-span-4 lg:min-h-[190px] lg:overflow-y-auto lg:p-4">
            <div className="mb-10 flex items-baseline justify-between border-b border-ink/10 pb-4 lg:mb-3 lg:pb-3">
              <h3 className="font-print text-4xl uppercase italic lg:text-2xl">The Schedule</h3>
              <Link
                to="/calendar"
                className="text-[10px] font-bold tracking-widest text-seam uppercase hover:underline"
              >
                View full calendar
              </Link>
            </div>

            {upcoming.length === 0 ? (
              <p className="font-print text-xl italic opacity-70">
                No games on the calendar — once the schedule is added, the next dates show up here.
              </p>
            ) : (
              <div className="space-y-8 lg:space-y-3">
                {upcoming.slice(0, 5).map((e) => {
                  const d = monthDay(e.starts_at);
                  return (
                    <Link
                      key={e.id}
                      to="/calendar"
                      className="group flex items-start gap-8 lg:gap-5"
                    >
                      <div className="min-w-[40px] text-center">
                        <span className="mb-1 block text-[9px] font-bold uppercase opacity-40">
                          {d.month}
                        </span>
                        <span className="font-print text-3xl lg:text-2xl">{d.day}</span>
                      </div>
                      <div className="flex-1 border-l border-ink/10 pl-8 lg:pl-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="mb-1 text-[10px] font-bold tracking-widest text-seam uppercase">
                              {typeLabel(e.event_type)}
                            </p>
                            <h4 className="text-xl font-medium transition-all group-hover:italic lg:text-base">
                              {e.title ?? e.opponent ?? e.event_name ?? "Team event"}
                            </h4>
                            {e.location ? (
                              <p className="mt-1 text-xs opacity-60">{e.location}</p>
                            ) : null}
                          </div>
                          <span className="text-[10px] font-bold tracking-tighter uppercase opacity-60">
                            {d.time}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions + latest drops */}
          <div className="flex flex-col gap-4 md:col-span-3 lg:col-span-4 lg:row-start-2 lg:min-h-0 lg:overflow-hidden">
            <Link
              to="/share"
              className="w-full rounded-[20px] border-2 border-ink py-5 text-center text-[10px] font-bold tracking-[0.2em] uppercase transition-all hover:bg-ink hover:text-paper lg:min-h-[44px] lg:py-3.5"
            >
              Upload moments
            </Link>
            <Link
              to="/share"
              className="w-full rounded-[20px] bg-ticket py-5 text-center text-[10px] font-bold tracking-[0.2em] text-white uppercase transition-all hover:brightness-105 lg:min-h-[44px] lg:py-3.5"
            >
              Share video
            </Link>

            <div ref={dropsRef} className="mt-4 flex flex-col lg:mt-2 lg:min-h-0 lg:flex-1">
              <h4 className="mb-4 font-print text-2xl italic lg:mb-2">Latest drops</h4>
              {latestPhotos.length === 0 && gamePhotos.length === 0 ? (
                <div className="rounded-sm border-2 border-dashed border-ink/30 p-6 text-center">
                  <p className="font-print text-lg italic">No snapshots captured yet</p>
                  <p className="mt-1 text-xs opacity-60">
                    The gallery is waiting for those opening day shots.
                  </p>
                </div>
              ) : (
                <div
                  className={`grid grid-cols-2 gap-2 lg:min-h-0 lg:flex-1 ${
                    dropRows === 2 ? "lg:grid-rows-2" : "lg:grid-rows-1"
                  }`}
                >
                  {(latestPhotos.length > 0
                    ? latestPhotos.slice(0, dropCount).map((p) => ({ id: p.id, url: p.url!, alt: p.caption ?? "Shared team photo" }))
                    : (fastPhotos.length > 0 ? fastPhotos : gamePhotos).slice(-dropCount).map((g) => ({ id: g.id, url: g.thumbnail_url!, alt: "Game photo" }))
                  ).map((p) => (
                    <Link
                      key={p.id}
                      to="/photos"
                      className="aspect-square rounded-sm border border-ink/10 bg-white p-1 lg:aspect-auto lg:min-h-0"
                    >
                      <img
                        src={p.url}
                        alt={p.alt}
                        loading="lazy"
                        className="size-full rounded-sm object-cover"
                      />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Counts bento */}
          <div className="grid h-full grid-cols-2 gap-4 md:col-span-4 lg:col-span-8 lg:row-start-2 lg:grid-cols-4 lg:grid-rows-1 lg:min-h-0 lg:overflow-hidden">
            <Link
              to="/calendar"
              className="col-span-1 flex flex-col justify-between rounded-sm border border-ink/10 bg-white/50 p-6 transition-colors hover:border-ink/30 lg:min-h-[120px] lg:p-4"
            >
              <span className="text-[10px] font-bold tracking-widest text-ticket uppercase">
                Events
              </span>
              <span className="font-print text-5xl lg:text-4xl">{upcoming.length}</span>
            </Link>
            <Link
              to="/roster"
              className="col-span-1 flex flex-col justify-between rounded-sm border border-ink/10 bg-white/50 p-6 transition-colors hover:border-ink/30 lg:min-h-[120px] lg:p-4"
            >
              <span className="text-[10px] font-bold tracking-widest text-ticket uppercase">
                Roster
              </span>
              <span className="font-print text-5xl lg:text-4xl">{players.data?.length ?? 0}</span>
            </Link>
            <Link
              to="/photos"
              className="col-span-1 flex flex-col justify-between overflow-hidden rounded-sm bg-seam p-6 text-paper transition-all hover:brightness-110 lg:min-h-[120px] lg:p-4"
            >
              <span className="text-[10px] font-bold tracking-widest uppercase opacity-80">
                Media vault
              </span>
              <h3 className="mt-2 font-print text-3xl lg:text-2xl">
                {vaultCount} photo{vaultCount === 1 ? "" : "s"}
              </h3>
              <span className="mt-6 inline-block border-b border-paper pb-1 text-[10px] font-bold tracking-widest uppercase lg:mt-3">
                Enter gallery
              </span>
            </Link>
            {latestGameWithPhotos ? (
              <Link
                to="/photos/game/$eventId"
                params={{ eventId: latestGameWithPhotos.id }}
                className="col-span-1 flex flex-col justify-between overflow-hidden rounded-sm bg-ink p-6 text-paper transition-all hover:brightness-110 lg:min-h-[120px] lg:p-4"
              >
                <span className="text-[10px] font-bold tracking-widest uppercase opacity-80">
                  Latest game album
                </span>
                <h3 className="mt-2 line-clamp-2 font-print text-3xl leading-tight lg:text-2xl">
                  {latestGameWithPhotos.opponent ?? latestGameWithPhotos.title ?? "Game"}
                </h3>
                <p className="mt-1 text-xs opacity-80 lg:hidden">
                  {monthDay(latestGameWithPhotos.starts_at).weekday}
                </p>
                <span className="mt-6 inline-block border-b border-paper pb-1 text-[10px] font-bold tracking-widest uppercase lg:mt-3">
                  {tallyFor(photoCounts, latestGameWithPhotos)} photo
                  {tallyFor(photoCounts, latestGameWithPhotos) === 1 ? "" : "s"} →
                </span>
              </Link>
            ) : (
              <Link
                to="/share"
                className="col-span-1 flex flex-col justify-between rounded-sm border-2 border-dashed border-ink/30 p-6 text-ink transition-all hover:border-ink/60 lg:min-h-[120px] lg:p-4"
              >
                <span className="text-[10px] font-bold tracking-widest uppercase opacity-60">
                  Latest game album
                </span>
                <h3 className="mt-2 font-print text-2xl leading-tight italic">
                  No game photos yet
                </h3>
                <span className="mt-6 inline-block border-b border-ink pb-1 text-[10px] font-bold tracking-widest uppercase lg:mt-3">
                  Share the first
                </span>
              </Link>
            )}
          </div>

          {/* Team photo */}
          <section className="flex flex-col md:col-span-9 lg:col-span-12 lg:row-start-3 lg:min-h-[140px]">
            <div ref={squadHeadRef} className="mb-4 flex items-baseline justify-between border-b border-ink/10 pb-3 lg:mb-2 lg:pb-2">
              <h3 className="font-print text-4xl uppercase italic lg:text-2xl">The Squad</h3>
              <span className="text-[10px] font-bold tracking-widest text-seam uppercase">
                1836 Roughriders
              </span>
            </div>
            <div className="relative min-h-0 aspect-[3/2] lg:aspect-auto lg:flex-1">
              <img
                ref={squadImgRef}
                src={squadPhoto}
                alt="1836 Roughriders team photo"
                loading="lazy"
                className="absolute inset-0 size-full rounded-sm object-cover object-[center_35%]"
              />
            </div>
          </section>
        </div>
      </div>
    </PortalLayout>
  );
}

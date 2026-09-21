import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Images } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { VideoList } from "@/components/VideoList";
import { GamePhotoLightbox } from "@/components/GamePhotoLightbox";
import {
  albumPhotoGameLinksQuery,
  albumsQuery,
  eventsQuery,
  sharedPhotosQuery,
  teamVideosQuery,
  tallyFor,
  formatEventDate,
  type PortalEvent,
} from "@/lib/portal-data";


export const Route = createFileRoute("/photos/")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Photos & Videos — 1836 - The DugOut" },
      {
        name: "description",
        content:
          "Browse 1836 Roughriders shared photo albums, game galleries and highlight videos.",
      },
      { property: "og:title", content: "Photos & Videos — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Shared albums, game galleries and highlight videos for 1836 Roughriders families.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Photos,
});

function Photos() {
  const albums = useQuery(albumsQuery);
  const events = useQuery(eventsQuery);
  const shared = useQuery(sharedPhotosQuery);
  const gameLinks = useQuery(albumPhotoGameLinksQuery);
  const media = useQuery(teamVideosQuery);
  const [openGame, setOpenGame] = useState<PortalEvent | null>(null);

  const albumRows = albums.data ?? [];
  const eventRows = events.data ?? [];
  const sharedRows = shared.data ?? [];

  // Photo counts per game, from synced album photos plus photos families shared.
  const gameCounts = new Map<string, number>();
  const gameCovers = new Map<string, string>();
  for (const p of gameLinks.data ?? []) {
    if (!p.event_id) continue;
    gameCounts.set(p.event_id, (gameCounts.get(p.event_id) ?? 0) + 1);
    if (p.thumbnail_url && !gameCovers.has(p.event_id)) {
      gameCovers.set(p.event_id, p.thumbnail_url);
    }
  }
  for (const p of sharedRows) {
    if (!p.event_id) continue;
    gameCounts.set(p.event_id, (gameCounts.get(p.event_id) ?? 0) + 1);
    if (p.url && !gameCovers.has(p.event_id)) gameCovers.set(p.event_id, p.url);
  }
  const coverFor = (e: { id: string; alias_ids: string[] }) =>
    [e.id, ...e.alias_ids].map((id) => gameCovers.get(id)).find(Boolean) ?? null;
  const games = eventRows
    .filter((e) => [e.id, ...e.alias_ids].some((id) => gameCounts.has(id)))
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  const loading = albums.isLoading || shared.isLoading || gameLinks.isLoading;

  return (
    <PortalLayout eyebrow="Team gallery" title="Photos & Videos">
      <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
        Open a shared album, jump to a single game to see every photo from it, or watch the team
        videos below.
      </p>

      <section>
        <h2 className="section-title text-xl">Albums</h2>
        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : albumRows.length === 0 ? (
          <EmptyState
            title="No albums yet"
            copy="Albums appear here once the team album is synced or a family shares a picture."
          />
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {albumRows.map((a) => (
              <Link
                key={a.id}
                to="/photos/$albumId"
                params={{ albumId: a.id }}
                className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/60"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-secondary">
                  {a.cover_url ? (
                    <img
                      src={a.cover_url}
                      alt={a.title}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Images className="size-10 text-primary/70" />
                  )}
                </div>
                <div className="p-4">
                  <p className="font-display text-base uppercase tracking-wide">{a.title}</p>
                  <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                    {a.season ? `${a.season} · ` : ""}
                    {a.photo_count} photos
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="section-title text-xl">By game</h2>
        {games.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No photos are tied to a game yet. Families can pick the game when they share a photo.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((e) => {
              const cover = coverFor(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setOpenGame(e)}
                  className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/60"
                >
                  <div className="flex aspect-[4/3] items-center justify-center bg-secondary">
                    {cover ? (
                      <img
                        src={cover}
                        alt={e.opponent ? `Photos from the game against ${e.opponent}` : "Game photos"}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <Camera className="size-10 text-primary/70" />
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-display text-base uppercase tracking-wide">
                      {e.opponent ? `vs ${e.opponent}` : (e.title ?? "Game")}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                      {formatEventDate(e.starts_at)} · {tallyFor(gameCounts, e)} photos
                    </p>
                    {e.location ? (
                      <p className="mt-1 text-xs text-muted-foreground">{e.location}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="section-title text-xl">Videos</h2>
        {media.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : (media.data ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No videos yet. Upload a clip from the Share page and it plays right here.
          </p>
        ) : (
          <div className="mt-4">
            <VideoList videos={media.data ?? []} />
          </div>
        )}
      </section>

      {openGame ? (
        <GamePhotoLightbox event={openGame} onClose={() => setOpenGame(null)} />
      ) : null}
    </PortalLayout>
  );
}

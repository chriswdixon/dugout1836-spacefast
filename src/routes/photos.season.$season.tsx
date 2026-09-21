import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, Images } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  albumPhotosForAlbumsQuery,
  albumsQuery,
  eventIdsOf,
  eventsByAnyId,
  eventsQuery,
  formatEventDate,
  sharedPhotosQuery,
  tallyFor,
} from "@/lib/portal-data";
import { seasonOf } from "@/lib/seasons";

export const Route = createFileRoute("/photos/season/$season")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Season photos — 1836 - The DugOut" },
      {
        name: "description",
        content: "Every 1836 Roughriders photo from one season, album by album and game by game.",
      },
      { property: "og:title", content: "Season photos — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Browse a full season of 1836 Roughriders team photos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SeasonGallery,
});

function SeasonGallery() {
  const { season } = Route.useParams();
  const albums = useQuery(albumsQuery);
  const events = useQuery(eventsQuery);
  const shared = useQuery(sharedPhotosQuery);

  const eventRows = events.data ?? [];
  const eventById = eventsByAnyId(eventRows);

  const seasonAlbums = (albums.data ?? []).filter(
    (a) => (a.season ?? seasonOf(a.created_at)) === season,
  );
  const photos = useQuery(albumPhotosForAlbumsQuery(seasonAlbums.map((a) => a.id)));

  const familyPhotos = (shared.data ?? []).filter((p) => {
    const ev = p.event_id ? eventById.get(p.event_id) : undefined;
    return seasonOf(ev?.starts_at ?? p.created_at) === season;
  });

  const photoRows = photos.data ?? [];
  const gameCounts = new Map<string, number>();
  for (const p of photoRows) {
    if (p.event_id) gameCounts.set(p.event_id, (gameCounts.get(p.event_id) ?? 0) + 1);
  }
  for (const p of familyPhotos) {
    if (p.event_id) gameCounts.set(p.event_id, (gameCounts.get(p.event_id) ?? 0) + 1);
  }

  const seasonGames = eventRows
    .filter((e) => seasonOf(e.starts_at) === season)
    .filter(
      (e) =>
        tallyFor(gameCounts, e) > 0 ||
        seasonAlbums.some((a) => a.event_id && eventIdsOf(e).includes(a.event_id)),
    )
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  const loading = albums.isLoading || shared.isLoading || photos.isLoading;

  return (
    <PortalLayout
      eyebrow="Season gallery"
      title={season}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/photos">
            <ArrowLeft className="size-4" /> All photos
          </Link>
        </Button>
      }
    >
      <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
        Pick a game or an album to see the pictures.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : seasonGames.length === 0 && seasonAlbums.length === 0 ? (
        <EmptyState
          title="No photos for this season"
          copy="Photos show up here once an album is refreshed or a family shares a picture."
        />
      ) : (
        <div className="space-y-12">
          {seasonGames.length > 0 ? (
            <section>
              <h2 className="section-title text-xl">Games this season</h2>
              <div className="mt-4 space-y-2">
                {seasonGames.map((e) => (
                  <Link
                    key={e.id}
                    to="/photos/game/$eventId"
                    params={{ eventId: e.id }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60"
                  >
                    <div>
                      <p className="font-display text-sm uppercase tracking-wide">
                        {e.opponent ? `vs ${e.opponent}` : (e.title ?? "Game")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatEventDate(e.starts_at)}
                        {e.location ? ` · ${e.location}` : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                      <Camera className="size-4 text-primary/70" /> {tallyFor(gameCounts, e)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {seasonAlbums.length > 0 ? (
            <section>
              <h2 className="section-title text-xl">Albums</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {seasonAlbums.map((a) => (
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
                        {a.photo_count} photos
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </PortalLayout>
  );
}

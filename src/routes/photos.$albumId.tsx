import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { PhotoGrid } from "@/components/PhotoGrid";
import { Button } from "@/components/ui/button";
import {
  albumPhotosQuery,
  albumsQuery,
  eventsByAnyId,
  eventsQuery,
  formatEventDate,
  sharedPhotosQuery,
} from "@/lib/portal-data";
import { seasonOf } from "@/lib/seasons";

export const Route = createFileRoute("/photos/$albumId")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Album — 1836 - The DugOut" },
      {
        name: "description",
        content: "Photos from a shared 1836 Roughriders team album, grouped by game.",
      },
      { property: "og:title", content: "Album — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Photos from a shared 1836 Roughriders team album, grouped by game.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Album,
});

function Album() {
  const { albumId } = Route.useParams();
  const albums = useQuery(albumsQuery);
  const events = useQuery(eventsQuery);
  const photos = useQuery(albumPhotosQuery(albumId));
  const shared = useQuery(sharedPhotosQuery);
  const album = (albums.data ?? []).find((a) => a.id === albumId);
  const eventRows = events.data ?? [];
  const eventById = eventsByAnyId(eventRows);
  const game = album?.event_id ? eventById.get(album.event_id) : undefined;
  const season = album ? (album.season ?? seasonOf(album.created_at)) : null;

  const rows = photos.data ?? [];

  // Photos live on their game page; here we only list which games this album covers.
  const groups = new Map<string, typeof rows>();
  for (const p of rows) {
    const key = p.event_id ?? "unlinked";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const gameGroups = [...groups.entries()]
    .filter(([key]) => key !== "unlinked")
    .map(([key, list]) => ({ event: eventById.get(key), list }))
    .sort(
      (a, b) =>
        new Date(a.event?.starts_at ?? 0).getTime() - new Date(b.event?.starts_at ?? 0).getTime(),
    );
  const unlinked = [
    ...(groups.get("unlinked") ?? []).map((p) => ({
      id: p.id,
      url: p.thumbnail_url,
      fullUrl: p.full_url,
      alt: p.name ?? "Team photo",
      caption: p.created_time ? formatEventDate(p.created_time) : null,
      kind: "album" as const,
    })),
    ...(shared.data ?? [])
      .filter((p) => p.album_id === albumId && !p.event_id)
      .map((p) => ({
        id: p.id,
        url: p.url,
        alt: p.caption ?? "Photo shared by a team family",
        caption: p.caption,
        kind: "upload" as const,
      })),
  ];

  return (
    <PortalLayout
      eyebrow="Album"
      title={album?.title ?? "Photos"}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/photos">
            <ArrowLeft className="size-4" /> All photos
          </Link>
        </Button>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
        {season ? (
          <Link to="/photos/season/$season" params={{ season }} className="underline">
            {season}
          </Link>
        ) : null}
        {game ? (
          <Link to="/photos/game/$eventId" params={{ eventId: game.id }} className="underline">
            {game.opponent ? `vs ${game.opponent}` : "Game"} · {formatEventDate(game.starts_at)}
          </Link>
        ) : null}
        <span>{album?.photo_count ?? 0} photos</span>
      </div>

      {album?.description ? (
        <p className="mb-6 max-w-2xl text-sm text-muted-foreground">{album.description}</p>
      ) : null}

      {photos.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 && unlinked.length === 0 ? (
        <EmptyState
          title="This album is empty"
          copy="Photos show up after the album is refreshed from the photo drive."
        />
      ) : (
        <div className="space-y-10">
          {gameGroups.length > 0 ? (
            <section>
              <h2 className="section-title text-xl">Games in this album</h2>
              <div className="mt-4 space-y-2">
                {gameGroups.map(({ event, list }) => (
                  <Link
                    key={event?.id ?? "game"}
                    to="/photos/game/$eventId"
                    params={{ eventId: event?.id ?? "" }}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/60"
                  >
                    <div>
                      <p className="font-display text-sm uppercase tracking-wide">
                        {event?.opponent ? `vs ${event.opponent}` : (event?.title ?? "Game")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event ? formatEventDate(event.starts_at) : null}
                        {event?.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                    <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                      <Camera className="size-4 text-primary/70" /> {list.length}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {unlinked.length > 0 ? (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="section-title text-xl">Not tied to a game</h2>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {unlinked.length} photos
                </p>
              </div>
              <div className="mt-4">
                <PhotoGrid photos={unlinked} />
              </div>
            </section>
          ) : null}
        </div>
      )}
    </PortalLayout>
  );
}

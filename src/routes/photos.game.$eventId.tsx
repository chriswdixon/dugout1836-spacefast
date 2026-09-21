import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { PhotoGrid } from "@/components/PhotoGrid";
import { VideoList } from "@/components/VideoList";
import { Button } from "@/components/ui/button";
import {
  albumPhotosForAlbumsQuery,
  albumsQuery,
  eventAlbumPhotosQuery,
  eventIdsOf,
  eventsQuery,
  findEventByAnyId,
  formatEventDate,
  sharedPhotosQuery,
  teamVideosQuery,
} from "@/lib/portal-data";
import { seasonOf } from "@/lib/seasons";


export const Route = createFileRoute("/photos/game/$eventId")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Game photos — 1836 - The DugOut" },
      {
        name: "description",
        content: "Photos from a single 1836 Roughriders game, shared by the coach and team families.",
      },
      { property: "og:title", content: "Game photos — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Browse every photo from one 1836 Roughriders game.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GameGallery,
});

function GameGallery() {
  const { eventId } = Route.useParams();
  const events = useQuery(eventsQuery);
  const albums = useQuery(albumsQuery);
  const shared = useQuery(sharedPhotosQuery);
  const videos = useQuery(teamVideosQuery);

  const event = findEventByAnyId(events.data ?? [], eventId);
  const ids = event ? eventIdsOf(event) : [eventId];
  const gameVideos = (videos.data ?? []).filter((v) => v.event_id && ids.includes(v.event_id));
  const gameAlbums = (albums.data ?? []).filter((a) => a.event_id && ids.includes(a.event_id));
  const photos = useQuery(albumPhotosForAlbumsQuery(gameAlbums.map((a) => a.id)));
  const taggedPhotos = useQuery(eventAlbumPhotosQuery(ids));
  const familyPhotos = (shared.data ?? []).filter(
    (p) => p.event_id && ids.includes(p.event_id),
  );

  // Photos tagged with this game (by capture time) plus any album filed under it.
  const albumPhotos = [...(taggedPhotos.data ?? []), ...(photos.data ?? [])].filter(
    (p, i, all) => all.findIndex((q) => q.id === p.id) === i,
  );

  const gridPhotos = [
    ...albumPhotos.map((p) => ({
      id: p.id,
      url: p.thumbnail_url,
      fullUrl: p.full_url,
      alt: p.name ?? "Game photo",
      caption: p.created_time ? formatEventDate(p.created_time) : null,
      kind: "album" as const,
    })),
    ...familyPhotos.map((p) => ({
      id: p.id,
      url: p.url,
      alt: p.caption ?? "Photo shared by a team family",
      caption: p.caption,
      kind: "upload" as const,
    })),
  ];

  const season = event ? seasonOf(event.starts_at) : null;
  const score =
    event && event.score_us !== null && event.score_them !== null
      ? `${event.score_us}-${event.score_them}`
      : null;

  const loading = events.isLoading || albums.isLoading || shared.isLoading || photos.isLoading;

  return (
    <PortalLayout
      eyebrow={event ? formatEventDate(event.starts_at) : "Game gallery"}
      title={event?.opponent ? `vs ${event.opponent}` : (event?.title ?? "Game photos")}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/photos">
            <ArrowLeft className="size-4" /> All photos
          </Link>
        </Button>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
        {event?.location ? <span>{event.location}</span> : null}
        {event?.event_name ? <span>{event.event_name}</span> : null}
        {score ? <span className="text-primary">{score}</span> : null}
        {season ? (
          <Link to="/photos/season/$season" params={{ season }} className="underline">
            {season} gallery
          </Link>
        ) : null}
      </div>

      <h2 className="section-title text-xl">Photos</h2>
      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : gridPhotos.length === 0 ? (
          <EmptyState
            title="No photos from this game yet"
            copy="Share yours from the Share page and pick this game — it will show up here right away."
          />
        ) : (
          <PhotoGrid photos={gridPhotos} />
        )}
      </div>

      <section className="mt-12">
        <h2 className="section-title text-xl">Videos</h2>
        {videos.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : gameVideos.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No videos from this game yet. Upload a clip on the Share page and pick this game — it
            plays right here.
          </p>
        ) : (
          <div className="mt-4">
            <VideoList videos={gameVideos} />
          </div>
        )}
      </section>

    </PortalLayout>
  );
}

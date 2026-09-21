import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { PhotoGrid } from "@/components/PhotoGrid";
import {
  albumPhotosForAlbumsQuery,
  albumsQuery,
  eventAlbumPhotosQuery,
  eventIdsOf,
  formatEventDate,
  sharedPhotosQuery,
  type PortalEvent,
} from "@/lib/portal-data";

/** All photos for one game: album shots tagged by capture time + family uploads. */
export function useGameGridPhotos(event: PortalEvent | null) {
  const albums = useQuery(albumsQuery);
  const shared = useQuery(sharedPhotosQuery);

  const ids = event ? eventIdsOf(event) : [];
  const gameAlbums = (albums.data ?? []).filter((a) => a.event_id && ids.includes(a.event_id));
  const photos = useQuery({
    ...albumPhotosForAlbumsQuery(gameAlbums.map((a) => a.id)),
    enabled: !!event,
  });
  const taggedPhotos = useQuery({
    ...eventAlbumPhotosQuery(ids),
    enabled: !!event && ids.length > 0,
  });
  const familyPhotos = (shared.data ?? []).filter(
    (p) => p.event_id && ids.includes(p.event_id),
  );

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

  const loading =
    !!event && (albums.isLoading || shared.isLoading || photos.isLoading || taggedPhotos.isLoading);

  return { gridPhotos, loading };
}

/** Full-screen overlay showing one game's photo grid; closes with Escape, backdrop or the X. */
export function GamePhotoLightbox({
  event,
  onClose,
}: {
  event: PortalEvent;
  onClose: () => void;
}) {
  const { gridPhotos, loading } = useGameGridPhotos(event);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const score =
    event.score_us !== null && event.score_them !== null
      ? `${event.score_us}-${event.score_them}`
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Photos from ${event.opponent ? `the game against ${event.opponent}` : "this game"}`}
      onClick={onClose}
    >
      <div
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{formatEventDate(event.starts_at)}</p>
            <h2 className="section-title text-2xl md:text-3xl">
              {event.opponent ? `vs ${event.opponent}` : (event.title ?? "Game photos")}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
              {event.location ? `${event.location} · ` : ""}
              {score ? <span className="text-primary">{score} · </span> : null}
              {gridPhotos.length} photos
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/photos/game/$eventId"
              params={{ eventId: event.id }}
              className="rounded-md border border-border px-3 py-1.5 font-work text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Open page
            </Link>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : gridPhotos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos from this game yet.</p>
          ) : (
            <PhotoGrid photos={gridPhotos} />
          )}
        </div>
      </div>
    </div>
  );
}

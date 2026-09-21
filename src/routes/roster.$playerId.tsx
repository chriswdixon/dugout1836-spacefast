import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { PhotoGrid } from "@/components/PhotoGrid";
import { VideoList } from "@/components/VideoList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  eventIdsOf,
  eventsByAnyId,
  eventsQuery,
  formatEventDate,
  playerPhotosQuery,
  playersQuery,
  teamVideosQuery,
} from "@/lib/portal-data";

export const Route = createFileRoute("/roster/$playerId")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Player — 1836 - The DugOut" },
      {
        name: "description",
        content: "Player details for the 1836 Roughriders roster.",
      },
      { property: "og:title", content: "Player — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Jersey number, positions and class year for an 1836 Roughriders player.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlayerPage,
});

function PlayerPage() {
  const { playerId } = Route.useParams();
  const players = useQuery(playersQuery);
  const player = (players.data ?? []).find((p) => p.id === playerId);
  const qc = useQueryClient();
  const { user } = useAuth();
  const [jersey, setJersey] = useState("");

  useEffect(() => {
    setJersey(player?.jersey_number ?? "");
  }, [player?.id, player?.jersey_number]);

  const saveJersey = useMutation({
    mutationFn: async () => {
      const value = jersey.trim();
      const { error } = await supabase
        .from("players")
        .update({ jersey_number: value || null })
        .eq("id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["players"] });
      toast.success("Jersey number saved — photos will tag this player by number.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const events = useQuery(eventsQuery);
  const tagged = useQuery(playerPhotosQuery(playerId));
  const videos = useQuery(teamVideosQuery);

  const photos = tagged.data ?? [];
  const eventById = eventsByAnyId(events.data ?? []);
  // Photos may be filed under a duplicate copy of a game, so group by the kept game.
  const gameIds = [
    ...new Set(
      photos
        .map((p) => (p.event_id ? (eventById.get(p.event_id)?.id ?? p.event_id) : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
    .sort((a, b) => {
      const ta = eventById.get(a)?.starts_at ?? "";
      const tb = eventById.get(b)?.starts_at ?? "";
      return tb.localeCompare(ta);
    });
  const loose = photos.filter((p) => !p.event_id);


  return (
    <PortalLayout eyebrow="Player" title={player?.name ?? "Player"}>
      <Link
        to="/roster"
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4" /> Back to roster
      </Link>

      {players.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !player ? (
        <div className="mt-8">
          <EmptyState title="Player not found" copy="This player is no longer on the roster." />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-4 sm:col-span-2">
            <p className="font-display text-xs uppercase tracking-widest text-muted-foreground">
              Jersey number
            </p>
            {user ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Input
                  value={jersey}
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  onChange={(e) => setJersey(e.target.value)}
                  className="w-28"
                />
                <Button
                  onClick={() => saveJersey.mutate()}
                  disabled={saveJersey.isPending || (player.jersey_number ?? "") === jersey.trim()}
                >
                  {saveJersey.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : (
              <p className="mt-2 font-display text-2xl">{player.jersey_number || "—"}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Photos are tagged to this player automatically when this number is readable. If the
              number is hidden, use "Identify a player" on the photo to name them by hand.
            </p>
          </div>
          {[
            { label: "Positions", value: player.positions || "—" },
            { label: "Class", value: player.grad_year ? String(player.grad_year) : "—" },
            {
              label: "Bats / Throws",
              value:
                player.bats || player.throws
                  ? `${player.bats ?? "-"} / ${player.throws ?? "-"}`
                  : "—",
            },
          ].map((f) => (
            <div key={f.label} className="rounded-lg border border-border p-4">
              <p className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                {f.label}
              </p>
              <p className="mt-1 text-lg">{f.value}</p>
            </div>
          ))}
        </div>
      )}

      <section className="mt-12">
        <h2 className="section-title text-xl">Photos & videos of this player</h2>
        {tagged.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : photos.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No photos yet"
              copy="Open any photo and use “Identify a player” to name this player — every photo they appear in shows up here, game by game."
            />
          </div>
        ) : (
          <div className="mt-6 space-y-10">
            {gameIds.map((id) => {
              const game = eventById.get(id);
              const ids = game ? eventIdsOf(game) : [id];
              const gamePhotos = photos.filter((p) => p.event_id && ids.includes(p.event_id));
              const gameVideos = (videos.data ?? []).filter(
                (v) => v.event_id && ids.includes(v.event_id),
              );
              return (
                <div key={id}>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="font-display text-lg">
                      {game?.opponent ? `vs ${game.opponent}` : (game?.title ?? "Game")}
                    </h3>
                    {game ? (
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">
                        {formatEventDate(game.starts_at)}
                      </span>
                    ) : null}
                    <Link
                      to="/photos/game/$eventId"
                      params={{ eventId: id }}
                      className="text-xs uppercase tracking-widest text-primary underline"
                    >
                      Full game gallery
                    </Link>
                  </div>
                  <div className="mt-4">
                    <PhotoGrid photos={gamePhotos} />
                  </div>
                  {gameVideos.length > 0 ? (
                    <div className="mt-4">
                      <VideoList videos={gameVideos} />
                    </div>
                  ) : null}
                </div>
              );
            })}

            {loose.length > 0 ? (
              <div>
                <h3 className="font-display text-lg">Not tied to a game</h3>
                <div className="mt-4">
                  <PhotoGrid photos={loose} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </PortalLayout>
  );
}

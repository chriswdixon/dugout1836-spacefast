import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { photoTagsQuery, playersQuery } from "@/lib/portal-data";
import { Button } from "@/components/ui/button";

export type PhotoKind = "album" | "upload";

/** Tags on one photo, with a manual "who is this?" picker. */
export function PhotoTagBar({ photoId, kind }: { photoId: string; kind: PhotoKind }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const tags = useQuery(photoTagsQuery);
  const players = useQuery(playersQuery);
  const [picking, setPicking] = useState(false);

  const key = kind === "album" ? "album_photo_id" : "photo_upload_id";
  const mine = (tags.data ?? []).filter((t) => t[key] === photoId);
  const taggedIds = new Set(mine.map((t) => t.player_id));
  const untagged = (players.data ?? []).filter((p) => !taggedIds.has(p.id));

  const addTag = useMutation({
    mutationFn: async (playerId: string) => {
      if (!user) throw new Error("Sign in to identify players.");
      const player = (players.data ?? []).find((p) => p.id === playerId);
      const { error } = await supabase.from("photo_tags").insert({
        player_id: playerId,
        album_photo_id: kind === "album" ? photoId : null,
        photo_upload_id: kind === "upload" ? photoId : null,
        jersey_number: player?.jersey_number ?? null,
        method: "manual",
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      // If the player has no roster photo yet, use this tagged album photo —
      // but only when this photo shows exactly one player.
      if (kind === "album" && player && !player.photo_url) {
        const { count } = await supabase
          .from("photo_tags")
          .select("id", { count: "exact", head: true })
          .eq("album_photo_id", photoId);
        if ((count ?? 0) > 1) return;
        const { data: photo } = await supabase
          .from("album_photos")
          .select("thumbnail_url")
          .eq("id", photoId)
          .maybeSingle();
        const thumb = photo?.thumbnail_url;
        if (thumb) {
          const url = /googleusercontent\.com/.test(thumb)
            ? thumb.replace(/=[a-z0-9-]*$/i, "=w800")
            : thumb;
          await supabase.from("players").update({ photo_url: url }).eq("id", playerId);
        }
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: photoTagsQuery.queryKey });
      void qc.invalidateQueries({ queryKey: playersQuery.queryKey });
      void qc.invalidateQueries({ queryKey: ["player_tag_photos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTag = useMutation({
    mutationFn: async (tagId: string) => {
      const { error } = await supabase.from("photo_tags").delete().eq("id", tagId);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: photoTagsQuery.queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Any signed-in member can remove a tag — collaborative corrections for AI
  // mistakes. Signed-out visitors see tags read-only.
  const canRemove = (_createdBy: string | null) => !!user;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
      <Tag className="size-4 text-primary/70" />
      {mine.length === 0 ? (
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          Nobody identified yet
        </span>
      ) : null}
      {mine.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-3 py-1 text-xs"
        >
          {t.players?.name ?? "Player"}
          {t.method === "ai" ? (
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              auto
            </span>
          ) : null}
          {canRemove(t.created_by) ? (
            <button
              type="button"
              aria-label={`Remove ${t.players?.name ?? "player"}`}
              onClick={() => removeTag.mutate(t.id)}
              className="text-muted-foreground hover:text-primary"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}

      {!user ? (
        <Link
          to="/auth"
          className="text-xs uppercase tracking-widest text-muted-foreground underline-offset-2 hover:underline"
        >
          Sign in to identify players
        </Link>
      ) : picking ? (
        <div className="w-full max-w-lg rounded-xl border border-border bg-card p-3 text-left">
          <p className="eyebrow mb-2">Tap everyone in this photo</p>
          {untagged.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Everyone on the roster is already identified.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {untagged.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={addTag.isPending}
                  onClick={() => addTag.mutate(p.id)}
                  className="rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary disabled:opacity-50"
                >
                  {p.jersey_number ? `#${p.jersey_number} ` : ""}
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setPicking(false)}
          >
            Done
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
          {mine.length > 0 ? "Identify more players" : "Identify a player"}
        </Button>
      )}
    </div>
  );
}

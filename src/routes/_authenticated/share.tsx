import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { VideoList } from "@/components/VideoList";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  albumsQuery,
  eventsQuery,
  formatEventDate,
  teamVideosQuery,
  myPhotoUploadsQuery,
} from "@/lib/portal-data";


export const Route = createFileRoute("/_authenticated/share")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Share — 1836 - The DugOut" },
      {
        name: "description",
        content:
          "1836 Roughriders families can post their own game photos and video clips.",
      },
      { property: "og:title", content: "Share — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Post your own photos and clips to the team portal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Share,
});

function Share() {
  return (
    <PortalLayout
      eyebrow="Family contributions"
      title="Share"
      actions={undefined}
    >
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Anything you add here shows up for the rest of the team right away. You can delete your own
        posts at any time.
      </p>
      <Tabs defaultValue="photos">
        <TabsList>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="videos">Videos</TabsTrigger>
        </TabsList>
        <TabsContent value="photos" className="mt-6">
          <PhotoUpload />
        </TabsContent>
        <TabsContent value="videos" className="mt-6">
          <VideoForm />
        </TabsContent>
      </Tabs>
    </PortalLayout>
  );
}

function PhotoUpload() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const mine = useQuery(myPhotoUploadsQuery(user?.id));
  const events = useQuery(eventsQuery);
  const albums = useQuery(albumsQuery);
  // Everything families share is filed into the shared "Parents album".
  const parentsAlbumId =
    (albums.data ?? []).find((a) => a.title.toLowerCase() === "parents album")?.id ?? null;

  const [caption, setCaption] = useState("");
  const [eventId, setEventId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!user || files.length === 0) return;
    setBusy(true);
    let done = 0;
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${user.id}/${Date.now()}-${safe}`;
      const { data: up, error: upErr } = await supabase.storage
        .from("team-photos")
        .upload(path, file, { contentType: file.type });
      if (upErr) {
        toast.error(`${file.name}: ${upErr.message}`);
        continue;
      }
      const { error } = await supabase.from("photo_uploads").insert({
        storage_path: up?.path ?? path,
        caption: caption.trim() || null,
        uploaded_by: user.id,
        event_id: eventId || null,
        album_id: parentsAlbumId,
        mime_type: file.type,
      });
      if (error) {
        toast.error(error.message);
        continue;
      }
      done += 1;
    }
    setBusy(false);
    setFiles([]);
    setCaption("");
    if (done > 0) {
      toast.success(`${done} photo${done === 1 ? "" : "s"} shared.`);
      void qc.invalidateQueries({ queryKey: ["photo_uploads"] });
    }
  }

  const remove = useMutation({
    mutationFn: async (row: { id: string; storage_path: string }) => {
      const { error } = await supabase.from("photo_uploads").delete().eq("id", row.id);
      if (error) throw error;
      await supabase.storage.from("team-photos").remove([row.storage_path]);
    },
    onSuccess: () => {
      toast.success("Photo removed.");
      void qc.invalidateQueries({ queryKey: ["photo_uploads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel space-y-4 rounded-xl p-6">
        <h2 className="section-title text-lg">Add photos</h2>
        <div className="space-y-2">
          <Label htmlFor="photo-files">Choose photos</Label>
          <Input
            id="photo-files"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 ? (
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="photo-caption">Caption (optional)</Label>
          <Input
            id="photo-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Bracket game vs. Dallas Tigers"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="photo-game">Game (optional)</Label>
          <select
            id="photo-game"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Not tied to a game</option>
            {(events.data ?? [])
              .slice()
              .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {formatEventDate(e.starts_at)} · {e.opponent ?? e.title ?? "Game"}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Pick a game and your photos join that game's gallery.
          </p>
        </div>

        <Button disabled={busy || files.length === 0} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Share photos"}
        </Button>
      </div>

      <div className="panel space-y-3 rounded-xl p-6">
        <h2 className="section-title text-lg">Your photos</h2>
        {(mine.data ?? []).length === 0 ? (
          <EmptyState title="Nothing yet" copy="Photos you share will be listed here." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(mine.data ?? []).map((p) => (
              <div key={p.id} className="overflow-hidden rounded-lg border border-border">
                {p.url ? (
                  <img
                    src={p.url}
                    alt={p.caption ?? "Team photo"}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: p.id, storage_path: p.storage_path })}
                >
                  <Trash2 className="mr-1 size-3" /> Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VideoForm() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const videos = useQuery(teamVideosQuery);
  const events = useQuery(eventsQuery);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [eventId, setEventId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["media_items"] });
  };

  /** Uploads the chosen files into the team video store and lists them right away. */
  async function upload() {
    if (!user || files.length === 0) return;
    setBusy(true);
    let done = 0;
    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${user.id}/${Date.now()}-${safe}`;
      const { data: up, error: upErr } = await supabase.storage
        .from("team-videos")
        .upload(path, file, { contentType: file.type || "video/mp4" });
      if (upErr) {
        toast.error(`${file.name}: ${upErr.message}`);
        continue;
      }
      const stored = up?.path ?? path;
      const { error } = await supabase.from("media_items").insert({
        title: (files.length === 1 && title.trim()) || safe.replace(/\.[a-z0-9]+$/i, ""),
        media_url: stored,
        storage_path: stored,
        mime_type: file.type || null,
        description: description.trim() || null,
        kind: "video",
        event_id: eventId || null,
        published_at: new Date().toISOString(),
        submitted_by: user.id,
      });
      if (error) {
        toast.error(error.message);
        continue;
      }
      done += 1;
    }
    setBusy(false);
    setFiles([]);
    setTitle("");
    setDescription("");
    if (done > 0) {
      toast.success(`${done} video${done === 1 ? "" : "s"} uploaded.`);
      refresh();
    }
  }

  const add = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Please sign in again.");
      const { error } = await supabase.from("media_items").insert({
        title: title.trim(),
        media_url: url.trim(),
        description: description.trim() || null,
        kind: "video",
        event_id: eventId || null,
        published_at: new Date().toISOString(),
        submitted_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Video shared.");
      setTitle("");
      setUrl("");
      setDescription("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (video: { id: string; storage_path: string | null }) => {
      const { error } = await supabase.from("media_items").delete().eq("id", video.id);
      if (error) throw error;
      if (video.storage_path) {
        await supabase.storage.from("team-videos").remove([video.storage_path]);
      }
    },
    onSuccess: () => {
      toast.success("Video removed.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mine = (videos.data ?? []).filter((m) => m.submitted_by && m.submitted_by === user?.id);
  const gameOptions = (events.data ?? [])
    .slice()
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel space-y-4 rounded-xl p-6">
        <h2 className="section-title text-lg">Upload a video</h2>
        <p className="text-sm text-muted-foreground">
          Videos you upload are stored on this site and play right on the game's page — no other app
          needed.
        </p>
        <div className="space-y-2">
          <Label htmlFor="v-files">Choose video files</Label>
          <Input
            id="v-files"
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 ? (
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">Up to 500 MB per clip.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-title">Title (optional)</Label>
          <Input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-game">Game (optional)</Label>
          <select
            id="v-game"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Not tied to a game</option>
            {gameOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {formatEventDate(e.starts_at)} · {e.opponent ?? e.title ?? "Game"}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="v-desc">Notes (optional)</Label>
          <Textarea
            id="v-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button disabled={busy || files.length === 0} onClick={() => void upload()}>
          {busy ? "Uploading…" : "Upload videos"}
        </Button>

        <div className="border-t border-border pt-4">
          <Label htmlFor="v-url">Or paste a link (YouTube, Drive, GameChanger…)</Label>
          <Input
            id="v-url"
            className="mt-2"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
          <Button
            variant="outline"
            className="mt-3"
            disabled={add.isPending || !title.trim() || !url.trim()}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Sharing…" : "Share link"}
          </Button>
        </div>
      </div>

      <div className="panel space-y-3 rounded-xl p-6">
        <h2 className="section-title text-lg">Your videos</h2>
        {mine.length === 0 ? (
          <EmptyState title="Nothing yet" copy="Clips you share will be listed here." />
        ) : (
          <VideoList
            videos={mine}
            removing={remove.isPending}
            onRemove={(v) => remove.mutate({ id: v.id, storage_path: v.storage_path })}
          />
        )}
      </div>
    </div>
  );
}

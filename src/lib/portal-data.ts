import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PlayerStatRow = Database["public"]["Tables"]["player_stats"]["Row"];

type EventRow = Database["public"]["Tables"]["events"]["Row"];

/**
 * The same game often arrives from two places (GameChanger and FiveTool), so it
 * would otherwise be listed twice. Games starting at the same moment are treated
 * as one: GameChanger is the preferred source; FiveTool or Perfect Game rows act
 * as a backup and only fill in fields the GameChanger row doesn't carry.
 */
export type PortalEvent = EventRow & { alias_ids: string[] };

export function dedupeEvents(rows: EventRow[]): PortalEvent[] {
  const games = rows.filter((e) => e.event_type === "game");
  const rest = rows.filter((e) => e.event_type !== "game");
  const merged = [...new Set(games.map((g) => g.starts_at))].map((when) => {
    const same = games.filter((g) => g.starts_at === when);
    const best =
      same.find((g) => g.source === "gamechanger") ??
      same.find((g) => g.result) ??
      same[0]!;
    const pick = <K extends keyof EventRow>(key: K) =>
      (best[key] ?? same.find((g) => g[key] !== null && g[key] !== "")?.[key] ?? null) as
        EventRow[K];
    return {
      ...best,
      opponent: pick("opponent"),
      location: pick("location"),
      notes: pick("notes"),
      link_url: pick("link_url"),
      event_name: pick("event_name"),
      result: pick("result"),
      score_us: pick("score_us"),
      score_them: pick("score_them"),
      alias_ids: same.filter((g) => g.id !== best.id).map((g) => g.id),
    };
  });
  return [...merged, ...rest.map((e) => ({ ...e, alias_ids: [] as string[] }))].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
}

/** Every id a game was known by, so photos filed under a duplicate still show. */
export function eventIdsOf(event: { id: string; alias_ids?: string[] } | undefined) {
  return event ? [event.id, ...(event.alias_ids ?? [])] : [];
}

/** Finds a game by any of the ids it was known by. */
export function findEventByAnyId<T extends { id: string; alias_ids?: string[] }>(
  events: T[],
  id: string,
) {
  return events.find((e) => e.id === id || (e.alias_ids ?? []).includes(id));
}

/** Lookup keyed by every id a game was known by. */
export function eventsByAnyId<T extends { id: string; alias_ids?: string[] }>(events: T[]) {
  const map = new Map<string, T>();
  for (const e of events) for (const id of eventIdsOf(e)) map.set(id, e);
  return map;
}

/** Adds up a per-event tally across all the ids a game was known by. */
export function tallyFor(
  counts: Map<string, number>,
  event: { id: string; alias_ids?: string[] },
) {
  return eventIdsOf(event).reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
}

export const eventsQuery = queryOptions({
  queryKey: ["events"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("starts_at", { ascending: true });
    if (error) throw error;
    return dedupeEvents(data ?? []);
  },
});

// ---------------------------------------------------------------------------
// Direct-from-storage picture links
//
// Pictures used to be streamed one by one through our own server, which made
// the galleries crawl. Instead we ask the file store once for a batch of links
// and let the browser fetch every picture straight from it.
// ---------------------------------------------------------------------------

const API_PHOTO_ID = /\/api\/album-photo\?id=([0-9a-fA-F-]{36})/;
const PHOTO_LINK_TTL = 60 * 60 * 24 * 7;

async function signTeamPhotoPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data } = await supabase.storage
      .from("team-photos")
      .createSignedUrls(chunk, PHOTO_LINK_TTL);
    for (const s of data ?? []) {
      if (s.signedUrl && !s.error && s.path) out.set(s.path, s.signedUrl);
    }
  }
  return out;
}

/** Maps "/api/album-photo?id=…" links onto direct storage links. */
async function directPhotoUrls(
  urls: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>(); // original url -> thumbnail path
  for (const u of urls) {
    const m = u?.match(API_PHOTO_ID);
    if (u && m) wanted.set(u, `thumbs/${m[1]}.jpg`);
  }
  if (wanted.size === 0) return new Map();
  const signed = await signTeamPhotoPaths([...wanted.values()]);
  const map = new Map<string, string>();
  for (const [url, path] of wanted) {
    const direct = signed.get(path);
    if (direct) map.set(url, direct);
  }
  return map;
}

/** Replaces one URL field on each row with a direct storage link. */
async function rewritePhotoField<T extends Record<string, unknown>>(
  rows: T[],
  field: keyof T,
): Promise<T[]> {
  const map = await directPhotoUrls(rows.map((r) => r[field] as string | null));
  if (map.size === 0) return rows;
  return rows.map((r) => {
    const v = r[field] as string | null;
    const direct = v ? map.get(v) : undefined;
    return direct ? ({ ...r, [field]: direct } as T) : r;
  });
}

type AlbumPhotoRow = Database["public"]["Tables"]["album_photos"]["Row"];

export type GalleryAlbumPhoto = AlbumPhotoRow & {
  /** Full-size picture link, straight from storage when we host the file. */
  full_url: string;
};

/** Album photo rows with grid thumbnails and full-size links served directly. */
async function withPhotoLinks(rows: AlbumPhotoRow[]): Promise<GalleryAlbumPhoto[]> {
  const paths: string[] = [];
  for (const r of rows) {
    if (r.storage_path) paths.push(`thumbs/${r.id}.jpg`, r.storage_path);
  }
  const signed = await signTeamPhotoPaths(paths);
  return rows.map((r) => ({
    ...r,
    thumbnail_url:
      (r.storage_path ? signed.get(`thumbs/${r.id}.jpg`) : null) ?? r.thumbnail_url,
    full_url:
      (r.storage_path ? signed.get(r.storage_path) : null) ?? `/api/album-photo?id=${r.id}`,
  }));
}



export const playersQuery = queryOptions({
  queryKey: ["players"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return rewritePhotoField(data ?? [], "photo_url");
  },

});

export const playerStatsQuery = queryOptions({
  queryKey: ["player_stats"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("player_stats")
      .select("*")
      .order("player_name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
});

/** GameChanger box scores: one line score per game. */
export const gameLineScoresQuery = queryOptions({
  queryKey: ["team_stats", "line_score"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("team_stats")
      .select("id,event_id,category,season,source,stats")
      .eq("category", "line_score");
    if (error) throw error;
    return data ?? [];
  },
});


export const mediaQuery = queryOptions({
  queryKey: ["media_items"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("media_items")
      .select("*")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});

export type TeamVideo = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  source: string;
  media_url: string;
  storage_path: string | null;
  mime_type: string | null;
  thumbnail_url: string | null;
  event_id: string | null;
  submitted_by: string | null;
  published_at: string | null;
  created_at: string;
  /** Playable link: a signed link for videos hosted here, otherwise the original link. */
  url: string | null;
  hosted: boolean;
};

/** Every team video, with hosted files turned into playable links. */
export const teamVideosQuery = queryOptions({
  queryKey: ["media_items", "playable"],
  queryFn: async (): Promise<TeamVideo[]> => {
    const { data, error } = await supabase
      .from("media_items")
      .select("*")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data ?? [];
    const paths = rows
      .map((r) => r.storage_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    let byPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("team-videos")
        .createSignedUrls(paths, 60 * 60);
      byPath = new Map(
        (signed ?? []).map((s) => [s.path ?? "", s.signedUrl] as [string, string]),
      );
    }
    return rows.map((r) => ({
      ...r,
      url: r.storage_path ? (byPath.get(r.storage_path) ?? null) : r.media_url,
      hosted: Boolean(r.storage_path),
    })) as TeamVideo[];
  },
});



export const albumsQuery = queryOptions({
  queryKey: ["albums"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("albums")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rewritePhotoField(data ?? [], "cover_url");
  },
});

export const latestAlbumPhotosQuery = queryOptions({
  queryKey: ["album_photos", "latest_album"],
  queryFn: async () => {
    const { data: albums, error: aErr } = await supabase
      .from("albums")
      .select("id, title")
      .neq("title", "Parents album")
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (aErr) throw aErr;
    const album = albums?.[0];
    if (!album) return null;
    const { data: photos, error: pErr } = await supabase
      .from("album_photos")
      .select("id, name, thumbnail_url")
      .eq("album_id", album.id)
      .order("created_time", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (pErr) throw pErr;
    const withUrl = await rewritePhotoField(
      (photos ?? []).filter((p) => p.thumbnail_url),
      "thumbnail_url",
    );
    return withUrl.length > 0
      ? { album_title: album.title, photos: withUrl }
      : null;
  },
  refetchInterval: 30_000,
});

export const albumPhotosQuery = (albumId: string) =>
  queryOptions({
    queryKey: ["album_photos", albumId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("album_photos")
        .select("*")
        .eq("album_id", albumId)
        .order("created_time", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return withPhotoLinks(data ?? []);
    },
  });

/** Album photos taken at one game, oldest first. */
export const eventAlbumPhotosQuery = (eventIds: string[]) =>
  queryOptions({
    queryKey: ["album_photos", "event", [...eventIds].sort().join(",")],
    enabled: eventIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("album_photos")
        .select("*")
        .in("event_id", eventIds)
        .order("created_time", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return withPhotoLinks(data ?? []);
    },
  });

/** Which game each album photo belongs to, for counting photos per game. */
export const albumPhotoGameLinksQuery = queryOptions({
  queryKey: ["album_photos", "game_links"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("album_photos")
      .select("id, event_id, thumbnail_url")
      .not("event_id", "is", null)
      .limit(2000);
    if (error) throw error;
    const rows = data ?? [];
    // Only pictures actually shown here get links: one cover per game, plus a
    // handful of recent shots the home page uses for its collage.
    const covers = new Set<string>();
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.event_id || seen.has(r.event_id) || !r.thumbnail_url) continue;
      seen.add(r.event_id);
      covers.add(r.thumbnail_url);
    }
    for (const r of rows.slice(-40)) {
      if (r.thumbnail_url) covers.add(r.thumbnail_url);
    }
    const map = await directPhotoUrls([...covers]);
    return rows.map((r) =>
      r.thumbnail_url && map.has(r.thumbnail_url)
        ? { ...r, thumbnail_url: map.get(r.thumbnail_url)! }
        : r,
    );
  },
});


export const sourceConfigsQuery = queryOptions({
  queryKey: ["source_configs"],
  queryFn: async () => {
    const { data, error } = await supabase.from("source_configs").select("*").order("source");
    if (error) throw error;
    return data ?? [];
  },
});

export const invitesQuery = queryOptions({
  queryKey: ["invites"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("invites")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});

export const stagedQuery = queryOptions({
  queryKey: ["staged_records"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("staged_records")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});

export const pulledItemsQuery = queryOptions({
  queryKey: ["staged_records", "published"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("staged_records")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw error;
    return data ?? [];
  },
});

export const syncRunsQuery = queryOptions({
  queryKey: ["sync_runs"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    return data ?? [];
  },
});

export function formatEventDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const SOURCE_LABEL: Record<string, string> = {
  manual: "Entered by hand",
  gamechanger: "GameChanger",
  fivetools: "FiveTool",
  perfect_game: "Perfect Game",
  google_drive: "Google Drive",
};

export type SharedPhoto = {
  id: string;
  storage_path: string;
  caption: string | null;
  created_at: string;
  uploaded_by: string;
  event_id: string | null;
  album_id: string | null;
  url: string | null;
};

const UPLOAD_COLUMNS =
  "id, storage_path, caption, created_at, uploaded_by, event_id, album_id";


async function signPhotos(
  rows: {
    id: string;
    storage_path: string;
    caption: string | null;
    created_at: string;
    uploaded_by: string;
    event_id: string | null;
    album_id: string | null;
  }[],
): Promise<SharedPhoto[]> {
  if (rows.length === 0) return [];
  const { data } = await supabase.storage
    .from("team-photos")
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60);
  const byPath = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  return rows.map((r) => ({ ...r, url: byPath.get(r.storage_path) ?? null }));
}

export const sharedPhotosQuery = queryOptions({
  queryKey: ["photo_uploads", "all"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("photo_uploads")
      .select(UPLOAD_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return signPhotos(data ?? []);
  },
});

export const myPhotoUploadsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["photo_uploads", "mine", userId ?? "anon"],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photo_uploads")
        .select(UPLOAD_COLUMNS)
        .eq("uploaded_by", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return signPhotos(data ?? []);
    },
  });

/** All album photos for a set of albums, used for season and game galleries. */
export const albumPhotosForAlbumsQuery = (albumIds: string[]) =>
  queryOptions({
    queryKey: ["album_photos", "many", [...albumIds].sort().join(",")],
    enabled: albumIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("album_photos")
        .select("*")
        .in("album_id", albumIds)
        .order("created_time", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return withPhotoLinks(data ?? []);
    },
  });


export const myStatsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["player_stats", "mine", userId ?? "anon"],
    enabled: Boolean(userId),
    queryFn: async (): Promise<PlayerStatRow[]> => {
      const { data, error } = await supabase
        .from("player_stats")
        .select("*")
        .eq("submitted_by", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });


export type PhotoTag = {
  id: string;
  player_id: string;
  album_photo_id: string | null;
  photo_upload_id: string | null;
  jersey_number: string | null;
  method: string;
  confidence: number | null;
  created_by: string | null;
  players: { name: string; jersey_number: string | null } | null;
};

/** Every player tag on every photo, used by the photo viewer. */
export const photoTagsQuery = queryOptions({
  queryKey: ["photo_tags"],
  queryFn: async (): Promise<PhotoTag[]> => {
    const { data, error } = await supabase
      .from("photo_tags")
      .select(
        "id, player_id, album_photo_id, photo_upload_id, jersey_number, method, confidence, created_by, players(name, jersey_number)",
      )
      .limit(4000);
    if (error) throw error;
    return (data ?? []) as unknown as PhotoTag[];
  },
});

/** Latest tagged album photo per player — used as their roster photo fallback. */
export const playerTagPhotosQuery = queryOptions({
  queryKey: ["player_tag_photos"],
  queryFn: async (): Promise<Map<string, string>> => {
    const { data, error } = await supabase
      .from("photo_tags")
      .select("player_id, created_at, album_photo_id, album_photos(thumbnail_url)")
      .not("album_photo_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(4000);
    if (error) throw error;
    const rows = (data ?? []) as unknown as {
      player_id: string;
      album_photo_id: string | null;
      album_photos: { thumbnail_url: string | null } | null;
    }[];
    // Roster photos only come from photos tagged with exactly one player.
    const tagCount = new Map<string, number>();
    for (const t of rows) {
      if (t.album_photo_id)
        tagCount.set(t.album_photo_id, (tagCount.get(t.album_photo_id) ?? 0) + 1);
    }
    const map = new Map<string, string>();
    for (const t of rows) {
      const url = t.album_photos?.thumbnail_url;
      if (
        url &&
        t.album_photo_id &&
        tagCount.get(t.album_photo_id) === 1 &&
        !map.has(t.player_id)
      )
        map.set(t.player_id, url);
    }
    const direct = await directPhotoUrls([...map.values()]);
    for (const [playerId, url] of map) {
      const d = direct.get(url);
      if (d) map.set(playerId, d);
    }
    return map;
  },
});

export type MemberProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  status: string;
  invited_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export const memberProfilesQuery = queryOptions({
  queryKey: ["profiles"],
  queryFn: async (): Promise<MemberProfile[]> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,status,invited_by,approved_at,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as MemberProfile[];
  },
});

export type PlayerPhoto = {
  id: string;
  url: string | null;
  alt: string;
  caption: string | null;
  kind: "album" | "upload";
  event_id: string | null;
  taken_at: string | null;
};

/** Every photo where this player has been identified, for the player's page. */
export const playerPhotosQuery = (playerId: string | undefined) =>
  queryOptions({
    queryKey: ["player_photos", playerId ?? "none"],
    enabled: Boolean(playerId),
    queryFn: async (): Promise<PlayerPhoto[]> => {
      const { data: tags, error } = await supabase
        .from("photo_tags")
        .select("album_photo_id, photo_upload_id")
        .eq("player_id", playerId!);
      if (error) throw error;
      const albumIds = (tags ?? [])
        .map((t) => t.album_photo_id)
        .filter((v): v is string => Boolean(v));
      const uploadIds = (tags ?? [])
        .map((t) => t.photo_upload_id)
        .filter((v): v is string => Boolean(v));

      const out: PlayerPhoto[] = [];

      if (albumIds.length > 0) {
        const { data, error: e2 } = await supabase
          .from("album_photos")
          .select("id, name, thumbnail_url, event_id, created_time")
          .in("id", albumIds);
        if (e2) throw e2;
        for (const p of await rewritePhotoField(data ?? [], "thumbnail_url")) {
          out.push({
            id: p.id,
            url: p.thumbnail_url,
            alt: p.name ?? "Team photo",
            caption: p.created_time ? formatEventDate(p.created_time) : null,
            kind: "album",
            event_id: p.event_id,
            taken_at: p.created_time,
          });
        }
      }

      if (uploadIds.length > 0) {
        const { data, error: e3 } = await supabase
          .from("photo_uploads")
          .select(UPLOAD_COLUMNS)
          .in("id", uploadIds);
        if (e3) throw e3;
        const signed = await signPhotos(data ?? []);
        for (const p of signed) {
          out.push({
            id: p.id,
            url: p.url,
            alt: p.caption ?? "Photo shared by a team family",
            caption: p.caption,
            kind: "upload",
            event_id: p.event_id,
            taken_at: p.created_at,
          });
        }
      }

      return out;
    },
  });

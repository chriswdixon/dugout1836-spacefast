// Zero capsule schema for Dugout 1836.
//
// Translated from the Supabase Postgres schema (src/integrations/supabase/types.ts).
// See docs/SPACEFAST_MIGRATION.md for the encoding rules. Reminders:
//   - Zero fields are only string() | boolean() | id("table").
//   - Every row auto-gets id, createdAt, updatedAt: do NOT declare them.
//   - Numbers, timestamps, JSON, arrays, and enums are string()-encoded.
//   - id("table") is an UNENFORCED reference (a string). No FKs, no cascades.
//   - Queries are index-only, so declare an index for every access pattern.
//
// NOT YET DEPLOYED. Indexes here cover the known access patterns; add more as
// endpoints are ported (Stage 3).

import { table, string, boolean, id } from "@spacefast/zero/server";

// data_source enum values: "manual" | "gamechanger" | "fivetools" | "perfect_game" | "google_drive"
// app_role enum values:    "admin" | "parent"
// Both stored as string() and validated in code.

export const schema = {
  // ---- Auth (new; no Supabase equivalent carried over) ----
  users: table({
    email: string(),
    passwordHash: string(),
    passwordSalt: string(),
    status: string().default("pending"), // pending | approved
  }).index("by_email", ["email"]),

  sessions: table({
    userId: id("users"),
    tokenHash: string(),
    expiresAt: string(), // ISO 8601
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"]),

  // ---- Profiles / roles (existed in Supabase, tied to auth.users) ----
  // profiles.id was auth.users.id. Here we key profiles by userId instead.
  profiles: table({
    userId: id("users"),
    email: string(),
    fullName: string().default(""),
    status: string().default("pending"), // pending | approved
    approvedAt: string().default(""),
    approvedBy: string().default(""),
    invitedBy: string().default(""),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"]),

  user_roles: table({
    userId: id("users"),
    role: string(), // admin | parent
  }).index("by_userId", ["userId"]),

  invites: table({
    email: string().default(""),
    code: string().default(""),
    label: string().default(""),
    autoApprove: boolean().default(false),
    invitedBy: string().default(""),
    acceptedAt: string().default(""),
  })
    .index("by_email", ["email"])
    .index("by_code", ["code"]),

  // ---- Roster / games / stats ----
  players: table({
    name: string(),
    externalId: string().default(""),
    jerseyNumber: string().default(""),
    positions: string().default(""),
    bats: string().default(""),
    throws: string().default(""),
    gradYear: string().default(""), // number
    photoUrl: string().default(""),
    sortOrder: string().default("0"), // number
    source: string().default("manual"),
  })
    .index("by_sortOrder", ["sortOrder"])
    .index("by_externalId", ["externalId"]),

  events: table({
    title: string().default(""),
    eventName: string().default(""),
    eventType: string(),
    startsAt: string(), // ISO
    source: string().default("manual"),
    externalId: string().default(""),
    opponent: string().default(""),
    location: string().default(""),
    result: string().default(""),
    recap: string().default(""),
    notes: string().default(""),
    linkUrl: string().default(""),
    scoreUs: string().default(""), // number | null
    scoreThem: string().default(""), // number | null
  })
    .index("by_startsAt", ["startsAt"])
    .index("by_source", ["source"])
    .index("by_externalId", ["externalId"]),

  player_stats: table({
    playerId: id("players"),
    playerName: string().default(""),
    category: string(),
    season: string(),
    source: string().default("manual"),
    externalId: string().default(""),
    eventId: id("events"),
    stats: string().default("{}"), // jsonb
    submittedBy: string().default(""),
  })
    .index("by_playerId", ["playerId"])
    .index("by_season", ["season"])
    .index("by_eventId", ["eventId"])
    .index("by_externalId", ["externalId"]),

  team_stats: table({
    category: string(),
    season: string(),
    source: string().default("manual"),
    eventId: id("events"),
    stats: string().default("{}"), // jsonb
  })
    .index("by_season", ["season"])
    .index("by_category", ["category"]),

  // ---- Media / photos ----
  albums: table({
    title: string(),
    description: string().default(""),
    season: string().default(""),
    eventId: id("events"),
    driveFolderId: string().default(""),
    gphotosUrl: string().default(""),
    coverUrl: string().default(""),
    photoCount: string().default("0"), // number
    sortOrder: string().default("0"), // number
    lastSyncedAt: string().default(""),
  })
    .index("by_sortOrder", ["sortOrder"])
    .index("by_season", ["season"])
    .index("by_eventId", ["eventId"])
    .index("by_driveFolderId", ["driveFolderId"]),

  album_photos: table({
    albumId: id("albums"),
    eventId: id("events"),
    driveFileId: string(),
    name: string().default(""),
    mimeType: string().default(""),
    storagePath: string().default(""),
    thumbnailUrl: string().default(""),
    width: string().default(""), // number
    height: string().default(""), // number
    createdTime: string().default(""),
    aiScannedAt: string().default(""),
  })
    .index("by_albumId", ["albumId"])
    .index("by_eventId", ["eventId"])
    .index("by_driveFileId", ["driveFileId"]),

  media_items: table({
    title: string(),
    kind: string(),
    mediaUrl: string(),
    source: string().default("manual"),
    externalId: string().default(""),
    eventId: id("events"),
    description: string().default(""),
    mimeType: string().default(""),
    thumbnailUrl: string().default(""),
    storagePath: string().default(""),
    publishedAt: string().default(""),
    submittedBy: string().default(""),
  })
    .index("by_eventId", ["eventId"])
    .index("by_source", ["source"])
    .index("by_externalId", ["externalId"]),

  photo_tags: table({
    playerId: id("players"),
    albumPhotoId: id("album_photos"),
    photoUploadId: id("photo_uploads"),
    jerseyNumber: string().default(""),
    method: string(),
    confidence: string().default(""), // number
    createdBy: string().default(""),
  })
    .index("by_albumPhotoId", ["albumPhotoId"])
    .index("by_photoUploadId", ["photoUploadId"])
    .index("by_playerId", ["playerId"]),

  photo_uploads: table({
    uploadedBy: id("users"),
    albumId: id("albums"),
    eventId: id("events"),
    storagePath: string(),
    caption: string().default(""),
    mimeType: string().default(""),
    width: string().default(""), // number
    height: string().default(""), // number
    aiScannedAt: string().default(""),
  })
    .index("by_albumId", ["albumId"])
    .index("by_eventId", ["eventId"])
    .index("by_uploadedBy", ["uploadedBy"]),

  // ---- Sync pipeline ----
  source_configs: table({
    source: string(),
    enabled: boolean().default(true),
    url: string().default(""),
    extraUrls: string().default("[]"), // text[]
    teamName: string().default(""),
    notes: string().default(""),
    lastRunAt: string().default(""),
  }).index("by_source", ["source"]),

  sync_runs: table({
    source: string(),
    status: string(),
    startedAt: string(),
    finishedAt: string().default(""),
    itemsFound: string().default("0"), // number
    message: string().default(""),
  })
    .index("by_source", ["source"])
    .index("by_startedAt", ["startedAt"]),

  staged_records: table({
    syncRunId: id("sync_runs"),
    source: string(),
    kind: string(),
    status: string(),
    payload: string().default("{}"), // jsonb
  })
    .index("by_syncRunId", ["syncRunId"])
    .index("by_status", ["status"]),

  // ---- Portal chat ----
  // Chronological listing uses the query builder's order() over the default
  // scan (rows carry createdAt). by_author supports "messages from a user".
  chat_messages: table({
    authorId: id("users"),
    authorName: string().default(""),
    body: string(),
  }).index("by_author", ["authorId"]),
};

export const DATA_SOURCES = ["manual", "gamechanger", "fivetools", "perfect_game", "google_drive"] as const;
export const APP_ROLES = ["admin", "parent"] as const;

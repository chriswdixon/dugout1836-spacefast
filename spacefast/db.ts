// Database access + schema bootstrap for the Dugout 1836 worker.
//
// The Functions worker gets `env.DB`, a D1-shaped binding. IMPORTANT: the
// binding is D1-*shaped* (prepare/bind/first/all/run) but backed by MySQL, not
// SQLite. So the DDL is MySQL: VARCHAR(n) for any keyed/indexed column (MySQL
// rejects TEXT in a key without a length), inline UNIQUE/KEY indexes, TINYINT
// for booleans, and `INSERT IGNORE` (not SQLite's `INSERT OR IGNORE`).
//
// Postgres -> MySQL mapping: uuid -> VARCHAR(36), timestamptz -> VARCHAR(40)
// ISO string, jsonb -> JSON/TEXT, boolean -> TINYINT(1).
//
// Stage 2 declares the auth-related tables. Stage 3 adds the rest of the 15.

// Minimal D1-shaped typings.
export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: unknown;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface Env {
  DB: D1Database;
  STORAGE?: unknown;
  [key: string]: unknown;
}

// Idempotent schema. Stage 2 subset (auth). MySQL dialect, indexes inline.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     email VARCHAR(320) NOT NULL,
     password_hash VARCHAR(128) NOT NULL,
     password_salt VARCHAR(64) NOT NULL,
     status VARCHAR(20) NOT NULL DEFAULT 'pending',
     created_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_users_email (email)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     user_id VARCHAR(36) NOT NULL,
     token_hash VARCHAR(64) NOT NULL,
     expires_at VARCHAR(40) NOT NULL,
     created_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_sessions_token (token_hash),
     KEY idx_sessions_user (user_id)
   )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     user_id VARCHAR(36) NOT NULL,
     token_hash VARCHAR(64) NOT NULL,
     expires_at VARCHAR(40) NOT NULL,
     created_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_pwreset_token (token_hash),
     KEY idx_pwreset_user (user_id)
   )`,

  `CREATE TABLE IF NOT EXISTS profiles (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     user_id VARCHAR(36) NOT NULL,
     email VARCHAR(320),
     full_name VARCHAR(200),
     status VARCHAR(20) NOT NULL DEFAULT 'pending',
     approved_at VARCHAR(40),
     approved_by VARCHAR(36),
     invited_by VARCHAR(36),
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_profiles_user (user_id)
   )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     user_id VARCHAR(36) NOT NULL,
     role VARCHAR(20) NOT NULL,
     created_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_user_roles_user_role (user_id, role)
   )`,
  `CREATE TABLE IF NOT EXISTS invites (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     email VARCHAR(320),
     code VARCHAR(40),
     label VARCHAR(200),
     auto_approve TINYINT(1) NOT NULL DEFAULT 0,
     invited_by VARCHAR(36),
     accepted_at VARCHAR(40),
     created_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_invites_code (code),
     KEY idx_invites_email (email)
   )`,

  // ---- roster / games / stats ----
  `CREATE TABLE IF NOT EXISTS players (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     name VARCHAR(200) NOT NULL,
     external_id VARCHAR(200),
     jersey_number VARCHAR(20),
     positions VARCHAR(200),
     bats VARCHAR(20),
     throws VARCHAR(20),
     grad_year INT,
     photo_url TEXT,
     sort_order INT NOT NULL DEFAULT 0,
     source VARCHAR(30) NOT NULL DEFAULT 'manual',
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL,
     KEY idx_players_sort (sort_order),
     KEY idx_players_ext (external_id)
   )`,
  `CREATE TABLE IF NOT EXISTS events (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     title VARCHAR(300),
     event_name VARCHAR(300),
     event_type VARCHAR(40) NOT NULL,
     starts_at VARCHAR(40) NOT NULL,
     source VARCHAR(30) NOT NULL DEFAULT 'manual',
     external_id VARCHAR(200),
     opponent VARCHAR(200),
     location VARCHAR(300),
     result VARCHAR(20),
     recap TEXT,
     notes TEXT,
     link_url TEXT,
     score_us INT,
     score_them INT,
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL,
     KEY idx_events_starts (starts_at),
     KEY idx_events_source (source),
     UNIQUE KEY idx_events_src_ext (source, external_id)
   )`,
  `CREATE TABLE IF NOT EXISTS player_stats (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     player_id VARCHAR(36),
     player_name VARCHAR(200),
     category VARCHAR(40) NOT NULL,
     season VARCHAR(40) NOT NULL,
     source VARCHAR(30) NOT NULL DEFAULT 'manual',
     external_id VARCHAR(200),
     event_id VARCHAR(36),
     stats TEXT,
     submitted_by VARCHAR(36),
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL,
     KEY idx_pstats_player (player_id),
     KEY idx_pstats_season (season),
     KEY idx_pstats_event (event_id),
     UNIQUE KEY idx_pstats_src_ext (source, external_id)
   )`,
  `CREATE TABLE IF NOT EXISTS team_stats (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     category VARCHAR(40) NOT NULL,
     season VARCHAR(40) NOT NULL,
     source VARCHAR(30) NOT NULL DEFAULT 'manual',
     event_id VARCHAR(36),
     stats TEXT,
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL,
     KEY idx_tstats_season (season)
   )`,

  // ---- media / photos ----
  `CREATE TABLE IF NOT EXISTS albums (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     title VARCHAR(300) NOT NULL,
     description TEXT,
     season VARCHAR(40),
     event_id VARCHAR(36),
     drive_folder_id VARCHAR(200),
     gphotos_url TEXT,
     cover_url TEXT,
     photo_count INT NOT NULL DEFAULT 0,
     sort_order INT NOT NULL DEFAULT 0,
     last_synced_at VARCHAR(40),
     created_at VARCHAR(40) NOT NULL,
     KEY idx_albums_sort (sort_order),
     KEY idx_albums_event (event_id),
     KEY idx_albums_drive (drive_folder_id)
   )`,
  `CREATE TABLE IF NOT EXISTS album_photos (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     album_id VARCHAR(36) NOT NULL,
     event_id VARCHAR(36),
     drive_file_id VARCHAR(200) NOT NULL,
     name VARCHAR(300),
     mime_type VARCHAR(100),
     storage_path TEXT,
     thumbnail_url TEXT,
     width INT,
     height INT,
     created_time VARCHAR(40),
     ai_scanned_at VARCHAR(40),
     created_at VARCHAR(40) NOT NULL,
     KEY idx_aphotos_album (album_id),
     KEY idx_aphotos_event (event_id),
     KEY idx_aphotos_drive (drive_file_id)
   )`,
  `CREATE TABLE IF NOT EXISTS media_items (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     title VARCHAR(300) NOT NULL,
     kind VARCHAR(40) NOT NULL,
     media_url TEXT NOT NULL,
     source VARCHAR(30) NOT NULL DEFAULT 'manual',
     external_id VARCHAR(200),
     event_id VARCHAR(36),
     description TEXT,
     mime_type VARCHAR(100),
     thumbnail_url TEXT,
     storage_path TEXT,
     published_at VARCHAR(40),
     submitted_by VARCHAR(36),
     created_at VARCHAR(40) NOT NULL,
     KEY idx_media_event (event_id),
     KEY idx_media_source (source)
   )`,
  `CREATE TABLE IF NOT EXISTS photo_tags (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     player_id VARCHAR(36) NOT NULL,
     album_photo_id VARCHAR(36),
     photo_upload_id VARCHAR(36),
     jersey_number VARCHAR(20),
     method VARCHAR(30) NOT NULL,
     confidence FLOAT,
     created_by VARCHAR(36),
     created_at VARCHAR(40) NOT NULL,
     updated_at VARCHAR(40) NOT NULL,
     KEY idx_ptags_aphoto (album_photo_id),
     KEY idx_ptags_upload (photo_upload_id),
     KEY idx_ptags_player (player_id)
   )`,
  `CREATE TABLE IF NOT EXISTS photo_uploads (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     uploaded_by VARCHAR(36) NOT NULL,
     album_id VARCHAR(36),
     event_id VARCHAR(36),
     storage_path TEXT NOT NULL,
     caption TEXT,
     mime_type VARCHAR(100),
     width INT,
     height INT,
     ai_scanned_at VARCHAR(40),
     created_at VARCHAR(40) NOT NULL,
     KEY idx_uploads_album (album_id),
     KEY idx_uploads_event (event_id),
     KEY idx_uploads_user (uploaded_by)
   )`,

  // ---- sync pipeline ----
  `CREATE TABLE IF NOT EXISTS source_configs (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     source VARCHAR(30) NOT NULL,
     enabled TINYINT(1) NOT NULL DEFAULT 1,
     url TEXT,
     extra_urls TEXT,
     team_name VARCHAR(200),
     notes TEXT,
     last_run_at VARCHAR(40),
     updated_at VARCHAR(40) NOT NULL,
     UNIQUE KEY idx_srccfg_source (source)
   )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     source VARCHAR(30) NOT NULL,
     status VARCHAR(30) NOT NULL,
     started_at VARCHAR(40) NOT NULL,
     finished_at VARCHAR(40),
     items_found INT NOT NULL DEFAULT 0,
     message TEXT,
     KEY idx_syncruns_source (source),
     KEY idx_syncruns_started (started_at)
   )`,
  `CREATE TABLE IF NOT EXISTS staged_records (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     sync_run_id VARCHAR(36),
     source VARCHAR(30) NOT NULL,
     kind VARCHAR(40) NOT NULL,
     status VARCHAR(30) NOT NULL,
     payload TEXT,
     created_at VARCHAR(40) NOT NULL,
     KEY idx_staged_run (sync_run_id),
     KEY idx_staged_status (status)
   )`,

  // ---- portal chat ----
  `CREATE TABLE IF NOT EXISTS chat_messages (
     id VARCHAR(36) NOT NULL PRIMARY KEY,
     author_id VARCHAR(36) NOT NULL,
     author_name VARCHAR(200),
     body TEXT NOT NULL,
     created_at VARCHAR(40) NOT NULL,
     KEY idx_chat_created (created_at)
   )`,
];

// Additive migrations for tables that predate a schema change. Each is
// attempted after the CREATEs; "already applied" errors (e.g. duplicate key
// name) are swallowed so this stays idempotent. New/fresh tables already carry
// these via their CREATE, so the ALTER simply no-ops with an ignored error.
const MIGRATIONS: string[] = [
  "ALTER TABLE events ADD UNIQUE KEY idx_events_src_ext (source, external_id)",
  "ALTER TABLE player_stats ADD UNIQUE KEY idx_pstats_src_ext (source, external_id)",
  "ALTER TABLE team_stats ADD UNIQUE KEY idx_tstats_event_cat (event_id, category)",
];

let schemaReady: Promise<void> | null = null;

// Bootstrap the schema once per isolate. There is no server-side "migrate on
// publish" for Functions, so we create idempotently on first DB use.
export function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA) {
        await db.prepare(stmt).run();
      }
      for (const stmt of MIGRATIONS) {
        try {
          await db.prepare(stmt).run();
        } catch {
          // already applied (duplicate key / column) — ignore
        }
      }
    })().catch((e) => {
      schemaReady = null; // let a transient failure retry next request
      throw e;
    });
  }
  return schemaReady;
}

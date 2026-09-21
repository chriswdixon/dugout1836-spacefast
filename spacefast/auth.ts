// Custom email/password auth for the Dugout 1836 worker.
//
// Zero could not do this (no crypto). The Functions runtime is a Cloudflare
// Worker, so we have real WebCrypto: PBKDF2 password hashing + CSPRNG session
// tokens. Every request is authorized in handler code (there is no RLS).

import type { D1Database, Env } from "./db";
import { ensureSchema } from "./db";
import { badRequest, forbidden, getBearer, json, ok, readJson, unauthorized } from "./http";

// ---------- crypto ----------
const PBKDF2_ITERS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toHex(bits);
}
export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt.buffer), hash: await derive(password, salt) };
}
export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const computed = await derive(password, fromHex(saltHex));
  return constantTimeEqual(computed, hashHex);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(digest);
}
function randomToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

// ---------- rows ----------
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  status: string;
  created_at: string;
}
export interface Identity {
  user: { id: string; email: string; status: string };
  profile: { status: string; fullName: string | null } | null;
  roles: string[];
}

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();

// ---------- sessions ----------
async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uuid(), userId, tokenHash, expiresAt, nowIso())
    .run();
  return token;
}

export async function currentUser(req: Request, db: D1Database): Promise<UserRow | null> {
  const token = getBearer(req);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ user_id: string; expires_at: string }>();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first<UserRow>();
}

async function rolesFor(db: D1Database, userId: string): Promise<string[]> {
  const res = await db.prepare("SELECT role FROM user_roles WHERE user_id = ?").bind(userId).all<{ role: string }>();
  return (res.results ?? []).map((r) => r.role);
}
async function isAdmin(db: D1Database, userId: string): Promise<boolean> {
  return (await rolesFor(db, userId)).includes("admin");
}

// ---------- guards ----------
export async function requireUser(req: Request, db: D1Database): Promise<UserRow | Response> {
  const user = await currentUser(req, db);
  return user ?? unauthorized();
}
export async function requireAdmin(req: Request, db: D1Database): Promise<UserRow | Response> {
  const user = await currentUser(req, db);
  if (!user) return unauthorized();
  if (!(await isAdmin(db, user.id))) return forbidden("admin only");
  return user;
}
const isResponse = (v: unknown): v is Response => v instanceof Response;

// Shared auth context for the data layer.
export interface AuthCtx {
  user: UserRow;
  roles: string[];
  isAdmin: boolean;
  isApproved: boolean; // approved member (or admin)
}
export async function getAuthContext(req: Request, db: D1Database): Promise<AuthCtx | null> {
  const user = await currentUser(req, db);
  if (!user) return null;
  const roles = await rolesFor(db, user.id);
  const isAdmin = roles.includes("admin");
  return { user, roles, isAdmin, isApproved: user.status === "approved" || isAdmin };
}

async function identity(db: D1Database, user: UserRow): Promise<Identity> {
  const profile = await db
    .prepare("SELECT status, full_name FROM profiles WHERE user_id = ?")
    .bind(user.id)
    .first<{ status: string; full_name: string | null }>();
  return {
    user: { id: user.id, email: user.email, status: user.status },
    profile: profile ? { status: profile.status, fullName: profile.full_name } : null,
    roles: await rolesFor(db, user.id),
  };
}

// ---------- endpoint handlers ----------
export async function handleSignup(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const body = await readJson<{ email?: string; password?: string; code?: string; fullName?: string }>(req);
  if (!body) return badRequest("invalid json");
  const email = normEmail(body.email);
  const password = String(body.password ?? "");
  if (!email || !email.includes("@")) return badRequest("valid email required");
  if (password.length < 8) return badRequest("password must be at least 8 characters");

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "an account with that email already exists" }, { status: 409 });

  // Invite gate: a matching invite (by code or by email) approves immediately;
  // otherwise the account is created pending admin approval.
  const code = String(body.code ?? "").trim();
  const invite = code
    ? await env.DB.prepare("SELECT * FROM invites WHERE code = ? AND accepted_at IS NULL").bind(code).first<Record<string, unknown>>()
    : await env.DB.prepare("SELECT * FROM invites WHERE email = ? AND accepted_at IS NULL").bind(email).first<Record<string, unknown>>();
  const approved = !!invite;
  const status = approved ? "approved" : "pending";

  const userId = uuid();
  const { salt, hash } = await hashPassword(password);
  const ts = nowIso();
  await env.DB
    .prepare("INSERT INTO users (id, email, password_hash, password_salt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, email, hash, salt, status, ts)
    .run();
  await env.DB
    .prepare(
      "INSERT INTO profiles (id, user_id, email, full_name, status, approved_at, invited_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uuid(), userId, email, body.fullName ?? null, status, approved ? ts : null, invite?.["invited_by"] ?? null, ts, ts)
    .run();
  await env.DB
    .prepare("INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .bind(uuid(), userId, "parent", ts)
    .run();
  if (invite) {
    await env.DB.prepare("UPDATE invites SET accepted_at = ? WHERE id = ?").bind(ts, invite["id"]).run();
  }

  // Seed admins: any email in the ADMIN_EMAILS env list is auto-approved and
  // granted the admin role on signup (so the owner just signs up).
  const adminEmails = String(env.ADMIN_EMAILS ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (adminEmails.includes(email)) {
    await env.DB.prepare("UPDATE users SET status = 'approved' WHERE id = ?").bind(userId).run();
    await env.DB.prepare("UPDATE profiles SET status = 'approved', approved_at = ? WHERE user_id = ?").bind(ts, userId).run();
    await env.DB.prepare("INSERT IGNORE INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)").bind(uuid(), userId, ts).run();
  }

  const token = await createSession(env.DB, userId);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  return json({ token, ...(await identity(env.DB, user!)) }, { status: 201 });
}

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const body = await readJson<{ email?: string; password?: string }>(req);
  if (!body) return badRequest("invalid json");
  const email = normEmail(body.email);
  const password = String(body.password ?? "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  // Always run a hash to keep timing uniform whether or not the user exists.
  const okPass = user
    ? await verifyPassword(password, user.password_salt, user.password_hash)
    : (await hashPassword(password), false);
  if (!user || !okPass) return unauthorized("invalid email or password");
  const token = await createSession(env.DB, user.id);
  return json({ token, ...(await identity(env.DB, user)) });
}

export async function handleLogout(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const token = getBearer(req);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  return json({ ok: true });
}

export async function handleSession(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const user = await currentUser(req, env.DB);
  if (!user) return ok({ user: null });
  return ok(await identity(env.DB, user));
}

// Seed the first admin. Gated by a secret set with `sf env set ADMIN_BOOTSTRAP_TOKEN`.
export async function handleAdminBootstrap(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const secret = String(env.ADMIN_BOOTSTRAP_TOKEN ?? "");
  const provided = req.headers.get("x-bootstrap-token") ?? "";
  if (!secret || provided !== secret) return forbidden();
  const body = await readJson<{ email?: string }>(req);
  const email = normEmail(body?.email);
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  if (!user) return json({ error: "no user with that email" }, { status: 404 });
  const ts = nowIso();
  await env.DB.prepare("UPDATE users SET status = 'approved' WHERE id = ?").bind(user.id).run();
  await env.DB.prepare("UPDATE profiles SET status = 'approved', approved_at = ? WHERE user_id = ?").bind(ts, user.id).run();
  await env.DB
    .prepare("INSERT IGNORE INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)")
    .bind(uuid(), user.id, ts)
    .run();
  return ok({ ok: true, email, promoted: "admin" });
}

// Admin creates an invite (email allowlist / code). requireAdmin.
export async function handleCreateInvite(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const admin = await requireAdmin(req, env.DB);
  if (isResponse(admin)) return admin;
  const body = await readJson<{ email?: string; label?: string; autoApprove?: boolean }>(req);
  const email = body?.email ? normEmail(body.email) : null;
  const code = randomToken().slice(0, 12);
  const ts = nowIso();
  await env.DB
    .prepare("INSERT INTO invites (id, email, code, label, auto_approve, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(uuid(), email, code, body?.label ?? null, body?.autoApprove ? 1 : 0, admin.id, ts)
    .run();
  return json({ code, email }, { status: 201 });
}

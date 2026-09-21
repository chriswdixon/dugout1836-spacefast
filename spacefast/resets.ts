// Password reset. Token-based; two delivery paths:
//  - admin generates a reset link (keyless) and shares it, and/or
//  - self-serve email when RESEND_API_KEY + RESET_FROM_EMAIL are configured.

import type { Env } from "./db";
import { ensureSchema } from "./db";
import { getAuthContext } from "./auth";
import { json, badRequest, forbidden, unauthorized } from "./http";

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const norm = (e: unknown) => String(e ?? "").trim().toLowerCase();

function toHex(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randomToken() { return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer); }
async function sha256Hex(s: string) { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function pbkdf2(password: string, salt: Uint8Array) {
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, km, 256));
}

async function createResetToken(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uuid(), userId, await sha256Hex(token), expiresAt, nowIso()).run();
  return token;
}

function resetLink(req: Request, token: string): string {
  return `${new URL(req.url).origin}/reset-password?token=${token}`;
}

async function sendResetEmail(env: Env, to: string, link: string): Promise<boolean> {
  const key = env.RESEND_API_KEY as string | undefined;
  const from = env.RESET_FROM_EMAIL as string | undefined;
  if (!key || !from) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to, subject: "Reset your Dugout 1836 password",
      html: `<p>Tap to set a new password:</p><p><a href="${link}">${link}</a></p><p>This link expires in an hour. If you did not ask for it, ignore this email.</p>`,
    }),
  });
  return res.ok;
}

// POST /api/auth/reset-request { email } — always 200 (no account enumeration).
export async function handleResetRequest(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const body = await req.json().catch(() => null) as { email?: string } | null;
  const email = norm(body?.email);
  const user = email ? await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>() : null;
  if (user) {
    const token = await createResetToken(env, user.id);
    await sendResetEmail(env, email, resetLink(req, token));
  }
  return json({ ok: true, message: "If that email has an account, a reset link is on its way. If email isn't set up, ask a coach to send you a link." });
}

// POST /api/auth/reset-confirm { token, password }
export async function handleResetConfirm(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const body = await req.json().catch(() => null) as { token?: string; password?: string } | null;
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");
  if (!token || password.length < 8) return badRequest("a token and an 8+ character password are required");
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?").bind(await sha256Hex(token)).first<{ user_id: string; expires_at: string }>();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return json({ error: "That reset link is invalid or has expired." }, { status: 400 });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, toHex(salt.buffer), row.user_id).run();
  await env.DB.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(row.user_id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id).run();
  return json({ ok: true });
}

// POST /api/admin/reset-user { email } — admin generates a shareable reset link.
export async function handleAdminResetUser(req: Request, env: Env): Promise<Response> {
  await ensureSchema(env.DB);
  const ctx = await getAuthContext(req, env.DB);
  if (!ctx) return unauthorized();
  if (!ctx.isAdmin) return forbidden("admin only");
  const body = await req.json().catch(() => null) as { email?: string } | null;
  const email = norm(body?.email);
  const user = email ? await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>() : null;
  if (!user) return json({ error: "no user with that email" }, { status: 404 });
  const token = await createResetToken(env, user.id);
  const link = resetLink(req, token);
  await sendResetEmail(env, email, link);
  return json({ ok: true, email, resetLink: link, expiresInMinutes: 60 });
}

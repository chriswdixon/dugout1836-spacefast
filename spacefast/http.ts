// Small HTTP helpers for the worker.

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const ok = (data: unknown) => json(data, { status: 200 });
export const badRequest = (message: string) => json({ error: message }, { status: 400 });
export const unauthorized = (message = "unauthorized") => json({ error: message }, { status: 401 });
export const forbidden = (message = "forbidden") => json({ error: message }, { status: 403 });
export const serverError = (message = "internal_error") => json({ error: message }, { status: 500 });

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// Session transport is a bearer token, not a cookie: the Automattic CDN in
// front of the worker strips Set-Cookie from responses, so cookies never reach
// the client. The SPA stores the token and sends it as `Authorization: Bearer`.
// (The space access gate uses a different header, `x-sf-authorization`, so the
// standard Authorization header is ours to use.)
export function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const COOKIE_NAME = "sf_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}
export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
export const SESSION_COOKIE = COOKIE_NAME;

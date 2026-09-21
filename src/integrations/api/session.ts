// Client session store. Replaces Supabase's session + onAuthStateChange.
//
// The token lives in localStorage (the CDN strips Set-Cookie, so cookies are
// out). A tiny subscribable store stands in for onAuthStateChange.

export interface SessionUser {
  id: string;
  email: string;
  status: string;
}
export interface SessionProfile {
  status: string;
  fullName: string | null;
}
export interface Session {
  token: string;
  user: SessionUser;
  profile: SessionProfile | null;
  roles: string[];
}

const KEY = "dugout.auth";
let cached: Session | null | undefined;
const listeners = new Set<() => void>();

function read(): Session | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function getSession(): Session | null {
  return read();
}
export function getToken(): string | null {
  return read()?.token ?? null;
}
export function setSession(s: Session | null): void {
  cached = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode / disabled storage */
  }
  for (const cb of listeners) cb();
}
export function clearSession(): void {
  setSession(null);
}
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

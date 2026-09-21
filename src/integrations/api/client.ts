// Thin API client for the Spacefast worker. Same-origin by default (the SPA is
// served by the same space as the worker), so paths are relative.

import { getToken } from "./session";

const BASE = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "";

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(
      (body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null) ??
        `HTTP ${res.status}`,
    ) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

// ---- data helpers ----
export interface DataQuery {
  [key: string]: string | number | undefined;
}
export function listRows<T = Record<string, unknown>>(table: string, query?: DataQuery): Promise<T[]> {
  const qs = query
    ? "?" +
      Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return apiFetch<T[]>(`/api/data/${table}${qs}`);
}
export const getRow = <T = Record<string, unknown>>(table: string, id: string) =>
  apiFetch<T>(`/api/data/${table}/${encodeURIComponent(id)}`);
export const createRow = <T = Record<string, unknown>>(table: string, data: unknown) =>
  apiFetch<T>(`/api/data/${table}`, { method: "POST", body: JSON.stringify(data) });
export const updateRow = <T = Record<string, unknown>>(table: string, id: string, data: unknown) =>
  apiFetch<T>(`/api/data/${table}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteRow = (table: string, id: string) =>
  apiFetch(`/api/data/${table}/${encodeURIComponent(id)}`, { method: "DELETE" });

// ---- auth helpers ----
export interface AuthResult {
  token: string;
  user: { id: string; email: string; status: string };
  profile: { status: string; fullName: string | null } | null;
  roles: string[];
}
export const authLogin = (email: string, password: string) =>
  apiFetch<AuthResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const authSignup = (data: { email: string; password: string; fullName?: string; code?: string }) =>
  apiFetch<AuthResult>("/api/auth/signup", { method: "POST", body: JSON.stringify(data) });
export const authLogout = () => apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
export const authSession = () => apiFetch<{ user: null } | AuthResult>("/api/auth/session");

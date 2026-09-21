// Supabase-compatible shim over the Spacefast worker API.
//
// The app was written against the Supabase JS client (`supabase.from(...)`,
// `.auth`, `.rpc`, `.storage`). Rather than edit every call site, this shim
// implements the subset the app uses and routes it to `/api/*`.
//
// Read filtering/ordering that the generic REST layer cannot express is done
// client-side after fetching the (eq-narrowed) list. The dataset is small.

import { apiFetch, authLogin, authLogout, authSession, authSignup, createRow, deleteRow, listRows, updateRow } from "./client";
import { clearSession, getSession, setSession, subscribe, type Session } from "./session";

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string } | null };

// Columns the worker's /api/data list endpoint accepts as eq filters.
const SERVER_FILTERS: Record<string, string[]> = {
  players: ["source"],
  events: ["source", "event_type"],
  player_stats: ["player_id", "season", "event_id", "category"],
  team_stats: ["season", "category"],
  albums: ["season", "event_id"],
  album_photos: ["album_id", "event_id"],
  media_items: ["event_id", "kind", "source"],
  photo_tags: ["album_photo_id", "photo_upload_id", "player_id"],
  photo_uploads: ["album_id", "event_id"],
  source_configs: ["source"],
  sync_runs: ["source", "status"],
  staged_records: ["sync_run_id", "status"],
  invites: ["email", "code"],
  profiles: [],
  user_roles: ["user_id"],
};

interface Filter {
  op: "eq" | "neq" | "in" | "is" | "not" | "gt" | "gte" | "lt" | "lte";
  col: string;
  val: unknown;
}

class QueryBuilder implements PromiseLike<Result<unknown>> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private limitN?: number;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: unknown;
  private singleMode: "single" | "maybe" | null = null;
  private wantCount = false;

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (this.mode === "select") this.mode = "select";
    if (opts?.count) this.wantCount = true;
    return this;
  }
  insert(rows: unknown): this { this.mode = "insert"; this.payload = rows; return this; }
  update(vals: unknown): this { this.mode = "update"; this.payload = vals; return this; }
  upsert(rows: unknown, _opts?: { onConflict?: string }): this { this.mode = "upsert"; this.payload = rows; return this; }
  delete(): this { this.mode = "delete"; return this; }

  eq(col: string, val: unknown): this { this.filters.push({ op: "eq", col, val }); return this; }
  neq(col: string, val: unknown): this { this.filters.push({ op: "neq", col, val }); return this; }
  in(col: string, val: unknown[]): this { this.filters.push({ op: "in", col, val }); return this; }
  is(col: string, val: unknown): this { this.filters.push({ op: "is", col, val }); return this; }
  not(col: string, _op: string, val: unknown): this { this.filters.push({ op: "not", col, val }); return this; }
  gt(col: string, val: unknown): this { this.filters.push({ op: "gt", col, val }); return this; }
  gte(col: string, val: unknown): this { this.filters.push({ op: "gte", col, val }); return this; }
  lt(col: string, val: unknown): this { this.filters.push({ op: "lt", col, val }); return this; }
  lte(col: string, val: unknown): this { this.filters.push({ op: "lte", col, val }); return this; }
  ilike(col: string, val: string): this { this.filters.push({ op: "eq", col, val: val.replace(/%/g, "") }); return this; }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({ col, asc: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number): this { this.limitN = n; return this; }
  single(): this { this.singleMode = "single"; return this; }
  maybeSingle(): this { this.singleMode = "maybe"; return this; }

  private applyClient(rows: Row[]): Row[] {
    let out = rows;
    for (const f of this.filters) {
      out = out.filter((r) => {
        const v = r[f.col];
        switch (f.op) {
          case "eq": return v === f.val;
          case "neq": return v !== f.val;
          case "in": return (f.val as unknown[]).includes(v);
          case "is": return f.val === null ? v === null || v === undefined : v === f.val;
          case "not": return f.val === null ? v !== null && v !== undefined : v !== f.val;
          case "gt": return (v as number) > (f.val as number);
          case "gte": return (v as number) >= (f.val as number);
          case "lt": return (v as number) < (f.val as number);
          case "lte": return (v as number) <= (f.val as number);
          default: return true;
        }
      });
    }
    for (const o of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[o.col], bv = b[o.col];
        if (av == null && bv == null) return 0;
        if (av == null) return o.nullsFirst ? -1 : 1;
        if (bv == null) return o.nullsFirst ? 1 : -1;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  private async run(): Promise<Result<unknown>> {
    try {
      if (this.mode === "select") {
        const serverQ: Record<string, string> = {};
        const allowed = SERVER_FILTERS[this.table] ?? [];
        for (const f of this.filters) if (f.op === "eq" && allowed.includes(f.col)) serverQ[f.col] = String(f.val);
        const rows = await listRows<Row>(this.table, serverQ);
        const shaped = this.applyClient(rows);
        if (this.wantCount) return { data: (this.singleMode ? shaped[0] ?? null : shaped) as unknown, error: null } as Result<unknown> & { count: number };
        if (this.singleMode) return { data: (shaped[0] ?? null) as unknown, error: this.singleMode === "single" && !shaped[0] ? { message: "no rows" } : null };
        return { data: shaped, error: null };
      }
      if (this.mode === "insert" || this.mode === "upsert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const created = [];
        for (const r of rows) created.push(await createRow(this.table, r));
        const data = Array.isArray(this.payload) ? created : created[0];
        return { data: (this.singleMode ? created[0] : data) as unknown, error: null };
      }
      if (this.mode === "update") {
        const id = this.filters.find((f) => f.op === "eq" && f.col === "id")?.val as string | undefined;
        if (!id) return { data: null, error: { message: "update requires an id filter in this shim" } };
        const row = await updateRow(this.table, id, this.payload);
        return { data: (this.singleMode ? row : [row]) as unknown, error: null };
      }
      if (this.mode === "delete") {
        const id = this.filters.find((f) => f.op === "eq" && f.col === "id")?.val as string | undefined;
        if (!id) return { data: null, error: { message: "delete requires an id filter in this shim" } };
        await deleteRow(this.table, id);
        return { data: null, error: null };
      }
      return { data: null, error: { message: "unsupported operation" } };
    } catch (e) {
      // For reads, a 401/403 (member-gated content the visitor can't see) is not
      // an error to surface — return empty so React Query doesn't retry/spin.
      const status = (e as { status?: number }).status;
      if (this.mode === "select" && (status === 401 || status === 403)) {
        return { data: this.singleMode ? null : [], error: null };
      }
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  then<R1 = Result<unknown>, R2 = never>(
    onfulfilled?: ((value: Result<unknown>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// ---- session mapping (Supabase-shaped) ----
function mapSession(s: Session | null) {
  if (!s) return null;
  return { access_token: s.token, user: { id: s.user.id, email: s.user.email } };
}
function toSession(r: { token: string; user: { id: string; email: string; status: string }; profile: { status: string; fullName: string | null } | null; roles: string[] }): Session {
  return { token: r.token, user: r.user, profile: r.profile, roles: r.roles };
}

const auth = {
  async getSession() {
    return { data: { session: mapSession(getSession()) }, error: null };
  },
  async getUser() {
    const s = getSession();
    return { data: { user: s ? { id: s.user.id, email: s.user.email } : null }, error: s ? null : { message: "no session" } };
  },
  onAuthStateChange(cb: (event: string, session: ReturnType<typeof mapSession>) => void) {
    const unsub = subscribe(() => cb(getSession() ? "SIGNED_IN" : "SIGNED_OUT", mapSession(getSession())));
    // fire once with current state (async, like supabase)
    Promise.resolve().then(() => cb(getSession() ? "SIGNED_IN" : "SIGNED_OUT", mapSession(getSession())));
    return { data: { subscription: { unsubscribe: unsub } } };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const r = await authLogin(email, password);
      setSession(toSession(r));
      return { data: { session: mapSession(getSession()), user: { id: r.user.id, email: r.user.email } }, error: null };
    } catch (e) {
      return { data: { session: null, user: null }, error: { message: e instanceof Error ? e.message : "sign in failed" } };
    }
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string; invite_code?: string } } }) {
    try {
      const r = await authSignup({ email, password, fullName: options?.data?.full_name, code: options?.data?.invite_code });
      setSession(toSession(r));
      return { data: { session: mapSession(getSession()), user: { id: r.user.id, email: r.user.email } }, error: null };
    } catch (e) {
      return { data: { session: null, user: null }, error: { message: e instanceof Error ? e.message : "sign up failed" } };
    }
  },
  async signOut() {
    await authLogout();
    clearSession();
    return { error: null };
  },
  async resetPasswordForEmail(email: string) {
    try {
      await apiFetch("/api/auth/reset-request", { method: "POST", body: JSON.stringify({ email }) });
      return { data: {}, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : "reset failed" } };
    }
  },
  // Reset via a token from the reset-password link (?token=…).
  async updateUser({ password }: { password?: string }, opts?: { token?: string }) {
    const token = opts?.token ?? new URLSearchParams(location.search).get("token") ?? "";
    try {
      await apiFetch("/api/auth/reset-confirm", { method: "POST", body: JSON.stringify({ token, password }) });
      return { data: {}, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : "reset failed" } };
    }
  },
  async refreshSession() {
    try {
      const r = await authSession();
      if (r && "user" in r && r.user) setSession(toSession(r as never));
      return { data: { session: mapSession(getSession()) }, error: null };
    } catch {
      return { data: { session: mapSession(getSession()) }, error: null };
    }
  },
};

// Storage: files are uploaded to the worker (env.STORAGE) and identified by
// their stable served URL, which we store as `storage_path`. Signing is an
// identity op because the path already IS the URL.
const API_BASE = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "";
const storage = {
  from() {
    return {
      async upload(_path: string, file: Blob & { name?: string; type?: string }, opts?: { contentType?: string }) {
        const token = getSession()?.token;
        const res = await fetch(`${API_BASE}/api/uploads`, {
          method: "POST",
          headers: {
            "content-type": opts?.contentType || file.type || "application/octet-stream",
            "x-filename": (file as { name?: string }).name || "upload",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: file,
        });
        if (!res.ok) return { data: null, error: { message: `upload failed (${res.status})` } };
        const j = (await res.json()) as { url: string };
        // Return the stored URL as the path so callers persist it in storage_path.
        return { data: { path: j.url, fullPath: j.url }, error: null };
      },
      // storage_path holds the full stored URL. Only "sign" real URLs; a
      // Supabase-style key (e.g. "thumbs/<id>.jpg") is not a stored object, so
      // return null and let callers fall back to thumbnail_url.
      async createSignedUrl(path: string) {
        return path.startsWith("http")
          ? { data: { signedUrl: path }, error: null }
          : { data: null, error: { message: "not a stored object" } };
      },
      async createSignedUrls(paths: string[]) {
        return {
          data: paths.map((p) =>
            p.startsWith("http")
              ? { path: p, signedUrl: p, error: null }
              : { path: p, signedUrl: null, error: "not a stored object" },
          ),
          error: null,
        };
      },
      async remove(paths: string[]) {
        const token = getSession()?.token;
        await Promise.all(
          paths.map((p) =>
            fetch(`${API_BASE}/api/uploads?id=${encodeURIComponent(p)}`, {
              method: "DELETE",
              headers: token ? { authorization: `Bearer ${token}` } : {},
            }).catch(() => undefined),
          ),
        );
        return { data: null, error: null };
      },
    };
  },
};

async function rpc(name: string, args?: Record<string, unknown>): Promise<Result<unknown>> {
  const s = getSession();
  if (name === "my_status") return { data: (s?.profile?.status ?? null) as unknown, error: null };
  if (name === "is_member") return { data: (!!s && (s.profile?.status === "approved" || s.roles.includes("admin"))) as unknown, error: null };
  if (name === "has_role") return { data: (!!s && s.roles.includes(String(args?.["_role"] ?? "admin"))) as unknown, error: null };
  return { data: null, error: { message: `rpc ${name} not implemented` } };
}

export const supabaseShim = {
  from: (table: string) => new QueryBuilder(table),
  auth,
  storage,
  rpc,
};

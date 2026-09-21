// Dugout 1836 - Spacefast Functions worker entry.
// Stage 2: custom email/password auth on the D1 (env.DB) database.
// The React portal (Stage 6) will be served as static assets alongside this;
// the worker owns /api/*.

import type { Env } from "./db";
import { ensureSchema } from "./db";
import {
  handleAdminBootstrap,
  handleCreateInvite,
  handleLogin,
  handleLogout,
  handleSession,
  handleSignup,
} from "./auth";
import { handleData } from "./data";
import { handleUpload, handleRelativize } from "./storage";
import { handleImport } from "./importer";
import { handleGphotos } from "./gphotos";
import { handleScanPhotos } from "./phototags";
import { handleResetRequest, handleResetConfirm, handleAdminResetUser } from "./resets";
import { handleSync, handleAdminScan } from "./sync";
import { json } from "./http";

const LANDING = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>The Dugout 1836</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:38rem;margin:12vh auto;padding:0 1.2rem;color:#13191e}
h1{font-size:1.6rem;margin:0 0 .3rem}.tag{color:#6b7280}code{background:#f3f4f6;padding:.1rem .35rem;border-radius:4px}</style>
</head><body><h1>The Dugout 1836</h1>
<p class="tag">Parent portal, migrating onto Spacefast Functions.</p>
<p>Stage 2: auth API is live. Endpoints under <code>/api/auth/*</code>. Runtime check: <code>/api/probe</code>.</p>
</body></html>`;

async function probe(env: Env): Promise<Response> {
  const report: Record<string, unknown> = {
    runtime: "spacefast-functions",
    hasFetch: typeof fetch === "function",
    hasSubtle: typeof crypto !== "undefined" && !!crypto.subtle,
    hasGetRandomValues: typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function",
    hasRandomUUID: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function",
    hasDbBinding: !!env.DB,
    envKeys: Object.keys(env as Record<string, unknown>),
  };
  // Discover the STORAGE binding surface (undocumented) to build Stage 5 on.
  const st = (env as Record<string, unknown>).STORAGE as Record<string, unknown> | undefined;
  if (st) {
    const own = Object.keys(st);
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(st) ?? {});
    const probe = ["put", "get", "head", "delete", "list", "upload", "createSignedUrl", "url", "store", "read"];
    report.storage = {
      type: typeof st,
      keys: own,
      protoMethods: proto.filter((m) => m !== "constructor"),
      has: Object.fromEntries(probe.map((m) => [m, typeof (st as Record<string, unknown>)[m]])),
    };
  }
  try {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    report.db = { ok: true, userCount: row?.n ?? 0 };
  } catch (e) {
    report.db = { ok: false, error: String(e) };
  }
  return json(report);
}

type Handler = (req: Request, env: Env) => Promise<Response>;
const routes: Record<string, Partial<Record<string, Handler>>> = {
  "/api/auth/signup": { POST: handleSignup },
  "/api/auth/login": { POST: handleLogin },
  "/api/auth/logout": { POST: handleLogout },
  "/api/auth/session": { GET: handleSession },
  "/api/auth/reset-request": { POST: handleResetRequest },
  "/api/auth/reset-confirm": { POST: handleResetConfirm },
  "/api/admin/reset-user": { POST: handleAdminResetUser },
  "/api/admin/bootstrap": { POST: handleAdminBootstrap },
  "/api/admin/invites": { POST: handleCreateInvite },
  "/api/admin/scan": { POST: handleAdminScan },
  "/api/admin/import": { POST: handleImport },
  "/api/admin/gphotos": { POST: handleGphotos },
  "/api/admin/scan-photos": { POST: handleScanPhotos },
  "/api/admin/relativize": { POST: handleRelativize },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/probe") return probe(env);

    // File uploads / deletes (family photos + videos) via env.STORAGE.
    if (path === "/api/uploads") {
      try {
        return await handleUpload(request, env);
      } catch (e) {
        return json({ error: "internal_error", detail: String(e) }, { status: 500 });
      }
    }

    // Public: validate an invite code before signup.
    if (path === "/api/invites/check") {
      await ensureSchema(env.DB);
      const code = url.searchParams.get("code") ?? "";
      const row = code
        ? await env.DB.prepare("SELECT id FROM invites WHERE code = ? AND accepted_at IS NULL").bind(code).first()
        : null;
      return json({ valid: !!row });
    }

    // Source sync (manual POST/GET, or the cron with the secret as a path
    // segment: /api/sync/<secret>). Secret can also ride a header or ?token=.
    if (path === "/api/sync" || path.startsWith("/api/sync/")) {
      const pathToken = path.startsWith("/api/sync/")
        ? decodeURIComponent(path.slice("/api/sync/".length))
        : null;
      try {
        return await handleSync(request, env, pathToken);
      } catch (e) {
        return json({ error: "internal_error", detail: String(e) }, { status: 500 });
      }
    }

    // Generic data REST: /api/data/<table> [ /<id> ]
    if (path.startsWith("/api/data/")) {
      const rest = path.slice("/api/data/".length).split("/").filter(Boolean);
      const table = rest[0];
      const id = rest[1] ?? null;
      if (!table) return json({ error: "collection required" }, { status: 404 });
      try {
        return await handleData(request, env, table, id);
      } catch (e) {
        return json({ error: "internal_error", detail: String(e) }, { status: 500 });
      }
    }

    const route = routes[path];
    if (route) {
      const handler = route[request.method];
      if (!handler) return json({ error: "method not allowed" }, { status: 405 });
      try {
        return await handler(request, env);
      } catch (e) {
        return json({ error: "internal_error", detail: String(e) }, { status: 500 });
      }
    }

    // Non-API paths are served by static files (index.html is the SPA). The
    // worker only answers paths no file matches; return the SPA shell as a
    // fallback so client entry still works if a non-API path reaches here.
    if (!path.startsWith("/api/")) {
      return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return json({ error: "not found" }, { status: 404 });
  },
};

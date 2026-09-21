// Dugout 1836 Zero capsule entry.
//
// Foundation scaffold (Stage 0). NOT YET DEPLOYED.
//
// Design note: this app uses CUSTOM email/password auth, so Zero's built-in
// identity (ctx.auth) is always a "guest". We therefore drive the app through
// `endpoints` (raw HTTP + our own session cookie), not the queries/mutations
// RPC layer, which keys off ctx.auth.userId. Authorization lives in the guards
// in server/auth/* (Stage 2), called at the top of every endpoint.
//
// See docs/SPACEFAST_MIGRATION.md for the full plan.

import { capsule, endpoint, json } from "@spacefast/zero/server";

import { schema } from "./schema";

export default capsule({
  name: "Dugout 1836",
  schema,
  endpoints: {
    // Liveness check. Confirms the capsule is published and migrations applied.
    health: endpoint({ mode: "read", method: "GET", path: "/api/health" }, (ctx) => {
      return json({ ok: true, tables: Object.keys(schema).length, ts: new Date().toISOString() });
    }),
  },
  // queries / mutations: intentionally empty. Custom auth means everything runs
  // through endpoints. See design note above.
  // Auth endpoints (Stage 2), data endpoints (Stage 3), sync (Stage 4),
  // storage/image proxy (Stage 5) get registered here as they are ported.
});

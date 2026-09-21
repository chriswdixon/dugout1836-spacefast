// Neutral client error hook (was a Lovable reporter). Extend to send to your
// own monitoring if you want; for now it just logs.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error("[error]", context ?? {}, error);
}

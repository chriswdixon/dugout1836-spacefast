import { apiFetch } from "@/integrations/api/client";

/** Public check so families get a clear error before an account is created. */
export async function checkInviteCode({ data }: { data: { code: string } }): Promise<{ valid: boolean }> {
  try {
    return await apiFetch<{ valid: boolean }>(`/api/invites/check?code=${encodeURIComponent(data.code.trim())}`);
  } catch {
    return { valid: false };
  }
}

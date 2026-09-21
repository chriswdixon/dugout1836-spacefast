import { apiFetch } from "@/integrations/api/client";
export interface ScanResult { scanned: number; tagged: number; remaining?: boolean; error?: string }
export async function scanPhotosForPlayers({ data }: { data?: { limit?: number } } = {}): Promise<ScanResult> {
  return apiFetch<ScanResult>("/api/admin/scan-photos", { method: "POST", body: JSON.stringify({ limit: data?.limit }) });
}

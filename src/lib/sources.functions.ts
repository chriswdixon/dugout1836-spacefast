import { apiFetch } from "@/integrations/api/client";

const NOT_READY = "This action isn't available on the new platform yet.";

// GameChanger (and other configured sources) sync, run on the worker.
export async function runSourceScan({ data }: { data: { source?: string } }) {
  return apiFetch("/api/admin/scan", { method: "POST", body: JSON.stringify({ source: data?.source }) });
}

// Staged-record review isn't part of the deterministic GameChanger flow (it
// publishes straight through), so these remain no-ops for now.
export async function decideStagedRecord(_?: unknown): Promise<never> { throw new Error(NOT_READY); }
export async function removePulledItem(_?: unknown): Promise<never> { throw new Error(NOT_READY); }

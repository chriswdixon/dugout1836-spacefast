import { apiFetch } from "@/integrations/api/client";
export async function syncGooglePhotosAlbum({ data }: { data: { url: string; title?: string; description?: string } }) {
  return apiFetch("/api/admin/gphotos", { method: "POST", body: JSON.stringify(data) });
}

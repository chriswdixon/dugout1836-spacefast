import { updateRow } from "@/integrations/api/client";

export async function adminUpdateUser({ data }: { data: { id: string; full_name?: string; email?: string } }) {
  await updateRow("profiles", data.id, { full_name: data.full_name ?? null, email: data.email ?? null });
  return { ok: true };
}

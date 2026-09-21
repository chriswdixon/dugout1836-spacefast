// Migrated: the app now talks to the Spacefast worker API, not Supabase.
// The `supabase` export is a compatibility shim (see integrations/api).
import { supabaseShim } from "@/integrations/api/supabase-shim";

// Kept the import name so call sites do not change.
export const supabase = supabaseShim as unknown as SupabaseLike;

// Loose structural type so existing `.from(...).select()` etc. keep type-checking.
type SupabaseLike = {
  from: (table: string) => any;
  auth: any;
  storage: any;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};

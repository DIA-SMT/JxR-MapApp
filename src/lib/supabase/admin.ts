import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service role — SOLO servidor, salta RLS.
 * Se usa únicamente para la gestión de usuarios del superadmin.
 */
export function crearClienteAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

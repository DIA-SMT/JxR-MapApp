"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Cliente Supabase del navegador (sesión en cookies, compartida con el server). */
export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

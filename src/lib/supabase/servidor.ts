import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Perfil } from "@/lib/tipos";

/** Cliente Supabase de Server Components / Route Handlers (RLS del usuario). */
export async function crearClienteServidor() {
  const almacen = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => almacen.getAll(),
        setAll: (aEscribir: Array<{ name: string; value: string; options?: CookieOptions }>) => {
          try {
            for (const { name, value, options } of aEscribir) almacen.set(name, value, options);
          } catch {
            // Server Component: el middleware ya refresca la sesión
          }
        },
      },
    },
  );
}

/** Usuario autenticado + su perfil, o null. */
export async function sesionConPerfil() {
  const supabase = await crearClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, email, nombre, rol, debe_cambiar_password")
    .eq("id", user.id)
    .single<Perfil>();
  if (!perfil) return null;
  return { user, perfil, supabase };
}

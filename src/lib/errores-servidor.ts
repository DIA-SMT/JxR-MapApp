import "server-only";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { normalizarError } from "@/lib/errores";

/**
 * Registra un error del servidor (rutas de la API). Escribe con la service
 * role porque no siempre hay sesión; nunca lanza: si no se puede guardar,
 * queda al menos en la consola de Vercel.
 */
export async function registrarErrorServidor(
  donde: string,
  error: unknown,
  usuario?: { id: string; email: string } | null,
): Promise<void> {
  const { mensaje, detalle } = normalizarError(error);
  console.error(`[${donde}]`, mensaje);
  try {
    await crearClienteAdmin()
      .from("errores_app")
      .insert({
        origen: "servidor",
        donde: donde.slice(0, 300),
        mensaje,
        detalle,
        usuario: usuario?.id ?? null,
        usuario_email: usuario?.email ?? "",
      });
  } catch {
    // sin registro no se frena nada
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { conversarConElena } from "@/lib/elena-conversar";
import { sesionConPerfil } from "@/lib/supabase/servidor";

export const maxDuration = 60;

/**
 * Elena conversacional: loop de tool-calling (máx. 5 rondas) contra
 * herramientas de solo lectura del operativo. Sesión obligatoria; las
 * consultas corren con la sesión RLS del usuario.
 */

// Holgado a propósito: una conversación larga o una respuesta extensa de Elena
// no tienen que dejar el chat roto. Lo que se usa se recorta abajo.
const entradaSchema = z.object({
  mensajes: z
    .array(
      z.object({
        rol: z.enum(["usuario", "elena"]),
        contenido: z.string().max(50_000),
      }),
    )
    .min(1)
    .max(500),
});

/** Los últimos 12 mensajes con texto, cada uno hasta 4000 caracteres: lo que el modelo necesita de contexto. */
const MAX_MENSAJES = 12;
const MAX_CARACTERES = 4000;

export async function POST(req: NextRequest) {
  const sesion = await sesionConPerfil();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "mensajes inválidos" }, { status: 400 });
  const mensajes = cuerpo.data.mensajes
    .filter((m) => m.contenido.trim() !== "")
    .slice(-MAX_MENSAJES)
    .map((m) => ({ ...m, contenido: m.contenido.slice(0, MAX_CARACTERES) }));
  if (mensajes.length === 0 || mensajes[mensajes.length - 1].rol !== "usuario")
    return NextResponse.json({ error: "falta la pregunta" }, { status: 400 });

  try {
    const r = await conversarConElena(sesion.supabase, mensajes);
    return NextResponse.json({
      respuesta: r.respuesta,
      herramientas: r.herramientas,
      ...(r.accionMapa ? { accionMapa: r.accionMapa } : {}),
      ...(r.accionesMapa.length > 0 ? { accionesMapa: r.accionesMapa } : {}),
    });
  } catch (e) {
    // que quede en los registros de Vercel: sin esto, un fallo de Elena no deja rastro
    console.error("[elena] no pudo responder:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Elena no pudo responder" },
      { status: 502 },
    );
  }
}

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

const entradaSchema = z.object({
  mensajes: z
    .array(
      z.object({
        rol: z.enum(["usuario", "elena"]),
        contenido: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: NextRequest) {
  const sesion = await sesionConPerfil();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "mensajes inválidos" }, { status: 400 });

  try {
    const r = await conversarConElena(sesion.supabase, cuerpo.data.mensajes);
    return NextResponse.json({
      respuesta: r.respuesta,
      herramientas: r.herramientas,
      ...(r.accionMapa ? { accionMapa: r.accionMapa } : {}),
      ...(r.accionesMapa.length > 0 ? { accionesMapa: r.accionesMapa } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Elena no pudo responder" },
      { status: 502 },
    );
  }
}

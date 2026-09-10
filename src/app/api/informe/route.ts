import { NextResponse } from "next/server";
import { conversarConElena } from "@/lib/elena-conversar";
import { sesionConPerfil } from "@/lib/supabase/servidor";

export const maxDuration = 60;

/**
 * Informe de situación: Elena recorre el operativo con sus herramientas y
 * escribe el parte completo, que queda guardado y compartido para el equipo.
 */

const PEDIDO_INFORME = `Armá el INFORME DE SITUACIÓN completo del operativo para el equipo de campaña. Consultá las herramientas que necesites y cubrí, en este orden y con una línea en negrita como título de cada sección:
1. Operativo: cobertura de distritos y circuitos, personas, tareas pendientes críticas.
2. Estrategia voto disperso: avance contra la meta, frontera 20K y votos huérfanos.
3. Dónde crecer: los 5 circuitos con más oportunidad y por qué (bolsa, competitividad, disperso).
4. Alertas: espacios peleados por pocos votos y territorios sin referente donde hay votos en juego.
5. Plan territorial: cuántas fichas están cargadas/validadas y qué territorios prioritarios siguen sin plan.
6. Tres acciones concretas para esta semana, cada una con territorio, meta en votos y responsable sugerido (el rol, no un nombre).
Es un informe ejecutivo: hasta ~450 palabras, números exactos, sin relleno.`;

export async function POST() {
  const sesion = await sesionConPerfil();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });

  try {
    const r = await conversarConElena(
      sesion.supabase,
      [{ rol: "usuario", contenido: PEDIDO_INFORME }],
      { maxTokens: 1600 },
    );
    const titulo = `Informe de situación · ${new Date().toLocaleDateString("es-AR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Argentina/Tucuman",
    })}`;
    const { data, error } = await sesion.supabase
      .from("informes")
      .insert({ titulo, contenido: r.respuesta, generado_por: sesion.perfil.id })
      .select("id, titulo, contenido, generado_en")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ informe: data, herramientas: r.herramientas });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "no pude generar el informe" },
      { status: 502 },
    );
  }
}

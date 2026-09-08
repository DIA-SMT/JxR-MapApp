import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CIRCUITOS, esEspacioValido } from "@/lib/espacios";
import { sesionConPerfil } from "@/lib/supabase/servidor";

export const maxDuration = 30;

/**
 * Búsqueda inteligente del mapa: convierte una frase en lenguaje natural
 * (escrita o dictada) en UNA acción estructurada que el mapa ejecuta.
 * Corre por OpenRouter con salida forzada a tool-call (JSON confiable).
 */

const entradaSchema = z.object({ frase: z.string().min(2).max(300) });

const HERRAMIENTA = {
  type: "function",
  function: {
    name: "accion_mapa",
    description: "La acción que el mapa electoral debe ejecutar para responder a la frase del usuario.",
    parameters: {
      type: "object",
      properties: {
        accion: {
          type: "string",
          enum: ["ir_espacio", "donde_vota", "vista", "filtros_padron", "escuelas_min", "nada"],
          description:
            "ir_espacio: encuadrar un circuito o distrito. donde_vota: buscar a una persona en el padrón. vista: cambiar la vista del mapa. filtros_padron: microsegmentar el padrón (cambia a vista padrón). escuelas_min: mostrar escuelas con al menos N electores (cambia a vista escuelas). nada: la frase no es accionable en el mapa.",
        },
        tipo: { type: "string", enum: ["distrito", "circuito"] },
        codigo: { type: "string", description: "'15B', '7', '18G'… para ir_espacio" },
        texto: { type: "string", description: "Apellido/nombre o DNI para donde_vota" },
        vista: { type: "string", enum: ["operativo", "padron", "escuelas", "v2023"] },
        sexo: { type: "string", enum: ["F", "M", "todos"], description: "para filtros_padron" },
        franja: {
          type: "string",
          enum: ["todas", "16_25", "26_40", "41_60", "60_mas"],
          description: "franja etaria estimada, para filtros_padron",
        },
        minimo: { type: "number", description: "mínimo de electores por escuela, para escuelas_min" },
      },
      required: ["accion"],
    },
  },
} as const;

const SISTEMA = `Convertís frases (en español rioplatense, escritas o dictadas) en UNA acción del mapa electoral de San Miguel de Tucumán. Llamá SIEMPRE a accion_mapa.

Contexto:
- Circuitos válidos: ${CIRCUITOS.join(", ")}. Distritos: 1 a 20.
- Vistas: operativo (asignaciones/tareas), padron (densidad de electores), escuelas (escuelas de votación), v2023 (voto disperso 2023).
- "mostrame el 15B", "andá al circuito 20", "llevame al 18 G" → ir_espacio (codigo en mayúsculas, sin espacios: "18G").
- "dónde vota Pérez Juan", "buscá el DNI 30123456" → donde_vota.
- "mostrá el padrón", "vista escuelas", "cómo dio el 2023", "voto disperso" → vista.
- "mujeres de 16 a 25", "varones mayores de 60", "jóvenes en el padrón" → filtros_padron (16-25→16_25, 26-40→26_40, 41-60→41_60, 60+→60_mas).
- "escuelas con más de 5000 electores", "las escuelas más grandes" (usar 4000) → escuelas_min.
- Si la frase no encaja en nada de esto → accion "nada".`;

export async function POST(req: NextRequest) {
  const sesion = await sesionConPerfil();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ error: "IA no configurada" }, { status: 501 });

  const cuerpo = entradaSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "frase inválida" }, { status: 400 });

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "JxR Busqueda",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5",
        max_tokens: 300,
        temperature: 0,
        messages: [
          { role: "system", content: SISTEMA },
          { role: "user", content: cuerpo.data.frase },
        ],
        tools: [HERRAMIENTA],
        tool_choice: { type: "function", function: { name: "accion_mapa" } },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function: { arguments: string } }> } }>;
    };
    const cruda = data.choices?.[0]?.message?.tool_calls?.[0]?.function.arguments ?? "{}";
    const accion = JSON.parse(cruda) as Record<string, unknown>;

    // saneo del lado del servidor
    if (accion.accion === "ir_espacio") {
      const tipo = accion.tipo === "distrito" ? "distrito" : "circuito";
      const codigo = String(accion.codigo ?? "").toUpperCase().replace(/\s+/g, "");
      if (!esEspacioValido(tipo, codigo)) return NextResponse.json({ accion: "nada" });
      return NextResponse.json({ accion: "ir_espacio", tipo, codigo });
    }
    return NextResponse.json(accion);
  } catch {
    return NextResponse.json({ accion: "nada", error: "no se pudo interpretar" }, { status: 200 });
  }
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ejecutarHerramientaElena, HERRAMIENTAS_ELENA, SISTEMA_ELENA, validarAccionMapaElena } from "./elena";
import { esEspacioValido } from "./espacios";
import type { AccionMapaElena, TipoEspacio } from "./tipos";

/**
 * El loop conversacional de Elena (tool-calling contra OpenRouter), separado
 * de la ruta HTTP para que lo usen tanto el chat como el generador de
 * informes. Las herramientas corren con la sesión RLS del usuario.
 */

interface MensajeOR {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface RespuestaElena {
  respuesta: string;
  herramientas: string[];
  accionMapa: { tipo: TipoEspacio; codigo: string } | null;
  accionesMapa: AccionMapaElena[];
}

export async function conversarConElena(
  supabase: SupabaseClient,
  entrada: Array<{ rol: "usuario" | "elena"; contenido: string }>,
  opciones?: { sistemaExtra?: string; maxTokens?: number },
): Promise<RespuestaElena> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) throw new Error("IA no configurada");

  const mensajes: MensajeOR[] = [
    { role: "system", content: opciones?.sistemaExtra ? `${SISTEMA_ELENA}\n\n${opciones.sistemaExtra}` : SISTEMA_ELENA },
    ...entrada.slice(-12).map((m) => ({
      role: m.rol === "usuario" ? "user" : "assistant",
      content: m.contenido,
    })),
  ];

  const modelo = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5";
  const herramientasUsadas: string[] = [];
  // Si Elena llama accionar_mapa, el espacio viaja al navegador y el mapa lo encuadra
  let accionMapa: { tipo: TipoEspacio; codigo: string } | null = null;
  // mostrar_en_mapa: resaltados, coropletas y barrios que pidió Elena (máx 3)
  const accionesMapa: AccionMapaElena[] = [];

  for (let ronda = 0; ronda < 5; ronda++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "JxR Elena",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: opciones?.maxTokens ?? 1200,
        temperature: 0.3,
        messages: mensajes,
        tools: HERRAMIENTAS_ELENA,
      }),
    });
    if (!res.ok) {
      const detalle = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(detalle?.error?.message ?? `OpenRouter ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: MensajeOR & { content?: string } }>;
    };
    const mensaje = data.choices?.[0]?.message;
    if (!mensaje) throw new Error("respuesta vacía del modelo");

    if (mensaje.tool_calls && mensaje.tool_calls.length > 0) {
      // El assistant debe llevar EXACTAMENTE las llamadas que vamos a responder:
      // un tool_call sin mensaje tool posterior hace fallar la ronda siguiente.
      const llamadas = mensaje.tool_calls.slice(0, 4);
      mensajes.push({ role: "assistant", content: mensaje.content ?? null, tool_calls: llamadas });
      for (const llamada of llamadas) {
        let argumentos: Record<string, unknown> | null = {};
        try {
          argumentos = JSON.parse(llamada.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          argumentos = null;
        }
        if (argumentos === null) {
          // Argumentos ilegibles: NO ejecutar la herramienta con {} (podría
          // devolver el universo completo como si fuera lo pedido).
          mensajes.push({
            role: "tool",
            tool_call_id: llamada.id,
            content: JSON.stringify({ error: "argumentos ilegibles: reformulá la llamada" }),
          });
          continue;
        }
        herramientasUsadas.push(llamada.function.name);
        if (llamada.function.name === "accionar_mapa") {
          const tipo = argumentos.tipo as TipoEspacio;
          const codigo = String(argumentos.codigo ?? "").toUpperCase().trim();
          if (esEspacioValido(tipo, codigo)) accionMapa = { tipo, codigo };
        }
        if (llamada.function.name === "mostrar_en_mapa" && accionesMapa.length < 3) {
          const accion = validarAccionMapaElena(argumentos);
          if (accion) accionesMapa.push(accion);
        }
        let resultado: unknown;
        try {
          resultado = await ejecutarHerramientaElena(supabase, llamada.function.name, argumentos);
        } catch (e) {
          resultado = { error: e instanceof Error ? e.message.slice(0, 200) : "error de consulta" };
        }
        mensajes.push({
          role: "tool",
          tool_call_id: llamada.id,
          content: JSON.stringify(resultado).slice(0, 12_000),
        });
      }
      continue;
    }

    return {
      respuesta: mensaje.content ?? "…",
      herramientas: [...new Set(herramientasUsadas)],
      accionMapa,
      accionesMapa,
    };
  }
  return {
    respuesta:
      "Uf, me enredé consultando demasiadas cosas a la vez. ¿Podés preguntármelo de una forma más específica?",
    herramientas: [...new Set(herramientasUsadas)],
    accionMapa,
    accionesMapa,
  };
}

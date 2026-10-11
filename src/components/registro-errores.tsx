"use client";

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { esRuido, normalizarError } from "@/lib/errores";

let cliente: SupabaseClient | null = null;
// el mismo error no se manda dos veces en la misma pestaña
const enviados = new Set<string>();

/** Manda un error del navegador al registro. Nunca lanza. */
export function registrarError(error: unknown, donde = typeof location !== "undefined" ? location.pathname : "") {
  try {
    const { mensaje, detalle } = normalizarError(error);
    if (!mensaje || esRuido(mensaje)) return;
    const firma = `${donde}|${mensaje}`;
    if (enviados.has(firma) || enviados.size > 50) return;
    enviados.add(firma);
    cliente ??= crearClienteNavegador();
    void cliente
      .rpc("registrar_error", {
        p_donde: donde,
        p_mensaje: mensaje,
        p_detalle: detalle,
        p_navegador: navigator.userAgent.slice(0, 300),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    // registrar no puede romper nada
  }
}

/** Escucha los errores que no atrapó nadie, en toda la parte autenticada de la app. */
export function RegistroErrores() {
  useEffect(() => {
    const alError = (e: ErrorEvent) => registrarError(e.error ?? e.message);
    const alRechazo = (e: PromiseRejectionEvent) => registrarError(e.reason);
    window.addEventListener("error", alError);
    window.addEventListener("unhandledrejection", alRechazo);
    return () => {
      window.removeEventListener("error", alError);
      window.removeEventListener("unhandledrejection", alRechazo);
    };
  }, []);
  return null;
}

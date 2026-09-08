import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerListas2023, type Lista2023 } from "./padron";

/**
 * Estrategia "voto disperso 2023": preselección editable de listas.
 *
 * La preselección es solo un punto de partida MECÁNICO: listas cuyo nombre
 * remite al universo peronista y que quedaron fuera del reparto grande
 * (se excluyen los frentes principales). La decisión política final es del
 * equipo: en la pantalla Estrategia se puede prender y apagar cada lista.
 */

/** Frentes grandes 2023 (con banca o estructura provincial): fuera del preset. */
export const LISTAS_GRANDES_2023 = new Set([830, 831, 832, 901, 929]);

const PALABRAS_PERONISTAS =
  /LEALTAD|VICTORIA|PERON|JUSTICIA SOCIAL|MILITANCIA|CIUDADANA|LABORISTA|PUEBLO|COMPROMISO|ORGANIZADOS|POPULAR|INCLUSION|TODOS/i;

export function presetPeronismoDisperso(listas: Lista2023[]): number[] {
  return listas
    .filter(
      (l) =>
        !LISTAS_GRANDES_2023.has(l.lista_numero) &&
        PALABRAS_PERONISTAS.test(l.lista_nombre),
    )
    .map((l) => l.lista_numero);
}

export const META_VOTOS = 20000;

/** Selección de listas persistida por categoría (localStorage, lado cliente). */
export const claveSeleccion = (categoria: string) => `jxr:estrategia:sel:${categoria}`;

export function leerSeleccion(categoria: string): number[] | null {
  try {
    const crudo = localStorage.getItem(claveSeleccion(categoria));
    if (!crudo) return null;
    const lista = JSON.parse(crudo) as unknown;
    return Array.isArray(lista) ? lista.filter((n) => Number.isInteger(n)) : null;
  } catch {
    return null;
  }
}

export function guardarSeleccion(categoria: string, listas: number[]) {
  try {
    localStorage.setItem(claveSeleccion(categoria), JSON.stringify(listas));
  } catch {
    // sin persistencia local: no es grave
  }
}

// ── Selección compartida en la base (tabla estrategia_listas) ────────────────
// Una sola verdad para la pantalla Estrategia, el mapa y Migue. localStorage
// queda como cache/fallback si la base aún no tiene selección guardada.

export async function leerSeleccionDB(supabase: SupabaseClient, categoria: string): Promise<number[] | null> {
  const { data } = await supabase.from("estrategia_listas").select("lista_numero").eq("categoria", categoria);
  const filas = (data as Array<{ lista_numero: number }>) ?? [];
  return filas.length > 0 ? filas.map((f) => f.lista_numero) : null;
}

export async function guardarSeleccionDB(supabase: SupabaseClient, categoria: string, listas: number[]) {
  await supabase.from("estrategia_listas").delete().eq("categoria", categoria);
  if (listas.length > 0) {
    await supabase.from("estrategia_listas").insert(listas.map((n) => ({ categoria, lista_numero: n })));
  }
  guardarSeleccion(categoria, listas);
}

/** Resolución canónica: base → cache local → preselección mecánica. */
export async function resolverSeleccion(supabase: SupabaseClient, categoria: string): Promise<number[]> {
  const db = await leerSeleccionDB(supabase, categoria);
  if (db && db.length > 0) {
    guardarSeleccion(categoria, db);
    return db;
  }
  const local = leerSeleccion(categoria);
  if (local && local.length > 0) return local;
  const todas = await obtenerListas2023(supabase, categoria);
  return presetPeronismoDisperso(todas);
}

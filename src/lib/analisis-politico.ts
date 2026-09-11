import type { SupabaseClient } from "@supabase/supabase-js";
import { estimarTransferencia, type ResultadoTransferencia } from "./transferencia";

/** Acceso a datos de las herramientas de análisis político (migración 0015). */

// ── Matriz de transferencia ─────────────────────────────────────────────────

interface FilaDatos {
  circuito: string;
  padron_2023: number;
  votantes_2023: number;
  blanco_2023: number;
  votos_2023: Record<string, number>;
  electores_2025: number;
  votantes_2025: number;
  blanco_2025: number;
  votos_2025: Record<string, number>;
}

export interface OpcionesTransferencia {
  categoria2023?: string;
  /** Cuántas fuerzas mostrar por elección; el resto se agrupa en "Otras". */
  bloques?: number;
}

/**
 * Arma y estima la matriz de flujos 2023→2025 por circuito.
 *
 * Los orígenes y destinos se agrupan en pocos bloques a propósito: con 47
 * circuitos no se pueden identificar 41 listas, y forzarlo daría una matriz
 * sin sentido. Se toman las fuerzas más votadas de cada elección y el resto va
 * a "Otras", más blanco/nulo y la abstención, que es la que más se mueve.
 */
export async function estimarTransferencia2023a2025(
  supabase: SupabaseClient,
  opciones: OpcionesTransferencia = {},
): Promise<{ resultado: ResultadoTransferencia; nombres23: string[]; nombres25: string[] }> {
  const categoria = opciones.categoria2023 ?? "INTENDENTE";
  const bloques = Math.max(2, Math.min(opciones.bloques ?? 3, 5));

  const { data, error } = await supabase.rpc("transferencia_datos", { p_categoria_2023: categoria });
  if (error) throw new Error(error.message);
  const filas = (data as FilaDatos[]) ?? [];
  if (filas.length < 6) throw new Error("no hay suficientes circuitos con datos de las dos elecciones");

  // nombres de las fuerzas: se piden aparte porque la RPC devuelve solo ids
  const [l23, l25] = await Promise.all([
    supabase.rpc("listas_eleccion", { p_eleccion: "2023", p_categoria: categoria }),
    supabase.rpc("listas_eleccion", { p_eleccion: "2025", p_categoria: null }),
  ]);
  type Lista = { lista_id: number; lista: string; votos: number };
  const nombre23 = new Map(((l23.data as Lista[]) ?? []).map((l) => [String(l.lista_id), l.lista]));
  const nombre25 = new Map(((l25.data as Lista[]) ?? []).map((l) => [String(l.lista_id), l.lista]));

  const totalPor = (campo: "votos_2023" | "votos_2025") => {
    const t = new Map<string, number>();
    for (const f of filas) for (const [k, v] of Object.entries(f[campo] ?? {})) t.set(k, (t.get(k) ?? 0) + Number(v));
    return [...t.entries()].sort((a, b) => b[1] - a[1]);
  };
  const top23 = totalPor("votos_2023").slice(0, bloques).map(([k]) => k);
  const top25 = totalPor("votos_2025").slice(0, bloques).map(([k]) => k);

  const corto = (t: string) => (t.length > 24 ? t.slice(0, 23) + "…" : t);
  const origenes = [
    ...top23.map((k) => corto(nombre23.get(k) ?? `Lista ${k}`)),
    "Otras 2023",
    "Blanco/nulo 2023",
    "No votó 2023",
  ];
  const destinos = [
    ...top25.map((k) => corto(nombre25.get(k) ?? `Agrup. ${k}`)),
    "Otras 2025",
    "Blanco/nulo 2025",
    "No votó 2025",
  ];

  const unidades = filas.map((f) => {
    const v23 = top23.map((k) => Number(f.votos_2023?.[k] ?? 0));
    const otras23 = Object.entries(f.votos_2023 ?? {})
      .filter(([k]) => !top23.includes(k))
      .reduce((a, [, v]) => a + Number(v), 0);
    const aus23 = Math.max(0, Number(f.padron_2023) - Number(f.votantes_2023));

    const v25 = top25.map((k) => Number(f.votos_2025?.[k] ?? 0));
    const otras25 = Object.entries(f.votos_2025 ?? {})
      .filter(([k]) => !top25.includes(k))
      .reduce((a, [, v]) => a + Number(v), 0);
    const aus25 = Math.max(0, Number(f.electores_2025) - Number(f.votantes_2025));

    return {
      unidad: f.circuito,
      origen: [...v23, otras23, Number(f.blanco_2023), aus23],
      destino: [...v25, otras25, Number(f.blanco_2025), aus25],
    };
  });

  return {
    resultado: estimarTransferencia(origenes, destinos, unidades),
    nombres23: origenes,
    nombres25: destinos,
  };
}

// ── Contactos territoriales ─────────────────────────────────────────────────

export interface Contacto {
  id: number;
  fecha: string;
  nivel: "mesa" | "escuela" | "circuito" | "barrio";
  codigo: string;
  circuito: string;
  escuela: string;
  contactados: number;
  favorables: number;
  indecisos: number;
  contrarios: number;
  no_atendieron: number;
  tema: string;
  persona_id: number | null;
  notas: string;
}

export interface ResumenContactos {
  espacio: string;
  circuito: string | null;
  jornadas: number;
  contactados: number;
  favorables: number;
  indecisos: number;
  contrarios: number;
  no_atendieron: number;
  pct_favorable: number | null;
  pct_contrario: number | null;
  efectividad: number | null;
  ultima_fecha: string | null;
  tema_top: string | null;
}

export const TEMAS_CONTACTO = [
  "alumbrado",
  "seguridad",
  "limpieza y residuos",
  "calles y veredas",
  "agua y cloacas",
  "trabajo",
  "salud",
  "transporte",
  "arbolado y espacios verdes",
  "otro",
] as const;

export async function registrarContacto(
  supabase: SupabaseClient,
  c: Omit<Contacto, "id">,
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("contactos").insert({ ...c, creado_por: u.user?.id ?? null });
  return error ? error.message : null;
}

export async function obtenerResumenContactos(
  supabase: SupabaseClient,
  nivel: "mesa" | "escuela" | "circuito" | "barrio",
): Promise<ResumenContactos[]> {
  const { data, error } = await supabase.rpc("contactos_resumen", { p_nivel: nivel });
  if (error) throw new Error(error.message);
  return (data as ResumenContactos[]) ?? [];
}

export async function obtenerContactos(supabase: SupabaseClient, limite = 60): Promise<Contacto[]> {
  const { data, error } = await supabase
    .from("contactos")
    .select("id, fecha, nivel, codigo, circuito, escuela, contactados, favorables, indecisos, contrarios, no_atendieron, tema, persona_id, notas")
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data as Contacto[]) ?? [];
}

export async function borrarContacto(supabase: SupabaseClient, id: number): Promise<string | null> {
  const { error } = await supabase.from("contactos").delete().eq("id", id);
  return error ? error.message : null;
}

// ── Voto joven ──────────────────────────────────────────────────────────────

export interface CohorteJoven {
  circuito: string;
  electores: number;
  jovenes: number;
  pct: number;
  mujeres: number;
  varones: number;
  anio_min: number;
  anio_max: number;
}

export async function obtenerCohorteJoven(supabase: SupabaseClient, edadMax = 24): Promise<CohorteJoven[]> {
  const { data, error } = await supabase.rpc("cohorte_joven", { p_edad_max: edadMax });
  if (error) throw new Error(error.message);
  return (data as CohorteJoven[]) ?? [];
}

// ── Diseños muestrales guardados ────────────────────────────────────────────

export interface MuestraGuardada {
  id: number;
  nombre: string;
  n_objetivo: number;
  confianza: number;
  margen: number | null;
  estratos: Array<{ circuito: string; electores: number; entrevistas: number; peso: number }>;
  notas: string;
  creado_en: string;
}

export async function listarMuestras(supabase: SupabaseClient): Promise<MuestraGuardada[]> {
  const { data, error } = await supabase
    .from("muestras")
    .select("id, nombre, n_objetivo, confianza, margen, estratos, notas, creado_en")
    .order("creado_en", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data as MuestraGuardada[]) ?? [];
}

export async function guardarMuestra(
  supabase: SupabaseClient,
  m: Omit<MuestraGuardada, "id" | "creado_en">,
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("muestras").insert({ ...m, creado_por: u.user?.id ?? null });
  return error ? error.message : null;
}

export async function borrarMuestra(supabase: SupabaseClient, id: number): Promise<string | null> {
  const { error } = await supabase.from("muestras").delete().eq("id", id);
  return error ? error.message : null;
}

// ── Calendario electoral ────────────────────────────────────────────────────

export interface HitoCalendario {
  id: number;
  hito: string;
  dias_antes: number;
  norma: string;
  responsable: string;
  certeza: "verificado" | "a confirmar";
  estado: "pendiente" | "en curso" | "cumplido" | "no aplica";
  notas: string;
}

export async function listarHitos(supabase: SupabaseClient): Promise<HitoCalendario[]> {
  const { data, error } = await supabase
    .from("calendario_hitos")
    .select("id, hito, dias_antes, norma, responsable, certeza, estado, notas")
    .order("dias_antes", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as HitoCalendario[]) ?? [];
}

export async function guardarHito(
  supabase: SupabaseClient,
  h: Partial<HitoCalendario> & { hito: string; dias_antes: number },
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const fila = { ...h, actualizado_por: u.user?.id ?? null, actualizado_en: new Date().toISOString() };
  const { error } = h.id
    ? await supabase.from("calendario_hitos").update(fila).eq("id", h.id)
    : await supabase.from("calendario_hitos").insert(fila);
  return error ? error.message : null;
}

export async function borrarHito(supabase: SupabaseClient, id: number): Promise<string | null> {
  const { error } = await supabase.from("calendario_hitos").delete().eq("id", id);
  return error ? error.message : null;
}

/** La fecha concreta de un hito, contada hacia atrás desde la elección. */
export function fechaDelHito(fechaEleccion: string, diasAntes: number): Date {
  const d = new Date(`${fechaEleccion}T12:00:00`);
  d.setDate(d.getDate() - diasAntes);
  return d;
}

// ── Prioridad de fiscalización ──────────────────────────────────────────────

export interface MesaPrioritaria {
  mesa: number;
  escuela: string;
  circuito: string;
  electores: number;
  competitividad: number;
  disperso_escuela: number;
  tiene_fiscal: boolean;
  score: number;
  acumulado_electores: number;
}

export async function obtenerPrioridadMesas(
  supabase: SupabaseClient,
  listas: number[] | null,
  limite = 200,
): Promise<MesaPrioritaria[]> {
  const { data, error } = await supabase.rpc("diad_prioridad_mesas", {
    p_listas: listas && listas.length > 0 ? listas : null,
    p_limite: limite,
  });
  if (error) throw new Error(error.message);
  return (data as MesaPrioritaria[]) ?? [];
}

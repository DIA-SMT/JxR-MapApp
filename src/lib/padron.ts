import type { SupabaseClient } from "@supabase/supabase-js";

/** Tipos y consultas del padrón electoral y los resultados 2023.
 *  Todo el análisis expuesto es AGREGADO; las consultas individuales son
 *  exclusivamente de logística electoral (dónde vota una persona). */

export interface ResumenPadron {
  total: number;
  mujeres: number;
  varones: number;
  otros: number;
  con_mesa: number;
  circuitos: number;
  escuelas: number;
  franjas_estimadas: {
    e16_25: number;
    e26_40: number;
    e41_60: number;
    e60_mas: number;
    sin_estimar: number;
  };
}

export interface FilaPadronCircuito {
  circuito: string | null;
  total: number;
  mujeres: number;
  varones: number;
}

export interface Escuela {
  id: number;
  nombre: string;
  circuito: string | null;
  electores: number;
  mesas: number | null;
  lat: number | null;
  lon: number | null;
}

export interface ElectorEncontrado {
  dni: string;
  apellido_nombre: string;
  domicilio: string | null;
  sexo: string | null;
  circuito: string | null;
  mesa: number | null;
  orden_mesa: number | null;
  establecimiento: string | null;
}

export interface DetallePadronCircuito {
  circuito: string;
  total: number;
  mujeres: number;
  varones: number;
  franjas_estimadas: { e16_25: number; e26_40: number; e41_60: number; e60_mas: number };
  escuelas: Array<{ nombre: string; electores: number; mesas: number | null }>;
}

/** Franjas etarias ESTIMADAS por rango de DNI (aclararlo siempre en la UI). */
export const FRANJAS: Array<{ clave: string; etiqueta: string; min: number | null; max: number | null }> = [
  { clave: "todas", etiqueta: "Todas las edades", min: null, max: null },
  { clave: "16_25", etiqueta: "16–25 (est.)", min: 16, max: 25 },
  { clave: "26_40", etiqueta: "26–40 (est.)", min: 26, max: 40 },
  { clave: "41_60", etiqueta: "41–60 (est.)", min: 41, max: 60 },
  { clave: "60_mas", etiqueta: "60+ (est.)", min: 61, max: null },
];

export async function obtenerResumenPadron(supabase: SupabaseClient): Promise<ResumenPadron | null> {
  const { data } = await supabase.rpc("padron_resumen");
  return (data as ResumenPadron) ?? null;
}

export async function obtenerPadronPorCircuito(
  supabase: SupabaseClient,
  filtros: { sexo?: string | null; edadMin?: number | null; edadMax?: number | null } = {},
): Promise<FilaPadronCircuito[]> {
  const { data } = await supabase.rpc("padron_por_circuito", {
    p_sexo: filtros.sexo ?? null,
    p_edad_min: filtros.edadMin ?? null,
    p_edad_max: filtros.edadMax ?? null,
  });
  return (data as FilaPadronCircuito[]) ?? [];
}

export async function obtenerEscuelas(supabase: SupabaseClient): Promise<Escuela[]> {
  const { data } = await supabase.from("escuelas").select("id, nombre, circuito, electores, mesas, lat, lon").order("electores", { ascending: false });
  return (data as Escuela[]) ?? [];
}

export async function buscarElectores(
  supabase: SupabaseClient,
  q: string,
  circuito?: string | null,
  limite = 8,
): Promise<ElectorEncontrado[]> {
  const { data } = await supabase.rpc("buscar_electores", {
    q,
    p_circuito: circuito ?? null,
    p_limite: limite,
  });
  return (data as ElectorEncontrado[]) ?? [];
}

export async function obtenerPadronDeCircuito(
  supabase: SupabaseClient,
  circuito: string,
): Promise<DetallePadronCircuito | null> {
  const { data } = await supabase.rpc("padron_de_circuito", { p_circuito: circuito });
  return (data as DetallePadronCircuito) ?? null;
}

// ── Resultados 2023 ──────────────────────────────────────────────────────────

export interface Lista2023 {
  lista_numero: number;
  lista_nombre: string;
  votos: number;
  mesas: number;
}

export interface VotosEscuela2023 {
  escuela: string;
  circuito: string | null;
  votos: number;
  mesas: number;
  electores: number;
}

export const CATEGORIAS_2023 = ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] as const;
export type Categoria2023 = (typeof CATEGORIAS_2023)[number];

export async function obtenerListas2023(supabase: SupabaseClient, categoria: string): Promise<Lista2023[]> {
  const { data } = await supabase.rpc("listas_2023", { p_categoria: categoria });
  return (data as Lista2023[]) ?? [];
}

export async function obtenerVotosPorEscuela2023(
  supabase: SupabaseClient,
  categoria: string,
  listas: number[],
): Promise<VotosEscuela2023[]> {
  if (listas.length === 0) return [];
  const { data } = await supabase.rpc("votos_por_escuela_2023", { p_categoria: categoria, p_listas: listas });
  return (data as VotosEscuela2023[]) ?? [];
}

export async function obtenerVotosPorCircuito2023(
  supabase: SupabaseClient,
  categoria: string,
  listas: number[],
): Promise<Array<{ circuito: string; votos: number }>> {
  if (listas.length === 0) return [];
  const { data } = await supabase.rpc("votos_por_circuito_2023", { p_categoria: categoria, p_listas: listas });
  return (data as Array<{ circuito: string; votos: number }>) ?? [];
}

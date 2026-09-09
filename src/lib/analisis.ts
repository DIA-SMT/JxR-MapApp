import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consultas de análisis electoral para el panel del mapa (cliente, RLS del
 * usuario). Los resultados 2025 son del escrutinio PROVISORIO de Diputado
 * Nacional y se analizan por mesa y circuito (sin cruce a escuela: la
 * numeración de mesas nacionales no es la del padrón provincial).
 */

export interface FilaRankingEspacio {
  posicion: number;
  lista_id: number;
  lista: string;
  votos: number;
  pct: number;
}

/** Ranking completo de agrupaciones dentro de un circuito (2025 o 2023). */
export async function obtenerRankingCircuito(
  supabase: SupabaseClient,
  eleccion: "2023" | "2025",
  circuito: string,
  categoria = "CONCEJAL",
): Promise<FilaRankingEspacio[]> {
  const { data } = await supabase.rpc("ranking_en_espacio", {
    p_eleccion: eleccion,
    p_categoria: categoria,
    p_nivel: "circuito",
    p_codigo: circuito,
  });
  return (data as FilaRankingEspacio[]) ?? [];
}

export interface Mesa2025 {
  mesa: number;
  electores: number;
  blanco: number;
  nulos: number;
  positivos: number;
  total: number;
}

/** Totales por mesa 2025 del circuito (electores, blancos, votantes). */
export async function obtenerMesas2025Circuito(supabase: SupabaseClient, circuito: string): Promise<Mesa2025[]> {
  const { data } = await supabase
    .from("mesas_2025")
    .select("mesa, electores, blanco, nulos, positivos, total")
    .eq("circuito", circuito)
    .order("mesa");
  return (data as Mesa2025[]) ?? [];
}

export interface VotoMesa2025 {
  mesa: number;
  agrupacion_id: number;
  agrupacion_nombre: string;
  votos: number;
}

/** Votos por mesa y agrupación 2025 del circuito (para la tabla mesa a mesa). */
export async function obtenerVotos2025Circuito(supabase: SupabaseClient, circuito: string): Promise<VotoMesa2025[]> {
  const { data } = await supabase
    .from("resultados_2025")
    .select("mesa, agrupacion_id, agrupacion_nombre, votos")
    .eq("circuito", circuito)
    .limit(2000);
  return (data as VotoMesa2025[]) ?? [];
}

/** Siglas conocidas de las agrupaciones 2025 (fallback: iniciales). */
const SIGLAS_2025: Record<number, string> = {
  94: "LLA",
  237: "FTP",
  348: "UxT",
  239: "FR",
  242: "FIT",
  243: "CREO",
  238: "FPU",
  241: "DTyP",
  349: "PCO",
};
const VACIAS = new Set(["de", "del", "la", "las", "los", "el", "y", "por", "para"]);
export function siglaAgrupacion(id: number, nombre: string): string {
  if (SIGLAS_2025[id]) return SIGLAS_2025[id];
  const letras = nombre
    .split(/\s+/)
    .filter((p) => !VACIAS.has(p.toLowerCase()))
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
  return letras.slice(0, 4) || nombre.slice(0, 4);
}

export interface MesaPeleada {
  mesa: number;
  ganador: string;
  ganadorId: number;
  votosGanador: number;
  segundo: string | null;
  segundoId: number | null;
  votosSegundo: number;
  diferencia: number;
  blanco: number;
  ausentes: number;
}

/** Arma la tabla "mesa por mesa 2025" del circuito, las más peleadas primero. */
export function armarMesasPeleadas(votos: VotoMesa2025[], mesas: Mesa2025[]): MesaPeleada[] {
  const porMesa = new Map<number, VotoMesa2025[]>();
  for (const v of votos) {
    const arr = porMesa.get(v.mesa) ?? [];
    arr.push(v);
    porMesa.set(v.mesa, arr);
  }
  const totales = new Map(mesas.map((m) => [m.mesa, m]));
  const filas: MesaPeleada[] = [];
  for (const [mesa, arr] of porMesa) {
    arr.sort((a, b) => b.votos - a.votos);
    const t = totales.get(mesa);
    const g = arr[0];
    if (!g) continue;
    const s = arr[1] ?? null;
    filas.push({
      mesa,
      ganador: siglaAgrupacion(g.agrupacion_id, g.agrupacion_nombre),
      ganadorId: g.agrupacion_id,
      votosGanador: g.votos,
      segundo: s ? siglaAgrupacion(s.agrupacion_id, s.agrupacion_nombre) : null,
      segundoId: s?.agrupacion_id ?? null,
      votosSegundo: s?.votos ?? 0,
      diferencia: g.votos - (s?.votos ?? 0),
      blanco: t?.blanco ?? 0,
      ausentes: Math.max(0, (t?.electores ?? 0) - (t?.total ?? 0)),
    });
  }
  return filas.sort((a, b) => a.diferencia - b.diferencia);
}

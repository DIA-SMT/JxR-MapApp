import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consultas de análisis electoral para el panel del mapa (cliente, RLS del
 * usuario). Los resultados 2025 son del escrutinio PROVISORIO de Diputado
 * Nacional y se analizan por mesa y circuito (sin cruce a escuela: la
 * numeración de mesas nacionales no es la del padrón provincial).
 */

// ── Perfil social (Censo 2022 por radio censal) ─────────────────────────────

export interface PerfilSocial {
  nivel: string;
  codigo: string | null;
  radios_censales: number;
  poblacion: number;
  hogares: number;
  edad: { hasta_14: number; de_15_a_64: number; de_65_y_mas: number; pct_65_y_mas: number | null };
  pobreza: {
    hogares_nbi: number;
    pct_nbi: number | null;
    hogares_con_privacion: number;
    pct_privacion: number | null;
    hogares_hacinados: number;
    pct_hacinamiento: number | null;
  };
  servicios: {
    hogares_sin_cloaca: number;
    pct_sin_cloaca: number | null;
    hogares_sin_agua_de_red: number;
    pct_sin_agua_de_red: number | null;
  };
  trabajo: {
    ocupados: number;
    desocupados: number;
    inactivos: number;
    tasa_desocupacion: number | null;
    en_relacion_de_dependencia: number;
    cuenta_propia: number;
    servicio_domestico: number;
    patron_o_empleador: number;
    empleo_publico_o_educacion_salud_publica: number;
    comercio: number;
    construccion: number;
  };
  educacion_salud: {
    secundario_completo_o_mas: number;
    hogares_clima_educativo_bajo: number;
    pct_clima_educativo_bajo: number | null;
    sin_cobertura_de_salud: number;
    pct_sin_cobertura: number | null;
  };
  fuente: string;
}

/** Perfil socioeconómico de un circuito, un barrio o toda la ciudad. */
export async function obtenerPerfilSocial(
  supabase: SupabaseClient,
  nivel: "circuito" | "barrio" | "ciudad",
  codigo: string | null,
): Promise<PerfilSocial | null> {
  const { data, error } = await supabase.rpc("perfil_social", {
    p_nivel: nivel,
    p_codigo: nivel === "ciudad" ? null : codigo,
  });
  if (error) throw new Error(error.message);
  const p = data as PerfilSocial | null;
  return p && p.poblacion > 0 ? p : null;
}

// ── Universos de listas (estrategia 2027) ───────────────────────────────────

export type NivelTerritorial = "barrio" | "circuito" | "escuela" | "mesa";

export interface FilaUniverso {
  espacio: string;
  circuito: string | null;
  votos_universo: number;
  positivos: number;
  pct_universo: number;
  electores: number;
  votantes: number;
  blancos: number;
  ausentes: number;
  participacion_pct: number;
  listas_con_votos: number;
  mesas: number;
}

export interface UniversoGuardado {
  nombre: string;
  listas: Array<{ numero: number; referente: string | null }>;
}

/** Universos de listas guardados y compartidos por el equipo. */
export async function listarUniversos(supabase: SupabaseClient, categoria = "CONCEJAL"): Promise<UniversoGuardado[]> {
  const { data } = await supabase
    .from("universos_listas")
    .select("nombre, lista_numero, referente")
    .eq("categoria", categoria)
    .order("nombre");
  const mapa = new Map<string, UniversoGuardado>();
  for (const f of (data as Array<{ nombre: string; lista_numero: number; referente: string | null }>) ?? []) {
    const u = mapa.get(f.nombre) ?? { nombre: f.nombre, listas: [] };
    u.listas.push({ numero: f.lista_numero, referente: f.referente });
    mapa.set(f.nombre, u);
  }
  return [...mapa.values()];
}

/** Distribución territorial de un universo de listas (barrio/circuito/escuela/mesa). */
export async function obtenerUniversoTerritorial(
  supabase: SupabaseClient,
  opciones: { categoria?: string; listas: number[]; nivel: NivelTerritorial; limite?: number },
): Promise<FilaUniverso[]> {
  const { data, error } = await supabase.rpc("universo_territorial", {
    p_categoria: opciones.categoria ?? "CONCEJAL",
    p_listas: opciones.listas,
    p_nivel: opciones.nivel,
    p_universo: null,
    p_eleccion: "2023",
    p_limite: opciones.limite ?? 400,
  });
  if (error) throw new Error(error.message);
  return (data as FilaUniverso[]) ?? [];
}

export interface FilaUniversoLista {
  lista_numero: number;
  lista: string;
  votos: number;
  pct_positivos: number;
  mesas: number;
}

/** Desglose lista por lista del universo, dentro de un espacio (o toda la ciudad). */
export async function obtenerUniversoPorLista(
  supabase: SupabaseClient,
  opciones: { categoria?: string; listas: number[]; nivel: NivelTerritorial; codigo: string | null },
): Promise<FilaUniversoLista[]> {
  const { data, error } = await supabase.rpc("universo_por_lista", {
    p_categoria: opciones.categoria ?? "CONCEJAL",
    p_listas: opciones.listas,
    p_nivel: opciones.nivel,
    p_codigo: opciones.codigo,
    p_universo: null,
  });
  if (error) throw new Error(error.message);
  return (data as FilaUniversoLista[]) ?? [];
}

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

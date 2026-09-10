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

// ── Ficha de inteligencia territorial (plan por circuito/barrio) ────────────

export interface FichaTerritorial {
  nivel: "circuito" | "barrio";
  codigo: string;
  segmento: string;
  problematica: string;
  mensaje: string;
  propuesta: string;
  abordaje: string;
  estado: "borrador" | "validada";
  actualizado_en?: string;
}

export const FICHA_VACIA = (nivel: "circuito" | "barrio", codigo: string): FichaTerritorial => ({
  nivel,
  codigo,
  segmento: "",
  problematica: "",
  mensaje: "",
  propuesta: "",
  abordaje: "",
  estado: "borrador",
});

export async function obtenerFicha(
  supabase: SupabaseClient,
  nivel: "circuito" | "barrio",
  codigo: string,
): Promise<FichaTerritorial | null> {
  const { data } = await supabase
    .from("fichas_territoriales")
    .select("nivel, codigo, segmento, problematica, mensaje, propuesta, abordaje, estado, actualizado_en")
    .eq("nivel", nivel)
    .eq("codigo", codigo)
    .maybeSingle();
  return (data as FichaTerritorial | null) ?? null;
}

export async function guardarFicha(supabase: SupabaseClient, ficha: FichaTerritorial): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("fichas_territoriales").upsert(
    {
      nivel: ficha.nivel,
      codigo: ficha.codigo,
      segmento: ficha.segmento.trim(),
      problematica: ficha.problematica.trim(),
      mensaje: ficha.mensaje.trim(),
      propuesta: ficha.propuesta.trim(),
      abordaje: ficha.abordaje.trim(),
      estado: ficha.estado,
      actualizado_por: u.user?.id ?? null,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "nivel,codigo" },
  );
  return error ? error.message : null;
}

// ── Índice de Oportunidad por circuito (vista "Oportunidad" del mapa) ────────

export interface OportunidadCircuito {
  circuito: string;
  /** 0–100: 40% voto disperso 2023 + 35% bolsa 2025 (blancos+ausentes) + 25% competitividad 2025. */
  indice: number;
  votosDisperso: number;
  dispersoPct: number;
  blancos2025: number;
  ausentes2025: number;
  bolsaPct: number;
  ganador2025: string;
  diferencia2025: number;
  competitividadPct: number;
  electores: number;
}

const normalizar = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0);

/**
 * Índice de Oportunidad por circuito: dónde conviene invertir estructura.
 * Cruza el voto disperso 2023 (la base propia potencial), la bolsa 2025
 * (blancos + ausentes: votos que hoy no elige nadie) y qué tan peleado quedó
 * el circuito en 2025. Todo agregado y con la cuenta a la vista.
 */
export async function calcularOportunidades(
  supabase: SupabaseClient,
  listasDisperso: number[],
): Promise<OportunidadCircuito[]> {
  const [mesasRes, ganadoresRes, universo] = await Promise.all([
    // 1.350 mesas: el rango explícito esquiva el límite de 1.000 filas de PostgREST
    supabase.from("mesas_2025").select("circuito, electores, blanco, total").range(0, 1999),
    supabase.rpc("ganadores_espacios", {
      p_eleccion: "2025",
      p_categoria: "DIPUTADO NACIONAL",
      p_nivel: "circuito",
      p_orden: "votos",
      p_limite: 60,
    }),
    listasDisperso.length > 0
      ? obtenerUniversoTerritorial(supabase, { listas: listasDisperso, nivel: "circuito", limite: 60 })
      : Promise.resolve([] as FilaUniverso[]),
  ]);

  const bolsa = new Map<string, { electores: number; blanco: number; total: number }>();
  for (const m of (mesasRes.data as Array<{ circuito: string; electores: number; blanco: number; total: number }>) ?? []) {
    const r = bolsa.get(m.circuito) ?? { electores: 0, blanco: 0, total: 0 };
    r.electores += m.electores;
    r.blanco += m.blanco;
    r.total += m.total;
    bolsa.set(m.circuito, r);
  }

  type Ganador = { espacio: string; ganador: string; diferencia: number; positivos: number };
  const ganadores = new Map<string, Ganador>();
  for (const g of (ganadoresRes.data as Ganador[]) ?? []) {
    ganadores.set(g.espacio.replace(/^Circuito /, ""), g);
  }

  const disperso = new Map<string, { votos: number; pct: number }>();
  for (const f of universo) {
    if (f.circuito) disperso.set(f.circuito, { votos: Number(f.votos_universo), pct: Number(f.pct_universo) });
  }

  const filas: OportunidadCircuito[] = [];
  for (const [circuito, b] of bolsa) {
    const g = ganadores.get(circuito);
    const d = disperso.get(circuito);
    const ausentes = Math.max(0, b.electores - b.total);
    filas.push({
      circuito,
      indice: 0,
      votosDisperso: d?.votos ?? 0,
      dispersoPct: d?.pct ?? 0,
      blancos2025: b.blanco,
      ausentes2025: ausentes,
      bolsaPct: b.electores > 0 ? (100 * (b.blanco + ausentes)) / b.electores : 0,
      ganador2025: g?.ganador ?? "?",
      diferencia2025: Number(g?.diferencia ?? 0),
      competitividadPct: g && Number(g.positivos) > 0 ? Math.max(0, 100 * (1 - Number(g.diferencia) / Number(g.positivos))) : 0,
      electores: b.electores,
    });
  }

  // Normalización min-max entre circuitos para que las tres patas pesen lo dicho
  const dMin = Math.min(...filas.map((f) => f.votosDisperso)), dMax = Math.max(...filas.map((f) => f.votosDisperso));
  const bMin = Math.min(...filas.map((f) => f.bolsaPct)), bMax = Math.max(...filas.map((f) => f.bolsaPct));
  const cMin = Math.min(...filas.map((f) => f.competitividadPct)), cMax = Math.max(...filas.map((f) => f.competitividadPct));
  for (const f of filas) {
    f.indice = Math.round(
      100 *
        (0.4 * normalizar(f.votosDisperso, dMin, dMax) +
          0.35 * normalizar(f.bolsaPct, bMin, bMax) +
          0.25 * normalizar(f.competitividadPct, cMin, cMax)),
    );
  }
  return filas.sort((a, b) => b.indice - a.indice);
}

// ── Comparador 2023 ↔ 2025 (vista "2023↔2025" del mapa) ─────────────────────

export interface ListaEleccion {
  lista_id: number;
  lista: string;
  votos: number;
  pct: number;
}

/** Ranking de listas de una elección (para poblar los selectores del comparador). */
export async function listarListasEleccion(
  supabase: SupabaseClient,
  eleccion: "2023" | "2025",
  categoria = "CONCEJAL",
): Promise<ListaEleccion[]> {
  const { data } = await supabase.rpc("listas_eleccion", {
    p_eleccion: eleccion,
    p_categoria: eleccion === "2023" ? categoria : null,
  });
  return (data as ListaEleccion[]) ?? [];
}

export interface DeltaCircuito {
  circuito: string;
  votos_2023: number;
  pct_2023: number;
  votos_2025: number;
  pct_2025: number;
  delta_pct: number;
}

/** Delta de % por circuito entre una lista 2023 y una agrupación 2025. */
export async function compararListasCircuitos(
  supabase: SupabaseClient,
  lista2023: number,
  lista2025: number,
  categoria2023 = "CONCEJAL",
): Promise<DeltaCircuito[]> {
  const { data, error } = await supabase.rpc("comparar_elecciones", {
    p_lista_2023: lista2023,
    p_lista_2025: lista2025,
    p_categoria_2023: categoria2023,
  });
  if (error) throw new Error(error.message);
  return (data as DeltaCircuito[]) ?? [];
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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultadoAsignacion } from "./asignacion";
import type { BarrioNecesidad, Clase, Partida, Politica, TipoPolitica } from "./presupuesto";

/**
 * Acceso a datos de la herramienta de asignación presupuestaria. El cálculo
 * vive en asignacion.ts y presupuesto.ts (puros y probados); acá solo se lee y
 * se escribe en la base, que vuelve a validar todo lo importante.
 */

export const EJERCICIO = 2026;

export interface Ejercicio {
  ejercicio: number;
  total_corrientes: number;
  total_capital: number;
  norma: string;
  notas: string;
}

export interface Veda {
  id: number;
  desde: string;
  hasta: string;
  motivo: string;
  norma: string;
}

export interface PartidaEstado extends Partida {
  estimada: boolean;
  fuente_dato: string;
  actualizado_en: string;
  disponible: number;
  reservado: number;
  libre: number;
  /** Lo reservado que ya no entra en la partida (bajó el crédito o subió el comprometido). */
  excedido: number;
}

export type EstadoEscenario = "borrador" | "propuesto" | "aprobado" | "ejecutado" | "descartado";

export interface Escenario {
  id: number;
  ejercicio: number;
  nombre: string;
  criterio: string;
  estado: EstadoEscenario;
  parametros: Record<string, unknown>;
  resumen: { asignado?: number; barrios?: number; politicas?: number; ajustes?: number };
  avisos: string[];
  norma: string;
  boletin: string;
  ejecucion: string;
  creado_por: string | null;
  creado_email: string;
  creado_en: string;
  propuesto_en: string | null;
  aprobado_por: string | null;
  aprobado_email: string;
  aprobado_en: string | null;
}

export interface EntradaBitacora {
  id: number;
  cuando: string;
  quien_email: string;
  tabla: string;
  accion: string;
  registro: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
}

export type PoliticaCatalogo = Politica & { ambito: string; eje: string; secretaria: string; notas: string };

const num = (v: unknown) => (v == null ? 0 : Number(v));

/**
 * Trae todas las filas paginando: PostgREST corta en 1000 sin avisar, también
 * en las funciones que devuelven un conjunto.
 */
async function todas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function puedePresupuesto(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("puede_presupuesto");
  return !error && data === true;
}

export async function obtenerEjercicio(supabase: SupabaseClient, ejercicio = EJERCICIO): Promise<Ejercicio | null> {
  const { data, error } = await supabase.from("presupuesto_ejercicios").select("*").eq("ejercicio", ejercicio).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, total_corrientes: num(data.total_corrientes), total_capital: num(data.total_capital) } as Ejercicio;
}

export async function obtenerVedas(supabase: SupabaseClient): Promise<Veda[]> {
  const { data, error } = await supabase.from("presupuesto_vedas").select("*").order("desde");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Veda[]).map((v) => ({ ...v, id: Number(v.id) }));
}

export async function obtenerPartidas(supabase: SupabaseClient, ejercicio = EJERCICIO): Promise<PartidaEstado[]> {
  const filas = await todas<Record<string, unknown>>((d, h) =>
    supabase.rpc("presupuesto_partidas_estado", { p_ejercicio: ejercicio }).range(d, h),
  );
  return filas.map((r) => ({
    id: Number(r.id),
    codigo: String(r.codigo ?? ""),
    anexo: String(r.anexo ?? ""),
    jurisdiccion: String(r.jurisdiccion ?? ""),
    programa: String(r.programa ?? ""),
    clase: r.clase as Clase,
    partida_principal: String(r.partida_principal ?? ""),
    afectacion: String(r.afectacion ?? ""),
    credito_vigente: num(r.credito_vigente),
    comprometido: num(r.comprometido),
    estimada: Boolean(r.estimada),
    fuente_dato: String(r.fuente_dato ?? ""),
    actualizado_en: String(r.actualizado_en ?? ""),
    disponible: num(r.disponible),
    reservado: num(r.reservado),
    libre: num(r.libre),
    excedido: num(r.excedido),
  }));
}

export type NuevaPartida = Omit<Partida, "id"> & { estimada?: boolean; fuente_dato?: string };

const filaPartida = (f: NuevaPartida, ejercicio: number) => ({
  ejercicio,
  codigo: f.codigo,
  anexo: f.anexo,
  jurisdiccion: f.jurisdiccion,
  programa: f.programa,
  clase: f.clase,
  partida_principal: f.partida_principal,
  afectacion: f.afectacion,
  credito_vigente: f.credito_vigente,
  comprometido: f.comprometido,
  estimada: f.estimada ?? false,
  fuente_dato: f.fuente_dato ?? "",
});

/**
 * Carga o actualiza partidas por (ejercicio, código). Una partida que ya
 * existe conserva su id, así los escenarios que la usan no se rompen. Los
 * códigos tienen que venir únicos (leerPartidas lo controla); igual se
 * rechaza acá, porque un upsert con dos filas iguales falla a mitad de carga.
 */
export async function guardarPartidas(
  supabase: SupabaseClient,
  filas: NuevaPartida[],
  ejercicio = EJERCICIO,
): Promise<string | null> {
  if (filas.length === 0) return null;
  const codigos = new Set<string>();
  for (const f of filas) {
    if (codigos.has(f.codigo)) return `El código «${f.codigo}» está repetido: no se cargó nada.`;
    codigos.add(f.codigo);
  }
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500).map((f) => filaPartida(f, ejercicio));
    const { error } = await supabase.from("presupuesto_partidas").upsert(lote, { onConflict: "ejercicio,codigo" });
    if (error) {
      return i > 0
        ? `${error.message}. Se cargaron las primeras ${i} partidas; revisá y volvé a cargar el archivo completo.`
        : error.message;
    }
  }
  return null;
}

/** Agrega UNA partida nueva. Si el código ya existe no la pisa: devuelve el error. */
export async function agregarPartida(supabase: SupabaseClient, f: NuevaPartida, ejercicio = EJERCICIO): Promise<string | null> {
  const { error } = await supabase.from("presupuesto_partidas").insert(filaPartida(f, ejercicio));
  if (!error) return null;
  if (error.code === "23505") return `Ya existe una partida con el código «${f.codigo}»: no se reemplaza por una estimación.`;
  return error.message;
}

export async function borrarPartida(supabase: SupabaseClient, id: number): Promise<string | null> {
  const { error } = await supabase.from("presupuesto_partidas").delete().eq("id", id);
  if (!error) return null;
  // la FK es "on delete restrict": según la versión de Postgres llega como 23503 o 23001
  if (error.code === "23503" || error.code === "23001") return "Esta partida financia algún escenario guardado: no se puede borrar.";
  return error.message;
}

export async function obtenerPoliticas(supabase: SupabaseClient): Promise<PoliticaCatalogo[]> {
  const { data, error } = await supabase.from("politicas_publicas").select("*").order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: Number(r.id),
      codigo: String(r.codigo ?? ""),
      nombre: String(r.nombre ?? ""),
      tipo: r.tipo as TipoPolitica,
      clase: r.clase as Clase,
      unidad: String(r.unidad ?? ""),
      costo_unitario: r.costo_unitario == null ? null : num(r.costo_unitario),
      indicador: String(r.indicador ?? ""),
      partidas_principales: (r.partidas_principales as string[]) ?? [],
      afectaciones: (r.afectaciones as string[]) ?? [],
      prioridad: num(r.prioridad),
      piso: r.piso == null ? null : num(r.piso),
      tope: r.tope == null ? null : num(r.tope),
      activa: Boolean(r.activa),
      ambito: String(r.ambito ?? ""),
      eje: String(r.eje ?? ""),
      secretaria: String(r.secretaria ?? ""),
      notas: String(r.notas ?? ""),
    }))
    .sort((a, b) => ordenCodigo(a.codigo, b.codigo));
}

/** "2.2" antes que "10.1": el orden del Plan Rector, no el alfabético. */
export function ordenCodigo(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return a.localeCompare(b);
}

export async function guardarPolitica(
  supabase: SupabaseClient,
  id: number,
  cambios: Partial<Omit<Politica, "id" | "codigo">>,
): Promise<string | null> {
  const { error } = await supabase.from("politicas_publicas").update(cambios).eq("id", id);
  return error ? error.message : null;
}

/** El censo por barrio, con los nombres de indicador que usa presupuesto.ts. */
export async function obtenerNecesidadBarrios(supabase: SupabaseClient): Promise<BarrioNecesidad[]> {
  const filas = await todas<Record<string, unknown>>((d, h) => supabase.rpc("necesidad_barrios").range(d, h));
  return filas.map((r) => {
    const poblacion = num(r.poblacion);
    const hogares = num(r.hogares);
    return {
      id: String(r.barrio),
      nombre: String(r.barrio),
      poblacion,
      hogares,
      indicadores: {
        nbi: num(r.hogares_nbi),
        privacion: num(r.hogares_privacion),
        hacinamiento: num(r.hogares_hacinamiento),
        clima_educativo_bajo: num(r.hogares_clima_edu_bajo),
        sin_cloaca: num(r.hogares_sin_cloaca),
        sin_agua_red: num(r.hogares_sin_agua_red),
        hogares,
        ocupados: num(r.ocupados),
        desocupados: num(r.desocupados),
        sin_cobertura_salud: num(r.sin_cobertura_salud),
        poblacion_0_14: num(r.pob_hasta14),
        poblacion_15_64: num(r.pob_15_64),
        poblacion_65_mas: num(r.pob_65mas),
        poblacion,
      },
    };
  });
}

export async function listarEscenarios(supabase: SupabaseClient, ejercicio = EJERCICIO): Promise<Escenario[]> {
  const filas = await todas<Escenario>((d, h) =>
    supabase
      .from("escenarios_presupuesto")
      .select("*")
      .eq("ejercicio", ejercicio)
      .order("creado_en", { ascending: false })
      .order("id", { ascending: false })
      .range(d, h),
  );
  return filas.map((e) => ({ ...e, id: Number(e.id), avisos: Array.isArray(e.avisos) ? e.avisos : [] }));
}

export interface DetalleEscenario {
  asignaciones: Array<{
    politica_id: number;
    barrio: string;
    monto: number;
    unidades: number;
    fijado: boolean;
    politica_codigo: string;
    politica_nombre: string;
    politica_tipo: string;
    unidad: string;
  }>;
  financiamiento: Array<{ partida_id: number; politica_id: number; monto: number; partida_codigo: string; partida_principal: string }>;
  ajustes: Array<{ politica_id: number; barrio: string; monto_motor: number; monto_fijado: number; motivo: string }>;
}

export async function obtenerDetalleEscenario(supabase: SupabaseClient, id: number): Promise<DetalleEscenario> {
  const [asignaciones, financiamiento, ajustes] = await Promise.all([
    todas<Record<string, unknown>>((d, h) =>
      supabase.from("escenario_asignaciones").select("*").eq("escenario_id", id).order("politica_id").order("barrio").range(d, h),
    ),
    todas<Record<string, unknown>>((d, h) =>
      supabase.from("escenario_financiamiento").select("*").eq("escenario_id", id).order("partida_id").order("politica_id").range(d, h),
    ),
    todas<Record<string, unknown>>((d, h) =>
      supabase.from("escenario_ajustes").select("*").eq("escenario_id", id).order("politica_id").order("barrio").range(d, h),
    ),
  ]);
  return {
    asignaciones: asignaciones.map((a) => ({
      politica_id: Number(a.politica_id),
      barrio: String(a.barrio),
      monto: num(a.monto),
      unidades: num(a.unidades),
      fijado: Boolean(a.fijado),
      politica_codigo: String(a.politica_codigo ?? ""),
      politica_nombre: String(a.politica_nombre ?? ""),
      politica_tipo: String(a.politica_tipo ?? ""),
      unidad: String(a.unidad ?? ""),
    })),
    financiamiento: financiamiento.map((f) => ({
      partida_id: Number(f.partida_id),
      politica_id: Number(f.politica_id),
      monto: num(f.monto),
      partida_codigo: String(f.partida_codigo ?? ""),
      partida_principal: String(f.partida_principal ?? ""),
    })),
    ajustes: ajustes.map((a) => ({
      politica_id: Number(a.politica_id),
      barrio: String(a.barrio),
      monto_motor: num(a.monto_motor),
      monto_fijado: num(a.monto_fijado),
      motivo: String(a.motivo ?? ""),
    })),
  };
}

export interface Ajuste {
  politica: string;
  barrio: string;
  montoMotor: number;
  montoFijado: number;
  motivo: string;
}

/** Guarda el resultado del motor como escenario. La base revalida todo y calcula el resumen. */
export async function guardarEscenario(
  supabase: SupabaseClient,
  datos: {
    nombre: string;
    criterio: string;
    parametros: Record<string, unknown>;
    resultado: ResultadoAsignacion;
    ajustes: Ajuste[];
    /** Costo por unidad con que se calculó cada política: la base rechaza si cambió. */
    costos: Map<string, number>;
  },
  ejercicio = EJERCICIO,
): Promise<{ id: number | null; error: string | null }> {
  const r = datos.resultado;
  const fijados = new Set(datos.ajustes.map((a) => `${a.politica}|${a.barrio}`));
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const { data, error } = await supabase.rpc("guardar_escenario", {
    p_nombre: datos.nombre,
    p_criterio: datos.criterio,
    p_parametros: datos.parametros,
    p_asignaciones: r.asignaciones.map((a) => ({
      politica_id: Number(a.politica),
      barrio: a.destino,
      monto: centavos(a.monto),
      unidades: a.unidades,
      fijado: fijados.has(`${a.politica}|${a.destino}`),
      costo_unitario: datos.costos.get(a.politica),
    })),
    p_financiamiento: r.financiamiento.map((f) => ({
      partida_id: Number(f.fuente),
      politica_id: Number(f.politica),
      monto: centavos(f.monto),
    })),
    p_ajustes: datos.ajustes.map((a) => ({
      politica_id: Number(a.politica),
      barrio: a.barrio,
      monto_motor: centavos(a.montoMotor),
      monto_fijado: centavos(a.montoFijado),
      motivo: a.motivo,
    })),
    p_avisos: r.avisos,
    p_ejercicio: ejercicio,
  });
  if (error) {
    if (error.code === "23514") return { id: null, error: "Los montos no cuadran con el costo por unidad vigente: recalculá y volvé a guardar." };
    return { id: null, error: error.message };
  }
  return { id: Number(data), error: null };
}

export async function cambiarEstadoEscenario(
  supabase: SupabaseClient,
  id: number,
  estado: EstadoEscenario,
  norma = "",
  boletin = "",
): Promise<string | null> {
  const { error } = await supabase.rpc("cambiar_estado_escenario", {
    p_id: id,
    p_estado: estado,
    p_norma: norma,
    p_boletin: boletin,
  });
  return error ? error.message : null;
}

export async function borrarEscenario(supabase: SupabaseClient, id: number): Promise<string | null> {
  const { error } = await supabase.rpc("borrar_escenario", { p_id: id });
  return error ? error.message : null;
}

export async function obtenerBitacora(supabase: SupabaseClient, limite = 100): Promise<EntradaBitacora[]> {
  const { data, error } = await supabase
    .from("presupuesto_bitacora")
    .select("*")
    .order("cuando", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as EntradaBitacora[];
}

export interface Acceso {
  perfil_id: string;
  email: string;
  nombre: string;
  rol: string;
  habilitado: boolean;
}

export async function obtenerAccesos(supabase: SupabaseClient): Promise<Acceso[]> {
  const { data, error } = await supabase.rpc("presupuesto_accesos");
  if (error) throw new Error(error.message);
  return (data ?? []) as Acceso[];
}

export async function habilitarAcceso(supabase: SupabaseClient, perfil: string, habilitar: boolean): Promise<string | null> {
  const { error } = await supabase.rpc("presupuesto_habilitar", { p_perfil: perfil, p_habilitar: habilitar });
  return error ? error.message : null;
}

// ── Seguimiento de la ejecución (migración 0017) ───────────────────────────

export type EstadoEjecucion = "pendiente" | "en_curso" | "terminado" | "no_se_hara";

export interface FilaEjecucion {
  politica_id: number;
  barrio: string;
  estado: EstadoEjecucion;
  monto_ejecutado: number;
  unidades_logradas: number;
  expediente: string;
  nota: string;
  actualizado_email: string;
  actualizado_en: string | null;
}

/** Avisa con un mensaje claro si la base todavía no tiene la migración 0017. */
export class SinSeguimiento extends Error {}

export async function obtenerEjecucion(supabase: SupabaseClient, escenario: number): Promise<FilaEjecucion[]> {
  const out: FilaEjecucion[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from("escenario_ejecucion")
      .select("*")
      .eq("escenario_id", escenario)
      .order("politica_id")
      .order("barrio")
      .range(desde, desde + 999);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205")
        throw new SinSeguimiento("El seguimiento todavía no está activado en la base (falta la migración 0017).");
      throw new Error(error.message);
    }
    for (const f of data ?? []) {
      out.push({
        politica_id: Number(f.politica_id),
        barrio: String(f.barrio),
        estado: f.estado as EstadoEjecucion,
        monto_ejecutado: num(f.monto_ejecutado),
        unidades_logradas: num(f.unidades_logradas),
        expediente: String(f.expediente ?? ""),
        nota: String(f.nota ?? ""),
        actualizado_email: String(f.actualizado_email ?? ""),
        actualizado_en: f.actualizado_en ? String(f.actualizado_en) : null,
      });
    }
    if (!data || data.length < 1000) return out;
  }
}

export async function registrarEjecucion(
  supabase: SupabaseClient,
  escenario: number,
  filas: Array<Omit<FilaEjecucion, "actualizado_email" | "actualizado_en">>,
): Promise<string | null> {
  const { error } = await supabase.rpc("registrar_ejecucion", {
    p_escenario: escenario,
    p_items: filas.map((f) => ({
      politica_id: f.politica_id,
      barrio: f.barrio,
      estado: f.estado,
      monto_ejecutado: Math.round(f.monto_ejecutado * 100) / 100,
      unidades_logradas: f.unidades_logradas,
      expediente: f.expediente,
      nota: f.nota,
    })),
  });
  if (error?.code === "PGRST202") return "El seguimiento todavía no está activado en la base (falta la migración 0017).";
  return error ? error.message : null;
}

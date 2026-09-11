import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DÍA D — la jornada electoral: fiscales por mesa, participación en vivo,
 * incidencias y escrutinio propio. Todo lo configura el administrador desde
 * la misma pantalla (`diad_config`, fila única).
 */

export interface ConfigDiaD {
  eleccion: string;
  categoria: string;
  bancas: number;
  mesas_esperadas: number;
  listas: string[];
  activa: boolean;
  fecha: string | null;
  hora_apertura: string;
  hora_cierre: string;
  meta_votos: number;
  telefono_comando: string;
  cortes: string[];
}

export const ESTADOS_FISCAL = ["asignado", "confirmado", "presente", "ausente"] as const;
export type EstadoFiscal = (typeof ESTADOS_FISCAL)[number];

/** Cómo se lee cada estado y con qué color, una sola definición para toda la UI. */
export const CHIP_FISCAL: Record<EstadoFiscal, { texto: string; clase: string; ayuda: string }> = {
  asignado: { texto: "Asignado", clase: "border-borde-2 text-texto-2", ayuda: "Anotado, todavía no confirmó" },
  confirmado: { texto: "Confirmó", clase: "border-celeste/50 bg-celeste/10 text-celeste", ayuda: "Avisó que va" },
  presente: { texto: "Presente", clase: "border-completo/50 bg-completo/10 text-completo", ayuda: "Está en la escuela" },
  ausente: { texto: "Ausente", clase: "border-sin/50 bg-sin/10 text-sin", ayuda: "No llegó: hay que reemplazarlo" },
};

export const TIPOS_INCIDENCIA = [
  "falta fiscal",
  "faltan boletas",
  "urna sin faja",
  "problema con la autoridad de mesa",
  "mesa no abrió",
  "corte de luz",
  "aprietes o presión",
  "traslado de votantes",
  "otro",
] as const;

export interface Mesa {
  mesa: number;
  escuela: string | null;
  circuito: string | null;
  electores: number;
}

export interface FiscalMesa {
  mesa: number;
  escuela: string;
  circuito: string;
  persona_id: number | null;
  nombre: string;
  telefono: string;
  rol: string;
  estado: EstadoFiscal;
  notas: string;
}

export interface CoberturaEspacio {
  espacio: string;
  circuito: string | null;
  mesas: number;
  electores: number;
  con_fiscal: number;
  confirmados: number;
  presentes: number;
  ausentes: number;
  sin_fiscal: number;
  pct_cubierto: number;
}

export interface Incidencia {
  id: number;
  mesa: number | null;
  escuela: string;
  circuito: string;
  tipo: string;
  gravedad: "baja" | "media" | "alta";
  detalle: string;
  estado: "abierta" | "resuelta";
  creado_en: string;
}

export interface ParticipacionCircuito {
  circuito: string;
  mesas_reportadas: number;
  mesas_totales: number;
  votaron: number;
  electores_reportados: number;
  pct: number | null;
}

// ── Contacto en un clic ─────────────────────────────────────────────────────

/**
 * Enlaces para llamar y para WhatsApp desde un teléfono anotado a mano.
 *
 * `tel:` acepta el número como lo escribieron (el teléfono del que llama sabe
 * marcar formatos locales). WhatsApp, en cambio, exige el formato
 * internacional sin signos, así que hay que normalizar: en Argentina el número
 * significativo son 10 dígitos (área + abonado) y los móviles llevan el 9
 * después del 54. El viejo "15" va DESPUÉS del código de área, así que se quita
 * probando las tres longitudes de área posibles.
 *
 * Si el número no queda en 10 dígitos no se arriesga un enlace equivocado:
 * devuelve `whatsapp: null` y la interfaz solo ofrece llamar.
 */
export function contacto(telefono: string): { tel: string | null; whatsapp: string | null; crudo: string } {
  const crudo = (telefono ?? "").trim();
  const digitos = crudo.replace(/\D/g, "");
  if (digitos.length < 6) return { tel: null, whatsapp: null, crudo };

  const tel = `tel:${crudo.startsWith("+") ? "+" : ""}${digitos}`;

  let n = digitos;
  if (n.startsWith("54")) n = n.slice(2);
  if (n.startsWith("9")) n = n.slice(1);
  if (n.startsWith("0")) n = n.slice(1);
  if (n.length === 12) {
    for (const largoArea of [2, 3, 4]) {
      if (n.slice(largoArea, largoArea + 2) === "15") {
        n = n.slice(0, largoArea) + n.slice(largoArea + 2);
        break;
      }
    }
  }
  return { tel, whatsapp: n.length === 10 ? `https://wa.me/549${n}` : null, crudo };
}

/** Mensaje inicial de WhatsApp, con el contexto de la mesa ya escrito. */
export function enlaceWhatsApp(base: string, mesa: number, escuela: string, eleccion: string): string {
  const texto = `Hola, te escribo del comando territorial JxR por la mesa ${mesa} (${escuela}) — ${eleccion}.`;
  return `${base}?text=${encodeURIComponent(texto)}`;
}

// ── Configuración ───────────────────────────────────────────────────────────

export async function obtenerConfig(supabase: SupabaseClient): Promise<ConfigDiaD | null> {
  const { data } = await supabase
    .from("diad_config")
    .select("eleccion, categoria, bancas, mesas_esperadas, listas, activa, fecha, hora_apertura, hora_cierre, meta_votos, telefono_comando, cortes")
    .eq("id", 1)
    .maybeSingle();
  return (data as ConfigDiaD | null) ?? null;
}

export async function guardarConfig(
  supabase: SupabaseClient,
  cambios: Partial<ConfigDiaD>,
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("diad_config")
    .update({ ...cambios, actualizado_por: u.user?.id ?? null, actualizado_en: new Date().toISOString() })
    .eq("id", 1);
  return error ? error.message : null;
}

// ── Mesas y fiscales ────────────────────────────────────────────────────────

/** Las 1.087 mesas del padrón provincial, con su escuela y circuito. */
export async function obtenerMesas(supabase: SupabaseClient): Promise<Mesa[]> {
  let todas: Mesa[] = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("mesas")
      .select("mesa, escuela, circuito, electores")
      .order("mesa")
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    todas = todas.concat(data as Mesa[]);
    if (data.length < 1000) break;
    desde += 1000;
  }
  return todas;
}

export async function obtenerFiscales(supabase: SupabaseClient): Promise<FiscalMesa[]> {
  const { data, error } = await supabase
    .from("diad_fiscales")
    .select("mesa, escuela, circuito, persona_id, nombre, telefono, rol, estado, notas")
    .range(0, 1999);
  if (error) throw new Error(error.message);
  return (data as FiscalMesa[]) ?? [];
}

export async function guardarFiscal(supabase: SupabaseClient, fiscal: FiscalMesa): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("diad_fiscales").upsert(
    {
      mesa: fiscal.mesa,
      escuela: fiscal.escuela,
      circuito: fiscal.circuito,
      persona_id: fiscal.persona_id,
      nombre: fiscal.nombre.trim(),
      telefono: fiscal.telefono.trim(),
      rol: fiscal.rol.trim() || "fiscal de mesa",
      estado: fiscal.estado,
      notas: fiscal.notas.trim(),
      actualizado_por: u.user?.id ?? null,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "mesa" },
  );
  return error ? error.message : null;
}

export async function quitarFiscal(supabase: SupabaseClient, mesa: number): Promise<string | null> {
  const { error } = await supabase.from("diad_fiscales").delete().eq("mesa", mesa);
  return error ? error.message : null;
}

export async function obtenerCobertura(
  supabase: SupabaseClient,
  nivel: "escuela" | "circuito",
): Promise<CoberturaEspacio[]> {
  const { data, error } = await supabase.rpc("diad_cobertura", { p_nivel: nivel });
  if (error) throw new Error(error.message);
  return (data as CoberturaEspacio[]) ?? [];
}

// ── Participación por cortes ────────────────────────────────────────────────

export async function obtenerParticipacion(
  supabase: SupabaseClient,
  corte: string,
): Promise<ParticipacionCircuito[]> {
  const { data, error } = await supabase.rpc("diad_participacion", { p_corte: corte });
  if (error) throw new Error(error.message);
  return (data as ParticipacionCircuito[]) ?? [];
}

export async function obtenerAsistencia(
  supabase: SupabaseClient,
  corte: string,
): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("diad_asistencia")
    .select("mesa, votaron")
    .eq("corte", corte)
    .range(0, 1999);
  if (error) throw new Error(error.message);
  return new Map(((data as Array<{ mesa: number; votaron: number }>) ?? []).map((f) => [f.mesa, f.votaron]));
}

export async function guardarAsistencia(
  supabase: SupabaseClient,
  mesa: number,
  corte: string,
  votaron: number,
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("diad_asistencia").upsert(
    { mesa, corte, votaron: Math.max(0, votaron), cargado_por: u.user?.id ?? null, cargado_en: new Date().toISOString() },
    { onConflict: "mesa,corte" },
  );
  return error ? error.message : null;
}

// ── Incidencias ─────────────────────────────────────────────────────────────

export async function obtenerIncidencias(supabase: SupabaseClient): Promise<Incidencia[]> {
  const { data, error } = await supabase
    .from("diad_incidencias")
    .select("id, mesa, escuela, circuito, tipo, gravedad, detalle, estado, creado_en")
    .order("creado_en", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as Incidencia[]) ?? [];
}

export async function crearIncidencia(
  supabase: SupabaseClient,
  i: Omit<Incidencia, "id" | "creado_en" | "estado">,
): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("diad_incidencias").insert({ ...i, creado_por: u.user?.id ?? null });
  return error ? error.message : null;
}

export async function resolverIncidencia(
  supabase: SupabaseClient,
  id: number,
  resuelta: boolean,
): Promise<string | null> {
  const { error } = await supabase
    .from("diad_incidencias")
    .update({ estado: resuelta ? "resuelta" : "abierta", resuelto_en: resuelta ? new Date().toISOString() : null })
    .eq("id", id);
  return error ? error.message : null;
}

/**
 * Reglas y conversiones de la herramienta de asignación presupuestaria.
 *
 * Todo lo que está acá es puro (sin base ni navegador) para poder probarlo: la
 * lectura del reporte de partidas, la regla que dice qué partida puede pagar
 * qué política, y el armado de las entradas del motor (src/lib/asignacion.ts).
 *
 * La clasificación es la de la Ordenanza de Contabilidad 570/80 de San Miguel
 * de Tucumán (Anexo → Ítem → Sección → Partida Principal), no la de incisos
 * del presupuesto nacional.
 *
 * Lo que la herramienta NO hace, por diseño:
 * - No lee datos electorales. La necesidad sale del Censo 2022 por radio.
 * - No asigna a personas con nombre: las políticas dirigidas a personas se
 *   planifican como CUPOS por barrio. Quién recibe cada cupo lo resuelve el
 *   área que ejecuta el programa, con su registro y su marco legal.
 */

import type { Fuente, Necesidad, PoliticaEntrada } from "./asignacion.ts";

export type Clase = "corriente" | "capital";
export type TipoPolitica = "obra" | "servicio" | "transferencia_personas" | "programa_social" | "institucional";

export interface Partida {
  id: number;
  codigo: string;
  anexo: string;
  /** Ítem (repartición). */
  jurisdiccion: string;
  programa: string;
  clase: Clase;
  /** Partida Principal de la Ord. 570/80: "12", "31", "52"… */
  partida_principal: string;
  /** '' = rentas generales (libre disponibilidad); si no, la afectación específica del recurso. */
  afectacion: string;
  credito_vigente: number;
  comprometido: number;
}

export interface Politica {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoPolitica;
  clase: Clase;
  unidad: string;
  costo_unitario: number | null;
  indicador: string;
  /** Partidas principales que la pueden pagar. */
  partidas_principales: string[];
  afectaciones: string[];
  prioridad: number;
  piso: number | null;
  tope: number | null;
  activa: boolean;
}

/** Un barrio con los indicadores de necesidad del censo (conteos, no tasas). */
export interface BarrioNecesidad {
  id: string;
  nombre: string;
  poblacion: number;
  hogares: number;
  indicadores: Record<string, number>;
}

// ── Nomenclador (Ord. 570/80, arts. 3 y 5) ─────────────────────────────────

export const PARTIDAS_PRINCIPALES: Record<string, { nombre: string; clase: Clase; asignable: boolean }> = {
  "11": { nombre: "Personal", clase: "corriente", asignable: false },
  "12": { nombre: "Bienes y servicios no personales", clase: "corriente", asignable: true },
  "13": { nombre: "Servicios públicos", clase: "corriente", asignable: true },
  "21": { nombre: "Intereses", clase: "corriente", asignable: false },
  "31": { nombre: "Transferencias corrientes", clase: "corriente", asignable: true },
  "41": { nombre: "Crédito adicional corriente", clase: "corriente", asignable: true },
  "32": { nombre: "Transferencias de capital", clase: "capital", asignable: true },
  "51": { nombre: "Bienes de capital", clase: "capital", asignable: true },
  "52": { nombre: "Trabajos públicos", clase: "capital", asignable: true },
  "61": { nombre: "Inversión financiera", clase: "capital", asignable: false },
  "71": { nombre: "Amortización de la deuda", clase: "capital", asignable: false },
  "81": { nombre: "Crédito adicional de capital", clase: "capital", asignable: true },
};

/** Personal, intereses, inversión financiera y amortización nunca se reparten a políticas. */
export const esAsignable = (pp: string) => PARTIDAS_PRINCIPALES[pp]?.asignable ?? false;

const sinAcentos = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Nombres con que puede venir escrita una partida principal en el reporte. */
// De lo más específico a lo más general: "Bienes y servicios NO PERSONALES"
// contiene "personal" y no es la partida 11.
const PP_POR_NOMBRE: Array<[string, string]> = [
  ["bienes y servicios", "12"],
  ["servicios no personales", "12"],
  ["servicios publicos", "13"],
  ["intereses", "21"],
  ["transferencias corrientes", "31"],
  ["transferencias para erogaciones corrientes", "31"],
  ["transferencias de capital", "32"],
  ["transferencias para erogaciones de capital", "32"],
  ["bienes de capital", "51"],
  ["trabajos publicos", "52"],
  ["inversion financiera", "61"],
  ["amortizacion", "71"],
  ["personal", "11"],
];

/**
 * Normaliza la partida principal: "52", "5.2", "052", "5200" (parcial) o el
 * nombre ("Trabajos Públicos") → "52". Devuelve '' si no la reconoce.
 */
export function normalizarPP(valor: string): string {
  const texto = sinAcentos(valor);
  const digitos = valor.replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (digitos.length >= 2) {
    const pp = digitos.slice(0, 2);
    if (PARTIDAS_PRINCIPALES[pp]) return pp;
  }
  for (const [nombre, pp] of PP_POR_NOMBRE) {
    if (pp === "11" && /no personal/.test(texto)) continue;
    if (texto.includes(nombre)) return pp;
  }
  return "";
}

/** Clase económica: lo que diga el reporte, o si no, la sección de su partida principal. */
export function inferirClase(valor: string, pp: string): Clase {
  const v = sinAcentos(valor);
  if (v.includes("capital")) return "capital";
  if (v.includes("corriente")) return "corriente";
  return PARTIDAS_PRINCIPALES[pp]?.clase ?? "corriente";
}

// ── Indicadores ────────────────────────────────────────────────────────────

export type BaseIndicador = "hogares" | "poblacion" | "activos";

/**
 * Qué mide cada indicador y sobre qué base se calcula su intensidad. La base
 * importa: "sin cloaca" se cuenta en hogares, la desocupación sobre la
 * población activa (ocupados + desocupados) y la cobertura de salud sobre la
 * población, y comparar un barrio con la ciudad solo tiene sentido sobre la
 * misma base.
 *
 * Son SOLO las variables del Censo 2022 que están importadas (radios_censo,
 * migración 0012). Faltan jóvenes de 15 a 24, sexo, internet, baño y calidad
 * de materiales: están en el ZIP del INDEC pero no se cargaron; hasta que se
 * carguen, una política que las necesite queda sin indicador.
 */
const SIN_PLURAL = new Set(["de", "del", "en", "con", "sin", "a", "para", "por", "y"]);
const SIN_TILDE: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };

/**
 * La unidad de una política en plural ("persona mayor" → "personas mayores",
 * "conexión" → "conexiones"), para escribir "418 hogares" y no "418 hogar".
 * Solo se pluralizan las palabras hasta la primera preposición: "cupo en
 * taller" → "cupos en taller".
 */
export function plural(unidad: string, n = 2): string {
  const u = unidad.trim();
  if (!u) return n === 1 ? "unidad" : "unidades";
  if (n === 1) return u;
  const palabras = u.split(/\s+/);
  let corte = palabras.findIndex((p) => SIN_PLURAL.has(p.toLowerCase()));
  if (corte < 0) corte = palabras.length;
  return palabras
    .map((p, i) => {
      if (i >= corte || /\d/.test(p) || /[sx]$/i.test(p)) return p;
      if (/[aeiouáéó]$/i.test(p)) return p + "s";
      if (/z$/i.test(p)) return p.slice(0, -1) + "ces";
      return p.replace(/([áéíóú])([nsl])$/, (_, v: string, c: string) => SIN_TILDE[v] + c) + "es";
    })
    .join(" ");
}

/** Un porcentaje con coma decimal, como se escribe acá: 22,4%. */
export function pct(x: number, decimales = 1): string {
  const v = Number.isFinite(x) ? x : 0;
  return `${v.toLocaleString("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}%`;
}

export const INDICADORES: Record<string, { etiqueta: string; unidad: string; base: BaseIndicador }> = {
  nbi: { etiqueta: "Hogares con NBI", unidad: "hogares", base: "hogares" },
  privacion: { etiqueta: "Hogares con privación (IPMH)", unidad: "hogares", base: "hogares" },
  hacinamiento: { etiqueta: "Hogares con hacinamiento", unidad: "hogares", base: "hogares" },
  clima_educativo_bajo: { etiqueta: "Hogares con clima educativo bajo", unidad: "hogares", base: "hogares" },
  sin_cloaca: { etiqueta: "Hogares sin cloaca", unidad: "hogares", base: "hogares" },
  sin_agua_red: { etiqueta: "Hogares sin agua de red", unidad: "hogares", base: "hogares" },
  hogares: { etiqueta: "Todos los hogares", unidad: "hogares", base: "hogares" },
  desocupados: { etiqueta: "Personas desocupadas", unidad: "personas", base: "activos" },
  sin_cobertura_salud: { etiqueta: "Personas sin cobertura de salud", unidad: "personas", base: "poblacion" },
  poblacion_0_14: { etiqueta: "Niñas y niños de 0 a 14", unidad: "personas", base: "poblacion" },
  poblacion_15_64: { etiqueta: "Personas de 15 a 64", unidad: "personas", base: "poblacion" },
  poblacion_65_mas: { etiqueta: "Personas de 65 y más", unidad: "personas", base: "poblacion" },
  poblacion: { etiqueta: "Toda la población", unidad: "personas", base: "poblacion" },
};

/** Base de un barrio para medir la intensidad de un indicador. */
export function baseDe(b: BarrioNecesidad, base: BaseIndicador): number {
  if (base === "hogares") return b.hogares;
  if (base === "activos") return (b.indicadores.ocupados ?? 0) + (b.indicadores.desocupados ?? 0);
  return b.poblacion;
}

// ── Lectura de montos y del reporte de partidas ────────────────────────────

/**
 * Lee un importe escrito a la argentina o a la inglesa: "$ 349.768.983.000",
 * "1.234.567,89", "1,234,567.89", "(12.500)" (negativo contable). Un separador
 * solo cuenta como de miles si agrupa de a tres de verdad ("1.234.567"); si
 * no, es decimal ("1234.5"). Devuelve NaN si no hay un número claro.
 */
export function parsearImporte(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  if (texto == null) return NaN;
  let t = String(texto).trim();
  if (!t) return NaN;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[$\s ]|ARS/gi, "");
  if (t.startsWith("-")) {
    negativo = !negativo;
    t = t.slice(1);
  }
  if (!/^[0-9.,]+$/.test(t) || !/[0-9]/.test(t)) return NaN;

  // grupos de a tres, y el primero sin cero adelante: "0.500" no es de miles
  const miles = (sep: "." | ",") => new RegExp(`^[1-9]\\d{0,2}(\\${sep}\\d{3})+$`);
  const p = t.lastIndexOf(".");
  const c = t.lastIndexOf(",");
  let normal: string;
  if (p >= 0 && c >= 0) {
    // los dos: el último es el decimal y el otro tiene que agrupar de a tres
    const [entero, decimal, sepMiles] = c > p ? [t.slice(0, c), t.slice(c + 1), "."] : [t.slice(0, p), t.slice(p + 1), ","];
    if (!miles(sepMiles as "." | ",").test(entero) && !/^\d+$/.test(entero)) return NaN;
    if (!/^\d+$/.test(decimal)) return NaN;
    normal = `${entero.split(sepMiles).join("")}.${decimal}`;
  } else if (p >= 0 || c >= 0) {
    const sep = p >= 0 ? "." : ",";
    const partes = t.split(sep);
    if (partes.length > 2) {
      // varios separadores iguales: solo pueden ser de miles
      if (!miles(sep).test(t)) return NaN;
      normal = partes.join("");
    } else if (sep === "." && miles(".").test(t)) {
      // "1.234": en un reporte en pesos, un punto con tres dígitos es de miles
      normal = partes.join("");
    } else {
      normal = `${partes[0] || "0"}.${partes[1]}`;
    }
  } else {
    normal = t;
  }
  const n = Number(normal);
  return Number.isFinite(n) ? (negativo ? -n : n) : NaN;
}

type CampoPartida = keyof Omit<Partida, "id">;

/**
 * Nombres con los que suelen venir las columnas, EN ORDEN DE PREFERENCIA. Se
 * elige el primer nombre de la lista que exista en el archivo, no la primera
 * columna que coincida: en el reporte de ejecución "Crédito original" viene
 * antes que "Crédito vigente", y "Devengado" puede venir antes que
 * "Comprometido".
 */
const COLUMNAS: Record<CampoPartida, { exactos: string[]; contiene: string[] }> = {
  codigo: { exactos: ["codigo", "cod partida", "codigo partida", "imputacion", "codigo presupuestario"], contiene: ["codigo"] },
  anexo: { exactos: ["anexo"], contiene: ["anexo"] },
  jurisdiccion: {
    exactos: ["item", "jurisdiccion", "reparticion", "secretaria", "unidad organizativa", "servicio administrativo", "saf"],
    contiene: ["reparticion", "jurisdiccion", "secretaria"],
  },
  programa: { exactos: ["programa", "prog", "categoria programatica"], contiene: ["programa"] },
  clase: { exactos: ["seccion", "clase", "caracter economico", "clasificacion economica", "tipo de gasto"], contiene: ["seccion", "clasificacion economica"] },
  partida_principal: {
    exactos: ["partida principal", "pp", "principal", "partida", "objeto del gasto", "objeto"],
    contiene: ["partida principal", "objeto del gasto"],
  },
  afectacion: {
    exactos: ["afectacion", "fuente de financiamiento", "fuente", "fte financ", "recurso afectado", "recurso", "origen del recurso"],
    contiene: ["afectacion", "financiamiento", "recurso", "fte"],
  },
  credito_vigente: { exactos: ["credito vigente", "vigente", "credito actual", "presupuesto vigente"], contiene: ["vigente"] },
  comprometido: { exactos: ["comprometido", "compromiso", "compromisos"], contiene: ["comprometido", "compromiso"] },
};

/** Respaldos que se aceptan solo con aviso, porque no son lo mismo. */
const RESPALDOS: Partial<Record<CampoPartida, Array<{ nombre: string; aviso: string }>>> = {
  credito_vigente: [
    { nombre: "credito original", aviso: "No hay «Crédito vigente»: se usó «Crédito original», que no incluye las modificaciones del año." },
    { nombre: "credito", aviso: "Se tomó la columna «Crédito» como crédito vigente: revisá que no sea el original." },
  ],
  comprometido: [
    { nombre: "devengado", aviso: "No hay «Comprometido»: se usó «Devengado», que es menor y deja el disponible inflado." },
    { nombre: "preventivo", aviso: "No hay «Comprometido»: se usó «Preventivo»." },
  ],
};

export interface LecturaPartidas {
  filas: Array<Omit<Partida, "id">>;
  errores: string[];
  avisos: string[];
  columnas: Partial<Record<CampoPartida, string>>;
  /** true si hay algo que impide cargar (códigos repetidos, sin crédito). */
  bloqueante: boolean;
}

/**
 * Parte el texto en registros y campos respetando comillas: una celda con
 * salto de línea adentro (Alt+Enter en Excel) sigue siendo una sola celda.
 * Una comilla solo abre un campo entrecomillado si está al principio (RFC
 * 4180): la de «Caño 4"» es un carácter más. Cada registro lleva la línea del
 * archivo donde empieza, para que los mensajes digan la fila de la planilla.
 */
function registrosCSV(texto: string, sep: string): Array<{ linea: number; campos: string[] }> {
  const out: Array<{ linea: number; campos: string[] }> = [];
  let fila: string[] = [];
  let celda = "";
  let comillas = false;
  let linea = 1;
  let inicio = 1;
  const cerrar = () => {
    fila.push(celda.trim());
    if (fila.some((x) => x !== "")) out.push({ linea: inicio, campos: fila });
    fila = [];
    celda = "";
  };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else comillas = false;
      } else {
        if (ch === "\n") linea++;
        celda += ch;
      }
    } else if (ch === '"' && celda.trim() === "") comillas = true;
    // una comilla en el medio de la celda es un carácter más
    else if (ch === sep) {
      fila.push(celda.trim());
      celda = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      cerrar();
      linea++;
      inicio = linea;
    } else celda += ch;
  }
  cerrar();
  return out;
}

/** Una fila de total o subtotal del reporte: se reconoce por el texto, aunque traiga importe. */
const esTotal = (campos: string[]) => campos.some((c) => /^(sub)?total(es)?\b/i.test(c.trim()));

/**
 * Lee el reporte de partidas que exporta la Contaduría (CSV con ";" o ",",
 * con o sin BOM). Reconoce las columnas por nombre, no por posición, y el
 * encabezado aunque el reporte traiga antes un título.
 */
export function leerPartidas(texto: string): LecturaPartidas {
  const errores: string[] = [];
  const avisos: string[] = [];
  const limpio = texto.replace(/^﻿/, "");
  const lineas = limpio.split(/\r?\n/, 25);
  const cuenta = (l: string, c: string) => l.split(c).length - 1;
  const sep = lineas.reduce((a, l) => a + cuenta(l, ";"), 0) >= lineas.reduce((a, l) => a + cuenta(l, ","), 0) ? ";" : ",";
  const registros = registrosCSV(limpio, sep);

  // El encabezado es el primer renglón (de los primeros 20) que nombra el crédito vigente.
  const nombraCredito = (campos: string[]) =>
    campos.map(sinAcentos).some((h) => h.includes("vigente") || h === "credito" || h.startsWith("credito "));
  const iEnc = registros.slice(0, 20).findIndex((r) => nombraCredito(r.campos));
  if (iEnc < 0) {
    return {
      filas: [],
      errores: [registros.length < 2 ? "El archivo no tiene filas de datos." : "No encontré la columna del crédito vigente."],
      avisos,
      columnas: {},
      bloqueante: true,
    };
  }
  if (iEnc > 0) avisos.push(`El encabezado está en la fila ${registros[iEnc].linea}: se ignoraron las ${iEnc} líneas de título de arriba.`);
  const original = registros[iEnc].campos;
  const encabezado = original.map(sinAcentos);

  const columnas: LecturaPartidas["columnas"] = {};
  const indice: Partial<Record<CampoPartida, number>> = {};
  const usada = (i: number) => Object.values(indice).includes(i);
  // "Saldo no comprometido" contiene "comprometido" pero es justo lo contrario.
  const negada = (h: string) => /\bno comprometid|\bsaldo\b|\bdisponible\b/.test(h);
  const orden: CampoPartida[] = ["credito_vigente", "comprometido", "partida_principal", "codigo", "anexo", "jurisdiccion", "programa", "clase", "afectacion"];
  for (const campo of orden) {
    const { exactos, contiene } = COLUMNAS[campo];
    let i = -1;
    for (const nombre of exactos) {
      const j = encabezado.indexOf(nombre);
      if (j >= 0 && !usada(j)) {
        i = j;
        break;
      }
    }
    if (i < 0) {
      for (const nombre of contiene) {
        const j = encabezado.findIndex((h, k) => h.includes(nombre) && !usada(k) && !(campo === "comprometido" && negada(h)));
        if (j >= 0) {
          i = j;
          break;
        }
      }
    }
    if (i < 0) {
      for (const r of RESPALDOS[campo] ?? []) {
        const j = encabezado.findIndex((h, k) => (h === r.nombre || h.startsWith(r.nombre + " ")) && !usada(k));
        if (j >= 0) {
          i = j;
          avisos.push(r.aviso);
          break;
        }
      }
    }
    if (i >= 0) {
      indice[campo] = i;
      columnas[campo] = original[i];
    }
  }

  if (indice.credito_vigente === undefined) {
    return { filas: [], errores: ["No encontré la columna del crédito vigente."], avisos, columnas, bloqueante: true };
  }
  if (indice.comprometido === undefined) avisos.push("No hay columna de comprometido: se toma 0 y todo el crédito vigente queda como disponible.");
  if (indice.partida_principal === undefined) {
    avisos.push("No hay columna de partida principal: sin ella ninguna partida se puede asignar (no se sabe si es personal).");
  }
  if (indice.afectacion === undefined) {
    avisos.push("No hay columna de fuente o afectación: todas las partidas se toman como de rentas generales. Si hay recursos afectados, el reporte tiene que traer la fuente.");
  }
  if (indice.codigo === undefined) {
    avisos.push("No hay columna de código: se arma con anexo, ítem, programa, partida y fuente. Si el reporte cambia esas columnas, las partidas no se van a reconocer al recargar.");
  }

  const celda = (v: string[], campo: CampoPartida) => (indice[campo] !== undefined ? (v[indice[campo]!] ?? "") : "");
  const filas: LecturaPartidas["filas"] = [];
  const vistos = new Map<string, number>();
  const repetidos: string[] = [];
  let bloqueante = false;
  let totales = 0;

  for (const { linea, campos: v } of registros.slice(iEnc + 1)) {
    if (esTotal(v)) {
      totales++;
      continue;
    }
    // Sin código en un reporte que tiene la columna: es un renglón de agrupación, no una partida.
    if (indice.codigo !== undefined && !celda(v, "codigo").trim()) {
      if (v.some((x) => x !== "")) avisos.push(`Fila ${linea}: no tiene código, se toma como renglón de agrupación y se saltea.`);
      continue;
    }
    const vigente = parsearImporte(celda(v, "credito_vigente"));
    if (!Number.isFinite(vigente)) {
      errores.push(`Fila ${linea}: el crédito vigente no es un número, se saltea.`);
      continue;
    }
    if (vigente < 0) {
      errores.push(`Fila ${linea}: el crédito vigente es negativo, se saltea.`);
      continue;
    }
    const comprometidoTxt = celda(v, "comprometido");
    let comprometido = comprometidoTxt === "" ? 0 : parsearImporte(comprometidoTxt);
    if (!Number.isFinite(comprometido)) {
      errores.push(`Fila ${linea}: el comprometido no es un número, se toma 0.`);
      comprometido = 0;
    }
    if (comprometido < 0) {
      // una desafectación: no se puede adivinar el neto, y la base no acepta negativos
      errores.push(`Fila ${linea}: el comprometido es negativo (${comprometidoTxt}). Corregí el reporte: no se puede cargar así.`);
      bloqueante = true;
      comprometido = 0;
    }
    if (comprometido > vigente) {
      avisos.push(`Fila ${linea}: el comprometido supera al crédito vigente (partida excedida). Queda con disponible 0.`);
    }
    const ppTexto = celda(v, "partida_principal").trim();
    const pp = normalizarPP(ppTexto);
    if (ppTexto && !pp) errores.push(`Fila ${linea}: no reconozco la partida principal «${ppTexto}». Queda como no asignable.`);
    const anexo = celda(v, "anexo");
    const jurisdiccion = celda(v, "jurisdiccion");
    const programa = celda(v, "programa");
    const afectacion = normalizarAfectacion(celda(v, "afectacion"));
    // con la partida TAL COMO VIENE (3150 y 3160 son partidas distintas de la 31)
    const codigo =
      celda(v, "codigo").trim() || [anexo, jurisdiccion, programa, ppTexto, afectacion].filter(Boolean).join(" | ") || `fila-${linea}`;
    if (vistos.has(codigo)) repetidos.push(`«${codigo}» (filas ${vistos.get(codigo)} y ${linea})`);
    else vistos.set(codigo, linea);
    filas.push({
      codigo,
      anexo,
      jurisdiccion,
      programa,
      clase: inferirClase(celda(v, "clase"), pp),
      partida_principal: pp,
      afectacion,
      credito_vigente: vigente,
      comprometido,
    });
  }

  if (totales > 0) avisos.push(`Se saltearon ${totales} filas de total o subtotal: no son partidas y duplicarían el crédito.`);
  if (repetidos.length > 0) {
    errores.unshift(
      `Hay ${repetidos.length} códigos repetidos: ${repetidos.slice(0, 5).join(", ")}${repetidos.length > 5 ? "…" : ""}. ` +
        "Cada partida necesita un código único; si la columna que se tomó como código se repite por programa, el reporte tiene que traer el código completo.",
    );
  }
  return { filas, errores, avisos, columnas, bloqueante: bloqueante || repetidos.length > 0 || filas.length === 0 };
}

/**
 * "Rentas generales", "Tesoro", "Fuente 11", "Libre disponibilidad", "Recursos
 * propios", vacío → '' (libre disponibilidad). Cualquier otra cosa es una
 * afectación específica y solo financia lo que la declare.
 */
export function normalizarAfectacion(valor: string): string {
  const v = sinAcentos(valor);
  if (
    !v ||
    v.includes("rentas generales") ||
    v.includes("tesoro") ||
    v.includes("libre disponibilidad") ||
    v.includes("recursos propios") ||
    /(^|\s)11($|\s)/.test(v)
  ) {
    return "";
  }
  return valor.trim();
}

// ── Compatibilidad partida ↔ política ──────────────────────────────────────

export const disponibleDe = (p: Pick<Partida, "credito_vigente" | "comprometido">) =>
  Math.max(0, p.credito_vigente - p.comprometido);

/**
 * ¿Puede esta partida pagar esta política? La herramienta planifica la
 * EJECUCIÓN del crédito que ya tiene cada partida: no mueve plata entre
 * partidas (eso es una reestructuración y va por su norma).
 *
 * 1. La partida principal tiene que ser asignable: nunca personal (11),
 *    intereses (21), inversión financiera (61) ni amortización (71).
 * 2. Misma clase económica: el crédito de capital no paga gasto corriente.
 * 3. La partida principal tiene que estar entre las que admite la política
 *    (una beca se paga con transferencias corrientes, 31; una obra con
 *    trabajos públicos, 52).
 * 4. Un recurso afectado solo financia las políticas que lo declaran; las
 *    partidas de rentas generales financian cualquiera.
 */
export function partidaCompatible(partida: Partida, politica: Politica): boolean {
  if (!esAsignable(partida.partida_principal)) return false;
  if (partida.clase !== politica.clase) return false;
  if (politica.partidas_principales.length > 0 && !politica.partidas_principales.includes(partida.partida_principal)) return false;
  if (partida.afectacion && !politica.afectaciones.includes(partida.afectacion)) return false;
  return true;
}

// ── Armado de las entradas del motor ───────────────────────────────────────

export interface ParametrosAsignacion {
  /** 0 = cada unidad de necesidad vale lo mismo; 2 = pesa mucho la concentración. */
  intensidad: number;
  /** κ del motor: cuánto se reparte entre barrios. */
  equidad: number;
  /** Solo estos barrios (vacío = toda la ciudad). */
  barrios?: string[];
  /** Solo estas políticas (vacío = todas las activas). */
  politicas?: number[];
  /** Montos bloqueados a mano: clave `${politicaId}|${barrioId}`. */
  fijos?: Record<string, number>;
  /** Montos decididos por política al repartir: pisan el piso y el tope del catálogo. */
  limites?: Limites;
}

/** Por política: al menos (piso) y como máximo (tope), en pesos. */
export type Limites = Record<number, { piso?: number; tope?: number }>;

/**
 * Lee lo que se escribió en «al menos» y «como máximo» (clave `${id}|piso` o
 * `${id}|tope`). Una política con un monto que no se entiende, o con el piso
 * por encima del tope, queda en `invalidas` y no se aplica: mejor no aplicar
 * nada que aplicar la mitad de lo que se quiso decir.
 */
export function leerLimites(texto: Record<string, string>): { limites: Limites; invalidas: Set<number> } {
  const limites: Limites = {};
  const invalidas = new Set<number>();
  for (const [clave, valor] of Object.entries(texto)) {
    const [idTxt, campo] = clave.split("|");
    const id = Number(idTxt);
    const txt = valor.trim();
    if (!Number.isInteger(id) || (campo !== "piso" && campo !== "tope") || !txt) continue;
    const n = parsearImporte(txt);
    if (!(Number.isFinite(n) && n >= 0)) {
      invalidas.add(id);
      continue;
    }
    (limites[id] ??= {})[campo] = n;
  }
  for (const [idTxt, l] of Object.entries(limites)) {
    const id = Number(idTxt);
    if (l.piso != null && l.tope != null && l.piso > l.tope) invalidas.add(id);
  }
  for (const id of invalidas) delete limites[id];
  return { limites, invalidas };
}

export interface Entradas {
  fuentes: Fuente[];
  politicas: PoliticaEntrada[];
  necesidades: Necesidad[];
  excluidas: Array<{ politica: string; motivo: string }>;
}

export const nombrePolitica = (p: Pick<Politica, "codigo" | "nombre">) => `${p.codigo ? p.codigo + " · " : ""}${p.nombre}`;

/** Lo que se reparte: el disponible de las partidas asignables. */
export const libreAsignable = (partidas: Partida[]) =>
  partidas.filter((p) => esAsignable(p.partida_principal)).reduce((a, p) => a + disponibleDe(p), 0);

/**
 * Convierte partidas, políticas y necesidad por barrio en las entradas del
 * motor.
 *
 * El valor de una política se expresa en PESOS DE NECESIDAD CUBIERTA:
 * prioridad × intensidad × costo de cubrir. Así un peso rinde lo mismo en una
 * beca barata que en una conexión cloacal cara, y lo que decide entre
 * políticas es la prioridad que les da quien planifica y dónde cae la
 * necesidad — no que una unidad sea más barata que otra.
 */
export function armarEntradas(
  partidas: Partida[],
  politicas: Politica[],
  barrios: BarrioNecesidad[],
  parametros: ParametrosAsignacion,
): Entradas {
  const excluidas: Entradas["excluidas"] = [];
  const fuentes: Fuente[] = partidas
    .filter((p) => disponibleDe(p) > 0 && esAsignable(p.partida_principal))
    .map((p) => ({ id: String(p.id), disponible: disponibleDe(p) }));

  const soloBarrios = parametros.barrios?.length ? new Set(parametros.barrios) : null;
  const barriosUsados = barrios.filter((b) => !soloBarrios || soloBarrios.has(b.id));
  const soloPoliticas = parametros.politicas?.length ? new Set(parametros.politicas) : null;

  const entradaPoliticas: PoliticaEntrada[] = [];
  const necesidades: Necesidad[] = [];

  for (const pol of politicas) {
    if (!pol.activa || pol.tipo === "institucional" || (soloPoliticas && !soloPoliticas.has(pol.id))) continue;
    const nombre = nombrePolitica(pol);
    if (!(pol.costo_unitario && pol.costo_unitario > 0)) {
      excluidas.push({ politica: nombre, motivo: "no tiene costo por unidad cargado" });
      continue;
    }
    const info = INDICADORES[pol.indicador];
    if (!info) {
      excluidas.push({ politica: nombre, motivo: "no tiene un indicador de necesidad del censo" });
      continue;
    }
    const compatibles = partidas.filter((p) => disponibleDe(p) > 0 && partidaCompatible(p, pol)).map((p) => String(p.id));
    if (compatibles.length === 0) {
      excluidas.push({ politica: nombre, motivo: "ninguna partida con disponible la puede pagar" });
      continue;
    }

    // la tasa de la ciudad es la vara contra la que se mide cada barrio
    const totalNecesidad = barrios.reduce((a, b) => a + (b.indicadores[pol.indicador] ?? 0), 0);
    const totalBase = barrios.reduce((a, b) => a + baseDe(b, info.base), 0);
    const tasaCiudad = totalBase > 0 ? totalNecesidad / totalBase : 0;
    if (totalNecesidad <= 0) {
      excluidas.push({ politica: nombre, motivo: "el indicador da cero en toda la ciudad" });
      continue;
    }

    const prioridad = Math.max(0, pol.prioridad);
    entradaPoliticas.push({
      id: String(pol.id),
      nombre,
      costoUnitario: pol.costo_unitario,
      fuentes: compatibles,
      // pesos de necesidad cubierta: ver el comentario de la función
      prioridad: prioridad * pol.costo_unitario,
      // los pisos que compiten se ordenan por la prioridad del planificador, sin escalar
      orden: prioridad,
      // lo decidido al repartir manda sobre el catálogo, campo por campo
      piso: parametros.limites?.[pol.id]?.piso ?? pol.piso ?? undefined,
      tope: parametros.limites?.[pol.id]?.tope ?? pol.tope ?? undefined,
    });

    for (const b of barriosUsados) {
      const unidades = Math.floor(b.indicadores[pol.indicador] ?? 0);
      if (unidades <= 0) continue;
      const base = baseDe(b, info.base);
      const tasa = base > 0 ? unidades / base : 0;
      const relativa = tasaCiudad > 0 ? tasa / tasaCiudad : 1;
      const fijo = parametros.fijos?.[`${pol.id}|${b.id}`];
      necesidades.push({
        politica: String(pol.id),
        destino: b.id,
        unidades,
        peso: Math.pow(Math.max(relativa, 1e-6), Math.max(0, parametros.intensidad)),
        // definido (aunque sea 0) = la celda queda congelada en ese monto
        fijo: fijo != null && fijo >= 0 ? fijo : undefined,
      });
    }
  }

  return { fuentes, politicas: entradaPoliticas, necesidades, excluidas };
}

// ── Formato y criterios (los comparten la herramienta y el informe impreso) ──

/** $ 1.234.567 o, compacto, $ 1.234,6 M. */
export function pesos(n: number, compacto = false): string {
  if (compacto && Math.abs(n) >= 1e6) {
    return `$ ${(n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: Math.abs(n) >= 1e9 ? 0 : 1 })} M`;
  }
  // «|| 0» evita el «$ -0» de redondear un negativo chico
  return `$ ${(Math.round(n) || 0).toLocaleString("es-AR")}`;
}

/**
 * Los tres criterios que se ofrecen, en lenguaje llano. Cada uno es una
 * combinación de los dos parámetros del motor: cuánto pesa que la necesidad
 * esté concentrada (intensidad) y cuánto se reparte entre barrios (equidad).
 */
export const CRITERIOS = [
  {
    clave: "necesidad",
    titulo: "Donde más se necesita",
    texto: "Concentra la plata en los barrios con más necesidad que el promedio de la ciudad.",
    intensidad: 2,
    equidad: 0.5,
  },
  {
    clave: "equilibrado",
    titulo: "Equilibrado",
    texto: "Prioriza la necesidad, pero sin dejar afuera a los barrios con necesidad media.",
    intensidad: 1,
    equidad: 1,
  },
  {
    clave: "alcance",
    titulo: "Llegar a más barrios",
    texto: "Reparte para que la mayor cantidad de barrios reciba algo, aunque sea menos.",
    intensidad: 0.5,
    equidad: 3,
  },
] as const;

/** Con qué se armó una propuesta, en una línea: el criterio y los montos decididos a mano. */
export function resumenParametros(p: Record<string, unknown>): string {
  const i = Number(p.intensidad);
  const e = Number(p.equidad);
  const c = CRITERIOS.find((x) => x.intensidad === i && x.equidad === e);
  const partes = [
    c
      ? `criterio «${c.titulo}»`
      : Number.isFinite(i) && Number.isFinite(e)
        ? "criterio personalizado"
        : "criterio sin registrar",
  ];
  const lim = p.limites && typeof p.limites === "object" ? Object.keys(p.limites).length : 0;
  if (lim > 0) partes.push(`${lim} política${lim === 1 ? "" : "s"} con monto decidido`);
  return partes.join(" · ");
}

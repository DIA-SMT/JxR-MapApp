/**
 * Importa el escrutinio definitivo 2023 (PDF mesa a mesa de la Junta Electoral,
 * Capital) a Supabase: votos por lista/mesa/categoría + totales por mesa.
 * Datos públicos y agregados. Corre con service role.
 *
 * Uso:  node --max-old-space-size=6144 scripts/importar-resultados-2023.mjs "C:\ruta\2023_mesa_a_mesa_capital.pdf" [--reemplazar]
 *
 * Valida el cruce mesa→circuito contra el padrón cargado (tabla `mesas`)
 * e informa el porcentaje de coincidencia (si la numeración de mesas cambió
 * entre elecciones, el análisis por escuela pierde precisión).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ruta = process.argv[2];
const reemplazar = process.argv.includes("--reemplazar");
if (!ruta) {
  console.error("Uso: node scripts/importar-resultados-2023.mjs <pdf> [--reemplazar]");
  process.exit(1);
}

const CATEGORIAS = new Set(["GOBERNADOR", "LEGISLADOR", "INTENDENTE", "CONCEJAL"]);
const HEADER_FIJO = new Set([
  "ELECCIONES PROVINCIALES 2023 DEL 11 de Junio de 2023",
  "Fecha:", "Hora:", "Paginas:", "TUCUMAN",
  "Junta Electoral Provincial - Escrutinio Definitivo",
]);
const normalizarCircuito = (v) => {
  const m = String(v).trim().match(/^0*(\d+)([A-Z]*)$/i);
  return m ? `${m[1]}${(m[2] ?? "").toUpperCase()}` : null;
};

console.log("extrayendo texto del PDF…");
const data = await pdf(readFileSync(ruta));
const crudas = data.text.split("\n").map((l) => l.trim()).filter((l) => l !== "");

// ── Quitar encabezados de página (fecha, hora, nº página, títulos fijos) ─────
const lineas = [];
for (let i = 0; i < crudas.length; i++) {
  const l = crudas[i];
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(l) && /^\d{2}:\d{2}:\d{2}$/.test(crudas[i + 1] ?? "")) {
    i++; // hora
    if (/^\d+$/.test(crudas[i + 1] ?? "")) i++; // nº de página
    continue;
  }
  if (HEADER_FIJO.has(l)) continue;
  lineas.push(l);
}

// ── Parser de bloques de mesa ────────────────────────────────────────────────
const RE_LISTA = /^(\d{1,3})\s+-\s+(.+?)(\d+)$/;
const resultados = [];
const totales = [];
const nombresPorLista = new Map();
let circuito = null, mesa = null, categoria = null;
let esperandoTotales = null; // etiquetas acumuladas → luego N números
let sinClasificar = 0;

for (let i = 0; i < lineas.length; i++) {
  const l = lineas[i];

  if (l === "VOTANTES :SOBRES :DIFERENCIA :" || l === "SECCION :DEPARTAMENTO :" || l === "CAPITAL" || l === "Municipio SAN MIGUEL DE TUCUMAN") continue;
  if (l === "JURISDICCION :CIRCUITO :") {
    // la línea siguiente es votantes/sobres/diferencia concatenados: saltearla
    if (/^[\d-]+$/.test(lineas[i + 1] ?? "")) i++;
    continue;
  }
  if (/^0\d{3}[A-Z]?$/i.test(l)) {
    circuito = normalizarCircuito(l);
    continue;
  }
  if (l === "MESA :") {
    const cruda = Number(lineas[++i]);
    if (Number.isInteger(cruda) && cruda > 0) {
      mesa = cruda;
    } else {
      mesa = null;
      console.warn(`MESA no numérica cerca de la línea ${i}: "${lineas[i]}" — bloque descartado`);
    }
    continue;
  }
  if (CATEGORIAS.has(l) && (lineas[i + 1] ?? "") === "CATEGORIA :") {
    categoria = l;
    i++; // CATEGORIA :
    continue;
  }
  if (l === "VOTOS" || l === "LISTA") continue;

  if (l === "VOTOS EN BLANCO") {
    esperandoTotales = ["blanco"];
    continue;
  }
  if (esperandoTotales) {
    if (l === "VOTOS NULOS") { esperandoTotales.push("nulos"); continue; }
    if (l === "VOTOS POSITIVOS") { esperandoTotales.push("positivos"); continue; }
    if (l === "VOTOS TOTAL") { esperandoTotales.push("total"); continue; }
    if (/^\d+$/.test(l)) {
      const valores = [Number(l)];
      while (valores.length < esperandoTotales.length && /^\d+$/.test(lineas[i + 1] ?? "")) {
        valores.push(Number(lineas[++i]));
      }
      const fila = { categoria, mesa, circuito };
      esperandoTotales.forEach((campo, idx) => { fila[campo] = valores[idx] ?? null; });
      totales.push(fila);
      esperandoTotales = null;
      continue;
    }
  }

  const m = l.match(RE_LISTA);
  if (m && categoria && Number.isInteger(mesa)) {
    const listaNumero = Number(m[1]);
    const listaNombre = m[2].trim();
    const votos = Number(m[3]);
    // Plausibilidad: una mesa no supera ~400 electores. Un nombre de lista que
    // termina en dígitos rompería la regex silenciosamente (nombre+votos
    // pegados) — esto lo detecta y frena en vez de inflar votos.
    if (votos > 400) {
      throw new Error(
        `Votos implausibles (${votos}) en mesa ${mesa}, "${l}": probable nombre de lista terminado en dígitos. Revisar RE_LISTA.`,
      );
    }
    const claveLista = `${categoria}|${listaNumero}`;
    const nombreVisto = nombresPorLista.get(claveLista);
    if (nombreVisto === undefined) {
      nombresPorLista.set(claveLista, listaNombre);
    } else if (nombreVisto !== listaNombre) {
      throw new Error(
        `Nombre inconsistente para lista ${listaNumero} (${categoria}): "${nombreVisto}" vs "${listaNombre}" en mesa ${mesa} — el parser cortó mal la línea "${l}".`,
      );
    }
    resultados.push({ categoria, mesa, circuito, lista_numero: listaNumero, lista_nombre: listaNombre, votos });
    continue;
  }
  sinClasificar++;
}

const mesasVistas = new Set(resultados.map((r) => r.mesa));
console.log(`filas de votos: ${resultados.length} · totales de mesa: ${totales.length} · mesas: ${mesasVistas.size} · líneas sin clasificar: ${sinClasificar}`);
for (const cat of CATEGORIAS) {
  const filas = resultados.filter((r) => r.categoria === cat);
  const suma = filas.reduce((a, r) => a + r.votos, 0);
  console.log(`  ${cat}: ${filas.length} filas · ${new Set(filas.map((r) => r.lista_numero)).size} listas · ${suma} votos`);
}

// ── Validación del cruce mesa→circuito contra el padrón vigente ─────────────
const { data: mesasPadron, error: errMesas } = await supabase.from("mesas").select("mesa, circuito");
if (errMesas) throw new Error(errMesas.message);
const circuitoPadron = new Map((mesasPadron ?? []).map((m) => [m.mesa, m.circuito]));
let coinciden = 0, difieren = 0, sinPadron = 0;
const circuitoPdfPorMesa = new Map();
for (const r of resultados) if (r.circuito) circuitoPdfPorMesa.set(r.mesa, r.circuito);
for (const [mesaN, circPdf] of circuitoPdfPorMesa) {
  const circPad = circuitoPadron.get(mesaN);
  if (circPad == null) sinPadron++;
  else if (circPad === circPdf) coinciden++;
  else difieren++;
}
const pct = coinciden + difieren > 0 ? Math.round((100 * coinciden) / (coinciden + difieren)) : 0;
console.log(`cruce mesa→circuito vs padrón: ${coinciden} coinciden · ${difieren} difieren · ${sinPadron} sin mesa en padrón → ${pct}% de coincidencia`);
if (pct < 85) console.warn("ADVERTENCIA: la numeración de mesas parece haber cambiado; el análisis por escuela pierde precisión (por circuito sigue siendo exacto).");

// ── Carga ────────────────────────────────────────────────────────────────────
const { count } = await supabase.from("resultados_2023").select("id", { count: "exact", head: true });
if ((count ?? 0) > 0) {
  if (!reemplazar) {
    console.error(`resultados_2023 ya tiene ${count} filas; usá --reemplazar`);
    process.exit(1);
  }
  await supabase.from("resultados_2023").delete().gte("id", 0);
  await supabase.from("mesas_2023_totales").delete().gte("mesa", 0);
}

const LOTE = 3000;
for (let i = 0; i < resultados.length; i += LOTE) {
  const { error } = await supabase.from("resultados_2023").insert(resultados.slice(i, i + LOTE));
  if (error) throw new Error(`resultados lote ${i}: ${error.message}`);
  if ((i / LOTE) % 10 === 0) console.log(`  ${Math.min(i + LOTE, resultados.length)} / ${resultados.length}`);
}
// totales: clave (categoria, mesa) — dedup por si el parser repitió
const vistos = new Set();
const totalesUnicos = totales.filter((t) => {
  const k = `${t.categoria}|${t.mesa}`;
  if (vistos.has(k) || !t.categoria || !Number.isInteger(t.mesa)) return false;
  vistos.add(k);
  return true;
});
for (let i = 0; i < totalesUnicos.length; i += LOTE) {
  const { error } = await supabase.from("mesas_2023_totales").insert(totalesUnicos.slice(i, i + LOTE));
  if (error) throw new Error(`totales lote ${i}: ${error.message}`);
}

// Verificación final: la tabla debe tener EXACTAMENTE lo parseado (una carga
// parcial silenciosa dejaría todos los agregados mintiendo).
const { count: enTabla } = await supabase.from("resultados_2023").select("id", { count: "exact", head: true });
if (enTabla !== resultados.length) {
  console.error(`ATENCIÓN: la tabla quedó con ${enTabla} filas y el parser produjo ${resultados.length}. Carga PARCIAL: correr de nuevo con --reemplazar.`);
  process.exit(1);
}
console.log(`LISTO: ${resultados.length} filas de votos + ${totalesUnicos.length} totales de mesa (verificado).`);

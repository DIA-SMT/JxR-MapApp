/**
 * Importa el padrón electoral (xlsx) a Supabase — SOLO datos en la base,
 * nunca en el repo. Corre con service role desde la máquina del operador.
 *
 * Uso:  node --max-old-space-size=6144 scripts/importar-padron.mjs "C:\ruta\padron.xlsx" [--reemplazar]
 *
 * - Normaliza circuito ("0015B" → "15B"), sexo (F/M/X) y mesa (0 → null).
 * - Estima el año de nacimiento por rango de DNI (aprox ±3 años, solo para
 *   cohortes agregadas; los DNI fuera de rango quedan sin estimar).
 * - Descarta filas corruptas (columnas corridas) y lo informa.
 * - Al final reconstruye `escuelas` (agregado por establecimiento) y `mesas`
 *   (mesa → escuela/circuito/electores) para cruzar con resultados electorales.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

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
  console.error("Uso: node scripts/importar-padron.mjs <padron.xlsx> [--reemplazar]");
  process.exit(1);
}

// ── Estimación de año de nacimiento por DNI (anclas aproximadas) ─────────────
const ANCLAS = [
  [500_000, 1925], [5_000_000, 1945], [10_000_000, 1956], [14_000_000, 1961],
  [16_000_000, 1963], [20_000_000, 1968], [22_000_000, 1971], [25_000_000, 1976],
  [27_000_000, 1979], [30_000_000, 1983], [32_000_000, 1986], [35_000_000, 1990],
  [37_000_000, 1993], [40_000_000, 1996], [42_000_000, 1999], [45_000_000, 2003],
  [47_000_000, 2005], [49_000_000, 2008], [51_500_000, 2010],
];
function anioEstimado(dni) {
  if (!Number.isFinite(dni) || dni < ANCLAS[0][0] || dni > ANCLAS[ANCLAS.length - 1][0]) return null;
  for (let i = 1; i < ANCLAS.length; i++) {
    const [d1, a1] = ANCLAS[i - 1];
    const [d2, a2] = ANCLAS[i];
    if (dni <= d2) return Math.round(a1 + ((dni - d1) * (a2 - a1)) / (d2 - d1));
  }
  return null;
}

const normalizarCircuito = (v) => {
  if (v == null) return null;
  const m = String(v).trim().match(/^0*(\d+)([A-Z]*)$/i);
  return m ? `${m[1]}${(m[2] ?? "").toUpperCase()}` : null;
};

// ── Lectura y normalización ──────────────────────────────────────────────────
console.log("leyendo xlsx…");
const wb = XLSX.readFile(ruta, { dense: true });
const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
console.log(`filas en planilla: ${filas.length - 1}`);

const electores = [];
let descartadas = 0;
for (let i = 1; i < filas.length; i++) {
  const f = filas[i];
  const dniLimpio = String(f[0] ?? "").replace(/\D/g, "");
  const nombre = String(f[2] ?? "").trim();
  const sexoCrudo = f[8] == null ? null : String(f[8]).trim();
  // filas con columnas corridas: el sexo trae texto largo → basura, afuera
  if (dniLimpio.length < 6 || !nombre || (sexoCrudo && sexoCrudo.length > 1)) {
    descartadas++;
    continue;
  }
  const mesa = Number(f[9]);
  const orden = Number(f[10]);
  electores.push({
    dni: dniLimpio,
    tipo_ejemplar: f[1] ? String(f[1]).trim() : null,
    apellido_nombre: nombre,
    domicilio: f[3] ? String(f[3]).trim() : null,
    sexo: ["F", "M", "X"].includes(sexoCrudo) ? sexoCrudo : null,
    circuito: normalizarCircuito(f[15]),
    mesa: Number.isFinite(mesa) && mesa > 0 ? mesa : null,
    orden_mesa: Number.isFinite(orden) && orden > 0 ? orden : null,
    establecimiento: f[11] ? String(f[11]).trim() : null,
    anio_nac_estimado: anioEstimado(Number(dniLimpio)),
  });
}
console.log(`válidas: ${electores.length} · descartadas: ${descartadas}`);

// ── Carga ────────────────────────────────────────────────────────────────────
const { count } = await supabase.from("electores").select("id", { count: "exact", head: true });
if ((count ?? 0) > 0) {
  if (!reemplazar) {
    console.error(`la tabla ya tiene ${count} electores; usá --reemplazar para recargar`);
    process.exit(1);
  }
  console.log(`borrando ${count} electores existentes…`);
  const { error } = await supabase.from("electores").delete().gte("id", 0);
  if (error) throw new Error(error.message);
}

const LOTE = 2000;
for (let i = 0; i < electores.length; i += LOTE) {
  const { error } = await supabase.from("electores").insert(electores.slice(i, i + LOTE));
  if (error) throw new Error(`lote ${i}: ${error.message}`);
  if ((i / LOTE) % 20 === 0) console.log(`  ${i + Math.min(LOTE, electores.length - i)} / ${electores.length}`);
}
console.log(`electores cargados: ${electores.length}`);

// ── Agregados: escuelas y mesas ──────────────────────────────────────────────
const porEscuela = new Map();
const porMesa = new Map();
for (const e of electores) {
  if (e.establecimiento) {
    const r = porEscuela.get(e.establecimiento) ?? { electores: 0, mesas: new Set(), circuitos: new Map() };
    r.electores++;
    if (e.mesa) r.mesas.add(e.mesa);
    if (e.circuito) r.circuitos.set(e.circuito, (r.circuitos.get(e.circuito) ?? 0) + 1);
    porEscuela.set(e.establecimiento, r);
  }
  if (e.mesa) {
    const m = porMesa.get(e.mesa) ?? { electores: 0, escuelas: new Map(), circuitos: new Map() };
    m.electores++;
    if (e.establecimiento) m.escuelas.set(e.establecimiento, (m.escuelas.get(e.establecimiento) ?? 0) + 1);
    if (e.circuito) m.circuitos.set(e.circuito, (m.circuitos.get(e.circuito) ?? 0) + 1);
    porMesa.set(e.mesa, m);
  }
}
const moda = (mapa) => [...mapa.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

await supabase.from("escuelas").delete().gte("id", 0);
const filasEscuelas = [...porEscuela.entries()].map(([nombre, r]) => ({
  nombre,
  circuito: moda(r.circuitos),
  electores: r.electores,
  mesas: r.mesas.size,
}));
for (let i = 0; i < filasEscuelas.length; i += 500) {
  const { error } = await supabase.from("escuelas").insert(filasEscuelas.slice(i, i + 500));
  if (error) throw new Error(`escuelas: ${error.message}`);
}
console.log(`escuelas: ${filasEscuelas.length}`);

await supabase.from("mesas").delete().gte("mesa", 0);
const filasMesas = [...porMesa.entries()].map(([mesa, m]) => ({
  mesa,
  escuela: moda(m.escuelas),
  circuito: moda(m.circuitos),
  electores: m.electores,
}));
for (let i = 0; i < filasMesas.length; i += 1000) {
  const { error } = await supabase.from("mesas").insert(filasMesas.slice(i, i + 1000));
  if (error) throw new Error(`mesas: ${error.message}`);
}
console.log(`mesas: ${filasMesas.length}`);
console.log("LISTO: padrón importado.");

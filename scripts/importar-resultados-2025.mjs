/**
 * Importa los resultados 2025 (Diputado Nacional, escrutinio provisorio,
 * Capital, mesa a mesa) al esquema de la migración 0010.
 *
 * Fuente: export CSV oficial del Sistema de Publicación de Resultados
 * Electorales (DINE) — endpoint /api/resultado/totalizadocsv con el ámbito
 * Tucumán/Capital/Diputado Nacional. Formato: Estándar de Preservación de
 * Datos Electorales (una fila por mesa+agrupación+tipo de voto).
 *
 * IMPORTANTE: la numeración de mesas nacionales NO es la del padrón
 * provincial (75 mesas cambian de circuito y hay 263 mesas que no existen en
 * él). Acá NO se cruza mesa→escuela: los datos 2025 viven como universo
 * propio, comparable con 2023 por CIRCUITO (los 47 códigos coinciden).
 *
 * Uso: node scripts/importar-resultados-2025.mjs <ruta al CSV>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ruta = process.argv[2];
if (!ruta) throw new Error("falta la ruta al CSV: node scripts/importar-resultados-2025.mjs <archivo>");

/** Parser CSV mínimo con soporte de comillas (el estándar cita campos con comas). */
function parsearLinea(linea) {
  const campos = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (entreComillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') entreComillas = false;
      else actual += ch;
    } else if (ch === '"') entreComillas = true;
    else if (ch === ",") { campos.push(actual); actual = ""; }
    else actual += ch;
  }
  campos.push(actual);
  return campos;
}

const lineas = readFileSync(ruta, "utf8").trim().split(/\r?\n/);
const cab = parsearLinea(lineas[0]);
const idx = Object.fromEntries(cab.map((c, i) => [c, i]));
for (const col of ["mesa_id", "circuito_nombre", "mesa_electores", "agrupacion_id", "agrupacion_nombre", "votos_tipo", "votos_cantidad", "cargo_nombre", "seccion_nombre", "año"]) {
  if (!(col in idx)) throw new Error(`el CSV no tiene la columna esperada: ${col}`);
}

const positivos = [];
const mesas = new Map(); // mesa → acumulador de totales

for (let i = 1; i < lineas.length; i++) {
  const f = parsearLinea(lineas[i]);
  if (f[idx["año"]] !== "2025") throw new Error(`fila ${i}: año inesperado ${f[idx["año"]]}`);
  if (!/capital/i.test(f[idx.seccion_nombre])) throw new Error(`fila ${i}: sección inesperada ${f[idx.seccion_nombre]}`);
  if (!/diputado/i.test(f[idx.cargo_nombre])) throw new Error(`fila ${i}: cargo inesperado ${f[idx.cargo_nombre]}`);

  const mesa = Number(f[idx.mesa_id]);
  const circuito = f[idx.circuito_nombre].trim().toUpperCase();
  const electores = Number(f[idx.mesa_electores]);
  const votos = Number(f[idx.votos_cantidad]);
  if (!Number.isInteger(mesa) || mesa <= 0) throw new Error(`fila ${i}: mesa inválida`);
  if (!Number.isInteger(votos) || votos < 0 || votos > 400) throw new Error(`fila ${i}: votos implausibles (${votos}) en mesa ${mesa}`);

  const acum = mesas.get(mesa) ?? { mesa, circuito, electores, blanco: 0, nulos: 0, impugnados: 0, recurridos: 0, comando: 0, positivos: 0, total: 0 };
  if (acum.circuito !== circuito) throw new Error(`mesa ${mesa}: circuito inconsistente (${acum.circuito} vs ${circuito})`);
  const tipo = f[idx.votos_tipo];
  if (tipo === "POSITIVO") {
    acum.positivos += votos;
    positivos.push({
      mesa,
      circuito,
      agrupacion_id: Number(f[idx.agrupacion_id]),
      agrupacion_nombre: f[idx.agrupacion_nombre].trim(),
      votos,
    });
  } else if (tipo === "EN BLANCO") acum.blanco += votos;
  else if (tipo === "NULO") acum.nulos += votos;
  else if (tipo === "IMPUGNADO") acum.impugnados += votos;
  else if (tipo === "RECURRIDO") acum.recurridos += votos;
  else if (tipo === "COMANDO") acum.comando += votos;
  else throw new Error(`fila ${i}: tipo de voto desconocido ${tipo}`);
  acum.total += votos;
  mesas.set(mesa, acum);
}

// ── Verificación contra los totales oficiales del ámbito (API totalizado) ────
const sumaPos = positivos.reduce((a, r) => a + r.votos, 0);
const sumaBlanco = [...mesas.values()].reduce((a, m) => a + m.blanco, 0);
const sumaElectores = [...mesas.values()].reduce((a, m) => a + m.electores, 0);
const porAgrupacion = new Map();
for (const r of positivos) porAgrupacion.set(r.agrupacion_nombre, (porAgrupacion.get(r.agrupacion_nombre) ?? 0) + r.votos);
console.log("mesas:", mesas.size, "| positivos:", sumaPos, "| blancos:", sumaBlanco, "| electores:", sumaElectores);
console.log("agrupaciones:", [...porAgrupacion.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n}=${v}`).join(" · "));
if (mesas.size !== 1350) throw new Error(`se esperaban 1350 mesas, hay ${mesas.size}`);
if (sumaPos !== 344882) throw new Error(`positivos ${sumaPos} ≠ 344882 (total oficial del ámbito)`);
if (sumaBlanco !== 3594) throw new Error(`blancos ${sumaBlanco} ≠ 3594`);
if (sumaElectores !== 464795) throw new Error(`electores ${sumaElectores} ≠ 464795`);
const circuitos = new Set([...mesas.values()].map((m) => m.circuito));
if (circuitos.size !== 47) throw new Error(`se esperaban 47 circuitos, hay ${circuitos.size}`);

// ── Carga idempotente ─────────────────────────────────────────────────────────
console.log("limpiando tablas 2025…");
{
  const { error } = await admin.from("resultados_2025").delete().gte("mesa", 0);
  if (error) throw new Error(`delete resultados_2025: ${error.message}`);
}
{
  const { error } = await admin.from("mesas_2025").delete().gte("mesa", 0);
  if (error) throw new Error(`delete mesas_2025: ${error.message}`);
}

console.log(`insertando ${positivos.length} filas de resultados…`);
for (let i = 0; i < positivos.length; i += 500) {
  const { error } = await admin.from("resultados_2025").insert(positivos.slice(i, i + 500));
  if (error) throw new Error(`insert resultados_2025 (${i}): ${error.message}`);
}
const filasMesas = [...mesas.values()];
console.log(`insertando ${filasMesas.length} mesas…`);
for (let i = 0; i < filasMesas.length; i += 500) {
  const { error } = await admin.from("mesas_2025").insert(filasMesas.slice(i, i + 500));
  if (error) throw new Error(`insert mesas_2025 (${i}): ${error.message}`);
}

// ── Verificación final contra la base ─────────────────────────────────────────
const { count: nRes } = await admin.from("resultados_2025").select("id", { count: "exact", head: true });
const { count: nMesas } = await admin.from("mesas_2025").select("mesa", { count: "exact", head: true });
console.log(`en base: ${nRes} filas de resultados · ${nMesas} mesas`);
if (nRes !== positivos.length || nMesas !== filasMesas.length) throw new Error("el conteo en base no coincide con lo importado");
console.log("✔ importación 2025 verificada");

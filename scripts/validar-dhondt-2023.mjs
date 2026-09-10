/**
 * Valida el simulador D'Hondt contra la ADJUDICACIÓN OFICIAL de concejales
 * 2023 (Junta Electoral de Tucumán) y calcula los escenarios de unificación
 * del universo "Sin banca 2027".
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { repartirDHondt, repartirConFusion, curvaDeBancas } from "../src/lib/dhondt.ts";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const filas = [];
for (let d = 0; ; d += 1000) {
  const { data, error } = await admin.from("resultados_2023").select("lista_numero, lista_nombre, votos").eq("categoria", "CONCEJAL").range(d, d + 999);
  if (error) throw error;
  filas.push(...data);
  if (data.length < 1000) break;
}
const mapa = new Map();
for (const f of filas) {
  const r = mapa.get(f.lista_numero) ?? { id: f.lista_numero, nombre: f.lista_nombre, votos: 0 };
  r.votos += f.votos;
  mapa.set(f.lista_numero, r);
}
const listas = [...mapa.values()];
const totalPositivos = listas.reduce((a, l) => a + l.votos, 0);
console.log(`listas: ${listas.length} · positivos: ${totalPositivos}`);

// ── Adjudicación OFICIAL 2023 (Junta Electoral, 18 bancas) ─────────────────
const OFICIAL = {
  390: 2, 901: 2, 821: 1, 248: 1, 78: 1, 830: 1, 808: 1, 256: 1,
  824: 1, 85: 1, 391: 1, 247: 1, 214: 1, 941: 1, 929: 1, 820: 1,
};

let ok = 0, fail = 0;
const check = (n, cond, d = "") => { if (cond) { ok++; console.log("  PASS " + n); } else { fail++; console.log("  FAIL " + n + " " + d); } };

console.log("\n── Validación contra la adjudicación oficial (18 bancas, sin piso) ──");
const r = repartirDHondt(listas, { bancas: 18 });
check("suma de bancas = 18", r.porLista.reduce((a, l) => a + l.bancas, 0) === 18);
const conBanca = r.porLista.filter((l) => l.bancas > 0);
check("16 listas con banca", conBanca.length === 16, `→ ${conBanca.length}`);
let coinciden = 0;
for (const [num, esperadas] of Object.entries(OFICIAL)) {
  const obtenidas = r.porLista.find((l) => String(l.id) === num)?.bancas ?? 0;
  if (obtenidas === esperadas) coinciden++;
  else console.log(`    DIFERENCIA lista ${num}: oficial ${esperadas} vs simulado ${obtenidas}`);
}
check(`las 16 listas con banca coinciden con el oficial`, coinciden === Object.keys(OFICIAL).length, `→ ${coinciden}/16`);
// ninguna lista fuera del oficial debe tener banca
const extra = r.porLista.filter((l) => l.bancas > 0 && !(String(l.id) in OFICIAL));
check("ninguna lista extra recibió banca", extra.length === 0, extra.map((l) => `${l.id}=${l.bancas}`).join(","));
// la primera sin banca debe ser la 158 con 10.781 (perdió por 7 votos)
const sinBanca = r.porLista.filter((l) => l.bancas === 0).sort((a, b) => b.votos - a.votos);
check("primera sin banca = lista 158 (10.781 votos)", String(sinBanca[0].id) === "158" && sinBanca[0].votos === 10781, `→ ${sinBanca[0].id} con ${sinBanca[0].votos}`);
console.log(`  piso EFECTIVO 2023: ${Math.round(r.cocienteUltimaBanca)} votos (cociente de la banca 18) · para arrebatarla hacían falta ${r.votosParaEntrar}`);
console.log(`  bancas con divisor 2: ${r.secuencia.filter((s) => s.divisor === 2).map((s) => s.nombre).join(", ")}`);
console.log(`  a la lista 158 le faltaron ${r.porLista.find((l) => String(l.id) === "158")?.faltanParaLaSiguiente} votos para entrar`);

// ── Escenario: el universo "Sin banca 2027" unificado ──────────────────────
console.log("\n── Escenario: las 8 listas sin banca UNIFICADAS ──");
const UNIVERSO = [269, 4, 359, 277, 267, 58, 493, 325];
const votosUniverso = listas.filter((l) => UNIVERSO.includes(l.id)).reduce((a, l) => a + l.votos, 0);
console.log(`  universo: ${votosUniverso} votos (${(100 * votosUniverso / totalPositivos).toFixed(2)}% de los positivos)`);
const bancasSeparadas = r.porLista.filter((l) => UNIVERSO.includes(Number(l.id))).reduce((a, l) => a + l.bancas, 0);
console.log(`  bancas HOY, compitiendo separadas: ${bancasSeparadas}`);

const unido = repartirConFusion(listas, UNIVERSO, "FRENTE UNIFICADO (8 listas)", { bancas: 18 });
const bancasUnido = unido.porLista.find((l) => l.nombre.startsWith("FRENTE UNIFICADO"))?.bancas ?? 0;
console.log(`  bancas UNIFICADAS: ${bancasUnido}`);
check("unificarse da más bancas que fragmentarse", bancasUnido > bancasSeparadas, `${bancasSeparadas} → ${bancasUnido}`);
const perdedoras = unido.porLista.filter((l) => {
  const antes = r.porLista.find((x) => String(x.id) === String(l.id))?.bancas ?? 0;
  return l.bancas < antes;
});
console.log(`  quiénes pierden banca en ese escenario: ${perdedoras.map((l) => `${l.nombre} (${l.bancas + 1}→${l.bancas})`).join(" · ") || "ninguna"}`);
check("la suma sigue siendo 18", unido.porLista.reduce((a, l) => a + l.bancas, 0) === 18);

// ── Curva: cuántos votos para 1, 2, 3, 4, 5 bancas ─────────────────────────
console.log("\n── Cuántos votos necesita una lista nueva para N bancas (escenario 2023) ──");
const sinLasOcho = listas.filter((l) => !UNIVERSO.includes(l.id));
const curva = curvaDeBancas([...sinLasOcho, { id: "nueva", nombre: "nueva", votos: 0 }], "nueva", { bancas: 18 }, 6);
for (const p of curva) console.log(`  ${p.bancas} banca${p.bancas === 1 ? "" : "s"}: ${p.votosNecesarios.toLocaleString("es-AR")} votos`);
check("la curva es creciente y no vacía", curva.length > 0 && curva.every((p, i, a) => i === 0 || p.votosNecesarios > a[i - 1].votosNecesarios));

// ── Legisladores: 19 bancas ────────────────────────────────────────────────
console.log("\n── Legisladores Capital (19 bancas) ──");
const filasLeg = [];
for (let d = 0; ; d += 1000) {
  const { data, error } = await admin.from("resultados_2023").select("lista_numero, lista_nombre, votos").eq("categoria", "LEGISLADOR").range(d, d + 999);
  if (error) throw error;
  filasLeg.push(...data);
  if (data.length < 1000) break;
}
const mapaLeg = new Map();
for (const f of filasLeg) {
  const x = mapaLeg.get(f.lista_numero) ?? { id: f.lista_numero, nombre: f.lista_nombre, votos: 0 };
  x.votos += f.votos;
  mapaLeg.set(f.lista_numero, x);
}
const leg = [...mapaLeg.values()];
const totalLeg = leg.reduce((a, l) => a + l.votos, 0);
const rLeg = repartirDHondt(leg, { bancas: 19 });
console.log(`  positivos legislador: ${totalLeg} (oficial: 350.695)`);
check("positivos legislador = 350.695 (escrutinio oficial)", totalLeg === 350695, `→ ${totalLeg}`);
check("suma de bancas = 19", rLeg.porLista.reduce((a, l) => a + l.bancas, 0) === 19);
// El oficial: Valores 2, FR 2, y 15 listas con 1 (incluida Activar 158)
const legValores = rLeg.porLista.find((l) => String(l.id) === "390")?.bancas;
const legFR = rLeg.porLista.find((l) => String(l.id) === "901")?.bancas;
check("Valores 2 y Fuerza Republicana 2 bancas (oficial)", legValores === 2 && legFR === 2, `→ ${legValores} y ${legFR}`);
check("Activar (158) entró en legisladores (oficial)", (rLeg.porLista.find((l) => String(l.id) === "158")?.bancas ?? 0) === 1);
console.log(`  piso efectivo legisladores: ${Math.round(rLeg.cocienteUltimaBanca)} votos`);

console.log(`\n${ok} PASS · ${fail} FAIL`);
if (fail > 0) process.exit(1);

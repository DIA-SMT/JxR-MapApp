/**
 * Cruce EXACTO escuela → barrio por geometría: cada escuela de votación
 * geocodificada se atribuye al barrio (mapa oficial municipal) cuyo polígono
 * la contiene. Habilita el análisis electoral por barrio sin estimaciones:
 * los votos de una escuela caen en un barrio concreto.
 *
 * Las escuelas sin coordenadas (o que caen fuera de todo polígono de barrio)
 * quedan sin barrio y se agrupan aparte en los análisis — nunca se reparten
 * a ojo.
 *
 * Uso: node scripts/cruzar-escuelas-barrios.mjs
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

// ── geometría: punto en polígono (ray casting, con agujeros) ────────────────
function enAnillo(x, y, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function enPoligono(x, y, coords) {
  if (!enAnillo(x, y, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) if (enAnillo(x, y, coords[i])) return false;
  return true;
}
const enGeometria = (x, y, g) =>
  g.type === "Polygon" ? enPoligono(x, y, g.coordinates) : g.coordinates.some((p) => enPoligono(x, y, p));

const barrios = JSON.parse(readFileSync("public/data/barrios.json", "utf8"));
const { data: escuelas, error } = await admin.from("escuelas").select("nombre, electores, lat, lon");
if (error) throw error;

const filas = [];
let sinGeo = 0;
const fuera = [];
for (const e of escuelas) {
  if (e.lat == null || e.lon == null) {
    sinGeo++;
    continue;
  }
  const b = barrios.features.find((f) => enGeometria(e.lon, e.lat, f.geometry));
  if (b) filas.push({ escuela: e.nombre, barrio: b.properties.nombre });
  else fuera.push(e.nombre);
}

console.log(
  `escuelas: ${escuelas.length} · con barrio: ${filas.length} · sin geocodificar: ${sinGeo} · geocodificadas fuera de todo barrio: ${fuera.length}`,
);
if (fuera.length > 0) console.log("fuera de los polígonos de barrio:", fuera.join(" | "));

// verificación: ninguna escuela puede quedar en dos barrios (el find corta en el primero)
const nombres = new Set(filas.map((f) => f.escuela));
if (nombres.size !== filas.length) throw new Error("hay escuelas duplicadas en el cruce");

// carga idempotente
{
  const { error: eDel } = await admin.from("escuelas_barrios").delete().neq("escuela", "");
  if (eDel) throw new Error(`delete: ${eDel.message}`);
}
for (let i = 0; i < filas.length; i += 200) {
  const { error: eIns } = await admin.from("escuelas_barrios").insert(filas.slice(i, i + 200));
  if (eIns) throw new Error(`insert (${i}): ${eIns.message}`);
}
const { count } = await admin.from("escuelas_barrios").select("escuela", { count: "exact", head: true });
if (count !== filas.length) throw new Error(`en base quedaron ${count} filas, se esperaban ${filas.length}`);

const porBarrio = new Map();
for (const f of filas) porBarrio.set(f.barrio, (porBarrio.get(f.barrio) ?? 0) + 1);
console.log(`✔ ${count} escuelas cruzadas en ${porBarrio.size} barrios`);
console.log(
  "barrios con más escuelas:",
  [...porBarrio.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b, n]) => `${b} (${n})`).join(" · "),
);

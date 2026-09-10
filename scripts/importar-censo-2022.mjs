/**
 * Importa el perfil socioeconómico del Censo 2022 (INDEC) por radio censal
 * para San Miguel de Tucumán, y lo cruza geográficamente con los circuitos
 * electorales y los barrios oficiales.
 *
 * Datos PÚBLICOS y AGREGADOS por radio (no microdato): el censo no dice cómo
 * vota nadie; aporta el contexto social de cada zona.
 *
 * Fuentes (ver memoria del proyecto):
 *  · Censo 2022 por radio, Tucumán:
 *    https://infra.datos.gob.ar/catalog/indec/dataset/48/distribution/48.23/download/90-tucuman-2022.zip
 *  · Geometrías de los 671 radios de Capital (WFS del GeoNode del INDEC):
 *    .../geoserver/wfs?...&typeNames=geonode:radios_censales2&CQL_FILTER=cde='90084'
 *
 * El cruce radio→circuito/barrio se estima por muestreo de una grilla de
 * puntos dentro de cada radio (los radios son mucho más chicos que los
 * circuitos, así que la precisión alcanza de sobra); el resultado es el % del
 * radio que cae en cada espacio y así se ponderan los indicadores.
 *
 * Uso: node scripts/importar-censo-2022.mjs <carpeta con los CSV y radios_smt.geojson>
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const dir = process.argv[2];
if (!dir) throw new Error("falta la carpeta: node scripts/importar-censo-2022.mjs <carpeta>");
const DEPTO_CAPITAL = "084";

/** Parser CSV con comillas: varias categorías del censo tienen comas dentro. */
function parsearLinea(linea) {
  const campos = [];
  let actual = "";
  let entre = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (entre) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') entre = false;
      else actual += ch;
    } else if (ch === '"') entre = true;
    else if (ch === ",") { campos.push(actual); actual = ""; }
    else actual += ch;
  }
  campos.push(actual);
  return campos;
}

/** Lee un CSV del censo y devuelve las filas de Capital. */
function leerCenso(archivo) {
  // El archivo trae BOM: si no se quita, el nombre de la primera columna
  // queda con el carácter invisible y el índice de columnas se rompe.
  const texto = readFileSync(join(dir, archivo), "utf8").replace(/^﻿/, "");
  const lineas = texto.split(/\r?\n/);
  const idx = Object.fromEntries(parsearLinea(lineas[0]).map((c, i) => [c.trim(), i]));
  for (const col of ["codigo", "cod_dep", "cod_variable", "cod_categoria", "cantidad"]) {
    if (!(col in idx)) throw new Error(`${archivo}: falta la columna ${col}`);
  }
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    if (!lineas[i]) continue;
    const f = parsearLinea(lineas[i]);
    if (f[idx.cod_dep] !== DEPTO_CAPITAL) continue;
    filas.push({
      radio: f[idx.codigo],
      variable: f[idx.cod_variable],
      categoria: f[idx.cod_categoria],
      cantidad: Number(f[idx.cantidad]) || 0,
    });
  }
  return filas;
}

const hogar = leerCenso("90-tucuman-2022-hogar.csv");
const persona = leerCenso("90-tucuman-2022-vivienda.csv".replace("vivienda", "persona"));
console.log(`censo Capital · filas hogar: ${hogar.length} · filas persona: ${persona.length}`);

/** Suma la cantidad de una variable para un conjunto de categorías, por radio. */
function acumular(filas, variable, categorias) {
  const set = categorias ? new Set(categorias.map(String)) : null;
  const mapa = new Map();
  for (const f of filas) {
    if (f.variable !== variable) continue;
    if (set && !set.has(f.categoria)) continue;
    mapa.set(f.radio, (mapa.get(f.radio) ?? 0) + f.cantidad);
  }
  return mapa;
}

// ── Indicadores por radio ───────────────────────────────────────────────────
const ind = {
  hogares: acumular(hogar, "HOGAR_NBI_TOT", null),
  hogares_nbi: acumular(hogar, "HOGAR_NBI_TOT", [1]),
  hogares_privacion: acumular(hogar, "HOGAR_IPMH", [2, 3, 4]),
  // 2 o más personas por cuarto (categorías 5 y 6)
  hogares_hacinamiento: acumular(hogar, "HOGAR_H20CP", [5, 6]),
  hogares_clima_edu_bajo: acumular(hogar, "HOGAR_EDUHOG", [1, 2]),
  hogares_con_agua_red: acumular(hogar, "HOGAR_H13", [1]),
  hogares_h13_total: acumular(hogar, "HOGAR_H13", null),
  hogares_con_cloaca: acumular(hogar, "HOGAR_H18", [1]),
  hogares_h18_total: acumular(hogar, "HOGAR_H18", null),
  poblacion: acumular(persona, "PERSONA_EDADGRU", null),
  pob_hasta14: acumular(persona, "PERSONA_EDADGRU", [1]),
  pob_15_64: acumular(persona, "PERSONA_EDADGRU", [2]),
  pob_65mas: acumular(persona, "PERSONA_EDADGRU", [3]),
  ocupados: acumular(persona, "PERSONA_CONDACT", [1]),
  desocupados: acumular(persona, "PERSONA_CONDACT", [2]),
  inactivos: acumular(persona, "PERSONA_CONDACT", [3]),
  emp_dependencia: acumular(persona, "PERSONA_P30", [2]),
  emp_cuenta_propia: acumular(persona, "PERSONA_P30", [3]),
  emp_domestico: acumular(persona, "PERSONA_P30", [1]),
  emp_patron: acumular(persona, "PERSONA_P30", [4]),
  rama_publica: acumular(persona, "PERSONA_P33", [2]),
  rama_comercio: acumular(persona, "PERSONA_P33", [3]),
  rama_construccion: acumular(persona, "PERSONA_P33", [6]),
  sin_cobertura_salud: acumular(persona, "PERSONA_P19", [3]),
  // secundario completo y todo lo que sigue
  edu_sec_completo_mas: acumular(persona, "PERSONA_MNI", [5, 6, 7, 8, 9, 10, 11]),
};

const radios = [...new Set([...ind.hogares.keys(), ...ind.poblacion.keys()])].sort();
console.log(`radios censales en Capital: ${radios.length}`);
if (radios.length !== 671) throw new Error(`se esperaban 671 radios, hay ${radios.length}`);

const g = (m, r) => m.get(r) ?? 0;
const filasCenso = radios.map((r) => ({
  radio: r,
  poblacion: g(ind.poblacion, r),
  hogares: g(ind.hogares, r),
  pob_hasta14: g(ind.pob_hasta14, r),
  pob_15_64: g(ind.pob_15_64, r),
  pob_65mas: g(ind.pob_65mas, r),
  hogares_nbi: g(ind.hogares_nbi, r),
  hogares_privacion: g(ind.hogares_privacion, r),
  hogares_hacinamiento: g(ind.hogares_hacinamiento, r),
  hogares_clima_edu_bajo: g(ind.hogares_clima_edu_bajo, r),
  // "sin" se calcula por diferencia contra el total de la misma variable
  hogares_sin_cloaca: Math.max(0, g(ind.hogares_h18_total, r) - g(ind.hogares_con_cloaca, r)),
  hogares_sin_agua_red: Math.max(0, g(ind.hogares_h13_total, r) - g(ind.hogares_con_agua_red, r)),
  ocupados: g(ind.ocupados, r),
  desocupados: g(ind.desocupados, r),
  inactivos: g(ind.inactivos, r),
  emp_dependencia: g(ind.emp_dependencia, r),
  emp_cuenta_propia: g(ind.emp_cuenta_propia, r),
  emp_domestico: g(ind.emp_domestico, r),
  emp_patron: g(ind.emp_patron, r),
  rama_publica: g(ind.rama_publica, r),
  rama_comercio: g(ind.rama_comercio, r),
  rama_construccion: g(ind.rama_construccion, r),
  sin_cobertura_salud: g(ind.sin_cobertura_salud, r),
  edu_sec_completo_mas: g(ind.edu_sec_completo_mas, r),
}));

// Verificación contra los totales conocidos de Capital
const total = (k) => filasCenso.reduce((a, f) => a + f[k], 0);
console.log(
  `población ${total("poblacion")} · hogares ${total("hogares")} · NBI ${total("hogares_nbi")} ` +
    `(${((100 * total("hogares_nbi")) / total("hogares")).toFixed(1)}%) · ocupados ${total("ocupados")} · ` +
    `desocupados ${total("desocupados")} (tasa ${((100 * total("desocupados")) / (total("ocupados") + total("desocupados"))).toFixed(1)}%)`,
);
if (total("hogares_nbi") !== 14322) throw new Error(`NBI ${total("hogares_nbi")} ≠ 14.322 (control del dataset)`);
if (total("ocupados") !== 262398) throw new Error(`ocupados ${total("ocupados")} ≠ 262.398`);
if (total("desocupados") !== 31556) throw new Error(`desocupados ${total("desocupados")} ≠ 31.556`);

// ── Cruce geométrico radio → circuito y radio → barrio ─────────────────────
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
const enGeom = (x, y, geo) =>
  geo.type === "Polygon" ? enPoligono(x, y, geo.coordinates) : geo.coordinates.some((p) => enPoligono(x, y, p));
function bbox(geo) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const rec = (co) => {
    if (typeof co[0] === "number") {
      a = Math.min(a, co[0]); c = Math.max(c, co[0]);
      b = Math.min(b, co[1]); d = Math.max(d, co[1]);
    } else for (const s of co) rec(s);
  };
  rec(geo.coordinates);
  return [a, b, c, d];
}

const radiosGeo = JSON.parse(readFileSync(join(dir, "radios_smt.geojson"), "utf8"));
const circuitos = JSON.parse(readFileSync("public/data/circuitos.json", "utf8")).features.map((f) => ({
  codigo: String(f.properties.circuito),
  geom: f.geometry,
  bb: bbox(f.geometry),
}));
const barrios = JSON.parse(readFileSync("public/data/barrios.json", "utf8")).features.map((f) => ({
  codigo: f.properties.nombre,
  geom: f.geometry,
  bb: bbox(f.geometry),
}));

const PASOS = 7; // grilla 7x7 por radio (los radios son chicos: alcanza)
const cruces = [];
let sinCircuito = 0;
for (const rf of radiosGeo.features) {
  const radio = rf.properties.cod_indec;
  const [minX, minY, maxX, maxY] = bbox(rf.geometry);
  const conteo = { circuito: new Map(), barrio: new Map() };
  let dentro = 0;
  for (let i = 0; i <= PASOS; i++) {
    for (let j = 0; j <= PASOS; j++) {
      const x = minX + ((maxX - minX) * i) / PASOS;
      const y = minY + ((maxY - minY) * j) / PASOS;
      if (!enGeom(x, y, rf.geometry)) continue;
      dentro++;
      for (const [tipo, lista] of [["circuito", circuitos], ["barrio", barrios]]) {
        const hit = lista.find(
          (e) => x >= e.bb[0] && x <= e.bb[2] && y >= e.bb[1] && y <= e.bb[3] && enGeom(x, y, e.geom),
        );
        if (hit) conteo[tipo].set(hit.codigo, (conteo[tipo].get(hit.codigo) ?? 0) + 1);
      }
    }
  }
  if (dentro === 0) continue;
  if (conteo.circuito.size === 0) sinCircuito++;
  for (const tipo of ["circuito", "barrio"]) {
    for (const [codigo, n] of conteo[tipo]) {
      const pct = Math.round((100 * n) / dentro);
      if (pct >= 5) cruces.push({ radio, tipo, codigo, pct });
    }
  }
}
const nCirc = cruces.filter((c) => c.tipo === "circuito").length;
const nBarr = cruces.filter((c) => c.tipo === "barrio").length;
console.log(`cruces: ${nCirc} radio→circuito · ${nBarr} radio→barrio · radios fuera de todo circuito: ${sinCircuito}`);
console.log(`circuitos alcanzados: ${new Set(cruces.filter((c) => c.tipo === "circuito").map((c) => c.codigo)).size} de 47`);

// ── Carga idempotente ───────────────────────────────────────────────────────
{
  const { error } = await admin.from("radios_espacios").delete().neq("radio", "");
  if (error) throw new Error(`delete radios_espacios: ${error.message}`);
}
{
  const { error } = await admin.from("radios_censo").delete().neq("radio", "");
  if (error) throw new Error(`delete radios_censo: ${error.message}`);
}
for (let i = 0; i < filasCenso.length; i += 300) {
  const { error } = await admin.from("radios_censo").insert(filasCenso.slice(i, i + 300));
  if (error) throw new Error(`insert radios_censo (${i}): ${error.message}`);
}
for (let i = 0; i < cruces.length; i += 400) {
  const { error } = await admin.from("radios_espacios").insert(cruces.slice(i, i + 400));
  if (error) throw new Error(`insert radios_espacios (${i}): ${error.message}`);
}
const { count: nCenso } = await admin.from("radios_censo").select("radio", { count: "exact", head: true });
const { count: nEsp } = await admin.from("radios_espacios").select("radio", { count: "exact", head: true });
if (nCenso !== filasCenso.length) throw new Error(`en base ${nCenso} radios, se esperaban ${filasCenso.length}`);
if (nEsp !== cruces.length) throw new Error(`en base ${nEsp} cruces, se esperaban ${cruces.length}`);
console.log(`✔ ${nCenso} radios censales y ${nEsp} cruces cargados y verificados`);

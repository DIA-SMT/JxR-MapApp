/**
 * Cruce espacial barrio ↔ circuito electoral.
 *
 * Los barrios (mapa oficial del Portal de Datos municipal) no siguen los
 * límites de los circuitos, así que el cruce se estima por muestreo: una
 * grilla de puntos dentro de cada barrio, y cada punto se atribuye al
 * circuito que lo contiene. El resultado (% del barrio en cada circuito) se
 * guarda como JSON estático que usan el mapa, la búsqueda y Migue.
 *
 * Uso: node scripts/cruzar-barrios-circuitos.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const barrios = JSON.parse(readFileSync("public/data/barrios.json", "utf8"));
const circuitos = JSON.parse(readFileSync("public/data/circuitos.json", "utf8"));

/** Punto en anillo (ray casting). */
function enAnillo(x, y, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
/** Punto en Polygon (primer anillo = borde, el resto = agujeros). */
function enPoligono(x, y, coords) {
  if (!enAnillo(x, y, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) if (enAnillo(x, y, coords[i])) return false;
  return true;
}
function enGeometria(x, y, geom) {
  if (geom.type === "Polygon") return enPoligono(x, y, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p) => enPoligono(x, y, p));
  return false;
}
function bbox(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rec = (c) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else for (const s of c) rec(s);
  };
  rec(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

const circs = circuitos.features.map((f) => ({
  codigo: String(f.properties.circuito),
  geom: f.geometry,
  bbox: bbox(f.geometry),
}));

const PASOS = 18; // grilla 18×18 por barrio (~±3% de precisión, sobra para esto)
const porBarrio = [];
let sinCircuito = 0;

for (const f of barrios.features) {
  const [minX, minY, maxX, maxY] = bbox(f.geometry);
  const votosPorCirc = new Map();
  let puntos = 0;
  for (let i = 0; i <= PASOS; i++) {
    for (let j = 0; j <= PASOS; j++) {
      const x = minX + ((maxX - minX) * i) / PASOS;
      const y = minY + ((maxY - minY) * j) / PASOS;
      if (!enGeometria(x, y, f.geometry)) continue;
      puntos++;
      const c = circs.find((cc) => x >= cc.bbox[0] && x <= cc.bbox[2] && y >= cc.bbox[1] && y <= cc.bbox[3] && enGeometria(x, y, cc.geom));
      if (c) votosPorCirc.set(c.codigo, (votosPorCirc.get(c.codigo) ?? 0) + 1);
    }
  }
  // centroide aproximado del bbox para volar en el mapa
  const entrada = {
    id: f.properties.id,
    nombre: f.properties.nombre,
    bbox: [minX, minY, maxX, maxY].map((v) => Math.round(v * 1e6) / 1e6),
    circuitos: [...votosPorCirc.entries()]
      .map(([codigo, n]) => ({ circuito: codigo, pct: Math.round((100 * n) / Math.max(1, puntos)) }))
      .filter((c) => c.pct >= 5)
      .sort((a, b) => b.pct - a.pct),
  };
  if (entrada.circuitos.length === 0) sinCircuito++;
  porBarrio.push(entrada);
}

porBarrio.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

const porCircuito = {};
for (const b of porBarrio) {
  for (const c of b.circuitos) {
    (porCircuito[c.circuito] ??= []).push({ barrio: b.nombre, pct: c.pct });
  }
}
for (const k of Object.keys(porCircuito)) porCircuito[k].sort((a, b) => b.pct - a.pct);

mkdirSync("src/lib/datos", { recursive: true });
writeFileSync(
  "src/lib/datos/barrios-circuitos.json",
  JSON.stringify({ generado: new Date().toISOString().slice(0, 10), metodo: "grilla 18x18 por barrio", barrios: porBarrio, por_circuito: porCircuito }),
);
console.log(`barrios: ${porBarrio.length} · fuera de los circuitos (countryside/limites): ${sinCircuito}`);
console.log(`circuitos con barrios: ${Object.keys(porCircuito).length}`);
const ej = porBarrio.find((b) => /barrio norte|centro/i.test(b.nombre)) ?? porBarrio[0];
console.log("ejemplo:", JSON.stringify(ej));

/**
 * Segunda pasada de geocodificación para las escuelas que la heurística de
 * `geocodificar-escuelas.mjs` no pudo ubicar. Cambia de estrategia:
 *  · búsqueda ESTRUCTURADA de Nominatim (street/city/state) en vez de texto libre,
 *  · fallback a Photon (otro geocoder sobre OSM, más tolerante a nombres),
 *  · último recurso: la calle sin número (precisión de cuadra, suficiente para
 *    asignar barrio, y se marca en el log para revisión manual).
 *
 * Importante: solo se envían direcciones de establecimientos PÚBLICOS de
 * votación, nunca domicilios de electores.
 *
 * Uso: node scripts/geocodificar-escuelas-2.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BBOX = { lonMin: -65.36, lonMax: -65.1, latMin: -26.95, latMax: -26.72 };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = `JxR-MapApp/1.0 (geocodificacion de escuelas de votacion${process.env.CONTACTO_NOMINATIM ? `; contacto: ${process.env.CONTACTO_NOMINATIM}` : ""})`;
const enBbox = (lat, lon) => lat >= BBOX.latMin && lat <= BBOX.latMax && lon >= BBOX.lonMin && lon <= BBOX.lonMax;

async function nominatimEstructurado(street) {
  const p = new URLSearchParams({
    format: "json",
    limit: "1",
    country: "Argentina",
    state: "Tucumán",
    city: "San Miguel de Tucumán",
    street,
  });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json();
    const h = d?.[0];
    if (!h) return null;
    const lat = Number(h.lat), lon = Number(h.lon);
    return enBbox(lat, lon) ? { lat, lon, fuente: "nominatim-estructurado" } : null;
  } catch {
    return null;
  }
}

async function photon(texto) {
  const p = new URLSearchParams({
    q: `${texto}, San Miguel de Tucumán, Tucumán, Argentina`,
    limit: "1",
    lat: "-26.8241",
    lon: "-65.2226",
  });
  try {
    const res = await fetch(`https://photon.komoot.io/api?${p}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const d = await res.json();
    const c = d?.features?.[0]?.geometry?.coordinates;
    if (!c) return null;
    const [lon, lat] = c;
    return enBbox(lat, lon) ? { lat, lon, fuente: "photon" } : null;
  } catch {
    return null;
  }
}

/** Extrae candidatos de DIRECCIÓN del texto (que mezcla nombre + dirección). */
function direcciones(nombre) {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  const out = [];
  // "... CALLE 1234" → la calle son las 1-3 palabras antes del número
  const conNum = limpio.match(/([A-ZÁÉÍÓÚÑ'\.\s]+?)\s+(\d{1,5})\s*$/i);
  if (conNum) {
    const palabras = conNum[1].trim().split(" ").filter(Boolean);
    const num = conNum[2];
    for (const n of [2, 3, 1, 4]) {
      const calle = palabras.slice(-n).join(" ");
      if (calle.length > 2) out.push(`${calle} ${num}`);
    }
  }
  // "... A ESQ. B" → intersección
  const esq = limpio.match(/([A-ZÁÉÍÓÚÑ0-9º°'\.\s]+?)\s+ESQ\.?\s+(.+)$/i);
  if (esq) {
    const palabras = esq[1].trim().split(" ").filter(Boolean);
    out.push(`${palabras.slice(-2).join(" ")} y ${esq[2].trim()}`);
  }
  // calle sin número (última chance: precisión de cuadra)
  if (conNum) {
    const palabras = conNum[1].trim().split(" ").filter(Boolean);
    out.push(palabras.slice(-2).join(" "));
  }
  return [...new Set(out)].filter(Boolean);
}

const { data: escuelas, error } = await supabase.from("escuelas").select("id, nombre, circuito").is("lat", null).order("id");
if (error) throw new Error(error.message);
console.log(`escuelas sin coordenadas: ${escuelas.length}`);

let ok = 0;
const fallidas = [];
const logradas = [];
for (const esc of escuelas) {
  const cands = direcciones(esc.nombre);
  let punto = null;
  let usada = null;
  for (const c of cands) {
    punto = await nominatimEstructurado(c);
    await dormir(1100);
    if (punto) { usada = c; break; }
    punto = await photon(c);
    await dormir(400);
    if (punto) { usada = c; break; }
  }
  if (punto) {
    const { error: eUp } = await supabase.from("escuelas").update({ lat: punto.lat, lon: punto.lon }).eq("id", esc.id);
    if (eUp) { console.log(`  ERROR guardando ${esc.nombre}: ${eUp.message}`); continue; }
    ok++;
    logradas.push(`${esc.nombre.slice(0, 45)} → ${usada} [${punto.fuente}]`);
  } else {
    fallidas.push(esc.nombre);
  }
}
console.log(`\n✔ geocodificadas en esta pasada: ${ok} · siguen sin ubicación: ${fallidas.length}`);
if (logradas.length) console.log("\nlogradas:\n" + logradas.join("\n"));
if (fallidas.length) console.log("\nsin ubicación (requieren carga manual):\n" + fallidas.join("\n"));

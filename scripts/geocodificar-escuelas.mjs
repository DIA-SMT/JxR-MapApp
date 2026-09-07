/**
 * Geocodifica las escuelas de votación (tabla `escuelas`) con Nominatim/OSM.
 * Solo se envían nombres/direcciones de establecimientos PÚBLICOS (jamás
 * domicilios de electores). Respeta el rate limit de 1 req/seg.
 *
 * Uso:  node scripts/geocodificar-escuelas.mjs
 * Reintenta solo las que no tienen coordenadas; tolera fallos (las escuelas
 * sin coordenadas simplemente no se muestran como punto en el mapa).
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

// bbox de San Miguel de Tucumán (con margen)
const BBOX = { lonMin: -65.36, lonMax: -65.1, latMin: -26.95, latMax: -26.72 };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodificar(consulta) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(consulta)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": `JxR-MapApp/1.0 (geocodificacion de escuelas de votacion${process.env.CONTACTO_NOMINATIM ? `; contacto: ${process.env.CONTACTO_NOMINATIM}` : ""})` },
  });
  if (!res.ok) return null;
  const datos = await res.json();
  const hit = datos?.[0];
  if (!hit) return null;
  const lat = Number(hit.lat), lon = Number(hit.lon);
  if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) return null;
  return { lat, lon };
}

/** Candidatos de dirección a partir del texto del establecimiento:
 *  el campo mezcla nombre + dirección ("ESCUELA X CALLE 123" / "... A ESQ. B"). */
function candidatos(nombre) {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  const c = [];
  const esq = limpio.match(/([A-ZÁÉÍÓÚÑ0-9º°\.\s]+?)\s+ESQ\.?\s+(.+)$/i);
  if (esq) {
    const antes = esq[1].trim().split(" ");
    const calle1 = antes.slice(-3).join(" ");
    const calle1corta = antes.slice(-2).join(" ");
    c.push(`${calle1} y ${esq[2]}`);
    c.push(`${calle1corta} y ${esq[2]}`);
  }
  const conNumero = limpio.match(/(\S+(?:\s+\S+){0,3})\s+(\d{1,5})$/);
  if (conNumero) {
    const t = conNumero[1].split(" ");
    c.push(`${t.slice(-3).join(" ")} ${conNumero[2]}`);
    c.push(`${t.slice(-2).join(" ")} ${conNumero[2]}`);
  }
  c.push(limpio);
  return [...new Set(c)];
}

const { data: escuelas, error } = await supabase.from("escuelas").select("id, nombre").is("lat", null).order("id");
if (error) throw new Error(error.message);
console.log(`a geocodificar: ${escuelas.length}`);

let ok = 0, sin = 0;
for (const esc of escuelas) {
  let punto = null;
  for (const consulta of candidatos(esc.nombre)) {
    punto = await geocodificar(`${consulta}, San Miguel de Tucumán, Tucumán, Argentina`);
    await dormir(1100);
    if (punto) break;
  }
  if (punto) {
    await supabase.from("escuelas").update({ lat: punto.lat, lon: punto.lon }).eq("id", esc.id);
    ok++;
  } else {
    sin++;
  }
  if ((ok + sin) % 20 === 0) console.log(`  ${ok + sin}/${escuelas.length} (ok ${ok} · sin ${sin})`);
}
console.log(`LISTO: ${ok} geocodificadas · ${sin} sin coordenadas.`);

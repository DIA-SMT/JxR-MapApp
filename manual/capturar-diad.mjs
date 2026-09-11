import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

/**
 * Capturas del DÍA D para el manual, en modo claro. Deja antes un estado de
 * ejemplo cargado (fiscales, participación, incidencias y escrutinio) para que
 * las pantallas se vean con datos y no vacías.
 */
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Estado de ejemplo ───────────────────────────────────────────────────────
await admin.from("diad_fiscales").delete().gte("mesa", 0);
await admin.from("diad_asistencia").delete().gte("mesa", 0);
await admin.from("diad_incidencias").delete().gte("id", 0);
await admin.from("diad_cargas").delete().gte("id", 0);
await admin.from("diad_config").update({
  eleccion: "Concejales 2027",
  fecha: "2027-10-24",
  categoria: "CONCEJAL",
  bancas: 18,
  mesas_esperadas: 1087,
  meta_votos: 20000,
  telefono_comando: "381 5123456",
  listas: ["JxR", "Frente Tucumán Primero", "La Libertad Avanza", "Unidos por Tucumán"],
  cortes: ["10:00", "12:00", "14:00", "16:00", "18:00"],
  activa: true,
}).eq("id", 1);

// las mesas de una escuela chica, para que la ficha se vea completa
const { data: mesas } = await admin.from("mesas").select("mesa, escuela, circuito, electores").order("mesa").limit(14);
const nombres = ["Ramón Pérez", "Lucía Gómez", "Carlos Juárez", "Mariela Soria", "Julio Ledesma", "Ana Ríos"];
const estados = ["presente", "presente", "confirmado", "asignado", "ausente", "confirmado"];
const fiscales = mesas.slice(0, 6).map((m, i) => ({
  mesa: m.mesa,
  escuela: m.escuela ?? "",
  circuito: m.circuito ?? "",
  nombre: nombres[i],
  telefono: `381 5${100000 + i * 1111}`,
  rol: i === 0 ? "fiscal general" : "fiscal de mesa",
  estado: estados[i],
  notas: i === 4 ? "No llegó: se está buscando reemplazo" : "",
}));
await admin.from("diad_fiscales").insert(fiscales);
await admin.from("diad_asistencia").insert(
  mesas.slice(0, 9).map((m, i) => ({ mesa: m.mesa, corte: "12:00", votaron: Math.round(m.electores * (0.33 + i * 0.02)) })),
);
await admin.from("diad_incidencias").insert([
  { mesa: mesas[0].mesa, escuela: mesas[0].escuela, circuito: mesas[0].circuito, tipo: "faltan boletas", gravedad: "alta", detalle: "No llegaron las boletas de la lista a la mesa. Avisado al juzgado." },
  { mesa: mesas[3].mesa, escuela: mesas[3].escuela, circuito: mesas[3].circuito, tipo: "falta fiscal", gravedad: "media", detalle: "El fiscal no se presentó, se busca reemplazo en la escuela." },
  { mesa: null, escuela: mesas[0].escuela, circuito: mesas[0].circuito, tipo: "otro", gravedad: "baja", detalle: "La escuela abrió 20 minutos tarde." },
]);
await admin.from("diad_cargas").insert(
  mesas.slice(0, 5).map((m, i) => {
    const votos = { JxR: 120 + i * 7, "Frente Tucumán Primero": 110 + i * 5, "La Libertad Avanza": 55, "Unidos por Tucumán": 22 };
    const total = Object.values(votos).reduce((a, v) => a + v, 0) + 6 + 3;
    return { mesa: m.mesa, circuito: m.circuito ?? "", escuela: m.escuela ?? "", electores: m.electores, votos, blancos: 6, nulos: 3, total };
  }),
);
console.log("· estado de ejemplo cargado");

// ── Capturas ────────────────────────────────────────────────────────────────
const SALIDA = "manual/capturas";
mkdirSync(SALIDA, { recursive: true });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "shell",
  defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await nav.newPage();
pag.setDefaultTimeout(60000);
const esperar = (t, l = 50000) =>
  pag.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout: l, polling: 400 }, t);
const clickTexto = async (t) => {
  const ok = await pag.evaluate((s) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(s));
    if (!b) return false;
    b.click();
    return true;
  }, t);
  if (!ok) throw new Error("no encontre: " + t);
  await dormir(1200);
};
const capturar = async (nombre, alto) => {
  await dormir(900);
  const caja = await pag.evaluate((m) => {
    const el = document.querySelector("main");
    const fondo = Math.max(...[...el.querySelectorAll("*")].map((x) => x.getBoundingClientRect().bottom));
    return { x: 0, y: 0, width: 1440, height: Math.round(Math.min(m ?? 1100, fondo + 24)) };
  }, alto);
  await pag.screenshot({ path: `${SALIDA}/${nombre}.png`, clip: caja });
  console.log("  ✓", nombre);
};

await pag.goto("http://localhost:3400/acceso", { waitUntil: "domcontentloaded" });
await pag.evaluate(() => localStorage.setItem("jxr:tema", "claro"));
await pag.goto("http://localhost:3400/acceso", { waitUntil: "networkidle2" });
await pag.type('input[type="email"]', "diad@jxr.com");
await pag.type('input[type="password"]', "PruebaDiaD2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);

await pag.goto("http://localhost:3400/dia-d", { waitUntil: "networkidle2" });
await esperar("mesas con fiscal", 60000);
await dormir(2500);
// Filtrar por la escuela que tiene los fiscales de ejemplo y abrirla: sin el
// filtro queda al final de la lista (se ordena por mesas descubiertas) y no
// entra en la captura.
await pag.evaluate(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const busc = [...document.querySelectorAll("input")].find((x) => (x.placeholder || "").includes("Mesa, escuela"));
  set.call(busc, "LICEO VOCACIONAL");
  busc.dispatchEvent(new Event("input", { bubbles: true }));
});
await dormir(1500);
await pag.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("LICEO VOCACIONAL"));
  b?.click();
});
await dormir(1800);
await capturar("26-diad-fiscales", 1100);

await clickTexto("Particip");
await esperar("corte horario", 30000);
await pag.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "12:00");
  b?.click();
});
await dormir(3000);
await capturar("27-diad-participacion", 1000);

await clickTexto("Incid");
await esperar("reportar una incidencia", 30000);
await dormir(1500);
await capturar("28-diad-incidencias", 1000);

await clickTexto("Config");
await esperar("parámetros de la jornada", 30000);
await dormir(1200);
await capturar("29-diad-config", 1100);

await clickTexto("Escrut");
await esperar("cargar telegrama", 30000);
await dormir(2500);
await capturar("30-diad-escrutinio", 900);

// teléfono: la carga del fiscal
await pag.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await pag.goto("http://localhost:3400/dia-d", { waitUntil: "networkidle2" });
await esperar("mesas con fiscal", 50000);
await dormir(3000);
await pag.evaluate((esc) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(esc.slice(0, 20)));
  b?.click();
}, mesas[0].escuela ?? "");
await dormir(1800);
await pag.screenshot({ path: `${SALIDA}/31-diad-mobile.png` });
console.log("  ✓ 31-diad-mobile");

await nav.close();
console.log("\nlisto");

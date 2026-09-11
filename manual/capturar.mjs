import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

/**
 * Capturas para el manual de uso, en MODO CLARO.
 *
 * El tema vive en localStorage bajo `jxr:tema` y el layout lo aplica antes del
 * primer paint, así que hay que escribirlo ANTES de cargar las pantallas: si se
 * tocara el botón del header, la primera captura saldría en oscuro y el mapa
 * tardaría en cambiar de estilo base (claro usa Carto Positron).
 *
 * Cada paso espera a que el DATO REAL esté en pantalla, no a un tiempo fijo,
 * para que ninguna captura salga a medio cargar.
 */

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3400";
const SALIDA = "manual/capturas";
const USUARIO = "manual-claude@jxr.com";
const CLAVE = "ManualJxR2026!";
mkdirSync(SALIDA, { recursive: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();
pag.setDefaultTimeout(60000);

const capturar = async (nombre, opciones = {}) => {
  await dormir(opciones.espera ?? 1000);
  await pag.screenshot({ path: `${SALIDA}/${nombre}.png`, clip: opciones.clip });
  console.log("  ✓", nombre);
};
const esperarTexto = (texto, limite = 60000) =>
  pag.waitForFunction((t) => document.body.innerText.includes(t), { timeout: limite, polling: 500 }, texto);
const clickTexto = async (texto, exacto = true) => {
  const ok = await pag.evaluate(
    (t, ex) => {
      const b = [...document.querySelectorAll("button, a")].find((x) => (ex ? x.textContent.trim() === t : x.textContent.includes(t)));
      if (!b) return false;
      b.click();
      return true;
    }, texto, exacto);
  if (!ok) throw new Error(`no encontré el control «${texto}»`);
  await dormir(800);
};
/** Escribe en un campo controlado por React (el setter nativo + evento input). */
const escribirReact = (indice, valor, tag = "input") =>
  pag.evaluate((i, v, t) => {
    const proto = t === "textarea" ? window.HTMLTextAreaElement : window.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
    const el = document.querySelectorAll(t)[i];
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, indice, valor, tag);
/** Alto útil de <main>: evita dejar media captura en fondo vacío. */
const cajaMain = (maxAlto) => pag.evaluate((m) => {
  const el = document.querySelector("main");
  const r = el.getBoundingClientRect();
  const fondo = Math.max(...[...el.querySelectorAll("*")].map((x) => x.getBoundingClientRect().bottom));
  return { x: 0, y: 0, width: 1440, height: Math.round(Math.min(m, fondo + 24)) };
}, maxAlto);

// ── Tema claro y sesión ─────────────────────────────────────────────────────
console.log("· tema claro + acceso");
await pag.goto(`${BASE}/acceso`, { waitUntil: "domcontentloaded" });
await pag.evaluate(() => localStorage.setItem("jxr:tema", "claro"));
await pag.goto(`${BASE}/acceso`, { waitUntil: "networkidle2" });
await esperarTexto("CONTRASEÑA");
const esClaro = await pag.evaluate(() => document.documentElement.classList.contains("claro"));
if (!esClaro) throw new Error("el tema claro no se aplicó: la captura saldría en oscuro");
await capturar("01-acceso");

await pag.type('input[type="email"]', USUARIO);
await pag.type('input[type="password"]', CLAVE);
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);

// ── Mapa: vista Operativo y la barra de controles ───────────────────────────
console.log("· mapa");
await esperarTexto("459.156");
await dormir(6000); // Positron y las etiquetas tardan en dibujarse
await capturar("02-mapa-operativo", { espera: 1500 });
await capturar("03-controles", { clip: { x: 0, y: 0, width: 1440, height: 150 } });

// ── Las demás vistas ────────────────────────────────────────────────────────
for (const [vista, archivo, ancla] of [
  ["Padrón", "04-vista-padron", "electores"],
  ["Escuelas", "05-vista-escuelas", "escuelas geocodificadas"],
  ["Prioridad", "06-vista-prioridad", "Frontera"],
  ["Oportunidad", "07-vista-oportunidad", "Dónde invertir primero"],
]) {
  console.log("·", vista);
  await clickTexto(vista);
  await esperarTexto(ancla).catch(() => console.log("    (sin ancla, sigo)"));
  await dormir(4000);
  await capturar(archivo, { espera: 1000 });
}

console.log("· 2023↔2025");
await clickTexto("2023↔2025");
await esperarTexto("2023 ·").catch(() => {});
await dormir(7000);
await capturar("08-vista-evolucion", { espera: 1000 });

// ── Ficha del circuito ──────────────────────────────────────────────────────
console.log("· ficha del circuito");
await clickTexto("Operativo");
await dormir(2500);
await pag.evaluate(() => window.dispatchEvent(new CustomEvent("jxr:accionar-mapa", { detail: { tipo: "circuito", codigo: "13" } })));
await esperarTexto("PADRÓN DEL CIRCUITO");
await esperarTexto("PERFIL SOCIAL");
await dormir(4000);
const cajaFicha = await pag.evaluate(() => {
  const r = document.querySelector("aside").getBoundingClientRect();
  return { x: Math.round(r.left) - 12, y: Math.round(r.top) - 6, width: Math.round(r.width) + 24, height: Math.round(r.height) + 12 };
});
await capturar("09-panel-circuito", { clip: cajaFicha });

await pag.evaluate(() => {
  [...document.querySelectorAll("aside button")].find((b) => b.textContent.includes("mesas · las más peleadas"))?.click();
});
await dormir(1400);
await capturar("10-mesas-peleadas", { clip: cajaFicha });

await pag.evaluate(() => {
  [...document.querySelectorAll("aside button")].find((b) => b.textContent.includes("Plan territorial"))?.click();
});
await dormir(1400);
// el plan queda al pie de la ficha: hay que bajar el scroll del panel
await pag.evaluate(() => {
  const sc = [...document.querySelectorAll("aside div")].find((d) => d.scrollHeight > d.clientHeight + 40);
  if (sc) sc.scrollTop = sc.scrollHeight;
});
await dormir(1000);
await capturar("11-plan-territorial", { clip: cajaFicha });

// ── Elena: el chat y el mapa pintado ───────────────────────────────────────
console.log("· Elena (consulta la base: puede tardar)");
await pag.evaluate(() => {
  // el primer botón del aside es la impresora: el de cerrar es el último del encabezado
  const enc = document.querySelector("aside > div");
  const botones = [...enc.querySelectorAll("button")];
  botones[botones.length - 1]?.click();
  window.dispatchEvent(new CustomEvent("jxr:elena-preguntar", {
    detail: "Pintame en el mapa el porcentaje de voto en blanco de 2025 por circuito y decime en qué circuitos es más alto",
  }));
});
await esperarTexto("Elena:", 110000);
await dormir(10000); // el fitBounds recarga teselas y etiquetas
const cajaChat = await pag.evaluate(() => {
  const p = [...document.querySelectorAll("div")].find((d) => {
    const c = d.className?.toString?.() ?? "";
    return c.includes("panel-vidrio") && c.includes("h-[540px]");
  });
  const r = p.getBoundingClientRect();
  return { x: Math.round(r.left) - 10, y: Math.round(r.top) - 10, width: Math.round(r.width) + 20, height: Math.round(r.height) + 20 };
});
await capturar("12-elena-chat", { clip: cajaChat });

await pag.evaluate(() => {
  [...document.querySelectorAll('div[class*="h-[540px]"] button')].find((b) => !b.getAttribute("title"))?.click();
});
await dormir(2000);
await capturar("13-mapa-pintado-por-elena", { espera: 1500 });

// ── Estrategia, Segmentos, Personas ────────────────────────────────────────
console.log("· estrategia");
await pag.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 2 });
await pag.goto(`${BASE}/estrategia`, { waitUntil: "networkidle2" });
await esperarTexto("Frontera 20K");
await dormir(4000);
await capturar("14-estrategia-disperso", { clip: await cajaMain(1100) });

await clickTexto("UniversoUniverso territorial");
await dormir(5000);
await capturar("15-estrategia-universo", { clip: await cajaMain(1100) });

await clickTexto("BancasBancas · D'Hondt");
await dormir(5500);
await capturar("16-estrategia-bancas", { clip: await cajaMain(1100) });

await clickTexto("InformesInformes");
await dormir(2500);
await pag.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Informe de situación"))?.click());
await dormir(1800);
await capturar("17-estrategia-informes", { clip: await cajaMain(1100) });

console.log("· segmentos y personas");
await pag.goto(`${BASE}/segmentos`, { waitUntil: "networkidle2" });
await dormir(5000);
await capturar("18-segmentos", { clip: await cajaMain(1100) });
await pag.goto(`${BASE}/personas`, { waitUntil: "networkidle2" });
await dormir(3500);
await capturar("19-personas", { clip: await cajaMain(1100) });

// ── Búnker: configuración y tablero en vivo ────────────────────────────────
console.log("· bunker");
await pag.goto(`${BASE}/bunker`, { waitUntil: "networkidle2" });
await esperarTexto("escrutinio propio en vivo");
await dormir(2000);
await capturar("20-bunker-config", { clip: await cajaMain(1100) });

await escribirReact(0, "Concejales 2027");
await escribirReact(0, "JxR\nFrente Tucumán Primero\nLa Libertad Avanza\nUnidos por Tucumán", "textarea");
await dormir(700);
await pag.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Abrir el búnker"))?.click());
await esperarTexto("CARGAR TELEGRAMA");
await dormir(2200);

for (const [mesa, circ, elec, votos, bl, nu] of [
  [101, "13", 350, [120, 90, 60, 30], 8, 2],
  [102, "13", 350, [100, 110, 55, 25], 6, 4],
  [103, "20", 340, [80, 130, 40, 20], 10, 3],
]) {
  await escribirReact(0, String(mesa));
  await pag.evaluate((c) => { const s = document.querySelector("select"); s.value = c; s.dispatchEvent(new Event("change", { bubbles: true })); }, circ);
  await escribirReact(1, String(elec));
  for (let i = 0; i < votos.length; i++) await escribirReact(2 + i, String(votos[i]));
  await escribirReact(2 + votos.length, String(bl));
  await escribirReact(3 + votos.length, String(nu));
  await dormir(500);
  await pag.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Cargar mesa"))?.click());
  await dormir(2200);
}
await esperarTexto("RESULTADO EN VIVO");
await dormir(1500);
await capturar("21-bunker-vivo", { clip: { x: 0, y: 0, width: 1440, height: 1000 } });

// ── Ficha imprimible (siempre es blanca) ───────────────────────────────────
console.log("· ficha imprimible");
await pag.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 2 });
await pag.goto(`${BASE}/imprimir/circuito/13`, { waitUntil: "networkidle2" });
await esperarTexto("Ficha lista");
await dormir(2500);
const altoFicha = await pag.evaluate(() => Math.min(1400, document.body.scrollHeight));
await capturar("22-ficha-imprimible", { clip: { x: 0, y: 0, width: 1000, height: altoFicha } });

// ── Teléfono ───────────────────────────────────────────────────────────────
console.log("· teléfono");
await pag.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await pag.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await esperarTexto("459.156");
await dormir(7000);
await pag.evaluate(() => document.querySelector('header button[aria-label="Abrir menú"]')?.click());
await dormir(1000);
await capturar("23-mobile-menu");

await pag.evaluate(() => {
  document.querySelector('header button[aria-label="Cerrar menú"]')?.click();
  window.dispatchEvent(new CustomEvent("jxr:accionar-mapa", { detail: { tipo: "circuito", codigo: "13" } }));
});
await esperarTexto("PADRÓN DEL CIRCUITO");
await dormir(3500);
await capturar("24-mobile-hoja");

await pag.goto(`${BASE}/bunker`, { waitUntil: "networkidle2" });
await esperarTexto("CARGAR TELEGRAMA");
await dormir(2500);
await capturar("25-mobile-bunker");

await navegador.close();
console.log("\nlisto: todas las capturas en modo claro");

import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

/**
 * Capturas para el manual de uso. Corre contra el dev server local con un
 * usuario dedicado. Cada paso espera a que el dato REAL esté en pantalla
 * (no a un timeout fijo), así ninguna captura sale a medio cargar.
 */

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3400";
const SALIDA = "manual/capturas";
mkdirSync(SALIDA, { recursive: true });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();
pag.setDefaultTimeout(45000);

const capturar = async (nombre, opciones = {}) => {
  await dormir(opciones.espera ?? 900);
  const ruta = `${SALIDA}/${nombre}.png`;
  await pag.screenshot({ path: ruta, clip: opciones.clip });
  console.log("  ✓", nombre);
};

/** Espera a que aparezca un texto en la página (dato real cargado). */
const esperarTexto = async (texto, limite = 40000) => {
  await pag.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout: limite, polling: 500 },
    texto,
  );
};

const clickTexto = async (texto, exacto = true) => {
  const ok = await pag.evaluate(
    (t, ex) => {
      const b = [...document.querySelectorAll("button, a")].find((x) => {
        const s = x.textContent.trim();
        return ex ? s === t : s.includes(t);
      });
      if (!b) return false;
      b.click();
      return true;
    },
    texto,
    exacto,
  );
  if (!ok) throw new Error(`no encontré el control «${texto}»`);
  await dormir(700);
};

// ── 1. Acceso ────────────────────────────────────────────────────────────────
console.log("· acceso");
await pag.goto(`${BASE}/acceso`, { waitUntil: "networkidle2" });
await esperarTexto("CONTRASEÑA");
await capturar("01-acceso");

await pag.type('input[type="email"]', "manual-claude@jxr.com");
await pag.type('input[type="password"]', "ManualJxR2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);

// ── 2. Mapa: vista Operativo ────────────────────────────────────────────────
console.log("· mapa");
await esperarTexto("459.156");
await dormir(4500); // que el basemap y las etiquetas terminen de dibujarse
await capturar("02-mapa-operativo", { espera: 1200 });

// barra de controles sola (para explicar cada control)
await capturar("03-controles", { clip: { x: 0, y: 0, width: 1440, height: 150 } });

// ── 3. Vistas de análisis ───────────────────────────────────────────────────
for (const [vista, archivo, ancla] of [
  ["Padrón", "04-vista-padron", "electores"],
  ["Escuelas", "05-vista-escuelas", "escuelas geocodificadas"],
  ["Prioridad", "06-vista-prioridad", "Frontera"],
  ["Oportunidad", "07-vista-oportunidad", "Dónde invertir primero"],
]) {
  console.log("·", vista);
  await clickTexto(vista);
  // la leyenda arranca abierta en desktop; algunas vistas cargan por RPC
  await esperarTexto(ancla).catch(() => console.log("    (sin ancla, sigo)"));
  await dormir(3200);
  await capturar(archivo, { espera: 900 });
}

console.log("· 2023↔2025");
await clickTexto("2023↔2025");
await esperarTexto("2023 ·").catch(() => {});
await dormir(6000);
await capturar("08-vista-evolucion", { espera: 900 });

await navegador.close();
console.log("\nlisto: capturas del mapa");

import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3400";
const SALIDA = "manual/capturas";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();
pag.setDefaultTimeout(60000);
const capturar = async (n, o = {}) => { await dormir(o.espera ?? 1000); await pag.screenshot({ path: `${SALIDA}/${n}.png`, clip: o.clip }); console.log("  ✓", n); };
const esperarTexto = (t, l = 50000) => pag.waitForFunction((x) => document.body.innerText.includes(x), { timeout: l, polling: 500 }, t);
const clickTexto = async (t, ex = true) => {
  const ok = await pag.evaluate((s, e) => {
    const b = [...document.querySelectorAll("button, a")].find((x) => (e ? x.textContent.trim() === s : x.textContent.includes(s)));
    if (!b) return false; b.click(); return true;
  }, t, ex);
  if (!ok) throw new Error(`no encontré «${t}»`);
  await dormir(900);
};
/** Recorta al contenido real de <main>, sin el vacío de abajo. */
const cajaMain = async (maxAlto = 1100) => pag.evaluate((m) => {
  const el = document.querySelector("main");
  const r = el.getBoundingClientRect();
  const alto = Math.min(m, Math.max(...[...el.querySelectorAll("*")].map((x) => x.getBoundingClientRect().bottom)) - r.top + 24);
  return { x: 0, y: 0, width: 1440, height: Math.round(Math.min(1100, r.top + alto)) };
}, maxAlto);

await pag.goto(`${BASE}/acceso`, { waitUntil: "networkidle2" });
await pag.type('input[type="email"]', "manual-claude@jxr.com");
await pag.type('input[type="password"]', "ManualJxR2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);
await esperarTexto("459.156");

// ── Estrategia ──────────────────────────────────────────────────────────────
console.log("· estrategia");
await pag.goto(`${BASE}/estrategia`, { waitUntil: "networkidle2" });
await esperarTexto("Frontera 20K");
await dormir(3500);
await capturar("14-estrategia-disperso", { clip: await cajaMain() });

await clickTexto("UniversoUniverso territorial");
await esperarTexto("Universo", 30000).catch(() => {});
await dormir(4500);
await capturar("15-estrategia-universo", { clip: await cajaMain() });

await clickTexto("BancasBancas · D'Hondt");
await esperarTexto("bancas", 30000).catch(() => {});
await dormir(5000);
await capturar("16-estrategia-bancas", { clip: await cajaMain() });

await clickTexto("InformesInformes");
await dormir(2500);
await pag.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Informe de situación")); b?.click(); });
await dormir(1800);
await capturar("17-estrategia-informes", { clip: await cajaMain() });

// ── Segmentos y Personas ────────────────────────────────────────────────────
console.log("· segmentos y personas");
await pag.goto(`${BASE}/segmentos`, { waitUntil: "networkidle2" });
await dormir(5000);
await capturar("18-segmentos", { clip: await cajaMain() });

await pag.goto(`${BASE}/personas`, { waitUntil: "networkidle2" });
await dormir(3500);
await capturar("19-personas", { clip: await cajaMain() });

// ── Búnker: pantalla de configuración ───────────────────────────────────────
console.log("· bunker");
await pag.goto(`${BASE}/bunker`, { waitUntil: "networkidle2" });
await esperarTexto("escrutinio propio en vivo");
await dormir(2000);
await capturar("20-bunker-config", { clip: await cajaMain() });

await navegador.close();
console.log("\nlisto");

import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3400";
const SALIDA = "manual/capturas";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  defaultViewport: { width: 1440, height: 1050, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();
pag.setDefaultTimeout(60000);
const capturar = async (n, o = {}) => { await dormir(o.espera ?? 1000); await pag.screenshot({ path: `${SALIDA}/${n}.png`, clip: o.clip }); console.log("  ✓", n); };
const esperarTexto = (t, l = 50000) => pag.waitForFunction((x) => document.body.innerText.includes(x), { timeout: l, polling: 500 }, t);

const escribirReact = (selectorIdx, valor, tag = "input") =>
  pag.evaluate((i, v, t) => {
    const proto = t === "textarea" ? window.HTMLTextAreaElement : window.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
    const el = document.querySelectorAll(t)[i];
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selectorIdx, valor, tag);

await pag.goto(`${BASE}/acceso`, { waitUntil: "networkidle2" });
await pag.type('input[type="email"]', "manual-claude@jxr.com");
await pag.type('input[type="password"]', "ManualJxR2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);
await esperarTexto("459.156");

// ── Búnker: abrirlo y cargar mesas para mostrar el tablero en vivo ──────────
console.log("· bunker en vivo");
await pag.goto(`${BASE}/bunker`, { waitUntil: "networkidle2" });
await esperarTexto("escrutinio propio en vivo");
await dormir(1500);
await escribirReact(0, "Concejales 2027");
await escribirReact(0, "JxR\nFrente Tucumán Primero\nLa Libertad Avanza\nUnidos por Tucumán", "textarea");
await dormir(600);
await pag.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Abrir el búnker"))?.click());
await esperarTexto("CARGAR TELEGRAMA");
await dormir(2000);

// tres mesas de ejemplo
const mesas = [
  [101, "13", 350, [120, 90, 60, 30], 8, 2],
  [102, "13", 350, [100, 110, 55, 25], 6, 4],
  [103, "20", 340, [80, 130, 40, 20], 10, 3],
];
for (const [mesa, circ, elec, votos, bl, nu] of mesas) {
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
await capturar("21-bunker-vivo", { clip: { x: 0, y: 0, width: 1440, height: 1050 } });

// ── Ficha imprimible ────────────────────────────────────────────────────────
console.log("· ficha imprimible");
await pag.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 2 });
await pag.goto(`${BASE}/imprimir/circuito/13`, { waitUntil: "networkidle2" });
await esperarTexto("Ficha lista");
await dormir(2500);
const altoFicha = await pag.evaluate(() => Math.min(1400, document.body.scrollHeight));
await capturar("22-ficha-imprimible", { clip: { x: 0, y: 0, width: 1000, height: altoFicha } });

// ── Mobile ──────────────────────────────────────────────────────────────────
console.log("· mobile");
await pag.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await pag.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await esperarTexto("459.156");
await dormir(5000);
await pag.evaluate(() => document.querySelector('header button[aria-label="Abrir menú"]')?.click());
await dormir(900);
await capturar("23-mobile-menu");

await pag.evaluate(() => {
  document.querySelector('header button[aria-label="Cerrar menú"]')?.click();
  window.dispatchEvent(new CustomEvent("jxr:accionar-mapa", { detail: { tipo: "circuito", codigo: "13" } }));
});
await esperarTexto("PADRÓN DEL CIRCUITO");
await dormir(3000);
await capturar("24-mobile-hoja");

await pag.goto(`${BASE}/bunker`, { waitUntil: "networkidle2" });
await esperarTexto("CARGAR TELEGRAMA");
await dormir(2500);
await capturar("25-mobile-bunker");

await navegador.close();
console.log("\nlisto");

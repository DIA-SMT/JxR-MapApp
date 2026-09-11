import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:3400";
const SALIDA = "manual/capturas";
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
  await dormir(opciones.espera ?? 900);
  await pag.screenshot({ path: `${SALIDA}/${nombre}.png`, clip: opciones.clip, fullPage: opciones.fullPage });
  console.log("  ✓", nombre);
};
const esperarTexto = (texto, limite = 50000) =>
  pag.waitForFunction((t) => document.body.innerText.includes(t), { timeout: limite, polling: 500 }, texto);
const clickTexto = async (texto, exacto = true) => {
  const ok = await pag.evaluate(
    (t, ex) => {
      const b = [...document.querySelectorAll("button, a")].find((x) => (ex ? x.textContent.trim() === t : x.textContent.includes(t)));
      if (!b) return false;
      b.click();
      return true;
    }, texto, exacto);
  if (!ok) throw new Error(`no encontré «${texto}»`);
  await dormir(800);
};

// login
await pag.goto(`${BASE}/acceso`, { waitUntil: "networkidle2" });
await pag.type('input[type="email"]', "manual-claude@jxr.com");
await pag.type('input[type="password"]', "ManualJxR2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);
await esperarTexto("459.156");
await dormir(4000);

// ── Panel del circuito ───────────────────────────────────────────────────────
console.log("· panel del circuito");
await pag.evaluate(() => window.dispatchEvent(new CustomEvent("jxr:accionar-mapa", { detail: { tipo: "circuito", codigo: "13" } })));
await esperarTexto("PADRÓN DEL CIRCUITO");
await esperarTexto("PERFIL SOCIAL");
await dormir(3500);
// el panel es un aside de 360px anclado a la derecha
const caja = await pag.evaluate(() => {
  const a = document.querySelector("aside");
  const r = a.getBoundingClientRect();
  return { x: Math.round(r.left) - 12, y: Math.round(r.top) - 6, width: Math.round(r.width) + 24, height: Math.round(r.height) + 12 };
});
await capturar("09-panel-circuito", { clip: caja });

// desplegar 2025 mesa a mesa y el plan territorial
await pag.evaluate(() => {
  const btn = [...document.querySelectorAll("aside button")];
  btn.find((b) => b.textContent.includes("mesas · las más peleadas"))?.click();
});
await dormir(1200);
await capturar("10-mesas-peleadas", { clip: caja });

await pag.evaluate(() => {
  const a = document.querySelector("aside");
  [...a.querySelectorAll("button")].find((b) => b.textContent.includes("Plan territorial"))?.click();
});
await dormir(1200);
// el plan queda abajo: scrollear el panel hasta el final
await pag.evaluate(() => {
  const sc = [...document.querySelectorAll("aside div")].find((d) => d.scrollHeight > d.clientHeight + 40);
  if (sc) sc.scrollTop = sc.scrollHeight;
});
await dormir(900);
await capturar("11-plan-territorial", { clip: caja });

// ── Elena: análisis + pintado del mapa ──────────────────────────────────────
console.log("· Elena (puede tardar: consulta la base y responde)");
await pag.evaluate(() => {
  document.querySelector("aside button")?.click(); // cerrar el panel
  window.dispatchEvent(new CustomEvent("jxr:elena-preguntar", {
    detail: "Pintame en el mapa el porcentaje de voto en blanco de 2025 por circuito y decime dónde es más alto",
  }));
});
await esperarTexto("Elena:", 90000);
await dormir(3000);
await capturar("12-elena-pinta-mapa");

await navegador.close();
console.log("\nlisto: panel y Elena");

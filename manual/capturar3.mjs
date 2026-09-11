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
const capturar = async (n, o = {}) => { await dormir(o.espera ?? 900); await pag.screenshot({ path: `${SALIDA}/${n}.png`, clip: o.clip }); console.log("  ✓", n); };
const esperarTexto = (t, l = 50000) => pag.waitForFunction((x) => document.body.innerText.includes(x), { timeout: l, polling: 500 }, t);

await pag.goto(`${BASE}/acceso`, { waitUntil: "networkidle2" });
await pag.type('input[type="email"]', "manual-claude@jxr.com");
await pag.type('input[type="password"]', "ManualJxR2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);
await esperarTexto("459.156");
await dormir(4500);

// Elena pinta el mapa, sin ningún panel abierto
console.log("· Elena");
await pag.evaluate(() => {
  window.dispatchEvent(new CustomEvent("jxr:elena-preguntar", {
    detail: "Pintame en el mapa el porcentaje de voto en blanco de 2025 por circuito y decime en qué circuitos es más alto",
  }));
});
await esperarTexto("Elena:", 100000);
// las teselas y las etiquetas del coropleta tardan tras el fitBounds
await dormir(9000);

// 12: el chat de Elena solo (la conversación y el rastro de herramientas)
const cajaChat = await pag.evaluate(() => {
  const p = [...document.querySelectorAll("div")].find((d) => {
    const t = d.className?.toString?.() ?? "";
    return t.includes("panel-vidrio") && t.includes("h-[540px]");
  });
  const r = p.getBoundingClientRect();
  return { x: Math.round(r.left) - 10, y: Math.round(r.top) - 10, width: Math.round(r.width) + 20, height: Math.round(r.height) + 20 };
});
await capturar("12-elena-chat", { clip: cajaChat });

// 13: el mapa con el análisis pintado (sin el chat tapando)
await pag.evaluate(() => {
  const cerrar = [...document.querySelectorAll("button")].find((b) => b.getAttribute("title") === null && b.closest('div[class*="h-[540px]"]'));
  cerrar?.click();
});
await dormir(1500);
await capturar("13-mapa-pintado-por-elena", { espera: 1500 });

await navegador.close();
console.log("\nlisto");

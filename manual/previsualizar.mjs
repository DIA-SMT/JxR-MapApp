import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

/** Rinde cada hoja como PNG para revisarla igual que saldrá en el PDF. */
mkdirSync("manual/previa", { recursive: true });
const navegador = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "shell",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();
await pag.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.6 });
await pag.goto(pathToFileURL(resolve("manual/manual.html")).href, { waitUntil: "networkidle0", timeout: 90000 });
await pag.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" }).catch(() => {});
await pag.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 2500));

const n = await pag.evaluate(() => document.querySelectorAll(".hoja").length);
for (let i = 0; i < n; i++) {
  // clip va en coordenadas del DOCUMENTO, no del viewport: hay que sumar el scroll
  const caja = await pag.evaluate((k) => {
    const h = document.querySelectorAll(".hoja")[k];
    const r = h.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, i);
  await pag.screenshot({ path: `manual/previa/hoja-${i + 1}.png`, clip: caja, captureBeyondViewport: true });
}
await navegador.close();
console.log(`${n} hojas rendidas en manual/previa/`);

import puppeteer from "puppeteer-core";
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SALIDA = "Manual de uso - JxR Comando Territorial.pdf";

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--font-render-hinting=none", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();

// Poppins es la tipografía de la marca; si no baja, cae en la del sistema
await pag.goto("https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap", { waitUntil: "load" }).catch(() => {});
await pag.goto(pathToFileURL(resolve("manual/manual.html")).href, { waitUntil: "networkidle0", timeout: 90000 });
await pag.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" }).catch(() => {});
await pag.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 2500));

// aviso si alguna imagen no cargó (en el PDF quedaría un hueco)
const rotas = await pag.evaluate(() =>
  [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute("src")),
);
if (rotas.length) console.log("IMÁGENES ROTAS:", rotas.join(", "));

await pag.pdf({
  path: SALIDA,
  format: "A4",
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  preferCSSPageSize: true,
});
await navegador.close();
console.log(`${SALIDA} · ${(statSync(SALIDA).size / 1024 / 1024).toFixed(2)} MB`);

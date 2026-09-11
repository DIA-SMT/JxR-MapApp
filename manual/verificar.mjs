import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const navegador = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "shell",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();
await pag.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
await pag.goto(pathToFileURL(resolve("manual/manual.html")).href, { waitUntil: "networkidle0", timeout: 90000 });
await pag.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" }).catch(() => {});
await pag.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 2000));

/**
 * Cada hoja tiene alto fijo (297 mm) con overflow oculto: si el contenido pasa,
 * en el PDF se corta sin aviso. Medimos el borde inferior del último elemento
 * de contenido contra el área útil (la hoja menos el pie y su margen).
 */
const informe = await pag.evaluate(() => {
  const hojas = [...document.querySelectorAll(".hoja")];
  return hojas.map((h, i) => {
    const rh = h.getBoundingClientRect();
    const pie = h.querySelector(".pie");
    const topePie = pie ? pie.getBoundingClientRect().top - rh.top : rh.height;
    let masBajo = 0, culpable = "";
    for (const el of h.querySelectorAll("h1,h2,h3,p,table,figure,figcaption,ul,.nota,.fila")) {
      if (el.closest(".pie")) continue;
      const b = el.getBoundingClientRect().bottom - rh.top;
      if (b > masBajo) { masBajo = b; culpable = el.tagName.toLowerCase() + (el.className ? "." + el.className.toString().split(" ")[0] : ""); }
    }
    return {
      hoja: i + 1,
      altoHoja: Math.round(rh.height),
      finContenido: Math.round(masBajo),
      topePie: Math.round(topePie),
      sobra: Math.round(topePie - masBajo),
      culpable,
    };
  });
});

console.log("hoja  alto  contenido  tope-pie  sobra   ultimo elemento");
for (const f of informe) {
  const alerta = f.sobra < 0 ? "  ← SE DESBORDA" : f.sobra < 12 ? "  ← justo" : "";
  console.log(
    String(f.hoja).padStart(4),
    String(f.altoHoja).padStart(5),
    String(f.finContenido).padStart(10),
    String(f.topePie).padStart(9),
    String(f.sobra).padStart(6),
    "  " + f.culpable + alerta,
  );
}
const malas = informe.filter((f) => f.sobra < 0);
console.log(malas.length ? `\n${malas.length} hoja(s) con desborde` : "\nninguna hoja se desborda");
await navegador.close();

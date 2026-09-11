import puppeteer from "puppeteer-core";
import { readdirSync, readFileSync, mkdirSync, statSync } from "node:fs";

/**
 * Reduce las capturas a un tamaño razonable para el PDF (~1500 px de ancho es
 * de sobra para impresión) y las pasa a JPEG, que para mapas y capturas de
 * pantalla pesa una fracción del PNG. Algunas se recortan: el alto útil
 * termina antes del final del viewport y el resto es fondo vacío.
 */
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ORIGEN = "manual/capturas";
const DESTINO = "manual/img";
mkdirSync(DESTINO, { recursive: true });

// alto útil como fracción del original (1 = completa)
const RECORTE = {
  "19-personas": 0.42,
  "20-bunker-config": 0.62,
  "21-bunker-vivo": 0.44,
  "18-segmentos": 0.78,
};
const ANCHO = { "03-controles": 1600, "09-panel-circuito": 620, "10-mesas-peleadas": 620, "11-plan-territorial": 620, "12-elena-chat": 640, "23-mobile-menu": 430, "24-mobile-hoja": 430, "25-mobile-bunker": 430 };

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await navegador.newPage();

let antes = 0, despues = 0;
for (const archivo of readdirSync(ORIGEN).filter((f) => f.endsWith(".png")).sort()) {
  const clave = archivo.replace(".png", "");
  const bytes = readFileSync(`${ORIGEN}/${archivo}`);
  antes += bytes.length;
  const wOrig = bytes.readUInt32BE(16), hOrig = bytes.readUInt32BE(20);
  const ancho = ANCHO[clave] ?? 1500;
  const escala = ancho / wOrig;
  const alto = Math.round(hOrig * escala * (RECORTE[clave] ?? 1));

  await pag.setViewport({ width: ancho, height: alto, deviceScaleFactor: 1 });
  await pag.setContent(
    `<style>html,body{margin:0;padding:0;background:#070a10;overflow:hidden}
     img{display:block;width:${ancho}px;height:${Math.round(hOrig * escala)}px}</style>
     <img src="data:image/png;base64,${bytes.toString("base64")}">`,
    { waitUntil: "load" },
  );
  const salida = `${DESTINO}/${clave}.jpg`;
  await pag.screenshot({ path: salida, type: "jpeg", quality: 86 });
  despues += statSync(salida).size;
  console.log(`  ${clave.padEnd(30)} ${wOrig}x${hOrig} → ${ancho}x${alto}`);
}
await navegador.close();
console.log(`\n${(antes / 1024 / 1024).toFixed(1)} MB → ${(despues / 1024 / 1024).toFixed(1)} MB`);

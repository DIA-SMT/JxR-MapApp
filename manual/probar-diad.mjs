import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/**
 * Prueba de punta a punta del DÍA D contra el servidor local.
 * Arranca dejando la jornada en cero para que sea repetible: si no, la
 * segunda corrida encontraría la configuración ya cargada y no entraría por
 * la pantalla de Configuración.
 */
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
await admin.from("diad_cargas").delete().gte("id", 0);
await admin.from("diad_incidencias").delete().gte("id", 0);
await admin.from("diad_fiscales").delete().gte("mesa", 0);
await admin.from("diad_asistencia").delete().gte("mesa", 0);
await admin.from("diad_config").update({
  eleccion: "Elección 2027", categoria: "CONCEJAL", bancas: 18, mesas_esperadas: 1350,
  listas: [], activa: false, fecha: null, meta_votos: 0, telefono_comando: "",
  cortes: ["10:00", "12:00", "14:00", "16:00", "18:00"],
}).eq("id", 1);
console.log("· jornada reiniciada");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "shell",
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
  args: ["--no-sandbox", "--hide-scrollbars", "--force-color-profile=srgb"],
});
const pag = await nav.newPage();
pag.setDefaultTimeout(60000);
const errores = [];
pag.on("console", (m) => { if (m.type() === "error") errores.push(m.text().slice(0, 160)); });
pag.on("pageerror", (e) => errores.push("PAGEERROR " + e.message.slice(0, 160)));

// insensible a mayúsculas: innerText devuelve el texto ya transformado por el
// CSS, y varios títulos de la interfaz llevan text-transform: uppercase
const esperar = (t, l = 45000) =>
  pag.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), { timeout: l, polling: 400 }, t);
const clickTexto = async (t) => {
  const ok = await pag.evaluate((s) => {
    const b = [...document.querySelectorAll("button, a")].find((x) => x.textContent.trim().includes(s));
    if (!b) return false;
    b.click();
    return true;
  }, t);
  if (!ok) throw new Error("no encontre el control: " + t);
  await dormir(900);
};
const ponerValor = (buscar, valor, tag = "input") =>
  pag.evaluate((b, v, t) => {
    const proto = t === "textarea" ? window.HTMLTextAreaElement : window.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
    const els = [...document.querySelectorAll(t)];
    const el = b === null ? els[0] : els.find((x) => (x.placeholder || "").includes(b));
    if (!el) throw new Error("sin campo: " + b);
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, buscar, valor, tag);

await pag.goto("http://localhost:3400/acceso", { waitUntil: "domcontentloaded" });
await pag.evaluate(() => localStorage.setItem("jxr:tema", "claro"));
await pag.goto("http://localhost:3400/acceso", { waitUntil: "networkidle2" });
await pag.type('input[type="email"]', "diad@jxr.com");
await pag.type('input[type="password"]', "PruebaDiaD2026!");
await Promise.all([pag.waitForNavigation({ waitUntil: "networkidle2" }), pag.click('button[type="submit"]')]);
await esperar("459.156");

console.log("· abriendo DÍA D");
await pag.goto("http://localhost:3400/dia-d", { waitUntil: "networkidle2" });
await esperar("Parámetros de la jornada", 60000);
console.log("  ✓ abre en Configuración porque todavía no hay listas");

// ── 1. Configurar la jornada ───────────────────────────────────────────────
console.log("· configurando");
await ponerValor("Concejales 2027", "Concejales 2027");
await pag.evaluate(() => {
  const d = document.querySelector('input[type="date"]');
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  s.call(d, "2027-10-24");
  d.dispatchEvent(new Event("input", { bubbles: true }));
});
await ponerValor("381", "381 155 123456");
await ponerValor(null, "JxR\nFrente Tucumán Primero\nLa Libertad Avanza\nUnidos por Tucumán", "textarea");
await dormir(600);
await clickTexto("Guardar configuración");
await esperar("Guardado", 25000);
console.log("  ✓ configuración guardada");

// ── 2. Fiscales ────────────────────────────────────────────────────────────
console.log("· fiscales");
await clickTexto("Fiscales");
await esperar("mesas con fiscal", 50000);
console.log("  cobertura inicial:", await pag.evaluate(() => document.body.innerText.match(/[\d.]+\/[\d.]+ mesas con fiscal/)?.[0]));

await pag.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.includes("faltan"))?.click());
await pag.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Asignar"));
await clickTexto("Asignar");
await pag.waitForFunction(() => [...document.querySelectorAll("input")].some((x) => x.placeholder === "Nombre y apellido"));
await ponerValor("Nombre y apellido", "Ramón Pérez");
await ponerValor("Teléfono", "0381 15 5123456");
await dormir(400);
await clickTexto("Guardar");
// el fiscal quedó guardado cuando aparece su enlace de WhatsApp en la fila
await pag.waitForFunction(() => document.querySelectorAll('a[href*="wa.me"]').length > 0, { timeout: 20000 });

const contacto = await pag.evaluate(() => {
  const tel = [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href"));
  const wa = [...document.querySelectorAll('a[href*="wa.me"]')].map((a) => a.getAttribute("href"));
  return {
    tel,
    wa: wa.map((u) => u.split("?")[0]),
    mensaje: wa[0] ? decodeURIComponent((wa[0].split("text=")[1] ?? "")) : null,
  };
});
console.log("  tel:", contacto.tel.join(" · "));
console.log("  whatsapp:", contacto.wa.join(" · "));
console.log("  mensaje:", contacto.mensaje);
console.log("  cobertura tras asignar:", await pag.evaluate(() => document.body.innerText.match(/[\d.]+\/[\d.]+ mesas con fiscal/)?.[0]));

// ── 3. Participación ───────────────────────────────────────────────────────
console.log("· participación");
await clickTexto("Particip");
await esperar("Corte horario", 30000);
await ponerValor("214", "1");
await ponerValor("120", "150");
await dormir(600);
await clickTexto("Cargar");
await dormir(2500);
console.log("  ", await pag.evaluate(() => document.body.innerText.match(/Mesa 1:[^\n]*/)?.[0] ?? "sin aviso"));
console.log("  ", await pag.evaluate(() => document.body.innerText.match(/[\d,.]+%[^\n]*participación[^\n]*/)?.[0] ?? ""));

// control: más votos que electores tiene que rechazarse
await ponerValor("214", "1");
await ponerValor("120", "9999");
await dormir(500);
await clickTexto("Cargar");
await dormir(1300);
console.log("  control de padrón:", await pag.evaluate(() => document.body.innerText.match(/no pueden haber votado[^\n]*/)?.[0] ?? "NO RECHAZÓ (mal)"));

// ── 4. Incidencias ─────────────────────────────────────────────────────────
console.log("· incidencias");
await clickTexto("Incid");
await esperar("Reportar una incidencia", 30000);
await ponerValor("Mesa", "1");
await ponerValor(null, "No llegaron las boletas de la lista", "textarea");
await dormir(500);
await clickTexto("Reportar");
await dormir(2200);
console.log("  ", await pag.evaluate(() => document.body.innerText.match(/\d+ abiertas/i)?.[0] ?? "sin listado"));

// ── 5. Escrutinio ──────────────────────────────────────────────────────────
console.log("· escrutinio");
await clickTexto("Escrut");
await esperar("Cargar telegrama de mesa", 30000);
await ponerValor("Número de mesa", "1");
await dormir(900);
console.log("  contexto de la mesa:", await pag.evaluate(() => document.body.innerText.match(/ESC\.[^\n]*electores/)?.[0] ?? "sin contexto"));
await pag.evaluate(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const ceros = [...document.querySelectorAll('input[placeholder="0"]')];
  [150, 90, 60, 20, 8, 2].forEach((v, i) => {
    if (!ceros[i]) return;
    set.call(ceros[i], String(v));
    ceros[i].dispatchEvent(new Event("input", { bubbles: true }));
  });
});
await dormir(600);
await clickTexto("Cargar mesa");
await dormir(2500);
console.log("  resultado:", await pag.evaluate(() => document.body.innerText.match(/1\. [^\n]*/)?.[0] ?? "sin resultado"));

await pag.screenshot({ path: "manual/diad-prueba.png" });
await nav.close();
console.log("\nerrores de consola:", errores.length ? errores.slice(0, 5) : "ninguno");

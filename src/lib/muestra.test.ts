import { strict as assert } from "node:assert";
import { test } from "node:test";
import { disenarMuestra, margenDeError, tamanoParaMargen, type Estrato } from "./muestra.ts";

const CIUDAD: Estrato[] = [
  { circuito: "1", electores: 12000 },
  { circuito: "2", electores: 8000 },
  { circuito: "3", electores: 25000 },
  { circuito: "4", electores: 5000 },
  { circuito: "5", electores: 50000 },
];

test("el margen de error coincide con los valores de manual", () => {
  // n=400 sobre una población grande: el clásico ±4,9 puntos al 95%
  assert.ok(Math.abs(margenDeError(400, 1_000_000, 95) - 4.9) < 0.1);
  // n=1000: ±3,1
  assert.ok(Math.abs(margenDeError(1000, 1_000_000, 95) - 3.1) < 0.1);
  // más confianza, más margen
  assert.ok(margenDeError(400, 1_000_000, 99) > margenDeError(400, 1_000_000, 95));
  // censar toda la población deja margen cero
  assert.equal(margenDeError(500, 500, 95), 0);
});

test("el tamaño para un margen objetivo es coherente con el margen que produce", () => {
  for (const objetivo of [2, 3, 5]) {
    const n = tamanoParaMargen(objetivo, 459_156, 95);
    const real = margenDeError(n, 459_156, 95);
    assert.ok(real <= objetivo + 0.05, `con n=${n} el margen fue ${real}, se pidió ${objetivo}`);
    // y con una entrevista menos ya no alcanzaría: el n es el mínimo
    assert.ok(margenDeError(n - 1, 459_156, 95) > objetivo - 0.05);
  }
});

test("las entrevistas asignadas suman exactamente el n pedido", () => {
  for (const n of [400, 777, 1000, 2500]) {
    const d = disenarMuestra(CIUDAD, { n, minimoPorEstrato: 10 });
    const suma = d.estratos.reduce((a, e) => a + e.entrevistas, 0);
    assert.equal(suma, d.n, `con n=${n} la suma fue ${suma}`);
  }
});

test("reparte proporcional a la población", () => {
  const d = disenarMuestra(CIUDAD, { n: 1000, minimoPorEstrato: 0 });
  const total = CIUDAD.reduce((a, e) => a + e.electores, 0);
  for (const e of d.estratos) {
    const esperado = (1000 * e.electores) / total;
    assert.ok(
      Math.abs(e.entrevistas - esperado) <= 1,
      `${e.circuito}: ${e.entrevistas} entrevistas, esperaba ~${esperado.toFixed(1)}`,
    );
  }
  // el circuito más grande se lleva la mayor parte
  assert.equal(d.estratos[0].circuito, "5");
});

test("respeta el mínimo por estrato y avisa si eso fuerza a subir el total", () => {
  const d = disenarMuestra(CIUDAD, { n: 20, minimoPorEstrato: 15 });
  assert.equal(d.n, 75, "5 circuitos × 15 mínimo");
  assert.ok(d.estratos.every((e) => e.entrevistas >= 15));
  assert.ok(d.avisos.some((a) => a.includes("no puede bajar")), JSON.stringify(d.avisos));
});

test("los pesos corrigen la sobre y sub representación", () => {
  const d = disenarMuestra(CIUDAD, { n: 500, minimoPorEstrato: 50 });
  // el circuito chico queda sobre-representado por el mínimo → peso < 1
  const chico = d.estratos.find((e) => e.circuito === "4");
  const grande = d.estratos.find((e) => e.circuito === "5");
  assert.ok(chico && chico.peso < 1, `el chico debería pesar menos de 1, pesó ${chico?.peso}`);
  assert.ok(grande && grande.peso > 1, `el grande debería pesar más de 1, pesó ${grande?.peso}`);
  // ponderando, la muestra reconstruye la proporción real de cada estrato
  for (const e of d.estratos) {
    const reconstruido = (e.entrevistas * e.peso) / d.n;
    assert.ok(
      Math.abs(reconstruido - e.proporcionPoblacion) < 0.002,
      `${e.circuito}: ponderado ${reconstruido.toFixed(4)} vs real ${e.proporcionPoblacion.toFixed(4)}`,
    );
  }
});

test("avisa cuando un circuito grande queda con muestra insuficiente para leerlo solo", () => {
  const d = disenarMuestra(CIUDAD, { n: 60, minimoPorEstrato: 5 });
  assert.ok(
    d.avisos.some((a) => a.includes("no para leer ese circuito solo")),
    JSON.stringify(d.avisos),
  );
});

test("un margen objetivo produce el n sugerido y lo usa si no se pide otro", () => {
  const d = disenarMuestra(CIUDAD, { margenObjetivo: 3, minimoPorEstrato: 10 });
  assert.ok(d.nSugerido && d.nSugerido > 800, `sugirió ${d.nSugerido}`);
  assert.equal(d.n, d.nSugerido);
  assert.ok(d.margen <= 3.05, `el margen resultante fue ${d.margen}`);
});

test("ignora estratos sin electores y se queja si no queda ninguno", () => {
  const d = disenarMuestra([...CIUDAD, { circuito: "vacío", electores: 0 }], { n: 400 });
  assert.ok(!d.estratos.some((e) => e.circuito === "vacío"));
  assert.throws(() => disenarMuestra([{ circuito: "x", electores: 0 }], { n: 100 }), /no hay estratos/);
});

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { estimarTransferencia, leerTransferencia, type UnidadTransferencia } from "./transferencia.ts";

/**
 * La prueba clave de un estimador de inferencia ecológica: si se le da un
 * conjunto de territorios GENERADO con una matriz conocida, tiene que
 * recuperar esa matriz. Si no la recupera en el caso sintético, no hay que
 * creerle nada en el caso real.
 */
function generar(
  matriz: number[][],
  padrones: number[][],
  etiquetas: { origenes: string[]; destinos: string[] },
): UnidadTransferencia[] {
  return padrones.map((origen, c) => {
    const destino = new Array(etiquetas.destinos.length).fill(0);
    for (let i = 0; i < origen.length; i++) {
      for (let j = 0; j < destino.length; j++) destino[j] += origen[i] * matriz[i][j];
    }
    return { unidad: `circuito ${c + 1}`, origen, destino };
  });
}

test("recupera una matriz conocida a partir de agregados por territorio", () => {
  const origenes = ["A", "B", "Abstención"];
  const destinos = ["A", "B", "C", "Abstención"];
  // A retiene 70% y pierde 20% con C; B retiene 60%; la abstención se activa a medias
  const verdadera = [
    [0.7, 0.05, 0.2, 0.05],
    [0.1, 0.6, 0.15, 0.15],
    [0.15, 0.1, 0.25, 0.5],
  ];
  // padrones variados: la variación entre territorios es lo que identifica la matriz
  const padrones = [
    [4000, 3000, 2000], [2500, 4500, 1800], [5200, 1500, 3100], [1800, 2200, 900],
    [3300, 3300, 3300], [6000, 800, 1200], [900, 5500, 2600], [4400, 2600, 1500],
    [2100, 1900, 4800], [3800, 4100, 700], [1200, 3400, 2900], [5600, 2200, 2400],
  ];
  const unidades = generar(verdadera, padrones, { origenes, destinos });

  const r = estimarTransferencia(origenes, destinos, unidades);

  for (let i = 0; i < verdadera.length; i++) {
    for (let j = 0; j < verdadera[i].length; j++) {
      assert.ok(
        Math.abs(r.matriz[i][j] - verdadera[i][j]) < 0.02,
        `p[${origenes[i]}→${destinos[j]}] estimado ${r.matriz[i][j].toFixed(3)} vs real ${verdadera[i][j]}`,
      );
    }
  }
  // datos sin ruido: el ajuste tiene que ser casi perfecto
  for (const { destino, r2 } of r.r2PorDestino) {
    assert.ok(r2 > 0.99, `R² de ${destino} fue ${r2.toFixed(3)}`);
  }
});

test("cada fila suma 1: todo votante termina en algún destino", () => {
  const origenes = ["X", "Y"];
  const destinos = ["X", "Y", "Blanco"];
  const unidades = generar(
    [
      [0.8, 0.15, 0.05],
      [0.2, 0.7, 0.1],
    ],
    [[1000, 900], [1500, 400], [700, 1300], [2000, 1100], [600, 600]],
    { origenes, destinos },
  );
  const r = estimarTransferencia(origenes, destinos, unidades);
  for (const fila of r.matriz) {
    const suma = fila.reduce((a, x) => a + x, 0);
    assert.ok(Math.abs(suma - 1) < 1e-6, `la fila suma ${suma}`);
  }
});

test("no devuelve proporciones negativas", () => {
  const origenes = ["P", "Q", "R"];
  const destinos = ["P", "Q"];
  // caso hostil: un destino desaparece casi por completo
  const unidades = generar(
    [
      [0.98, 0.02],
      [0.01, 0.99],
      [0.5, 0.5],
    ],
    [[3000, 100, 800], [200, 2900, 600], [1500, 1500, 1500], [4000, 300, 200], [100, 4000, 900]],
    { origenes, destinos },
  );
  const r = estimarTransferencia(origenes, destinos, unidades);
  for (const fila of r.matriz) for (const p of fila) assert.ok(p >= 0, `proporción negativa: ${p}`);
});

test("tolera padrones distintos entre las dos elecciones", () => {
  const origenes = ["A", "Abstención"];
  const destinos = ["A", "B", "Abstención"];
  const verdadera = [
    [0.75, 0.15, 0.1],
    [0.2, 0.3, 0.5],
  ];
  const padrones = [[3000, 2000], [4500, 1200], [1800, 3400], [2600, 2600], [5000, 900], [1100, 4200]];
  // el padrón de destino crece un 6%: el estimador lo reescala, no se rompe
  const unidades = generar(verdadera, padrones, { origenes, destinos }).map((u) => ({
    ...u,
    destino: u.destino.map((x) => x * 1.06),
  }));
  const r = estimarTransferencia(origenes, destinos, unidades);
  for (let i = 0; i < verdadera.length; i++) {
    for (let j = 0; j < verdadera[i].length; j++) {
      assert.ok(
        Math.abs(r.matriz[i][j] - verdadera[i][j]) < 0.02,
        `p[${i}][${j}] = ${r.matriz[i][j].toFixed(3)} vs ${verdadera[i][j]}`,
      );
    }
  }
});

test("se niega a estimar más orígenes que territorios disponibles", () => {
  const origenes = ["a", "b", "c", "d", "e"];
  const destinos = ["x", "y"];
  const unidades: UnidadTransferencia[] = [
    { unidad: "1", origen: [1, 1, 1, 1, 1], destino: [3, 2] },
    { unidad: "2", origen: [2, 1, 1, 1, 1], destino: [4, 2] },
  ];
  assert.throws(() => estimarTransferencia(origenes, destinos, unidades), /agrupá los orígenes/);
});

test("aguanta ruido razonable sin desarmarse", () => {
  const origenes = ["Oficialismo", "Oposición", "Abstención"];
  const destinos = ["Oficialismo", "Oposición", "Tercero", "Abstención"];
  const verdadera = [
    [0.65, 0.1, 0.15, 0.1],
    [0.08, 0.62, 0.2, 0.1],
    [0.12, 0.13, 0.2, 0.55],
  ];
  const padrones = Array.from({ length: 40 }, (_, k) => [
    2000 + ((k * 137) % 4000),
    1500 + ((k * 271) % 3500),
    1000 + ((k * 313) % 2500),
  ]);
  const limpias = generar(verdadera, padrones, { origenes, destinos });
  // ±2% de ruido determinístico sobre cada celda de destino
  const conRuido = limpias.map((u, c) => ({
    ...u,
    destino: u.destino.map((x, j) => x * (1 + 0.02 * Math.sin(c * 3 + j * 7))),
  }));

  const r = estimarTransferencia(origenes, destinos, conRuido);
  let maxDif = 0;
  for (let i = 0; i < verdadera.length; i++) {
    for (let j = 0; j < verdadera[i].length; j++) {
      maxDif = Math.max(maxDif, Math.abs(r.matriz[i][j] - verdadera[i][j]));
    }
  }
  assert.ok(maxDif < 0.06, `con ruido la desviación máxima fue ${maxDif.toFixed(3)}`);
});

test("la lectura en prosa nombra la retención y las fugas relevantes", () => {
  const origenes = ["Lista A", "Lista B"];
  const destinos = ["Lista A", "Lista B", "Abstención"];
  const unidades = generar(
    [
      [0.5, 0.4, 0.1],
      [0.05, 0.85, 0.1],
    ],
    [[4000, 1000], [1200, 3800], [2500, 2500], [5000, 600], [800, 4400]],
    { origenes, destinos },
  );
  const frases = leerTransferencia(estimarTransferencia(origenes, destinos, unidades));
  assert.ok(frases.length > 0, "no devolvió ninguna frase");
  assert.ok(
    frases.some((f) => f.includes("Lista A") && f.includes("Lista B")),
    `no mencionó la fuga de A hacia B: ${JSON.stringify(frases)}`,
  );
});

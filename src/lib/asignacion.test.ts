import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  asignarPresupuesto,
  type Fuente,
  type Necesidad,
  type PoliticaEntrada,
  type ResultadoAsignacion,
} from "./asignacion.ts";

// ── utilidades ──────────────────────────────────────────────────────────────
/** PRNG determinista (mulberry32): los casos al azar son siempre los mismos. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const monto = (r: ResultadoAsignacion, politica: string, destino: string) =>
  r.asignaciones.find((a) => a.politica === politica && a.destino === destino)?.monto ?? 0;

/** Chequeos que tienen que valer SIEMPRE, para cualquier entrada. */
function invariantes(r: ResultadoAsignacion, fuentes: Fuente[], politicas: PoliticaEntrada[]) {
  const disp = new Map(fuentes.map((f) => [f.id, f.disponible]));
  const pol = new Map(politicas.map((p) => [p.id, p]));
  for (const f of r.porFuente) {
    assert.ok(f.usado <= f.disponible + 1e-2, `la fuente ${f.fuente} gastó ${f.usado} de ${f.disponible}`);
  }
  for (const fin of r.financiamiento) {
    assert.ok(pol.get(fin.politica)!.fuentes.includes(fin.fuente), `${fin.fuente} financia ${fin.politica} sin poder`);
    assert.ok(fin.monto > 0);
  }
  for (const p of r.porPolitica) {
    const financiado = r.financiamiento.filter((f) => f.politica === p.politica).reduce((a, f) => a + f.monto, 0);
    assert.ok(Math.abs(financiado - p.monto) < 1e-2, `${p.politica}: financiado ${financiado} ≠ asignado ${p.monto}`);
    const tope = pol.get(p.politica)!.tope;
    if (tope != null) assert.ok(p.monto <= tope + 1e-2, `${p.politica} pasó su tope`);
  }
  for (const a of r.asignaciones) {
    assert.ok(Number.isInteger(a.unidades), `unidades no enteras: ${a.unidades}`);
    const c = pol.get(a.politica)!.costoUnitario;
    assert.ok(Math.abs(a.monto - a.unidades * c) < 1e-6);
    assert.ok(a.cobertura <= 1 + 1e-9);
  }
  const usado = r.porFuente.reduce((a, f) => a + f.usado, 0);
  assert.ok(Math.abs(usado - r.asignado) < 1e-2, `usado ${usado} ≠ asignado ${r.asignado}`);
  const total = [...disp.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(r.asignado + r.sinAsignar - total) < 1e-2);
}

/** Valor objetivo, reimplementado acá para no depender del motor. */
function valorCelda(prioridad: number, peso: number, N: number, u: number, kappa: number) {
  if (N <= 0) return 0;
  const s = Math.min(1, u / N);
  return prioridad * peso * N * (1 - Math.pow(1 - s, 1 + kappa));
}

/**
 * Óptimo por fuerza bruta: prueba TODAS las combinaciones de unidades por
 * celda y se queda con la mejor que las partidas pueden financiar. La
 * factibilidad se chequea con la condición de Hall (para cada subconjunto de
 * políticas, lo que piden no supera lo que tienen sus partidas), que es
 * independiente del flujo que usa el motor.
 */
function optimoFuerzaBruta(
  fuentes: Fuente[],
  politicas: PoliticaEntrada[],
  necesidades: Necesidad[],
  kappa: number,
) {
  const P = politicas.length;
  const factible = (gasto: number[]) => {
    for (let S = 1; S < 1 << P; S++) {
      let pide = 0;
      const vecinas = new Set<string>();
      for (let p = 0; p < P; p++) {
        if (!(S & (1 << p))) continue;
        pide += gasto[p];
        for (const f of politicas[p].fuentes) vecinas.add(f);
      }
      const tiene = fuentes.filter((f) => vecinas.has(f.id)).reduce((a, f) => a + f.disponible, 0);
      if (pide > tiene + 1e-9) return false;
    }
    return politicas.every((p, i) => p.tope == null || gasto[i] <= p.tope + 1e-9);
  };
  let mejor = 0;
  const u = necesidades.map(() => 0);
  const recorrer = (i: number) => {
    if (i === necesidades.length) {
      const gasto = politicas.map((p) =>
        necesidades.reduce((a, n, j) => (n.politica === p.id ? a + u[j] * p.costoUnitario : a), 0),
      );
      if (!factible(gasto)) return;
      const v = necesidades.reduce((a, n, j) => {
        const p = politicas.find((x) => x.id === n.politica)!;
        return a + valorCelda(p.prioridad ?? 1, n.peso ?? 1, n.unidades, u[j], kappa);
      }, 0);
      if (v > mejor) mejor = v;
      return;
    }
    for (let x = 0; x <= necesidades[i].unidades; x++) {
      u[i] = x;
      recorrer(i + 1);
    }
    u[i] = 0;
  };
  recorrer(0);
  return mejor;
}

function instanciaAlAzar(r: () => number, costosIguales: boolean) {
  const nF = 1 + Math.floor(r() * 3);
  const nP = 1 + Math.floor(r() * 3);
  const fuentes: Fuente[] = Array.from({ length: nF }, (_, k) => ({
    id: `F${k}`,
    disponible: Math.floor(r() * 9),
  }));
  const politicas: PoliticaEntrada[] = Array.from({ length: nP }, (_, p) => {
    const fs = fuentes.filter(() => r() < 0.6).map((f) => f.id);
    return {
      id: `P${p}`,
      costoUnitario: costosIguales ? 1 : 1 + Math.floor(r() * 3),
      fuentes: fs.length ? fs : [fuentes[Math.floor(r() * nF)].id],
      prioridad: 0.5 + r() * 2,
      tope: r() < 0.25 ? Math.floor(r() * 6) : undefined,
    };
  });
  const necesidades: Necesidad[] = [];
  for (const p of politicas) {
    const nD = 1 + Math.floor(r() * 2);
    for (let d = 0; d < nD; d++) {
      necesidades.push({ politica: p.id, destino: `B${d}`, unidades: Math.floor(r() * 4), peso: 0.3 + r() * 2 });
    }
  }
  return { fuentes, politicas, necesidades };
}

// ── casos ───────────────────────────────────────────────────────────────────

test("cubre primero el barrio de mayor peso y respeta el disponible", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 70 }];
  const politicas: PoliticaEntrada[] = [{ id: "cloaca", costoUnitario: 10, fuentes: ["F"] }];
  const necesidades: Necesidad[] = [
    { politica: "cloaca", destino: "X", unidades: 5, peso: 2 },
    { politica: "cloaca", destino: "Y", unidades: 5, peso: 1 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { pasos: 1000 });
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "cloaca", "X"), 50);
  assert.equal(monto(r, "cloaca", "Y"), 20);
  assert.equal(r.sinAsignar, 0);
});

test("reasigna el financiamiento en vez de dejar sin fondos a una política", () => {
  // A puede pagar las dos; B solo la beca. Si la beca se come A primero, la
  // obra (más prioritaria) se quedaría sin nada: el motor tiene que mover la
  // beca a B y darle A a la obra.
  const fuentes: Fuente[] = [
    { id: "A", disponible: 100 },
    { id: "B", disponible: 100 },
  ];
  const politicas: PoliticaEntrada[] = [
    { id: "beca", costoUnitario: 1, fuentes: ["A", "B"], prioridad: 3 },
    { id: "obra", costoUnitario: 1, fuentes: ["A"], prioridad: 1 },
  ];
  const necesidades: Necesidad[] = [
    { politica: "beca", destino: "X", unidades: 100 },
    { politica: "obra", destino: "X", unidades: 100 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { pasos: 200 });
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "beca", "X"), 100);
  assert.equal(monto(r, "obra", "X"), 100);
  const obraDesdeA = r.financiamiento.find((f) => f.politica === "obra" && f.fuente === "A")?.monto;
  assert.equal(obraDesdeA, 100);
});

test("con costos iguales coincide con el óptimo por fuerza bruta", () => {
  const r = azar(20260925);
  for (let caso = 0; caso < 250; caso++) {
    const { fuentes, politicas, necesidades } = instanciaAlAzar(r, true);
    const kappa = [0, 0.7, 2][caso % 3];
    const res = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: kappa, pasos: 1e6 });
    invariantes(res, fuentes, politicas);
    const optimo = optimoFuerzaBruta(fuentes, politicas, necesidades, kappa);
    assert.ok(
      Math.abs(res.impacto - optimo) < 1e-9 * Math.max(1, optimo),
      `caso ${caso}: el motor dio ${res.impacto} y el óptimo es ${optimo}\n${JSON.stringify({ fuentes, politicas, necesidades })}`,
    );
  }
});

test("con costos distintos pierde a lo sumo una unidad por política", () => {
  // Con unidades enteras y costos distintos el problema es de mochila: el
  // óptimo exacto no es polinomial. La cota que se garantiza es no perder más
  // que el valor de una unidad por política.
  const r = azar(7);
  for (let caso = 0; caso < 250; caso++) {
    const { fuentes, politicas, necesidades } = instanciaAlAzar(r, false);
    const kappa = [0, 1][caso % 2];
    const res = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: kappa, pasos: 1e6 });
    invariantes(res, fuentes, politicas);
    const optimo = optimoFuerzaBruta(fuentes, politicas, necesidades, kappa);
    const cota = politicas.reduce((a, p) => {
      const mejorUnidad = Math.max(
        0,
        ...necesidades
          .filter((n) => n.politica === p.id)
          .map((n) => valorCelda(p.prioridad ?? 1, n.peso ?? 1, n.unidades, 1, kappa)),
      );
      return a + mejorUnidad;
    }, 0);
    assert.ok(res.impacto <= optimo + 1e-9, `caso ${caso}: el motor superó al óptimo (bug de factibilidad)`);
    assert.ok(res.impacto >= optimo - cota - 1e-9, `caso ${caso}: ${res.impacto} vs óptimo ${optimo} (cota ${cota})`);
  }
});

test("el piso de una política se cubre aunque tenga menos prioridad", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 100 }];
  const politicas: PoliticaEntrada[] = [
    { id: "alumbrado", costoUnitario: 1, fuentes: ["F"], prioridad: 5 },
    { id: "becas", costoUnitario: 1, fuentes: ["F"], prioridad: 1, piso: 30 },
  ];
  const necesidades: Necesidad[] = [
    { politica: "alumbrado", destino: "X", unidades: 1000 },
    { politica: "becas", destino: "X", unidades: 1000 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { pasos: 100 });
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "becas", "X"), 30);
  assert.equal(monto(r, "alumbrado", "X"), 70);
  assert.equal(r.avisos.length, 0);
});

test("avisa cuando un piso no se puede cubrir", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 10 }];
  const politicas: PoliticaEntrada[] = [{ id: "becas", costoUnitario: 1, fuentes: ["F"], piso: 50 }];
  const r = asignarPresupuesto(fuentes, politicas, [{ politica: "becas", destino: "X", unidades: 100 }], {
    pasos: 100,
  });
  invariantes(r, fuentes, politicas);
  assert.equal(r.porPolitica[0].monto, 10);
  assert.ok(r.avisos.some((a) => a.includes("piso")));
});

test("respeta los montos fijados a mano y el tope", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 100 }];
  const politicas: PoliticaEntrada[] = [{ id: "plazas", costoUnitario: 5, fuentes: ["F"], tope: 60 }];
  const necesidades: Necesidad[] = [
    { politica: "plazas", destino: "X", unidades: 20, peso: 5 },
    { politica: "plazas", destino: "Y", unidades: 20, peso: 1, fijo: 25 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { pasos: 100 });
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "plazas", "Y"), 25); // fijado: no se toca aunque pese menos
  assert.equal(monto(r, "plazas", "X"), 35); // el resto hasta el tope va al de más peso
  assert.equal(r.porPolitica[0].saturada, "tope");
});

test("un monto fijado es exactamente ese monto, aunque el barrio rinda más", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 100 }];
  const politicas: PoliticaEntrada[] = [{ id: "plazas", costoUnitario: 5, fuentes: ["F"] }];
  const necesidades: Necesidad[] = [
    { politica: "plazas", destino: "X", unidades: 20, peso: 5, fijo: 10 }, // rinde mucho, pero se fijó en 10
    { politica: "plazas", destino: "Y", unidades: 20, peso: 1 },
    { politica: "plazas", destino: "Z", unidades: 20, peso: 9, fijo: 0 }, // fijado en cero: no recibe nada
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { pasos: 100 });
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "plazas", "X"), 10);
  assert.equal(monto(r, "plazas", "Z"), 0);
  assert.equal(monto(r, "plazas", "Y"), 90);
});

test("con equidad el presupuesto se reparte entre barrios", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 100 }];
  const politicas: PoliticaEntrada[] = [{ id: "salud", costoUnitario: 1, fuentes: ["F"] }];
  const necesidades: Necesidad[] = [
    { politica: "salud", destino: "X", unidades: 200, peso: 1.5 },
    { politica: "salud", destino: "Y", unidades: 200, peso: 1 },
  ];
  const lineal = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 0, pasos: 1000 });
  const repartido = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 3, pasos: 1000 });
  assert.equal(monto(lineal, "salud", "Y"), 0);
  assert.ok(monto(repartido, "salud", "Y") > 0, "con equidad Y tiene que recibir algo");
  assert.ok(monto(repartido, "salud", "X") > monto(repartido, "salud", "Y"), "pero X sigue recibiendo más");
});

test("una política sin partidas compatibles queda afuera con aviso", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 100 }];
  const politicas: PoliticaEntrada[] = [{ id: "huerfana", costoUnitario: 1, fuentes: ["NO-EXISTE"] }];
  const r = asignarPresupuesto(fuentes, politicas, [{ politica: "huerfana", destino: "X", unidades: 10 }]);
  assert.equal(r.asignado, 0);
  assert.ok(r.avisos.some((a) => a.includes("ninguna partida")));
});

test("resuelve una ciudad entera en menos de dos segundos", () => {
  const r = azar(99);
  const fuentes: Fuente[] = Array.from({ length: 80 }, (_, k) => ({
    id: `F${k}`,
    disponible: 1e8 + Math.floor(r() * 9e8),
  }));
  const politicas: PoliticaEntrada[] = Array.from({ length: 40 }, (_, p) => ({
    id: `P${p}`,
    costoUnitario: 50_000 + Math.floor(r() * 2_000_000),
    fuentes: fuentes.filter(() => r() < 0.15).map((f) => f.id),
    prioridad: 1 + r() * 4,
  }));
  const necesidades: Necesidad[] = [];
  for (const p of politicas) {
    for (let b = 0; b < 330; b++) {
      necesidades.push({ politica: p.id, destino: `barrio-${b}`, unidades: Math.floor(r() * 400), peso: 0.5 + r() * 2 });
    }
  }
  const t0 = performance.now();
  const res = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 1 });
  const ms = performance.now() - t0;
  invariantes(res, fuentes, politicas);
  assert.ok(ms < 2000, `tardó ${Math.round(ms)} ms`);
  assert.ok(res.asignado > 0);
});

// ── Regresiones de la revisión adversarial ─────────────────────────────────

test("la equidad actúa aunque la política tenga poca plata frente al total", () => {
  // Antes el paso salía del disponible TOTAL: con $1.000.000.000 de otra
  // política, la chica cubría un barrio entero en un paso y el otro nada.
  const fuentes: Fuente[] = [
    { id: "grande", disponible: 1e9 },
    { id: "chica", disponible: 1000 },
  ];
  const politicas: PoliticaEntrada[] = [
    { id: "obra", costoUnitario: 1000, fuentes: ["grande"] },
    { id: "becas", costoUnitario: 1, fuentes: ["chica"] },
  ];
  const necesidades: Necesidad[] = [
    { politica: "obra", destino: "X", unidades: 1e6 },
    { politica: "becas", destino: "X", unidades: 1000 },
    { politica: "becas", destino: "Y", unidades: 1000 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 3 });
  invariantes(r, fuentes, politicas);
  const x = monto(r, "becas", "X");
  const y = monto(r, "becas", "Y");
  assert.ok(Math.abs(x - y) <= 20, `con barrios iguales la equidad reparte parejo: X ${x}, Y ${y}`);
});

test("los pisos que compiten se cubren en el orden de prioridad del planificador", () => {
  // P1 vale más por peso (prioridad 5 sobre costo 1) que P2 (10 sobre costo
  // 10): se cubre primero P1, y los dos pisos entran.
  const fuentes: Fuente[] = [{ id: "F", disponible: 30 }];
  const politicas: PoliticaEntrada[] = [
    { id: "P1", costoUnitario: 1, fuentes: ["F"], prioridad: 5, piso: 20 },
    { id: "P2", costoUnitario: 10, fuentes: ["F"], prioridad: 10, piso: 10 },
  ];
  const necesidades: Necesidad[] = [
    { politica: "P1", destino: "X", unidades: 1000 },
    { politica: "P2", destino: "X", unidades: 1000 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades);
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "P1", "X"), 20);
  assert.equal(monto(r, "P2", "X"), 10);
  assert.equal(r.avisos.length, 0, r.avisos.join(" | "));
});

test("una política con prioridad cero igual recibe su piso", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 100 }];
  const politicas: PoliticaEntrada[] = [{ id: "minimo", costoUnitario: 1, fuentes: ["F"], prioridad: 0, piso: 30 }];
  const r = asignarPresupuesto(fuentes, politicas, [{ politica: "minimo", destino: "X", unidades: 100 }]);
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "minimo", "X"), 30);
});

test("un monto fijado respeta el tope y avisa cuando se recorta", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 1000 }];
  const politicas: PoliticaEntrada[] = [{ id: "plazas", nombre: "Plazas", costoUnitario: 10, fuentes: ["F"], tope: 50 }];
  const r = asignarPresupuesto(fuentes, politicas, [{ politica: "plazas", destino: "X", unidades: 100, fijo: 200 }]);
  invariantes(r, fuentes, politicas);
  assert.equal(monto(r, "plazas", "X"), 50);
  assert.ok(r.avisos.some((a) => a.includes("Plazas") && a.includes("tope")), r.avisos.join(" | "));
  assert.equal(r.fijados[0].efectivo, 50);
  assert.equal(r.fijados[0].motivo, "supera el tope de la política");
});

test("con equidad muy alta no quedan fondos sin usar por cancelación numérica", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 900 }];
  const politicas: PoliticaEntrada[] = [{ id: "salud", costoUnitario: 1, fuentes: ["F"] }];
  const necesidades: Necesidad[] = [
    { politica: "salud", destino: "X", unidades: 1000 },
    { politica: "salud", destino: "Y", unidades: 1000 },
  ];
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 50 });
  invariantes(r, fuentes, politicas);
  assert.equal(r.asignado, 900);
});

test("la equidad actúa en una ciudad real: muchas políticas comparten partida y hay más barrios que pasos mínimos", () => {
  // Segunda revisión: 40 políticas sobre una sola partida y 330 barrios. Con el
  // paso grueso, 36 de 40 políticas recibían $0 y se perdía el 77% del impacto.
  const fuentes: Fuente[] = [{ id: "F", disponible: 1e9 }];
  const politicas: PoliticaEntrada[] = Array.from({ length: 40 }, (_, p) => ({ id: `P${p}`, costoUnitario: 1000, fuentes: ["F"] }));
  const necesidades: Necesidad[] = [];
  for (const p of politicas) for (let b = 0; b < 330; b++) necesidades.push({ politica: p.id, destino: `b${b}`, unidades: 1000 });
  const t0 = performance.now();
  const r = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 4 });
  const ms = performance.now() - t0;
  invariantes(r, fuentes, politicas);
  const conPlata = r.porPolitica.filter((p) => p.monto > 0).length;
  assert.ok(conPlata >= 38, `solo ${conPlata} de 40 políticas recibieron plata`);
  const fino = asignarPresupuesto(fuentes, politicas, necesidades, { equidad: 4, pasos: 400000 });
  assert.ok(r.impacto >= 0.97 * fino.impacto, `impacto ${r.impacto} vs ${fino.impacto} con pasos finos`);
  assert.ok(ms < 2000, `tardó ${Math.round(ms)} ms`);
});

test("una política cuya única necesidad pendiente está fijada figura como cubierta, no como que rinde menos", () => {
  const fuentes: Fuente[] = [{ id: "F", disponible: 1000 }];
  const politicas: PoliticaEntrada[] = [{ id: "plazas", costoUnitario: 1, fuentes: ["F"] }];
  const r = asignarPresupuesto(fuentes, politicas, [
    { politica: "plazas", destino: "X", unidades: 10 },
    { politica: "plazas", destino: "Y", unidades: 10, fijo: 5 },
  ]);
  assert.equal(r.porPolitica[0].saturada, "necesidad");
});

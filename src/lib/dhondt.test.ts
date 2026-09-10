import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agruparPorEspacio,
  bancasConVotos,
  curvaDeBancas,
  repartirConFusion,
  repartirDHondt,
  type ListaVotos,
} from "./dhondt.ts";

/** Ejemplo canónico de D'Hondt: 8 bancas → A 4, B 3, C 1, D 0. */
test("reparto canónico de 8 bancas", () => {
  const listas: ListaVotos[] = [
    { id: "A", nombre: "A", votos: 100_000 },
    { id: "B", nombre: "B", votos: 80_000 },
    { id: "C", nombre: "C", votos: 30_000 },
    { id: "D", nombre: "D", votos: 20_000 },
  ];
  const r = repartirDHondt(listas, { bancas: 8 });
  const bancas = Object.fromEntries(r.porLista.map((l) => [l.id, l.bancas]));
  assert.deepEqual(bancas, { A: 4, B: 3, C: 1, D: 0 });
  assert.equal(r.secuencia.length, 8);
  assert.equal(r.secuencia[0].nombre, "A");
  // la última banca la ganó A con 100.000/4 = 25.000
  assert.equal(r.cocienteUltimaBanca, 25_000);
  assert.equal(r.votosParaEntrar, 25_001);
});

test("suma de bancas repartidas = bancas en juego", () => {
  const listas: ListaVotos[] = [
    { id: 1, nombre: "uno", votos: 12_345 },
    { id: 2, nombre: "dos", votos: 9_876 },
    { id: 3, nombre: "tres", votos: 4_321 },
    { id: 4, nombre: "cuatro", votos: 777 },
  ];
  for (const bancas of [1, 3, 5, 9, 18]) {
    const r = repartirDHondt(listas, { bancas });
    assert.equal(r.porLista.reduce((a, l) => a + l.bancas, 0), bancas, `con ${bancas} bancas`);
  }
});

test("empate de votos reparte una banca a cada uno", () => {
  const r = repartirDHondt(
    [
      { id: "X", nombre: "X", votos: 100 },
      { id: "Y", nombre: "Y", votos: 100 },
    ],
    { bancas: 2 },
  );
  assert.deepEqual(
    Object.fromEntries(r.porLista.map((l) => [l.id, l.bancas])),
    { X: 1, Y: 1 },
  );
});

/**
 * El punto estratégico de la fragmentación: dos listas de 25 no sacan nada
 * por separado (el grande se lleva las 2 bancas), pero unidas entran.
 */
test("fusionar listas fragmentadas convierte 0 bancas en 1", () => {
  const listas: ListaVotos[] = [
    { id: "grande", nombre: "grande", votos: 51 },
    { id: "chica1", nombre: "chica 1", votos: 25 },
    { id: "chica2", nombre: "chica 2", votos: 25 },
  ];
  const separadas = repartirDHondt(listas, { bancas: 2 });
  assert.equal(separadas.porLista.find((l) => l.id === "grande")?.bancas, 2);
  assert.equal(separadas.porLista.find((l) => l.id === "chica1")?.bancas, 0);
  assert.equal(separadas.porLista.find((l) => l.id === "chica2")?.bancas, 0);

  const unidas = repartirConFusion(listas, ["chica1", "chica2"], "frente unido", { bancas: 2 });
  assert.equal(unidas.porLista.find((l) => l.nombre === "frente unido")?.bancas, 1);
  assert.equal(unidas.porLista.find((l) => l.id === "grande")?.bancas, 1);
});

test("el umbral legal excluye a las listas por debajo", () => {
  const listas: ListaVotos[] = [
    { id: "A", nombre: "A", votos: 900 },
    { id: "B", nombre: "B", votos: 80 },
    { id: "C", nombre: "C", votos: 20 }, // 2% de 1000 → queda afuera con piso 3%
  ];
  const r = repartirDHondt(listas, { bancas: 3, pisoPct: 3, basePiso: "validos" });
  assert.equal(r.piso?.votos, 30);
  assert.equal(r.piso?.excluidas, 1);
  assert.equal(r.porLista.find((l) => l.id === "C")?.excluidaPorPiso, true);
  assert.equal(r.porLista.find((l) => l.id === "C")?.bancas, 0);
  assert.equal(r.porLista.reduce((a, l) => a + l.bancas, 0), 3);
});

test("piso sobre el padrón usa el padrón como base", () => {
  const r = repartirDHondt(
    [
      { id: "A", nombre: "A", votos: 600 },
      { id: "B", nombre: "B", votos: 400 },
    ],
    { bancas: 2, pisoPct: 50, basePiso: "padron", padron: 1000 },
  );
  assert.equal(r.piso?.votos, 500); // 50% de 1000
  assert.equal(r.porLista.find((l) => l.id === "B")?.excluidaPorPiso, true);
});

test("bancasConVotos es monótona y coincide con el reparto", () => {
  const listas: ListaVotos[] = [
    { id: "A", nombre: "A", votos: 50_000 },
    { id: "B", nombre: "B", votos: 30_000 },
    { id: "mia", nombre: "mía", votos: 5_000 },
  ];
  const opciones = { bancas: 9 };
  let previa = -1;
  for (const votos of [0, 5_000, 10_000, 20_000, 40_000, 90_000]) {
    const b = bancasConVotos(listas, "mia", votos, opciones);
    assert.ok(b >= previa, `con ${votos} votos dio ${b}, antes ${previa}`);
    previa = b;
  }
  // coherencia con el reparto directo
  const r = repartirDHondt(listas, opciones);
  assert.equal(bancasConVotos(listas, "mia", 5_000, opciones), r.porLista.find((l) => l.id === "mia")?.bancas);
});

test("curvaDeBancas devuelve umbrales crecientes y exactos", () => {
  const listas: ListaVotos[] = [
    { id: "A", nombre: "A", votos: 50_000 },
    { id: "B", nombre: "B", votos: 30_000 },
    { id: "mia", nombre: "mía", votos: 5_000 },
  ];
  const opciones = { bancas: 9 };
  const curva = curvaDeBancas(listas, "mia", opciones, 3);
  assert.ok(curva.length >= 1);
  for (let i = 1; i < curva.length; i++) {
    assert.ok(curva[i].votosNecesarios > curva[i - 1].votosNecesarios, "los umbrales deben crecer");
  }
  // el umbral es exacto: con esa cantidad alcanza, con uno menos no
  for (const punto of curva) {
    assert.ok(bancasConVotos(listas, "mia", punto.votosNecesarios, opciones) >= punto.bancas);
    assert.ok(bancasConVotos(listas, "mia", punto.votosNecesarios - 1, opciones) < punto.bancas);
  }
});

test("agruparPorEspacio suma los votos de cada espacio", () => {
  const g = agruparPorEspacio([
    { id: 1, nombre: "a1", votos: 10, espacio: "peronismo" },
    { id: 2, nombre: "a2", votos: 20, espacio: "peronismo" },
    { id: 3, nombre: "b1", votos: 25, espacio: "lla" },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].nombre, "peronismo");
  assert.equal(g[0].votos, 30);
  assert.equal(g[1].votos, 25);
});

test("cero bancas no reparte nada", () => {
  const r = repartirDHondt([{ id: "A", nombre: "A", votos: 100 }], { bancas: 0 });
  assert.equal(r.porLista.reduce((a, l) => a + l.bancas, 0), 0);
  assert.equal(r.secuencia.length, 0);
  assert.equal(r.votosParaEntrar, 0);
});

test("listas con cero votos no reciben bancas", () => {
  const r = repartirDHondt(
    [
      { id: "A", nombre: "A", votos: 100 },
      { id: "Z", nombre: "Z", votos: 0 },
    ],
    { bancas: 3 },
  );
  assert.equal(r.porLista.find((l) => l.id === "Z")?.bancas, 0);
  assert.equal(r.porLista.find((l) => l.id === "A")?.bancas, 3);
});

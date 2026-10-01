import { strict as assert } from "node:assert";
import { test } from "node:test";
import { asignarPresupuesto } from "./asignacion.ts";
import {
  armarEntradas,
  inferirClase,
  leerPartidas,
  libreAsignable,
  normalizarAfectacion,
  normalizarPP,
  parsearImporte,
  partidaCompatible,
  pct,
  plural,
  type BarrioNecesidad,
  type Partida,
  type Politica,
} from "./presupuesto.ts";

test("lee importes escritos a la argentina y a la inglesa", () => {
  assert.equal(parsearImporte("$ 349.768.983.000"), 349_768_983_000);
  assert.equal(parsearImporte("266.821.140.000"), 266_821_140_000);
  assert.equal(parsearImporte("1.234.567,89"), 1_234_567.89);
  assert.equal(parsearImporte("1,234,567.89"), 1_234_567.89);
  assert.equal(parsearImporte("1234,5"), 1234.5);
  assert.equal(parsearImporte("1234.5"), 1234.5);
  assert.equal(parsearImporte("1.234"), 1234, "un punto que agrupa de a tres es de miles");
  assert.equal(parsearImporte("(12.500)"), -12_500);
  assert.equal(parsearImporte("-3.000,50"), -3000.5);
  assert.equal(parsearImporte(" $ 1 234 567 "), 1_234_567);
  assert.equal(parsearImporte(1500), 1500);
  assert.ok(Number.isNaN(parsearImporte("")));
  assert.ok(Number.isNaN(parsearImporte("Subtotal")));
  assert.ok(Number.isNaN(parsearImporte("12,5%")));
});

test("no toma como miles lo que no agrupa de a tres", () => {
  assert.equal(parsearImporte("0.500"), 0.5, "el primer grupo con cero no es de miles");
  assert.equal(parsearImporte("1234.567"), 1234.567, "cuatro dígitos antes del punto: es decimal");
  assert.ok(Number.isNaN(parsearImporte("12.34.567")), "grupos irregulares: no hay número claro");
});

test("normaliza la partida principal de la Ord. 570/80", () => {
  assert.equal(normalizarPP("52"), "52");
  assert.equal(normalizarPP("5.2"), "52");
  assert.equal(normalizarPP("052"), "52");
  assert.equal(normalizarPP("3150"), "31", "una partida parcial se lleva a su principal");
  assert.equal(normalizarPP("Trabajos Públicos"), "52");
  assert.equal(normalizarPP("PERSONAL"), "11");
  assert.equal(normalizarPP("4"), "", "un inciso nacional no es una partida principal");
  assert.equal(normalizarPP("99"), "");
});

test("lee el reporte por nombre de columna y prefiere el crédito vigente al original", () => {
  const csv =
    "﻿Código;Anexo;Ítem;Programa;Partida principal;Crédito original;Modificaciones;Crédito vigente;Devengado;Comprometido;Fuente de financiamiento\n" +
    "DE.20.52.1;Dpto. Ejecutivo;Obras Públicas;Pavimento;52;1.000.000.000;500.000.000;1.500.000.000,00;100.000.000;400.000.000,00;Rentas generales\n" +
    'DE.30.31.5;Dpto. Ejecutivo;"Desarrollo\nHumano";Becas;3150;200.000.000;0;200.000.000;10.000.000;50.000.000;11\n' +
    ";;;TOTAL;;;;Total;;;\n" +
    "DE.10.11.1;Dpto. Ejecutivo;Hacienda;Personal;11;9.000.000.000;0;9.000.000.000;0;9.000.000.000;\n";
  const r = leerPartidas(csv);
  assert.equal(r.filas.length, 3, "la celda con salto de línea no rompe la fila");
  assert.equal(r.bloqueante, false);
  assert.equal(r.columnas.credito_vigente, "Crédito vigente");
  assert.equal(r.columnas.comprometido, "Comprometido");
  const [obra, becas, personal] = r.filas;
  assert.deepEqual(
    { clase: obra.clase, pp: obra.partida_principal, vigente: obra.credito_vigente, comp: obra.comprometido, af: obra.afectacion },
    { clase: "capital", pp: "52", vigente: 1_500_000_000, comp: 400_000_000, af: "" },
  );
  assert.equal(becas.partida_principal, "31");
  assert.equal(becas.clase, "corriente");
  assert.equal(becas.jurisdiccion, "Desarrollo\nHumano");
  assert.equal(personal.partida_principal, "11");
  assert.equal(libreAsignable(r.filas.map((f, i) => ({ ...f, id: i }))), 1_250_000_000, "personal no suma al libre");
});

test("usa el crédito original solo como respaldo, y avisa", () => {
  const r = leerPartidas("codigo;partida principal;credito original;comprometido\nA;52;1000;0\n");
  assert.equal(r.filas[0].credito_vigente, 1000);
  assert.ok(r.avisos.some((a) => a.includes("original")));
});

test("rechaza códigos repetidos en vez de pisar partidas", () => {
  const r = leerPartidas("codigo;partida principal;credito vigente\n4.2.1;52;100\n4.2.1;52;200\n");
  assert.equal(r.bloqueante, true);
  assert.ok(r.errores[0].includes("repetidos"));
});

test("sin columna de código arma uno estable, no el número de fila", () => {
  const texto = (extra: string) => `anexo;item;programa;partida principal;credito vigente\n${extra}DE;Obras;Pavimento;52;100\n`;
  const a = leerPartidas(texto(""));
  const b = leerPartidas(texto("DE;Cultura;Bibliotecas;12;50\n"));
  assert.equal(a.filas[0].codigo, b.filas.find((f) => f.programa === "Pavimento")!.codigo, "una fila más arriba no cambia el código");
  assert.ok(a.avisos.some((x) => x.includes("código")));
});

test("sin columna de crédito vigente no inventa nada", () => {
  const r = leerPartidas("codigo,monto raro\n1,100\n");
  assert.equal(r.filas.length, 0);
  assert.ok(r.errores[0].includes("crédito vigente"));
});

test("infiere la clase por la sección de la partida principal", () => {
  assert.equal(inferirClase("", "52"), "capital");
  assert.equal(inferirClase("", "32"), "capital", "las transferencias de capital son de capital");
  assert.equal(inferirClase("", "31"), "corriente");
  assert.equal(inferirClase("Erogaciones de Capital", "12"), "capital");
  assert.equal(inferirClase("1", "52"), "capital", "un código suelto no pisa lo que dice la partida");
  assert.equal(normalizarAfectacion("Tesoro Municipal"), "");
  assert.equal(normalizarAfectacion("Fondo Federal Solidario"), "Fondo Federal Solidario");
});

const partida = (p: Partial<Partida>): Partida => ({
  id: 1,
  codigo: "x",
  anexo: "",
  jurisdiccion: "",
  programa: "",
  clase: "corriente",
  partida_principal: "31",
  afectacion: "",
  credito_vigente: 100,
  comprometido: 0,
  ...p,
});
const politica = (p: Partial<Politica>): Politica => ({
  id: 1,
  codigo: "",
  nombre: "p",
  tipo: "transferencia_personas",
  clase: "corriente",
  unidad: "beca",
  costo_unitario: 10,
  indicador: "poblacion_0_14",
  partidas_principales: ["31"],
  afectaciones: [],
  prioridad: 1,
  piso: null,
  tope: null,
  activa: true,
  ...p,
});

test("una partida solo paga lo que su clase, su partida principal y su afectación permiten", () => {
  const beca = politica({});
  assert.ok(partidaCompatible(partida({}), beca));
  assert.ok(!partidaCompatible(partida({ clase: "capital", partida_principal: "32" }), beca), "capital no paga corriente");
  assert.ok(!partidaCompatible(partida({ partida_principal: "12" }), beca), "bienes y servicios no paga una beca");
  for (const pp of ["11", "21", "61", "71"]) {
    assert.ok(!partidaCompatible(partida({ partida_principal: pp }), politica({ partidas_principales: [] })), `la ${pp} nunca`);
  }
  assert.ok(!partidaCompatible(partida({ partida_principal: "" }), politica({ partidas_principales: [] })), "sin partida principal, no");
  assert.ok(!partidaCompatible(partida({ afectacion: "FFS" }), beca), "un recurso afectado solo a lo suyo");
  assert.ok(partidaCompatible(partida({ afectacion: "FFS" }), politica({ afectaciones: ["FFS"] })));
});

test("arma las entradas del motor y el peso sigue a la concentración de la necesidad", () => {
  const barrios: BarrioNecesidad[] = [
    { id: "a", nombre: "A", poblacion: 1000, hogares: 300, indicadores: { sin_cloaca: 150 } }, // 50%
    { id: "b", nombre: "B", poblacion: 1000, hogares: 300, indicadores: { sin_cloaca: 30 } }, // 10%
  ];
  const partidas = [partida({ id: 7, clase: "capital", partida_principal: "52", credito_vigente: 1000, comprometido: 200 })];
  const politicas = [
    politica({ id: 3, nombre: "Cloaca", tipo: "obra", clase: "capital", partidas_principales: ["52"], indicador: "sin_cloaca", costo_unitario: 4 }),
    politica({ id: 4, nombre: "Sin costo", costo_unitario: null }),
    politica({ id: 5, nombre: "Interna", tipo: "institucional", costo_unitario: 1 }),
  ];
  const e = armarEntradas(partidas, politicas, barrios, { intensidad: 1, equidad: 0 });
  assert.deepEqual(e.fuentes, [{ id: "7", disponible: 800 }]);
  assert.equal(e.politicas.length, 1, "la institucional no entra al motor");
  assert.equal(e.excluidas[0].motivo, "no tiene costo por unidad cargado");
  const [na, nb] = e.necesidades;
  assert.equal(na.unidades, 150);
  assert.ok(na.peso! > nb.peso!, "el barrio con la necesidad más concentrada pesa más");
  // tasa ciudad 30%: A está 1,67 veces por encima, B 0,33
  assert.ok(Math.abs(na.peso! - 50 / 30) < 1e-9);

  const plano = armarEntradas(partidas, politicas, barrios, { intensidad: 0, equidad: 0 });
  assert.equal(plano.necesidades[0].peso, 1);
  assert.equal(plano.necesidades[1].peso, 1);
});

test("la política barata no se come el presupuesto por tener unidades más baratas", () => {
  // Misma prioridad y la misma necesidad en unidades, pero cubrir todo cuesta
  // $10.000 en una y $1.000 en la otra. Si el valor se midiera por unidad, la
  // barata se llevaría casi todo. Medido en pesos de necesidad, con
  // rendimientos decrecientes el óptimo iguala la COBERTURA de las dos.
  const barrios: BarrioNecesidad[] = [
    { id: "a", nombre: "A", poblacion: 1000, hogares: 1000, indicadores: { sin_cloaca: 1000, poblacion_0_14: 1000 } },
  ];
  const partidas = [partida({ id: 1, partida_principal: "31", credito_vigente: 1000 })];
  const politicas = [
    politica({ id: 1, nombre: "Cara", indicador: "sin_cloaca", costo_unitario: 10 }),
    politica({ id: 2, nombre: "Barata", indicador: "poblacion_0_14", costo_unitario: 1 }),
  ];
  const e = armarEntradas(partidas, politicas, barrios, { intensidad: 0, equidad: 1 });
  const r = asignarPresupuesto(e.fuentes, e.politicas, e.necesidades, { equidad: 1, pasos: 2000 });
  const cara = r.porPolitica.find((p) => p.politica === "1")!;
  const barata = r.porPolitica.find((p) => p.politica === "2")!;
  const coberturaCara = cara.unidades / cara.necesidad;
  const coberturaBarata = barata.unidades / barata.necesidad;
  assert.ok(Math.abs(coberturaCara - coberturaBarata) < 0.01, `cobertura ${coberturaCara} vs ${coberturaBarata}`);
  assert.ok(cara.monto > barata.monto, "la de más necesidad en pesos recibe más");

  // Contraprueba: sin la normalización (valor por unidad), la barata se lleva casi todo.
  const porUnidad = e.politicas.map((p) => ({ ...p, prioridad: 1 }));
  const r2 = asignarPresupuesto(e.fuentes, porUnidad, e.necesidades, { equidad: 1, pasos: 2000 });
  assert.ok(r2.porPolitica.find((p) => p.politica === "2")!.monto > 900);
});

// ── Regresiones de la segunda revisión ─────────────────────────────────────

test("cada nombre oficial de partida principal se reconoce como su propio código", async () => {
  const { PARTIDAS_PRINCIPALES } = await import("./presupuesto.ts");
  for (const [pp, { nombre }] of Object.entries(PARTIDAS_PRINCIPALES)) {
    if (pp === "41" || pp === "81") continue; // "crédito adicional" no se identifica solo por nombre
    assert.equal(normalizarPP(nombre), pp, `«${nombre}»`);
  }
  assert.equal(normalizarPP("Servicios no personales"), "12", "no es personal");
});

test("una fila de subtotal con importe no se carga como partida", () => {
  const r = leerPartidas("codigo;partida principal;credito vigente\nA;52;1000\nB;52;500\nSubtotal Obras;52;1500\nTOTAL GENERAL;;1500\n");
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas.reduce((a, f) => a + f.credito_vigente, 0), 1500, "el disponible no se duplica");
  assert.ok(r.avisos.some((a) => a.includes("total")));
});

test("una comilla suelta en una descripción no se traga el resto del archivo", () => {
  const r = leerPartidas('codigo;programa;partida principal;credito vigente\nA;Caño PVC 4" cloacal;52;100\nB;Veredas;52;200\nC;Plazas;52;300\n');
  assert.equal(r.filas.length, 3);
  assert.equal(r.filas[0].programa, 'Caño PVC 4" cloacal');
});

test("un comprometido negativo bloquea la carga en vez de inflar el disponible", () => {
  const r = leerPartidas("codigo;partida principal;credito vigente;comprometido\nA;52;1000;(500)\n");
  assert.equal(r.bloqueante, true);
  assert.ok(r.errores.some((e) => e.includes("negativo")));
});

test("avisa cuando no hay columna de fuente o afectación", () => {
  const r = leerPartidas("codigo;partida principal;credito vigente\nA;52;1000\n");
  assert.ok(r.avisos.some((a) => a.includes("afectación")));
  assert.equal(normalizarAfectacion("Fuente 11 - Tesoro"), "");
  assert.equal(normalizarAfectacion("F.F. 11"), "");
  assert.equal(normalizarAfectacion("Recursos propios"), "");
});

test("sin código, dos partidas parciales del mismo programa no chocan", () => {
  const r = leerPartidas("anexo;item;programa;partida principal;credito vigente\nDE;Desarrollo;Becas;3150;100\nDE;Desarrollo;Becas;3160;200\n");
  assert.equal(r.bloqueante, false, r.errores.join(" | "));
  assert.equal(new Set(r.filas.map((f) => f.codigo)).size, 2);
  assert.ok(r.filas.every((f) => f.partida_principal === "31"));
});

test("«Saldo no comprometido» no se toma como comprometido", () => {
  const r = leerPartidas("codigo;partida principal;credito vigente;saldo no comprometido\nA;52;1000;900\n");
  assert.equal(r.filas[0].comprometido, 0);
  assert.notEqual(r.columnas.comprometido, "saldo no comprometido");
});

test("encuentra el encabezado aunque el reporte traiga un título, y numera como la planilla", () => {
  const r = leerPartidas("Reporte de ejecución presupuestaria al 30/06/2026\n\ncodigo;partida principal;credito vigente\nA;52;1000\n\n\nB;52;abc\n");
  assert.equal(r.filas.length, 1);
  assert.ok(r.errores.some((e) => e.startsWith("Fila 7:")), r.errores.join(" | "));
});

test("plural: unidades de las políticas", () => {
  assert.equal(plural("hogar"), "hogares");
  assert.equal(plural("persona mayor"), "personas mayores");
  assert.equal(plural("habitante"), "habitantes");
  assert.equal(plural("conexión"), "conexiones");
  assert.equal(plural("cupo en taller"), "cupos en taller");
  assert.equal(plural("luz"), "luces");
  assert.equal(plural("hogares"), "hogares");
  assert.equal(plural("hogar", 1), "hogar");
  assert.equal(plural(""), "unidades");
  assert.equal(plural("m2"), "m2");
});

test("pct: coma decimal", () => {
  assert.equal(pct(22.44), "22,4%");
  assert.equal(pct(NaN), "0,0%");
});

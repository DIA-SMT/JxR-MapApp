import { strict as assert } from "node:assert";
import { test } from "node:test";
import { enmascarar, esRuido, normalizarError } from "./errores.ts";

test("enmascarar: documentos y correos no se guardan", () => {
  assert.equal(enmascarar("falló con DNI 30.123.456 y 7123456"), "falló con DNI [número] y [número]");
  assert.equal(enmascarar("usuario ana.perez@smt.gob.ar no existe"), "usuario [correo] no existe");
  assert.equal(enmascarar("circuito 1A, mesa 1234"), "circuito 1A, mesa 1234");
});

test("normalizarError: recorta y entiende cualquier cosa", () => {
  const e = normalizarError(new Error("x".repeat(3000)));
  assert.equal(e.mensaje.length, 1000);
  assert.equal(normalizarError("texto").mensaje, "texto");
  assert.equal(normalizarError({ code: 1 }).mensaje, '{"code":1}');
});

test("esRuido: lo que no sirve se descarta", () => {
  assert.ok(esRuido("ResizeObserver loop completed with undelivered notifications."));
  assert.ok(esRuido("Script error."));
  assert.ok(!esRuido("Cannot read properties of undefined (reading 'monto')"));
});

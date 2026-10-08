import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AREA, AREAS_POLITICA, AREAS_TERRITORIALES, cadena, ORGANIGRAMA, secretariaDe } from "./organigrama.ts";

test("organigrama: ids únicos, cada dependencia existe y no hay ciclos", () => {
  assert.equal(new Set(ORGANIGRAMA.map((x) => x.id)).size, ORGANIGRAMA.length);
  for (const x of ORGANIGRAMA) {
    if (x.depende) assert.ok(AREA.has(x.depende), `${x.id} depende de ${x.depende}, que no existe`);
    const c = cadena(x.id);
    assert.equal(c[0].tipo, "secretaria", `${x.id} no llega a una secretaría`);
    assert.ok(c.length <= 4);
  }
  assert.equal(ORGANIGRAMA.filter((x) => x.tipo === "secretaria").length, 10);
});

test("organigrama: las 63 líneas del Plan Rector tienen área y las áreas existen", () => {
  const codigos = Object.keys(AREAS_POLITICA);
  assert.equal(codigos.length, 63);
  for (const [codigo, r] of Object.entries(AREAS_POLITICA)) {
    assert.ok(AREA.has(r.lidera), `${codigo}: ${r.lidera} no existe`);
    for (const p of r.participan) assert.ok(AREA.has(p), `${codigo}: ${p} no existe`);
    assert.ok(!r.participan.includes(r.lidera), `${codigo}: lidera y participa a la vez`);
  }
  for (const t of AREAS_TERRITORIALES) assert.ok(AREA.has(t));
  assert.equal(secretariaDe("dir-salud")?.id, "sec-general");
});

"use client";

import { RotateCcw, Target } from "lucide-react";
import type { PoliticaCatalogo } from "@/lib/presupuesto-datos";
import type { Limites } from "@/lib/presupuesto";
import { pesos } from "@/lib/presupuesto";

/**
 * Asegurar o limitar lo que recibe cada política sin salir de «Repartir»:
 * «al menos» y «como máximo» en pesos. El resto lo reparte el motor con el
 * criterio elegido. Pisa el piso y el tope del catálogo solo en este reparto.
 */
export function MontosPorPolitica({
  politicas,
  montoActual,
  texto,
  onTexto,
  limites,
  invalidas,
}: {
  politicas: PoliticaCatalogo[];
  montoActual: Map<string, number>;
  texto: Record<string, string>;
  onTexto: (t: Record<string, string>) => void;
  limites: Limites;
  invalidas: Set<number>;
}) {
  const activos = Object.keys(limites).length;
  const filas = [...politicas].sort(
    (a, b) => (montoActual.get(String(b.id)) ?? 0) - (montoActual.get(String(a.id)) ?? 0),
  );
  const poner = (id: number, campo: "piso" | "tope", v: string) =>
    onTexto({ ...texto, [`${id}|${campo}`]: v.replace(/[^0-9.,]/g, "") });
  const limpiar = (id: number) => {
    const n = { ...texto };
    delete n[`${id}|piso`];
    delete n[`${id}|tope`];
    onTexto(n);
  };
  const campo = (mal: boolean, puesto: boolean) =>
    `num w-full min-w-0 rounded-md border bg-panel px-2 py-1 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50 ${
      mal ? "border-peligro/60" : puesto ? "border-rosa/50" : "border-borde-2"
    }`;

  return (
    <details className="panel-vidrio rounded-2xl p-4" open={activos > 0 || undefined}>
      <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-extrabold hover:text-rosa">
        <Target size={14} className="text-rosa" /> Asegurar o limitar montos por política
        <span className="text-[11px] font-normal text-texto-3">
          {activos > 0 ? `· ${activos} con monto decidido` : "· opcional"}
        </span>
      </summary>
      <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
        Si una política tiene que recibir sí o sí un monto (una obra ya comprometida, un programa que no puede
        cortarse), ponelo en <b>al menos</b>. Si no querés que se lleve más de cierta plata, en <b>como máximo</b>. El
        resto se reparte solo con el criterio que elegiste, y el mapa se actualiza al instante.
      </p>
      {invalidas.size > 0 && (
        <p className="mt-1.5 text-[11px] font-semibold text-peligro">
          Hay {invalidas.size === 1 ? "una política" : `${invalidas.size} políticas`} con montos que no se entienden o
          con «al menos» mayor que «como máximo» (contando el del catálogo): no se aplican hasta corregirlos.
        </p>
      )}
      {/* Celular: una tarjeta por política */}
      <div className="mt-2 max-h-[460px] space-y-1.5 overflow-auto sm:hidden">
        {filas.map((p) => {
          const piso = texto[`${p.id}|piso`] ?? "";
          const tope = texto[`${p.id}|tope`] ?? "";
          const mal = invalidas.has(p.id);
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-2 ${limites[p.id] != null ? "border-rosa/40 bg-rosa/5" : "border-borde"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[11px] font-semibold">
                  <span className="text-texto-3">{p.codigo}</span> {p.nombre}
                </span>
                <span className="num shrink-0 text-[11px] font-bold">
                  {pesos(montoActual.get(String(p.id)) ?? 0, true)}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                <input
                  value={piso}
                  onChange={(e) => poner(p.id, "piso", e.target.value)}
                  placeholder="al menos $"
                  inputMode="decimal"
                  aria-label={`Al menos, ${p.nombre}`}
                  className={campo(mal, piso !== "")}
                />
                <input
                  value={tope}
                  onChange={(e) => poner(p.id, "tope", e.target.value)}
                  placeholder="como máximo $"
                  inputMode="decimal"
                  aria-label={`Como máximo, ${p.nombre}`}
                  className={campo(mal, tope !== "")}
                />
                {(piso || tope) && (
                  <button
                    onClick={() => limpiar(p.id)}
                    title="Volver a lo que decida el criterio"
                    className="text-texto-3 hover:text-rosa"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 hidden max-h-[360px] overflow-auto sm:block">
        <table className="w-full min-w-[560px] text-[11px]">
          <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
            <tr>
              <th className="py-1.5 pr-2 font-semibold">Política</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Recibe ahora</th>
              <th className="w-32 py-1.5 pr-2 font-semibold">Al menos</th>
              <th className="w-32 py-1.5 pr-2 font-semibold">Como máximo</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const piso = texto[`${p.id}|piso`] ?? "";
              const tope = texto[`${p.id}|tope`] ?? "";
              const mal = invalidas.has(p.id);
              const decidido = limites[p.id] != null;
              return (
                <tr key={p.id} className={`border-t border-borde/60 ${decidido ? "bg-rosa/5" : ""}`}>
                  <td className="max-w-64 py-1.5 pr-2">
                    <div className="truncate font-semibold" title={p.nombre}>
                      <span className="text-texto-3">{p.codigo}</span> {p.nombre}
                    </div>
                  </td>
                  <td className="num py-1.5 pr-2 text-right font-bold">
                    {pesos(montoActual.get(String(p.id)) ?? 0, true)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={piso}
                      onChange={(e) => poner(p.id, "piso", e.target.value)}
                      placeholder={p.piso ? `catálogo: ${pesos(p.piso, true)}` : "$"}
                      inputMode="decimal"
                      aria-label={`Al menos, ${p.nombre}`}
                      className={campo(mal, piso !== "")}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={tope}
                      onChange={(e) => poner(p.id, "tope", e.target.value)}
                      placeholder={p.tope != null ? `catálogo: ${pesos(p.tope, true)}` : "$"}
                      inputMode="decimal"
                      aria-label={`Como máximo, ${p.nombre}`}
                      className={campo(mal, tope !== "")}
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    {(piso || tope) && (
                      <button
                        onClick={() => limpiar(p.id)}
                        title="Volver a lo que decida el criterio"
                        className="text-texto-3 transition hover:text-rosa"
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

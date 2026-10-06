"use client";

import { ArrowLeftRight, Download, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerDetalleEscenario, type DetalleEscenario, type Escenario } from "@/lib/presupuesto-datos";
import { descargarCSV } from "@/lib/csv";
import { pesos, resumenParametros } from "@/lib/presupuesto";
import { MapaBarrios } from "./mapa-barrios";

/** Una diferencia con su signo: +$ 12 M, −$ 3,5 M. */
export const conSigno = (n: number) =>
  Math.abs(n) < 1 ? "sin cambio" : `${n > 0 ? "+" : "−"}${pesos(Math.abs(n), true)}`;

interface Totales {
  total: number;
  porBarrio: Map<string, number>;
  porPolitica: Map<number, { nombre: string; monto: number }>;
}

function totales(d: DetalleEscenario): Totales {
  const porBarrio = new Map<string, number>();
  const porPolitica = new Map<number, { nombre: string; monto: number }>();
  let total = 0;
  for (const a of d.asignaciones) {
    total += a.monto;
    porBarrio.set(a.barrio, (porBarrio.get(a.barrio) ?? 0) + a.monto);
    const p = porPolitica.get(a.politica_id) ?? { nombre: `${a.politica_codigo} ${a.politica_nombre}`, monto: 0 };
    p.monto += a.monto;
    porPolitica.set(a.politica_id, p);
  }
  return { total, porBarrio, porPolitica };
}

/**
 * Dos propuestas lado a lado: cuánto reparte cada una, qué barrios y qué
 * políticas ganan o pierden pasando de A a B, y el mapa de esa diferencia.
 * Compara las FOTOS guardadas, no el catálogo de hoy.
 */
export function Comparar({
  supabase,
  escenarios,
  onCerrar,
}: {
  supabase: SupabaseClient;
  escenarios: Escenario[];
  onCerrar: () => void;
}) {
  // por defecto, las dos más recientes que siguen en juego
  const vigentes = escenarios.filter((e) => e.estado !== "descartado");
  const base = vigentes.length >= 2 ? vigentes : escenarios;
  const [idA, setIdA] = useState<number>(base[1]?.id ?? base[0]?.id);
  const [idB, setIdB] = useState<number>(base[0]?.id);
  const [detalles, setDetalles] = useState<Record<number, DetalleEscenario>>({});
  const [error, setError] = useState<string | null>(null);
  const [barrio, setBarrio] = useState<string | null>(null);

  const pedidos = useRef(new Set<number>());
  useEffect(() => {
    setError(null);
    for (const id of [idA, idB]) {
      if (id == null || pedidos.current.has(id)) continue;
      pedidos.current.add(id);
      void obtenerDetalleEscenario(supabase, id)
        .then((d) => setDetalles((x) => ({ ...x, [id]: d })))
        .catch((e) => {
          pedidos.current.delete(id);
          setError(e instanceof Error ? e.message : "no pude cargar la propuesta");
        });
    }
  }, [idA, idB, supabase]);

  const eA = escenarios.find((e) => e.id === idA);
  const eB = escenarios.find((e) => e.id === idB);
  const tA = useMemo(() => (detalles[idA] ? totales(detalles[idA]) : null), [detalles, idA]);
  const tB = useMemo(() => (detalles[idB] ? totales(detalles[idB]) : null), [detalles, idB]);

  const barrios = useMemo(() => {
    if (!tA || !tB) return [];
    const ids = new Set([...tA.porBarrio.keys(), ...tB.porBarrio.keys()]);
    return [...ids]
      .map((id) => {
        const a = tA.porBarrio.get(id) ?? 0;
        const b = tB.porBarrio.get(id) ?? 0;
        return { id, a, b, dif: b - a };
      })
      .sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  }, [tA, tB]);

  const politicas = useMemo(() => {
    if (!tA || !tB) return [];
    const ids = new Set([...tA.porPolitica.keys(), ...tB.porPolitica.keys()]);
    return [...ids]
      .map((id) => {
        const a = tA.porPolitica.get(id);
        const b = tB.porPolitica.get(id);
        return {
          id,
          nombre: (b ?? a)!.nombre,
          a: a?.monto ?? 0,
          b: b?.monto ?? 0,
          dif: (b?.monto ?? 0) - (a?.monto ?? 0),
        };
      })
      .sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  }, [tA, tB]);

  const valoresMapa = useMemo(() => Object.fromEntries(barrios.map((b) => [b.id, b.dif])), [barrios]);
  const ganan = barrios.filter((b) => b.dif >= 1);
  const pierden = barrios.filter((b) => b.dif <= -1);
  const mismo = idA === idB;
  const sel = barrio ? barrios.find((b) => b.id === barrio) : null;

  const exportar = () =>
    descargarCSV(
      `comparacion-${idA}-vs-${idB}.csv`,
      ["barrio", `A: ${eA?.nombre ?? idA}`, `B: ${eB?.nombre ?? idB}`, "diferencia_B_menos_A"],
      barrios.map((b) => [b.id, Math.round(b.a), Math.round(b.b), Math.round(b.dif)]),
    );

  const selector = (letra: "A" | "B", valor: number, poner: (n: number) => void) => (
    <label className="block min-w-0 flex-1">
      <span className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">Propuesta {letra}</span>
      <select
        value={valor}
        onChange={(e) => poner(Number(e.target.value))}
        className="mt-0.5 w-full rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none focus:border-rosa/50"
      >
        {escenarios.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nombre} · {e.estado} · {pesos(Number(e.resumen.asignado ?? 0), true)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="panel-vidrio space-y-3 rounded-2xl border-2 border-rosa/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold">
          <ArrowLeftRight size={14} className="text-rosa" /> Comparar dos propuestas
        </h3>
        <button onClick={onCerrar} className="text-texto-3 hover:text-texto" aria-label="Cerrar la comparación">
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {selector("A", idA, setIdA)}
        <button
          onClick={() => {
            setIdA(idB);
            setIdB(idA);
          }}
          title="Intercambiar A y B"
          className="mb-0.5 rounded-lg border border-borde-2 p-2 text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
        >
          <ArrowLeftRight size={13} />
        </button>
        {selector("B", idB, setIdB)}
      </div>

      {mismo && <p className="text-[11px] text-texto-3">Elegí dos propuestas distintas.</p>}
      {error && <p className="text-[11px] text-peligro">{error}</p>}
      {!mismo && (!tA || !tB) && !error && <p className="text-[11px] text-texto-3">Cargando las dos propuestas…</p>}

      {!mismo && tA && tB && eA && eB && (
        <>
          {/* En una frase */}
          <p className="text-[13px] leading-relaxed">
            <b>A</b> reparte <b className="num">{pesos(tA.total, true)}</b> y <b>B</b>{" "}
            <b className="num">{pesos(tB.total, true)}</b>
            {Math.abs(tB.total - tA.total) >= 1 ? (
              <>
                {" "}
                (<b className="num">{conSigno(tB.total - tA.total)}</b>)
              </>
            ) : null}
            . Pasando de A a B, <b className="num text-rosa">{ganan.length}</b> barrios reciben más y{" "}
            <b className="num text-celeste">{pierden.length}</b> reciben menos.
            {ganan.length > 0 && (
              <>
                {" "}
                El que más gana: «{ganan.sort((x, y) => y.dif - x.dif)[0].id}» ({conSigno(ganan[0].dif)}).
              </>
            )}
            {pierden.length > 0 && (
              <>
                {" "}
                El que más pierde: «{pierden.sort((x, y) => x.dif - y.dif)[0].id}» ({conSigno(pierden[0].dif)}).
              </>
            )}
          </p>

          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            {[
              ["A", eA],
              ["B", eB],
            ].map(([letra, e]) => {
              const esc = e as Escenario;
              return (
                <div key={String(letra)} className="min-w-0 rounded-xl border border-borde p-2.5">
                  <div className="truncate font-bold">
                    {String(letra)} · {esc.nombre}
                  </div>
                  <div className="text-[10px] text-texto-3">
                    {esc.estado} · {resumenParametros(esc.parametros)}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[10.5px] text-texto-2" title={esc.criterio}>
                    {esc.criterio}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Mapa de la diferencia + detalle del barrio */}
          <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_280px]">
            <div className="min-w-0 space-y-1">
              <p className="text-[10px] text-texto-3">
                Rosa: recibe más con B. Celeste: recibe menos con B. Tocá un barrio para ver la diferencia.
              </p>
              <MapaBarrios
                valores={valoresMapa}
                divergente
                formatear={conSigno}
                etiqueta="B − A"
                seleccionado={barrio}
                onSeleccionar={setBarrio}
                alto="h-[380px]"
              />
            </div>
            <div className="min-w-0 rounded-xl border border-borde p-3">
              {sel ? (
                <>
                  <div className="truncate text-sm font-extrabold">{sel.id}</div>
                  <div className="mt-1 space-y-0.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-texto-3">Con A</span>
                      <span className="num font-bold">{pesos(sel.a, true)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-texto-3">Con B</span>
                      <span className="num font-bold">{pesos(sel.b, true)}</span>
                    </div>
                    <div className="flex justify-between border-t border-borde pt-0.5">
                      <span className="text-texto-3">Diferencia</span>
                      <span
                        className={`num font-extrabold ${sel.dif > 0 ? "text-rosa" : sel.dif < 0 ? "text-celeste" : ""}`}
                      >
                        {conSigno(sel.dif)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-texto-3">
                  Tocá un barrio en el mapa para ver cuánto recibe con cada una.
                </p>
              )}
            </div>
          </div>

          {/* Por política */}
          <div>
            <div className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">Por política</div>
            <div className="mt-1 max-h-72 overflow-auto">
              <table className="w-full min-w-[520px] text-[11px]">
                <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
                  <tr>
                    <th className="py-1 pr-2 font-semibold">Política</th>
                    <th className="py-1 pr-2 text-right font-semibold">A</th>
                    <th className="py-1 pr-2 text-right font-semibold">B</th>
                    <th className="py-1 text-right font-semibold">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {politicas.map((p) => (
                    <tr key={p.id} className="border-t border-borde/60">
                      <td className="max-w-64 truncate py-1 pr-2 font-semibold" title={p.nombre}>
                        {p.nombre}
                      </td>
                      <td className="num py-1 pr-2 text-right">{pesos(p.a, true)}</td>
                      <td className="num py-1 pr-2 text-right">{pesos(p.b, true)}</td>
                      <td
                        className={`num py-1 text-right font-bold ${p.dif >= 1 ? "text-rosa" : p.dif <= -1 ? "text-celeste" : "text-texto-3"}`}
                      >
                        {conSigno(p.dif)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Por barrio */}
          <details>
            <summary className="cursor-pointer text-[11px] font-bold text-texto-2 hover:text-rosa">
              Todos los barrios ({barrios.length}), ordenados por cuánto cambian
            </summary>
            <div className="mt-1 flex justify-end">
              <button
                onClick={exportar}
                className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
              >
                <Download size={12} /> Descargar planilla
              </button>
            </div>
            <div className="mt-1 max-h-80 overflow-auto">
              <table className="w-full min-w-[420px] text-[11px]">
                <tbody>
                  {barrios.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => setBarrio(b.id)}
                      className={`cursor-pointer border-t border-borde/60 hover:bg-panel-3/50 ${barrio === b.id ? "bg-rosa/10" : ""}`}
                    >
                      <td className="py-1 pr-2 font-semibold">{b.id}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">{pesos(b.a, true)}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">{pesos(b.b, true)}</td>
                      <td
                        className={`num py-1 text-right font-bold ${b.dif >= 1 ? "text-rosa" : b.dif <= -1 ? "text-celeste" : "text-texto-3"}`}
                      >
                        {conSigno(b.dif)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

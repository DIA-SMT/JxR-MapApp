"use client";

import { ArrowRight, Info, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  estimarTransferencia2023a2025,
  obtenerCohorteJoven,
  type CohorteJoven,
} from "@/lib/analisis-politico";
import { leerTransferencia, type ResultadoTransferencia } from "@/lib/transferencia";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Cifra, Cifras } from "@/components/ui/cifras";

const numero = (n: number) => n.toLocaleString("es-AR");

/** Color de una celda de la matriz según la proporción que representa. */
function colorCelda(pct: number): string {
  if (pct >= 50) return "bg-rosa/70 text-white";
  if (pct >= 25) return "bg-rosa/40";
  if (pct >= 10) return "bg-rosa/20";
  if (pct >= 3) return "bg-rosa/10";
  return "";
}

/**
 * Matriz de transferencia de votos: a dónde se fue cada fuerza entre las dos
 * elecciones. Es la respuesta a la pregunta de la que cuelga toda la estrategia
 * del voto disperso: ¿ese voto sigue disponible o ya migró?
 */
export function Transferencia({ supabase }: { supabase: SupabaseClient }) {
  const [categoria, setCategoria] = useState("INTENDENTE");
  const [bloques, setBloques] = useState(3);
  const [r, setR] = useState<ResultadoTransferencia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCargando(true);
    setError(null);
    void estimarTransferencia2023a2025(supabase, { categoria2023: categoria, bloques })
      .then(({ resultado }) => setR(resultado))
      .catch((e) => setError(e instanceof Error ? e.message : "no pude estimar la matriz"))
      .finally(() => setCargando(false));
  }, [supabase, categoria, bloques]);

  const frases = useMemo(() => (r ? leerTransferencia(r) : []), [r]);
  const r2Bajo = useMemo(() => (r ? r.r2PorDestino.filter((x) => x.r2 < 0.8) : []), [r]);

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <ArrowRight size={15} className="text-rosa" /> ¿A dónde se fue cada voto?
        </h2>
        <p className="mt-1 text-[11px] text-texto-2">
          Estimación de cuánto de cada fuerza de 2023 terminó en cada fuerza de 2025, mirando cómo se movieron
          juntos los resultados a lo largo de los 47 circuitos.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-texto-2">
            Cargo 2023
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none"
            >
              {["INTENDENTE", "CONCEJAL", "GOBERNADOR", "LEGISLADOR"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-texto-2">
            Fuerzas
            <select
              value={bloques}
              onChange={(e) => setBloques(Number(e.target.value))}
              title="Cuántas fuerzas mostrar por elección; el resto se agrupa en «Otras»"
              className="rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none"
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n} más votadas</option>
              ))}
            </select>
          </label>
          {r && (
            <span className="text-[10px] text-texto-3">
              {r.unidades} circuitos · error medio {numero(Math.round(r.errorMedio))} electores por celda
            </span>
          )}
        </div>
      </div>

      {cargando && <p className="px-1 text-xs text-texto-2">Estimando la matriz…</p>}
      {error && <p className="px-1 text-xs text-peligro">{error}</p>}

      {r && !cargando && (
        <>
          <div className="panel-vidrio rounded-2xl p-4">
            <div className="overflow-auto">
              <table className="w-full min-w-[680px] text-[11px]">
                <thead>
                  <tr className="text-texto-3">
                    <th className="py-1 pr-2 text-left font-semibold">2023 ↓ &nbsp; 2025 →</th>
                    <th className="num py-1 pr-3 text-right font-semibold">Votantes</th>
                    {r.destinos.map((d) => (
                      <th key={d} className="max-w-24 px-1 py-1 text-center font-semibold" title={d}>
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.filas.map((fila) => (
                    <tr key={fila.origen} className="border-t border-borde/60">
                      <td className="py-1.5 pr-2 font-bold" title={fila.origen}>{fila.origen}</td>
                      <td className="num py-1.5 pr-3 text-right text-texto-2">{numero(fila.total)}</td>
                      {r.destinos.map((d) => {
                        const h = fila.hacia.find((x) => x.destino === d);
                        const pct = h?.pct ?? 0;
                        return (
                          <td
                            key={d}
                            className={`num px-1 py-1.5 text-center ${colorCelda(pct)}`}
                            title={h ? `${numero(h.votos)} electores` : ""}
                          >
                            {pct >= 1 ? `${pct.toFixed(0)}%` : "·"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[9px] text-texto-3">
              Cada fila suma 100%: es a dónde fue el total de esa fuerza. Pasá el cursor por una celda para ver los
              electores estimados.
            </p>
          </div>

          {frases.length > 0 && (
            <div className="panel-vidrio rounded-2xl p-4">
              <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Qué dice</h3>
              <ul className="mt-2 space-y-1">
                {frases.map((f) => (
                  <li key={f} className="text-xs leading-relaxed text-texto">· {f}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel-vidrio rounded-2xl p-4">
            <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
              Cuánto confiar en cada columna
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.r2PorDestino.map(({ destino, r2 }) => (
                <span
                  key={destino}
                  title="R²: qué parte de la variación entre circuitos explica el modelo"
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    r2 >= 0.9
                      ? "border-completo/50 bg-completo/10 text-completo"
                      : r2 >= 0.8
                        ? "border-encurso/50 bg-encurso/10 text-encurso"
                        : "border-sin/50 bg-sin/10 text-sin"
                  }`}
                >
                  {destino} <b className="num">{r2.toFixed(2)}</b>
                </span>
              ))}
            </div>
            {r2Bajo.length > 0 && (
              <p className="mt-2 text-[10px] text-encurso">
                {r2Bajo.map((x) => x.destino).join(", ")}: el ajuste es flojo, esas columnas se leen con reserva.
              </p>
            )}
          </div>

          <div className="nota-lectura panel-vidrio rounded-2xl border-encurso/40 p-4">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-encurso uppercase">
              <Info size={12} /> Cómo hay que leer esto
            </h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
              Es una <b>estimación sobre datos agregados</b>, no un conteo. Está sujeta a la falacia ecológica: la
              relación que se ve entre circuitos no tiene por qué valer dentro de cada circuito. Sirve para leer la
              dirección y el orden de magnitud de los flujos, nunca para afirmar qué hizo una persona. Además son
              elecciones distintas —una municipal, otra nacional— y el 2025 es provisorio: se lee como tendencia.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Voto joven: la cohorte de menor lealtad partidaria, por circuito.
 *
 * Se muestra lo que el padrón permite medir. Los que votan por primera vez en
 * 2027 todavía no están inscriptos, y eso se dice explícitamente en lugar de
 * estimarlo con un número que no se puede sostener.
 */
export function VotoJoven({ supabase }: { supabase: SupabaseClient }) {
  const [edadMax, setEdadMax] = useState(24);
  const [filas, setFilas] = useState<CohorteJoven[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilas(null);
    void obtenerCohorteJoven(supabase, edadMax)
      .then(setFilas)
      .catch((e) => setError(e instanceof Error ? e.message : "no pude cargar la cohorte"));
  }, [supabase, edadMax]);

  const tot = useMemo(() => {
    const f = filas ?? [];
    const jovenes = f.reduce((a, x) => a + Number(x.jovenes), 0);
    const electores = f.reduce((a, x) => a + Number(x.electores), 0);
    return {
      jovenes,
      electores,
      pct: electores > 0 ? (100 * jovenes) / electores : 0,
      mujeres: f.reduce((a, x) => a + Number(x.mujeres), 0),
      varones: f.reduce((a, x) => a + Number(x.varones), 0),
    };
  }, [filas]);

  const media = tot.pct;

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <Users size={15} className="text-rosa" /> Voto joven
        </h2>
        <p className="mt-1 text-[11px] text-texto-2">
          Dónde está el electorado con menos lealtad partidaria, que es el más disputable y el que menos se trabaja.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[19, 24, 29].map((e) => (
            <button
              key={e}
              onClick={() => setEdadMax(e)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                edadMax === e ? "border-rosa bg-rosa/15 text-rosa" : "border-borde-2 text-texto-2 hover:text-texto"
              }`}
            >
              16–{e} años
            </button>
          ))}
          {filas && filas[0] && (
            <span className="text-[10px] text-texto-3">
              nacidos entre {filas[0].anio_min} y {filas[0].anio_max}
            </span>
          )}
        </div>
      </div>

      {error && <p className="px-1 text-xs text-peligro">{error}</p>}
      {!filas && !error && <p className="px-1 text-xs text-texto-2">Contando el padrón…</p>}

      {filas && (
        <>
          <Cifras>
            <Cifra valor={numero(tot.jovenes)} etiqueta={`electores de 16 a ${edadMax}`} tono="marca" />
            <Cifra valor={tot.pct.toFixed(1)} unidad="%" etiqueta="del padrón" />
            <Cifra valor={numero(tot.mujeres)} etiqueta="mujeres" />
            <Cifra valor={numero(tot.varones)} etiqueta="varones" />
          </Cifras>

          <div className="panel-vidrio rounded-2xl p-4">
            <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
              Por circuito <span className="font-normal normal-case text-texto-3">· más concentración arriba</span>
            </h3>
            <div className="mt-2 overflow-auto">
              <table className="w-full min-w-[460px] text-[11px]">
                <thead className="text-left text-texto-3">
                  <tr>
                    <th className="py-1 pr-2 font-semibold">Circuito</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Jóvenes</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Del circuito</th>
                    <th className="py-1 pr-2 font-semibold">vs ciudad</th>
                    <th className="num py-1 text-right font-semibold">Padrón</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.slice(0, 25).map((f) => {
                    const dif = Number(f.pct) - media;
                    return (
                      <tr key={f.circuito} className="border-t border-borde/60">
                        <td className="py-1 pr-2 font-semibold">{f.circuito}</td>
                        <td className="num py-1 pr-2 text-right font-bold">{numero(Number(f.jovenes))}</td>
                        <td className="num py-1 pr-2 text-right">{Number(f.pct).toFixed(1)}%</td>
                        <td className="py-1 pr-2">
                          <span className={`num text-[10px] font-bold ${dif >= 0 ? "text-completo" : "text-texto-3"}`}>
                            {dif >= 0 ? "+" : ""}
                            {dif.toFixed(1)} pts
                          </span>
                        </td>
                        <td className="num py-1 text-right text-texto-3">{numero(Number(f.electores))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel-vidrio rounded-2xl border-encurso/40 p-4">
            <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-encurso uppercase">
              <Info size={12} /> Lo que este padrón no puede decir
            </h3>
            <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
              <b>Quiénes votan por primera vez en 2027 no se puede saber todavía.</b> Los que cumplen 16 o 17 ese año
              nacieron en 2010 y 2011, y el padrón vigente tiene 47 electores nacidos en 2010 y ninguno en 2011:
              se armó cuando esos chicos tenían 13 o 14 años. Van a aparecer cuando la Junta Electoral publique el
              padrón actualizado, y recién entonces se los puede ubicar por circuito.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
              Las edades de acá son <b>estimadas por rango de DNI</b> (±3 años), porque el padrón no trae fecha de
              nacimiento: dimensionan una cohorte, no afirman la edad de nadie.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

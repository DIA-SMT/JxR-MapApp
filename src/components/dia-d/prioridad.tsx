"use client";

import { Info, ListOrdered } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { obtenerPrioridadMesas, type MesaPrioritaria } from "@/lib/analisis-politico";
import { resolverSeleccion } from "@/lib/estrategia";
import { descargarCSV } from "@/lib/csv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Cifra, Cifras } from "@/components/ui/cifras";
import { Vacio } from "@/components/ui/vacio";
import { TablaEsqueleto } from "@/components/ui/esqueleto";

const numero = (n: number) => n.toLocaleString("es-AR");
const TOPE = 400; // el ranking se pide acotado: más abajo la prioridad ya no discrimina

type Vista = "escuela" | "mesa";

/**
 * Qué mesas fiscalizar primero.
 *
 * Con fiscales limitados no se cubren 1.087 mesas: se cubren las que definen
 * la banca marginal. El ranking combina la competitividad del circuito en 2025,
 * el volumen de la mesa y el voto propio potencial de su escuela, y pone
 * adelante lo que todavía no tiene fiscal.
 *
 * La vista por escuela es la que se usa para repartir gente —un referente
 * cubre una escuela entera, no mesas sueltas—; la de mesa sirve para el detalle.
 */
export function PrioridadMesas({
  supabase,
  fiscalesAsignados,
  totalMesas,
  totalElectores,
}: {
  supabase: SupabaseClient;
  fiscalesAsignados: number;
  totalMesas: number;
  totalElectores: number;
}) {
  const [filas, setFilas] = useState<MesaPrioritaria[] | null>(null);
  const [cuantos, setCuantos] = useState(150);
  const [vista, setVista] = useState<Vista>("escuela");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilas(null);
    void (async () => {
      try {
        const listas = await resolverSeleccion(supabase, "CONCEJAL");
        setFilas(await obtenerPrioridadMesas(supabase, listas, TOPE));
      } catch (e) {
        setError(e instanceof Error ? e.message : "no pude calcular la prioridad");
      }
    })();
    // se recalcula cuando cambia la cobertura: las cubiertas bajan en el ranking
  }, [supabase, fiscalesAsignados]);

  /** Las N mesas que se van a cubrir con los fiscales disponibles. */
  const objetivo = useMemo(
    () => (filas ?? []).filter((m) => !m.tiene_fiscal).slice(0, cuantos),
    [filas, cuantos],
  );

  const resumen = useMemo(() => {
    const escuelas = new Set(objetivo.map((m) => m.escuela));
    return {
      mesas: objetivo.length,
      escuelas: escuelas.size,
      electores: objetivo.reduce((a, m) => a + m.electores, 0),
      competitividad:
        objetivo.length > 0
          ? objetivo.reduce((a, m) => a + Number(m.competitividad), 0) / objetivo.length
          : 0,
      sinFiscalTotal: Math.max(0, totalMesas - fiscalesAsignados),
    };
  }, [objetivo, totalMesas, fiscalesAsignados]);

  /** El mismo objetivo agrupado por escuela: así se reparte la gente. */
  const porEscuela = useMemo(() => {
    const g = new Map<string, { escuela: string; circuito: string; mesas: number; electores: number; competitividad: number; disperso: number; score: number }>();
    for (const m of objetivo) {
      const e = g.get(m.escuela);
      if (e) {
        e.mesas += 1;
        e.electores += m.electores;
        e.score = Math.max(e.score, Number(m.score));
      } else {
        g.set(m.escuela, {
          escuela: m.escuela,
          circuito: m.circuito,
          mesas: 1,
          electores: m.electores,
          competitividad: Number(m.competitividad),
          disperso: Number(m.disperso_escuela),
          score: Number(m.score),
        });
      }
    }
    return [...g.values()].sort((a, b) => b.score - a.score);
  }, [objetivo]);

  const exportar = () => {
    if (vista === "escuela") {
      descargarCSV(
        `escuelas-a-fiscalizar-${cuantos}-mesas.csv`,
        ["orden", "escuela", "circuito", "mesas_a_cubrir", "electores", "competitividad", "disperso_escuela", "score"],
        porEscuela.map((e, i) => [
          i + 1, e.escuela, e.circuito, e.mesas, e.electores, e.competitividad, e.disperso, e.score,
        ]),
      );
      return;
    }
    descargarCSV(
      `mesas-a-fiscalizar-${cuantos}.csv`,
      ["orden", "mesa", "escuela", "circuito", "electores", "competitividad", "disperso_escuela", "score"],
      objetivo.map((m, i) => [
        i + 1, m.mesa, m.escuela, m.circuito, m.electores, m.competitividad, m.disperso_escuela, m.score,
      ]),
    );
  };

  if (error) return <p className="p-4 text-xs text-peligro">{error}</p>;
  if (!filas)
    return (
      <div className="space-y-3">
        <div className="panel-vidrio rounded-2xl p-4">
          <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
            <ListOrdered size={13} className="text-rosa" /> Qué cubrir primero
          </h3>
          <p className="mt-1 text-[11px] text-texto-2">Calculando la prioridad de las mesas…</p>
        </div>
        <div className="panel-vidrio rounded-2xl p-4">
          <TablaEsqueleto filas={10} columnas={6} />
        </div>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
          <ListOrdered size={13} className="text-rosa" /> Qué cubrir primero
        </h3>
        <p className="mt-1 text-[11px] text-texto-2">
          Si no alcanzan los fiscales para las {numero(totalMesas)} mesas, este es el orden: primero lo que está
          descubierto, y dentro de eso lo que más pesa en el resultado.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-borde pt-3 text-xs">
          <label className="flex items-center gap-1.5 text-texto-2">
            Tengo fiscales para
            <input
              type="number"
              min="10"
              max={TOPE}
              step="10"
              value={cuantos}
              onChange={(e) => setCuantos(Math.max(1, Math.min(TOPE, Number(e.target.value) || 1)))}
              className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none focus:border-rosa/50"
            />
            mesas
          </label>
          <div className="flex overflow-hidden rounded-lg border border-borde-2 text-[11px] font-bold">
            {(
              [
                ["escuela", "Por escuela"],
                ["mesa", "Por mesa"],
              ] as Array<[Vista, string]>
            ).map(([clave, etiqueta]) => (
              <button
                key={clave}
                onClick={() => setVista(clave)}
                className={`px-2.5 py-1.5 transition ${vista === clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <button
            onClick={exportar}
            className="rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      <Cifras>
        <Cifra valor={numero(resumen.mesas)} etiqueta="mesas que cubrís" tono="marca" />
        <Cifra valor={numero(resumen.escuelas)} etiqueta="escuelas" />
        <Cifra
          valor={numero(resumen.electores)}
          etiqueta="electores vigilados"
          nota={totalElectores > 0 ? `${Math.round((100 * resumen.electores) / totalElectores)}% del padrón` : undefined}
        />
        <Cifra
          valor={(100 * resumen.competitividad).toFixed(0)}
          unidad="%"
          etiqueta="competitividad media"
          titulo="Promedio de lo peleado que quedaron en 2025 los circuitos de estas mesas"
        />
        <Cifra
          valor={numero(resumen.sinFiscalTotal)}
          etiqueta="sin fiscal en la ciudad"
          tono={resumen.sinFiscalTotal > 0 ? "alerta" : "ok"}
        />
      </Cifras>

      {objetivo.length === 0 && (
        <Vacio icono={ListOrdered} titulo="Las mesas prioritarias ya están cubiertas" variante="filtro">
          Las {numero(TOPE)} de mayor prioridad tienen fiscal asignado. El resto conviene cubrirlo por orden de
          volumen desde Fiscales.
        </Vacio>
      )}

      {objetivo.length > 0 && (
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="overflow-auto">
            {vista === "escuela" ? (
              <table className="w-full min-w-[620px] text-[11px]">
                <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
                  <tr>
                    <th className="num py-1 pr-2 text-right font-semibold">#</th>
                    <th className="py-1 pr-2 font-semibold">Escuela</th>
                    <th className="py-1 pr-2 font-semibold">Circ.</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Mesas</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Electores</th>
                    <th className="num py-1 pr-2 text-right font-semibold" title="Qué tan peleado quedó el circuito en 2025">
                      Peleado
                    </th>
                    <th className="num py-1 pr-2 text-right font-semibold" title="Voto disperso 2023 de la escuela">
                      Disperso
                    </th>
                    <th className="num py-1 text-right font-semibold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {porEscuela.map((e, i) => (
                    <tr key={e.escuela} className="border-t border-borde/60 transition hover:bg-panel-3/50">
                      <td className="num py-1 pr-2 text-right text-texto-3">{i + 1}</td>
                      <td className="max-w-72 truncate py-1 pr-2 font-semibold" title={e.escuela}>
                        {e.escuela}
                      </td>
                      <td className="py-1 pr-2 text-texto-2">{e.circuito}</td>
                      <td className="num py-1 pr-2 text-right font-bold">{e.mesas}</td>
                      <td className="num py-1 pr-2 text-right">{numero(e.electores)}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">{(100 * e.competitividad).toFixed(0)}%</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">{numero(e.disperso)}</td>
                      <td className="num py-1 text-right font-bold text-rosa">{e.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[620px] text-[11px]">
                <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
                  <tr>
                    <th className="num py-1 pr-2 text-right font-semibold">#</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Mesa</th>
                    <th className="py-1 pr-2 font-semibold">Escuela</th>
                    <th className="py-1 pr-2 font-semibold">Circ.</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Electores</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Peleado</th>
                    <th className="num py-1 text-right font-semibold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {objetivo.map((m, i) => (
                    <tr key={m.mesa} className="border-t border-borde/60 transition hover:bg-panel-3/50">
                      <td className="num py-1 pr-2 text-right text-texto-3">{i + 1}</td>
                      <td className="num py-1 pr-2 text-right font-bold">{m.mesa}</td>
                      <td className="max-w-64 truncate py-1 pr-2" title={m.escuela}>
                        {m.escuela}
                      </td>
                      <td className="py-1 pr-2 text-texto-2">{m.circuito}</td>
                      <td className="num py-1 pr-2 text-right">{numero(m.electores)}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">
                        {(100 * Number(m.competitividad)).toFixed(0)}%
                      </td>
                      <td className="num py-1 text-right font-bold text-rosa">{m.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <div className="panel-vidrio rounded-2xl border-encurso/40 p-4">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-encurso uppercase">
          <Info size={12} /> Cómo se arma el orden
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
          El score es <b>40% competitividad del circuito en 2025</b> (cuánto se define por poco), <b>35% volumen</b> de
          la mesa y <b>25% voto propio potencial</b> de la escuela, según la selección de listas de Estrategia. Las
          mesas que ya tienen fiscal quedan fuera de la lista: acá aparece solo lo que falta resolver.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
          La competitividad se mide <b>por circuito</b> y no por mesa porque la numeración de mesas de 2025 no es la
          del padrón provincial; a nivel circuito los 47 códigos sí coinciden. El ranking se calcula sobre las{" "}
          {numero(TOPE)} mesas de mayor prioridad: más abajo el score ya no discrimina y conviene cubrir por volumen.
        </p>
      </div>
    </div>
  );
}

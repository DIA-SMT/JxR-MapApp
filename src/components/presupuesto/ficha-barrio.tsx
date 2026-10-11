"use client";

import { Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import {
  listarEscenarios,
  obtenerDetalleEscenario,
  obtenerEjecucion,
  obtenerNecesidadBarrios,
  obtenerPoliticas,
  type DetalleEscenario,
  type Escenario,
  type FilaEjecucion,
  type PoliticaCatalogo,
} from "@/lib/presupuesto-datos";
import { demandasDeBarrio, pct, pesos, plural, type BarrioNecesidad } from "@/lib/presupuesto";
import { propuestasEjemplo } from "@/lib/presupuesto-ejemplo";
import { AREA, AREAS_TERRITORIALES, areasDePolitica, type Area } from "@/lib/organigrama";

const ESTADO_OBRA: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  terminado: "Terminado",
  no_se_hara: "No se hará",
};
const numero = (n: number) => Math.round(n).toLocaleString("es-AR");

/**
 * La ficha de un barrio en una hoja, para llevar a la reunión con el centro
 * vecinal o con las áreas: sus principales demandas según el censo, qué recibe
 * en la propuesta, cómo va la obra y qué áreas tienen que intervenir.
 * Documento de gestión: sin datos electorales ni la marca de la campaña.
 */
export function FichaBarrio({
  barrio,
  propuesta,
  ejemplo,
}: {
  barrio: string;
  propuesta: number | null;
  ejemplo: boolean;
}) {
  const [supabase] = useState(crearClienteNavegador);
  const [b, setB] = useState<BarrioNecesidad | null>(null);
  const [barrios, setBarrios] = useState<BarrioNecesidad[]>([]);
  const [politicas, setPoliticas] = useState<PoliticaCatalogo[]>([]);
  const [esc, setEsc] = useState<Escenario | null>(null);
  const [det, setDet] = useState<DetalleEscenario | null>(null);
  const [seg, setSeg] = useState<FilaEjecucion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [todos, pols] = await Promise.all([obtenerNecesidadBarrios(supabase), obtenerPoliticas(supabase)]);
        const este = todos.find((x) => x.id === barrio);
        if (!este) return setError(`No encuentro el barrio «${barrio}» en el censo, o no tenés acceso al presupuesto.`);
        let fuente: SupabaseClient = supabase;
        let lista: Escenario[];
        if (ejemplo) {
          const ej = propuestasEjemplo(pols, todos);
          fuente = ej.cliente;
          lista = ej.escenarios;
        } else lista = await listarEscenarios(supabase);
        // la pedida; si no, la aprobada más reciente; si no, la última que sigue en juego
        const elegida =
          lista.find((e) => e.id === propuesta) ??
          lista.find((e) => e.estado === "aprobado" || e.estado === "ejecutado") ??
          lista.find((e) => e.estado !== "descartado") ??
          null;
        if (elegida) {
          const d = await obtenerDetalleEscenario(fuente, elegida.id);
          const s =
            elegida.estado === "aprobado" || elegida.estado === "ejecutado"
              ? await obtenerEjecucion(fuente, elegida.id).catch(() => [])
              : [];
          setDet(d);
          setSeg(s);
          setEsc(elegida);
        }
        setBarrios(todos);
        setPoliticas(pols);
        setB(este);
        document.title = `Ficha del barrio ${este.nombre}`;
        setListo(true);
      } catch (x) {
        setError(x instanceof Error ? x.message : "no pude cargar la ficha");
      }
    })();
  }, [supabase, barrio, propuesta, ejemplo]);

  const demandas = useMemo(() => (b ? demandasDeBarrio(b, barrios, { minCasos: 5, limite: 8 }) : []), [b, barrios]);
  const recibe = useMemo(() => {
    if (!det || !b) return [];
    const obra = new Map(seg.filter((f) => f.barrio === b.id).map((f) => [f.politica_id, f]));
    return det.asignaciones
      .filter((a) => a.barrio === b.id)
      .sort((x, y) => y.monto - x.monto)
      .map((a) => ({ a, obra: obra.get(a.politica_id), areas: areasDePolitica(a.politica_codigo) }));
  }, [det, seg, b]);

  // Las áreas que intervienen: las que lideran o participan en lo que recibe y en lo que atiende sus demandas
  const areas = useMemo(() => {
    const m = new Map<string, { area: Area; lidera: Set<string>; participa: Set<string> }>();
    const anotar = (x: Area, codigo: string, lidera: boolean) => {
      const e = m.get(x.id) ?? { area: x, lidera: new Set<string>(), participa: new Set<string>() };
      (lidera ? e.lidera : e.participa).add(codigo);
      m.set(x.id, e);
    };
    const codigos = new Set([
      ...recibe.map((r) => r.a.politica_codigo),
      ...politicas
        .filter((p) => p.activa && p.tipo !== "institucional" && demandas.some((d) => d.indicador === p.indicador))
        .map((p) => p.codigo),
    ]);
    for (const c of codigos) {
      const { lidera, participan } = areasDePolitica(c);
      if (lidera) anotar(lidera, c, true);
      for (const x of participan) anotar(x, c, false);
    }
    return [...m.values()].sort((x, y) => y.lidera.size - x.lidera.size || y.participa.size - x.participa.size);
  }, [recibe, politicas, demandas]);

  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10 print:px-8 text-sm">
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">{error}</p>
      </div>
    );

  const seccion = "mt-5 mb-1.5 border-b border-neutral-300 pb-0.5 text-[11px] font-extrabold tracking-wide uppercase";
  const th = "py-1 pr-2 text-left font-semibold text-neutral-500";
  const td = "py-0.5 pr-2 align-top";
  const totalRecibe = recibe.reduce((s, r) => s + r.a.monto, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-8 sm:py-6 print:px-8 text-[11px] leading-snug">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-neutral-100 px-4 py-2.5 print:hidden">
        <span className="text-xs text-neutral-600">
          {listo ? "Ficha lista: imprimila o guardala como PDF." : "Armando la ficha del barrio…"}
        </span>
        <button
          onClick={() => window.print()}
          disabled={!listo}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          <Printer size={13} /> Imprimir o guardar PDF
        </button>
      </div>

      {b && (
        <>
          <div className="border-b-2 border-neutral-900 pb-2">
            <div className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">
              Ficha de barrio · gestión territorial
            </div>
            <h1 className="mt-0.5 text-2xl font-black">{b.nombre}</h1>
            <div className="mt-0.5 flex flex-wrap justify-between gap-2 text-[10px] text-neutral-600">
              <span>
                {numero(b.poblacion)} habitantes · {numero(b.hogares)} hogares (Censo 2022)
              </span>
              <span>
                Generada el {new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            </div>
          </div>
          {ejemplo && (
            <div className="mt-3 rounded border-2 border-dashed border-neutral-500 px-3 py-2 text-center text-[11px] font-bold tracking-wide text-neutral-700 uppercase">
              Ejemplo: la propuesta y sus montos son inventados; la necesidad del barrio es la real del censo
            </div>
          )}

          <div className={seccion}>Principales demandas</div>
          {demandas.length === 0 ? (
            <p className="text-neutral-600">Ninguna carencia del censo supera el promedio de la ciudad.</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[460px] print:min-w-0">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th className={th}>Demanda</th>
                  <th className={`${th} text-right`}>Casos</th>
                  <th className={`${th} text-right`}>En el barrio</th>
                  <th className={`${th} text-right`}>En la ciudad</th>
                  <th className={`${th} text-right`}>Veces</th>
                </tr>
              </thead>
              <tbody>
                {demandas.map((d) => (
                  <tr key={d.indicador} className="border-b border-neutral-100">
                    <td className={`${td} font-semibold`}>{d.etiqueta}</td>
                    <td className={`${td} text-right`}>{numero(d.casos)}</td>
                    <td className={`${td} text-right font-bold`}>{pct(d.tasa)}</td>
                    <td className={`${td} text-right text-neutral-600`}>{pct(d.tasaCiudad)}</td>
                    <td className={`${td} text-right`}>
                      {d.veces.toLocaleString("es-AR", { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
</div>
          )}

          <div className={seccion}>Qué recibe</div>
          {!esc ? (
            <p className="text-neutral-600">
              No hay propuestas guardadas que sigan en juego (aprobadas o por aprobar).
            </p>
          ) : recibe.length === 0 ? (
            <p className="text-neutral-600">La propuesta «{esc.nombre}» no le asigna nada a este barrio.</p>
          ) : (
            <>
              <p className="mb-1 text-neutral-600">
                Según la propuesta «{esc.nombre}» ({esc.estado}
                {esc.norma ? ` · ${esc.norma}` : ""}): <b className="text-neutral-900">{pesos(totalRecibe)}</b>.
              </p>
              <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[460px] print:min-w-0">
                <thead>
                  <tr className="border-b border-neutral-300">
                    <th className={th}>Política</th>
                    <th className={th}>Lidera</th>
                    <th className={`${th} text-right`}>Monto</th>
                    <th className={`${th} text-right`}>Qué se logra</th>
                    {seg.length > 0 && <th className={th}>Obra</th>}
                  </tr>
                </thead>
                <tbody>
                  {recibe.map(({ a, obra, areas: ar }) => (
                    <tr key={a.politica_id} className="border-b border-neutral-100 break-inside-avoid">
                      <td className={td}>
                        <span className="text-neutral-500">{a.politica_codigo}</span> {a.politica_nombre}
                      </td>
                      <td className={`${td} text-neutral-600`}>{ar.lidera?.nombre ?? "—"}</td>
                      <td className={`${td} text-right font-bold`}>{pesos(a.monto)}</td>
                      <td className={`${td} text-right`}>
                        {numero(a.unidades)} {plural(a.unidad, Math.round(a.unidades))}
                      </td>
                      {seg.length > 0 && (
                        <td className={td}>
                          {obra ? ESTADO_OBRA[obra.estado] : "Pendiente"}
                          {obra && obra.monto_ejecutado > 0 && (
                            <div className="text-[9px] text-neutral-500">
                              {pesos(obra.monto_ejecutado)} gastados{obra.expediente ? ` · ${obra.expediente}` : ""}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            </>
          )}

          <div className={seccion}>Áreas que intervienen</div>
          {areas.length === 0 ? (
            <p className="text-neutral-600">Sin políticas en juego para este barrio.</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[460px] print:min-w-0">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th className={th}>Área</th>
                  <th className={th}>Responsable</th>
                  <th className={th}>Lidera</th>
                  <th className={th}>Participa</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((x) => (
                  <tr key={x.area.id} className="border-b border-neutral-100 break-inside-avoid">
                    <td className={`${td} font-semibold`}>{x.area.nombre}</td>
                    <td className={`${td} text-neutral-600`}>{x.area.responsable ?? "—"}</td>
                    <td className={td}>{[...x.lidera].join(", ") || "—"}</td>
                    <td className={`${td} text-neutral-600`}>{[...x.participa].join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
</div>
          )}
          <p className="mt-1 text-[10px] text-neutral-600">
            Entrada al barrio:{" "}
            {AREAS_TERRITORIALES.map((id) => {
              const x = AREA.get(id)!;
              return `${x.nombre}${x.responsable ? ` (${x.responsable})` : ""}`;
            }).join(" · ")}
            .
          </p>

          <div className={seccion}>Fuentes</div>
          <p className="text-[10px] text-neutral-700">
            Censo Nacional 2022 (INDEC) por radio censal, repartido en proporción a la superficie de cada radio que cae
            en el barrio. Las demandas son las carencias cuya tasa supera la de la ciudad. Áreas según el organigrama
            municipal; la asignación de áreas a cada línea del Plan Rector es una propuesta de trabajo.
          </p>
        </>
      )}
    </div>
  );
}

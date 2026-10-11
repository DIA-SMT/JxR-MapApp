"use client";

import { Printer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import {
  obtenerDetalleEscenario,
  obtenerEjecucion,
  obtenerEjercicio,
  obtenerNecesidadBarrios,
  obtenerPoliticas,
  type DetalleEscenario,
  type Ejercicio,
  type Escenario,
  type FilaEjecucion,
  SinSeguimiento,
} from "@/lib/presupuesto-datos";
import { pesos, plural, resumenParametros } from "@/lib/presupuesto";
import { MapaImpreso } from "./mapa-impreso";
import { propuestasEjemplo } from "@/lib/presupuesto-ejemplo";
import { agruparPorArea } from "./areas";
import { areasDePolitica } from "@/lib/organigrama";

const TIPO: Record<string, string> = {
  obra: "Obra",
  servicio: "Servicio",
  transferencia_personas: "Cupos a personas",
  programa_social: "Programa",
};
const ESTADO: Record<string, string> = {
  borrador: "Borrador",
  propuesto: "Propuesta",
  aprobado: "Aprobada",
  ejecutado: "Ejecutada",
  descartado: "Descartada",
};
const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" }) : "—";
const numero = (n: number) => Math.round(n).toLocaleString("es-AR");

/**
 * La propuesta en hojas A4, para el expediente: fundamento, criterio, mapa,
 * qué recibe cada política y cada barrio, qué partida lo paga, los ajustes a
 * mano con su motivo y, si ya se aprobó, el avance. Se imprime o se guarda
 * como PDF desde el navegador.
 *
 * Sin la marca de la campaña: es un documento de gestión.
 */
export function InformePresupuesto({ id, ejemplo = false }: { id: number; ejemplo?: boolean }) {
  const [supabase] = useState(crearClienteNavegador);
  const [esc, setEsc] = useState<Escenario | null>(null);
  const [det, setDet] = useState<DetalleEscenario | null>(null);
  const [eje, setEje] = useState<Ejercicio | null>(null);
  const [seg, setSeg] = useState<FilaEjecucion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapaListo, setMapaListo] = useState(false);
  const alListoMapa = useCallback(() => setMapaListo(true), []);

  useEffect(() => {
    void (async () => {
      try {
        // En el ejemplo, las propuestas se recalculan acá con el mismo motor y los mismos datos: da lo mismo.
        const fuente = ejemplo
          ? propuestasEjemplo(await obtenerPoliticas(supabase), await obtenerNecesidadBarrios(supabase)).cliente
          : supabase;
        const { data, error: e } = await fuente.from("escenarios_presupuesto").select("*").eq("id", id).maybeSingle();
        if (e) throw new Error(e.message);
        if (!data) return setError("La propuesta no existe o no tenés acceso al presupuesto.");
        const escenario = { ...(data as Escenario), avisos: Array.isArray(data.avisos) ? data.avisos : [] };
        const conSeguimiento = escenario.estado === "aprobado" || escenario.estado === "ejecutado";
        const [d, ej, s] = await Promise.all([
          obtenerDetalleEscenario(fuente, id),
          obtenerEjercicio(supabase, escenario.ejercicio),
          // sin la migración 0017 no hay avance que mostrar; cualquier otro error frena el informe
          conSeguimiento
            ? obtenerEjecucion(fuente, id).catch((x) => {
                if (x instanceof SinSeguimiento) return [];
                throw new Error(`no pude cargar el avance de la ejecución: ${x instanceof Error ? x.message : x}`);
              })
            : Promise.resolve([]),
        ]);
        // todo junto: no se puede imprimir un informe a medio cargar
        setSeg(s);
        setEje(ej);
        setDet(d);
        setEsc(escenario);
        document.title = `Propuesta ${escenario.id} · ${escenario.nombre}`;
      } catch (x) {
        setError(x instanceof Error ? x.message : "no pude cargar la propuesta");
      }
    })();
  }, [supabase, id, ejemplo]);

  const total = useMemo(() => det?.asignaciones.reduce((a, x) => a + x.monto, 0) ?? 0, [det]);

  const porPolitica = useMemo(() => {
    const m = new Map<
      number,
      { codigo: string; nombre: string; tipo: string; unidad: string; monto: number; unidades: number; barrios: number }
    >();
    for (const a of det?.asignaciones ?? []) {
      const x = m.get(a.politica_id) ?? {
        codigo: a.politica_codigo,
        nombre: a.politica_nombre,
        tipo: a.politica_tipo,
        unidad: a.unidad,
        monto: 0,
        unidades: 0,
        barrios: 0,
      };
      x.monto += a.monto;
      x.unidades += a.unidades;
      x.barrios += 1;
      m.set(a.politica_id, x);
    }
    return [...m.entries()].sort((a, b) => b[1].monto - a[1].monto);
  }, [det]);

  const porBarrio = useMemo(() => {
    const m = new Map<string, { monto: number; politicas: number }>();
    for (const a of det?.asignaciones ?? []) {
      const x = m.get(a.barrio) ?? { monto: 0, politicas: 0 };
      x.monto += a.monto;
      x.politicas += 1;
      m.set(a.barrio, x);
    }
    return [...m.entries()].sort((a, b) => b[1].monto - a[1].monto);
  }, [det]);

  const porPartida = useMemo(() => {
    const m = new Map<number, { codigo: string; pp: string; monto: number; politicas: Set<number> }>();
    for (const f of det?.financiamiento ?? []) {
      const x = m.get(f.partida_id) ?? {
        codigo: f.partida_codigo,
        pp: f.partida_principal,
        monto: 0,
        politicas: new Set<number>(),
      };
      x.monto += f.monto;
      x.politicas.add(f.politica_id);
      m.set(f.partida_id, x);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto);
  }, [det]);

  const nombrePol = useMemo(
    () => new Map(porPolitica.map(([id, p]) => [id, `${p.codigo} ${p.nombre}`])),
    [porPolitica],
  );

  const limites = useMemo(() => {
    const l = esc?.parametros.limites;
    if (!l || typeof l !== "object") return [];
    return Object.entries(l as Record<string, { piso?: number; tope?: number; nombre?: string }>).map(([id, v]) => ({
      id: Number(id),
      ...v,
    }));
  }, [esc]);

  const avance = useMemo(() => {
    const ejecutado = seg.reduce((a, f) => a + f.monto_ejecutado, 0);
    const terminados = seg.filter((f) => f.estado === "terminado").length;
    const noSeHara = seg.filter((f) => f.estado === "no_se_hara").length;
    return { ejecutado, terminados, noSeHara };
  }, [seg]);

  const valoresMapa = useMemo(() => Object.fromEntries(porBarrio.map(([b, x]) => [b, x.monto])), [porBarrio]);

  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10 print:px-8 text-sm">
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">{error}</p>
      </div>
    );

  const listo = !!(esc && det) && mapaListo;
  const oficial = esc?.estado === "aprobado" || esc?.estado === "ejecutado";
  const seccion =
    "mt-5 mb-1.5 border-b border-neutral-300 pb-0.5 text-[11px] font-extrabold tracking-wide uppercase break-after-avoid";
  const th = "py-1 pr-2 text-left font-semibold text-neutral-500";
  const td = "py-0.5 pr-2 align-top";

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-8 sm:py-6 print:px-8 text-[11px] leading-snug">
      {/* Barra de acciones: no sale impresa */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-neutral-100 px-4 py-2.5 print:hidden">
        <span className="text-xs text-neutral-600">
          {listo
            ? "Informe listo. En la ventana de impresión elegí «Guardar como PDF» para adjuntarlo al expediente."
            : "Armando el informe…"}
        </span>
        <button
          onClick={() => window.print()}
          disabled={!listo}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          <Printer size={13} /> Imprimir o guardar PDF
        </button>
      </div>

      {esc && det && (
        <>
          {/* Encabezado */}
          <div className="border-b-2 border-neutral-900 pb-2">
            <div className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">
              Presupuesto municipal {esc.ejercicio} · Asignación del crédito disponible por barrio
            </div>
            <h1 className="mt-0.5 text-2xl font-black">{esc.nombre}</h1>
            <div className="mt-0.5 flex flex-wrap justify-between gap-2 text-[10px] text-neutral-600">
              <span>
                Propuesta Nº {esc.id} · <b>{ESTADO[esc.estado] ?? esc.estado}</b>
                {esc.norma ? ` · ${esc.norma}` : ""}
                {esc.boletin ? ` · ${esc.boletin}` : ""}
              </span>
              <span>Generado el {fecha(new Date().toISOString())}</span>
            </div>
          </div>

          {ejemplo && (
            <div className="mt-3 rounded border-2 border-dashed border-neutral-500 px-3 py-2 text-center text-[11px] font-bold tracking-wide text-neutral-700 uppercase">
              Ejemplo con montos y costos inventados · solo para conocer la herramienta · el avance que se cargue en la
              pantalla no se guarda y no aparece acá
            </div>
          )}
          {!oficial && !ejemplo && (
            <div className="mt-3 rounded border-2 border-dashed border-neutral-500 px-3 py-2 text-center text-[11px] font-bold tracking-wide text-neutral-700 uppercase">
              {esc.estado === "descartado" ? "Propuesta descartada" : "Documento de trabajo"} · no es un acto
              administrativo
              {esc.estado !== "descartado" && " hasta su aprobación por norma"}
            </div>
          )}

          {/* Quién y cuándo */}
          <div className="mt-3 grid grid-cols-1 gap-3 text-[10.5px] sm:grid-cols-3 print:grid-cols-3">
            <div>
              <div className="font-bold text-neutral-500">Elaboró</div>
              <div>{esc.creado_email || "—"}</div>
              <div className="text-neutral-500">{fecha(esc.creado_en)}</div>
            </div>
            <div>
              <div className="font-bold text-neutral-500">Aprobó</div>
              <div>{esc.aprobado_email || "—"}</div>
              <div className="text-neutral-500">{esc.aprobado_en ? fecha(esc.aprobado_en) : "pendiente"}</div>
            </div>
            <div>
              <div className="font-bold text-neutral-500">Ejecución</div>
              <div>{esc.ejecucion || (oficial ? "en curso" : "—")}</div>
            </div>
          </div>

          {/* Fundamento */}
          <div className={seccion}>Fundamento</div>
          <p className="whitespace-pre-wrap">{esc.criterio}</p>

          {/* Resumen */}
          <div className={seccion}>Resumen</div>
          <p>
            Se asignan <b>{pesos(total)}</b> a <b>{porPolitica.length}</b> políticas del Plan Rector en{" "}
            <b>{porBarrio.length}</b> barrios, financiados por <b>{porPartida.length}</b> partidas
            {eje ? ` del Presupuesto General ${esc.ejercicio} (${eje.norma})` : ""}. El reparto se calculó con{" "}
            {resumenParametros(esc.parametros)}
            {det.ajustes.length > 0
              ? `, y ${det.ajustes.length} monto${det.ajustes.length === 1 ? "" : "s"} se fij${det.ajustes.length === 1 ? "ó" : "aron"} a mano con su motivo`
              : ""}
            .
          </p>

          {/* Mapa */}
          <div className={seccion}>Monto asignado por barrio</div>
          <div className="break-inside-avoid">
            <MapaImpreso valores={valoresMapa} formatear={(v) => pesos(v, true)} onListo={alListoMapa} />
          </div>

          {/* Por política */}
          <div className={seccion}>Por política</div>
          <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[460px] print:min-w-0">
            <thead>
              <tr className="border-b border-neutral-300">
                <th className={th}>Política</th>
                <th className={th}>Lidera</th>
                <th className={`${th} text-right`}>Monto</th>
                <th className={`${th} text-right`}>%</th>
                <th className={`${th} text-right`}>Qué se logra</th>
                <th className={`${th} text-right`}>Barrios</th>
              </tr>
            </thead>
            <tbody>
              {porPolitica.map(([id, p]) => (
                <tr key={id} className="border-b border-neutral-100 break-inside-avoid">
                  <td className={td}>
                    <span className="text-neutral-500">{p.codigo}</span> {p.nombre}
                  </td>
                  <td className={`${td} text-neutral-600`}>
                    {areasDePolitica(p.codigo).lidera?.nombre ?? "—"}
                    <div className="text-[9px] text-neutral-400">{TIPO[p.tipo] ?? p.tipo}</div>
                  </td>
                  <td className={`${td} text-right font-bold`}>{pesos(p.monto)}</td>
                  <td className={`${td} text-right`}>
                    {total > 0 ? ((100 * p.monto) / total).toLocaleString("es-AR", { maximumFractionDigits: 1 }) : 0}%
                  </td>
                  <td className={`${td} text-right`}>
                    {numero(p.unidades)} {plural(p.unidad, Math.round(p.unidades))}
                  </td>
                  <td className={`${td} text-right`}>{p.barrios}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className={td} colSpan={2}>
                  Total
                </td>
                <td className={`${td} text-right`}>{pesos(total)}</td>
                <td className={`${td} text-right`}>100%</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
</div>

          {/* Coordinación entre áreas */}
          <div className={seccion}>Áreas que intervienen</div>
          <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[460px] print:min-w-0">
            <thead>
              <tr className="border-b border-neutral-300">
                <th className={th}>Área que lidera</th>
                <th className={`${th} text-right`}>Monto</th>
                <th className={`${th} text-right`}>Barrios</th>
                <th className={th}>Coordina con</th>
              </tr>
            </thead>
            <tbody>
              {agruparPorArea(
                det.asignaciones.map((x) => ({
                  codigo: x.politica_codigo,
                  nombre: x.politica_nombre,
                  barrio: x.barrio,
                  monto: x.monto,
                })),
              ).map((g) => (
                <tr key={g.area.id} className="border-b border-neutral-100 break-inside-avoid">
                  <td className={td}>
                    <span className="font-semibold">{g.area.nombre}</span>
                    <div className="text-[9px] text-neutral-500">
                      {g.secretaria.nombre}
                      {g.area.responsable ? ` · ${g.area.responsable}` : ""}
                    </div>
                  </td>
                  <td className={`${td} text-right font-bold`}>{pesos(g.monto)}</td>
                  <td className={`${td} text-right`}>{g.barrios}</td>
                  <td className={`${td} text-neutral-600`}>{g.participan.map((x) => x.nombre).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
          <p className="mt-1 text-[9px] text-neutral-500">
            Áreas según el organigrama municipal vigente. La asignación de áreas a cada línea del Plan Rector es una
            propuesta de trabajo a validar con cada secretaría.
          </p>

          {/* Financiamiento */}
          <div className={seccion}>Financiamiento (Ord. de Contabilidad 570/80)</div>
          <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[460px] print:min-w-0">
            <thead>
              <tr className="border-b border-neutral-300">
                <th className={th}>Partida</th>
                <th className={th}>Partida principal</th>
                <th className={`${th} text-right`}>Monto</th>
                <th className={th}>Financia</th>
              </tr>
            </thead>
            <tbody>
              {porPartida.map((p) => (
                <tr key={p.codigo} className="border-b border-neutral-100 break-inside-avoid">
                  <td className={`${td} font-semibold`}>{p.codigo}</td>
                  <td className={td}>{p.pp}</td>
                  <td className={`${td} text-right font-bold`}>{pesos(p.monto)}</td>
                  <td className={`${td} text-neutral-600`}>
                    {[...p.politicas].map((x) => nombrePol.get(x) ?? x).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>

          {limites.length > 0 && (
            <>
              <div className={seccion}>Montos decididos por política</div>
              <ul className="list-disc pl-4">
                {limites.map((l) => (
                  <li key={l.id}>
                    {nombrePol.get(l.id) ?? l.nombre ?? `Política ${l.id}`}
                    {l.piso != null && ` · al menos ${pesos(l.piso)}`}
                    {l.tope != null && ` · como máximo ${pesos(l.tope)}`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {det.ajustes.length > 0 && (
            <>
              <div className={seccion}>Ajustes a mano sobre el criterio</div>
              <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[460px] print:min-w-0">
                <thead>
                  <tr className="border-b border-neutral-300">
                    <th className={th}>Barrio</th>
                    <th className={th}>Política</th>
                    <th className={`${th} text-right`}>Según el criterio</th>
                    <th className={`${th} text-right`}>Fijado</th>
                    <th className={th}>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {det.ajustes.map((a) => (
                    <tr key={`${a.politica_id}-${a.barrio}`} className="border-b border-neutral-100 break-inside-avoid">
                      <td className={`${td} font-semibold`}>{a.barrio}</td>
                      <td className={td}>{nombrePol.get(a.politica_id) ?? a.politica_id}</td>
                      <td className={`${td} text-right`}>{pesos(a.monto_motor)}</td>
                      <td className={`${td} text-right font-bold`}>{pesos(a.monto_fijado)}</td>
                      <td className={`${td} text-neutral-700`}>{a.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
</div>
            </>
          )}

          {esc.avisos.length > 0 && (
            <>
              <div className={seccion}>Avisos del cálculo</div>
              <ul className="list-disc pl-4 text-neutral-700">
                {esc.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          )}

          {seg.length > 0 && (
            <>
              <div className={seccion}>Avance de la ejecución</div>
              <p>
                Se gastaron <b>{pesos(avance.ejecutado)}</b> de {pesos(total)} (
                {total > 0
                  ? ((100 * avance.ejecutado) / total).toLocaleString("es-AR", { maximumFractionDigits: 1 })
                  : 0}
                %). {avance.terminados} de {det.asignaciones.length} asignaciones por barrio están terminadas
                {avance.noSeHara > 0 ? ` y ${avance.noSeHara} no se harán` : ""}. Detalle completo en la planilla de
                seguimiento.
              </p>
            </>
          )}

          {/* Por barrio */}
          <div className={seccion}>Por barrio ({porBarrio.length})</div>
          <div className="gap-6 text-[10px] sm:columns-2 print:columns-2">
            {porBarrio.map(([b, x]) => (
              <div key={b} className="flex justify-between gap-2 border-b border-neutral-100 py-0.5 break-inside-avoid">
                <span className="min-w-0 truncate">{b}</span>
                <span className="shrink-0 font-semibold">
                  {pesos(x.monto)} <span className="font-normal text-neutral-500">· {x.politicas}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[9px] text-neutral-500">
            El número después del monto es la cantidad de políticas que recibe el barrio.
          </p>

          {/* Método */}
          <div className={seccion}>Método y fuentes</div>
          <p className="text-[10px] text-neutral-700">
            La necesidad de cada barrio surge del Censo Nacional 2022 (INDEC), por radio censal, repartida en proporción
            a la superficie de cada radio que cae en el barrio. Cada política convierte pesos en unidades de necesidad
            cubierta según su costo por unidad; el reparto busca cubrir la mayor necesidad posible con el crédito libre,
            respetando que cada partida solo financie lo que su sección, su partida principal y su afectación permiten
            (Ord. de Contabilidad 570/80). No se usan datos electorales. Las políticas dirigidas a personas se
            planifican como cupos por barrio: la selección de cada beneficiario la hace el área que ejecuta el programa,
            con sus propios criterios.
          </p>

          {/* Firmas */}
          <div className="mt-12 grid grid-cols-3 gap-4 text-center text-[10px] break-inside-avoid sm:gap-8">
            {["Elaboró", "Revisó", "Aprobó"].map((r) => (
              <div key={r}>
                <div className="border-t border-neutral-700 pt-1 font-semibold">{r}</div>
                <div className="text-neutral-500">firma y aclaración</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

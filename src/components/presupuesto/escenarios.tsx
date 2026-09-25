"use client";

import { Check, ChevronDown, ChevronRight, Download, FileCheck2, History, KeyRound, Send, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  borrarEscenario,
  cambiarEstadoEscenario,
  habilitarAcceso,
  obtenerAccesos,
  obtenerBitacora,
  obtenerDetalleEscenario,
  type Acceso,
  type DetalleEscenario,
  type EntradaBitacora,
  type Escenario,
  type EstadoEscenario,
} from "@/lib/presupuesto-datos";
import { descargarCSV } from "@/lib/csv";
import { Vacio } from "@/components/ui/vacio";
import { pesos } from "./asignar";
import type { DatosPresupuesto } from "./panel";

const CHIP: Record<EstadoEscenario, string> = {
  borrador: "border-borde-2 text-texto-2",
  propuesto: "border-encurso/50 bg-encurso/10 text-encurso",
  aprobado: "border-completo/50 bg-completo/10 text-completo",
  ejecutado: "border-celeste/50 bg-celeste/10 text-celeste",
  descartado: "border-borde text-texto-3 line-through",
};

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

type Pedido = { estado: "aprobado" | "ejecutado" | "descartado"; titulo: string; ayuda: string };

export function Escenarios({
  supabase,
  datos,
  esSuperadmin,
  onCambio,
}: {
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  esSuperadmin: boolean;
  onCambio: () => Promise<void> | void;
}) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const [verBitacora, setVerBitacora] = useState(false);
  const [verAccesos, setVerAccesos] = useState(false);

  return (
    <div className="space-y-2">
      {datos.escenarios.length === 0 ? (
        <Vacio icono={History} titulo="Todavía no hay escenarios">
          Armá una asignación en «Asignar» y guardala con su criterio. Queda como borrador hasta que la apruebe el superadmin
          —que no puede ser quien la armó— con el número de la norma.
        </Vacio>
      ) : (
        datos.escenarios.map((e) => (
          <FilaEscenario
            key={e.id}
            e={e}
            supabase={supabase}
            datos={datos}
            abierto={abierto === e.id}
            onAbrir={() => setAbierto(abierto === e.id ? null : e.id)}
            esSuperadmin={esSuperadmin}
            onCambio={onCambio}
          />
        ))
      )}

      <button
        onClick={() => setVerBitacora((v) => !v)}
        className="flex items-center gap-1.5 px-1 pt-2 text-[11px] font-bold text-texto-2 hover:text-rosa"
      >
        {verBitacora ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <History size={12} /> Bitácora de cambios
      </button>
      {verBitacora && <Bitacora supabase={supabase} />}

      {esSuperadmin && (
        <>
          <button
            onClick={() => setVerAccesos((v) => !v)}
            className="flex items-center gap-1.5 px-1 pt-1 text-[11px] font-bold text-texto-2 hover:text-rosa"
          >
            {verAccesos ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <KeyRound size={12} /> Quién usa esta herramienta
          </button>
          {verAccesos && <Accesos supabase={supabase} />}
        </>
      )}
    </div>
  );
}

function FilaEscenario({
  e,
  supabase,
  datos,
  abierto,
  onAbrir,
  esSuperadmin,
  onCambio,
}: {
  e: Escenario;
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  abierto: boolean;
  onAbrir: () => void;
  esSuperadmin: boolean;
  onCambio: () => Promise<void> | void;
}) {
  const [detalle, setDetalle] = useState<DetalleEscenario | null>(null);
  const [norma, setNorma] = useState("");
  const [boletin, setBoletin] = useState("");
  const [pidiendo, setPidiendo] = useState<Pedido | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto || detalle) return;
    void obtenerDetalleEscenario(supabase, e.id)
      .then(setDetalle)
      .catch((x) => setError(x instanceof Error ? x.message : "no pude cargar el detalle"));
  }, [abierto, detalle, supabase, e.id]);

  // Lo que se muestra es la FOTO guardada con el escenario, no el catálogo de hoy.
  const nombrePol = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of detalle?.asignaciones ?? []) m.set(a.politica_id, `${a.politica_codigo} ${a.politica_nombre}`);
    for (const p of datos.politicas) if (!m.has(p.id)) m.set(p.id, `${p.codigo} ${p.nombre}`);
    return m;
  }, [detalle, datos.politicas]);

  const cambiar = async (estado: EstadoEscenario, conNorma = "", conBoletin = "") => {
    setOcupado(true);
    setError(null);
    const x = await cambiarEstadoEscenario(supabase, e.id, estado, conNorma, conBoletin);
    setOcupado(false);
    if (x) return setError(x);
    setPidiendo(null);
    setNorma("");
    setBoletin("");
    await onCambio();
  };

  const borrar = async () => {
    if (!window.confirm(`¿Borrar el escenario «${e.nombre}»? Solo se puede porque nunca se propuso.`)) return;
    setOcupado(true);
    const x = await borrarEscenario(supabase, e.id);
    setOcupado(false);
    if (x) setError(x);
    else await onCambio();
  };

  const exportar = () => {
    if (!detalle) return;
    descargarCSV(
      `escenario-${e.id}-${e.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
      ["escenario", "estado", "norma", "boletin", "politica_codigo", "politica", "tipo", "barrio", "monto", "unidades", "unidad", "fijado_a_mano"],
      detalle.asignaciones.map((a) => [
        e.nombre, e.estado, e.norma, e.boletin, a.politica_codigo, a.politica_nombre, a.politica_tipo,
        a.barrio, Math.round(a.monto), a.unidades, a.unidad, a.fijado,
      ]),
    );
  };

  const exportarFinanciamiento = () => {
    if (!detalle) return;
    descargarCSV(
      `escenario-${e.id}-financiamiento.csv`,
      ["partida", "partida_principal", "politica", "monto"],
      detalle.financiamiento.map((f) => [f.partida_codigo, f.partida_principal, nombrePol.get(f.politica_id), Math.round(f.monto)]),
    );
  };

  const porBarrio = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of detalle?.asignaciones ?? []) m.set(a.barrio, (m.get(a.barrio) ?? 0) + a.monto);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [detalle]);

  const nuncaPropuesto = !e.propuesto_en && !e.aprobado_en;
  const campo = "rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50";

  return (
    <div className="panel-vidrio rounded-2xl">
      <button onClick={onAbrir} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        {abierto ? <ChevronDown size={13} className="shrink-0 text-texto-3" /> : <ChevronRight size={13} className="shrink-0 text-texto-3" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold">{e.nombre}</div>
          <div className="truncate text-[10px] text-texto-3">
            {fecha(e.creado_en)}
            {e.creado_email ? ` · ${e.creado_email}` : ""} · {pesos(Number(e.resumen.asignado ?? 0), true)} en{" "}
            {e.resumen.barrios ?? 0} barrios y {e.resumen.politicas ?? 0} políticas
            {(e.resumen.ajustes ?? 0) > 0 ? ` · ${e.resumen.ajustes} ajustes a mano` : ""}
            {e.norma ? ` · ${e.norma}` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${CHIP[e.estado]}`}>{e.estado}</span>
      </button>

      {abierto && (
        <div className="border-t border-borde px-4 py-3">
          <div className="text-[9.5px] font-bold tracking-wide text-texto-3 uppercase">Criterio (registro interno)</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed whitespace-pre-wrap">{e.criterio}</p>
          {e.aprobado_en && (
            <p className="mt-1 text-[10px] text-completo">
              Aprobado el {fecha(e.aprobado_en)} por {e.aprobado_email || "—"} · {e.norma}
              {e.boletin ? ` · ${e.boletin}` : ""}
            </p>
          )}
          {e.ejecucion && <p className="mt-0.5 text-[10px] text-celeste">Ejecutado · {e.ejecucion}</p>}
          {e.avisos.length > 0 && (
            <ul className="mt-1.5 text-[10px] text-encurso">
              {e.avisos.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          )}

          {detalle && detalle.ajustes.length > 0 && (
            <div className="mt-3 rounded-xl border border-encurso/40 bg-encurso/5 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-encurso uppercase">
                <TriangleAlert size={11} /> {detalle.ajustes.length} ajuste{detalle.ajustes.length === 1 ? "" : "s"} a mano sobre el criterio
              </div>
              <div className="mt-1 max-h-40 space-y-1 overflow-auto pr-1">
                {detalle.ajustes.map((a) => (
                  <div key={`${a.politica_id}-${a.barrio}`} className="text-[10.5px] leading-snug">
                    <b>{a.barrio}</b> · {nombrePol.get(a.politica_id)}: el motor daba {pesos(a.monto_motor)}, se fijó{" "}
                    <b>{pesos(a.monto_fijado)}</b>
                    <span className="text-texto-2"> — {a.motivo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detalle && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="min-w-0">
                <div className="text-[9.5px] font-bold tracking-wide text-texto-3 uppercase">Barrios que más reciben</div>
                <div className="mt-1 max-h-48 space-y-0.5 overflow-auto pr-1">
                  {porBarrio.slice(0, 40).map(([b, m]) => (
                    <div key={b} className="flex justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate">{b}</span>
                      <span className="num shrink-0 font-bold">{pesos(m, true)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9.5px] font-bold tracking-wide text-texto-3 uppercase">Qué partida paga qué</div>
                <div className="mt-1 max-h-48 space-y-0.5 overflow-auto pr-1">
                  {detalle.financiamiento.map((f) => (
                    <div key={`${f.partida_id}-${f.politica_id}`} className="flex justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate">
                        <span className="text-texto-3">
                          {f.partida_codigo} (PP {f.partida_principal}) →
                        </span>{" "}
                        {nombrePol.get(f.politica_id) ?? f.politica_id}
                      </span>
                      <span className="num shrink-0 font-bold">{pesos(f.monto, true)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {!detalle && !error && <p className="mt-2 text-[11px] text-texto-3">Cargando el detalle…</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-borde pt-3">
            <button onClick={exportar} disabled={!detalle} className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 hover:border-rosa/50 hover:text-rosa disabled:opacity-40">
              <Download size={12} /> Asignación (CSV)
            </button>
            <button onClick={exportarFinanciamiento} disabled={!detalle} className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 hover:border-rosa/50 hover:text-rosa disabled:opacity-40">
              <Download size={12} /> Financiamiento (CSV)
            </button>

            <span className="flex-1" />

            {e.estado === "borrador" && (
              <button onClick={() => void cambiar("propuesto")} disabled={ocupado} className="flex items-center gap-1 rounded-lg border border-encurso/50 px-2.5 py-1.5 text-[11px] font-bold text-encurso disabled:opacity-40">
                <Send size={12} /> Proponer
              </button>
            )}
            {/* los cuatro ojos los controla la base: si lo armó quien aprueba, la aprobación falla con su motivo */}
            {esSuperadmin && (e.estado === "borrador" || e.estado === "propuesto") && (
              <button
                onClick={() =>
                  setPidiendo({
                    estado: "aprobado",
                    titulo: "Norma que aprueba la asignación",
                    ayuda: "La base vuelve a controlar el crédito libre de cada partida y rechaza la aprobación si alguna quedó excedida, si hay partidas estimadas, si la aprueba quien la armó o si hay cupos o programas y rige una veda.",
                  })
                }
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg bg-completo px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
              >
                <Check size={12} /> Aprobar
              </button>
            )}
            {esSuperadmin && e.estado === "aprobado" && (
              <button
                onClick={() =>
                  setPidiendo({
                    estado: "ejecutado",
                    titulo: "Expediente o norma de la ejecución",
                    ayuda: "Marcalo recién cuando el gasto ya figure como comprometido en el reporte de la Contaduría: al pasar a ejecutado deja de reservar crédito.",
                  })
                }
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg border border-celeste/50 px-2.5 py-1.5 text-[11px] font-bold text-celeste disabled:opacity-40"
              >
                <FileCheck2 size={12} /> Marcar ejecutado
              </button>
            )}
            {(e.estado === "borrador" || e.estado === "propuesto" || (esSuperadmin && e.estado === "aprobado")) && (
              <button
                onClick={() =>
                  e.estado === "aprobado"
                    ? setPidiendo({ estado: "descartado", titulo: "Norma que anula la aprobación", ayuda: "La anulación queda sumada a la norma original." })
                    : void cambiar("descartado")
                }
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 hover:text-peligro disabled:opacity-40"
              >
                <X size={12} /> {e.estado === "aprobado" ? "Anular" : "Descartar"}
              </button>
            )}
            {(e.estado === "borrador" || e.estado === "descartado") && nuncaPropuesto && (
              <button onClick={() => void borrar()} disabled={ocupado} title="Borrar (solo lo que nunca se propuso)" className="text-texto-3 transition hover:text-peligro disabled:opacity-40">
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {pidiendo && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rosa/30 bg-rosa/5 p-2.5">
              <span className="text-[11px] font-bold">{pidiendo.titulo}</span>
              <input autoFocus value={norma} onChange={(x) => setNorma(x.target.value)} placeholder="ej. Decreto Nº 1234/SEH/2026" className={`min-w-0 flex-1 ${campo}`} />
              {pidiendo.estado === "aprobado" && (
                <input value={boletin} onChange={(x) => setBoletin(x.target.value)} placeholder="Boletín Oficial (opcional)" className={`w-44 ${campo}`} />
              )}
              <button
                onClick={() => void cambiar(pidiendo.estado, norma, boletin)}
                disabled={ocupado || norma.trim().length < 5 || !/[0-9]/.test(norma)}
                title="La norma tiene que traer su número"
                className="rounded-lg bg-rosa px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
              >
                Confirmar
              </button>
              <button onClick={() => setPidiendo(null)} className="text-[11px] text-texto-3 hover:text-texto">
                cancelar
              </button>
              <p className="w-full text-[10px] text-texto-3">{pidiendo.ayuda}</p>
            </div>
          )}
          {error && <p className="mt-2 text-[11px] text-peligro">{error}</p>}
        </div>
      )}
    </div>
  );
}

function Bitacora({ supabase }: { supabase: SupabaseClient }) {
  const [filas, setFilas] = useState<EntradaBitacora[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void obtenerBitacora(supabase, 150)
      .then(setFilas)
      .catch((e) => setError(e instanceof Error ? e.message : "no pude cargar la bitácora"));
  }, [supabase]);

  const TABLA: Record<string, string> = {
    presupuesto_partidas: "partida",
    politicas_publicas: "política",
    escenarios_presupuesto: "escenario",
    presupuesto_ejercicios: "ejercicio",
    presupuesto_vedas: "veda",
    presupuesto_habilitados: "acceso",
    escenario_ajustes: "ajuste manual",
  };
  const ACCION: Record<string, string> = { INSERT: "alta", UPDATE: "cambio", DELETE: "baja" };

  /** Qué campos cambiaron, en una línea. */
  const cambios = (f: EntradaBitacora) => {
    if (f.accion !== "UPDATE" || !f.antes || !f.despues) return "";
    return Object.keys(f.despues)
      .filter((k) => !["actualizado_en", "actualizado_por"].includes(k))
      .filter((k) => JSON.stringify(f.antes![k]) !== JSON.stringify(f.despues![k]))
      .map((k) => `${k}: ${JSON.stringify(f.antes![k])} → ${JSON.stringify(f.despues![k])}`)
      .join(" · ");
  };
  const nombre = (f: EntradaBitacora) => {
    const r = f.despues ?? f.antes ?? {};
    return String(r.nombre ?? r.codigo ?? r.barrio ?? r.ejercicio ?? f.registro);
  };

  if (error) return <p className="text-[11px] text-peligro">{error}</p>;
  if (!filas) return <p className="text-[11px] text-texto-3">Cargando…</p>;
  return (
    <div className="panel-vidrio max-h-96 overflow-auto rounded-2xl p-3">
      {filas.length === 0 && <p className="text-[11px] text-texto-3">Sin movimientos todavía.</p>}
      {filas.map((f) => (
        <div key={f.id} className="border-b border-borde/60 py-1.5 text-[10.5px] last:border-0">
          <span className="num text-texto-3">{fecha(f.cuando)}</span> · <b>{f.quien_email || "sistema"}</b> ·{" "}
          {ACCION[f.accion] ?? f.accion} de {TABLA[f.tabla] ?? f.tabla} <b>{nombre(f)}</b>
          {cambios(f) && (
            <div className="mt-0.5 truncate text-texto-3" title={cambios(f)}>
              {cambios(f)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Solo el superadmin: quién además de él puede ver y proponer sobre el presupuesto. */
function Accesos({ supabase }: { supabase: SupabaseClient }) {
  const [lista, setLista] = useState<Acceso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = () =>
    obtenerAccesos(supabase)
      .then(setLista)
      .catch((e) => setError(e instanceof Error ? e.message : "no pude cargar los accesos"));
  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const cambiar = async (a: Acceso) => {
    const e = await habilitarAcceso(supabase, a.perfil_id, !a.habilitado);
    if (e) setError(e);
    else await cargar();
  };

  if (error) return <p className="text-[11px] text-peligro">{error}</p>;
  if (!lista) return <p className="text-[11px] text-texto-3">Cargando…</p>;
  return (
    <div className="panel-vidrio rounded-2xl p-3">
      <p className="mb-2 text-[10.5px] leading-snug text-texto-3">
        Tener usuario en el comando no da acceso al presupuesto. Habilitá solo a quien trabaja en la planificación del gasto
        municipal. El superadmin siempre tiene acceso.
      </p>
      {lista.map((a) => (
        <label key={a.perfil_id} className="flex items-center gap-2 border-b border-borde/60 py-1.5 text-[11px] last:border-0">
          <input
            type="checkbox"
            checked={a.habilitado}
            disabled={a.rol === "superadmin"}
            onChange={() => void cambiar(a)}
            className="accent-[#e14f82]"
          />
          <span className="min-w-0 flex-1 truncate">
            <b>{a.nombre}</b> <span className="text-texto-3">{a.email}</span>
          </span>
          <span className="text-[10px] text-texto-3">{a.rol}</span>
        </label>
      ))}
    </div>
  );
}

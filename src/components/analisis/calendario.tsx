"use client";

import { CalendarClock, Check, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fechaDelHito, guardarHito, listarHitos, type HitoCalendario } from "@/lib/analisis-politico";
import { obtenerConfig, guardarConfig, type ConfigDiaD } from "@/lib/diad";
import type { SupabaseClient } from "@supabase/supabase-js";

const ESTADOS: Array<HitoCalendario["estado"]> = ["pendiente", "en curso", "cumplido", "no aplica"];
const CLASE_ESTADO: Record<HitoCalendario["estado"], string> = {
  pendiente: "border-borde-2 text-texto-2",
  "en curso": "border-encurso/50 bg-encurso/10 text-encurso",
  cumplido: "border-completo/50 bg-completo/10 text-completo",
  "no aplica": "border-borde text-texto-3",
};

const fmt = (d: Date) =>
  d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Calendario electoral: los plazos legales contados hacia atrás desde la fecha
 * de la elección, que se toma de la configuración del DÍA D.
 *
 * Cada hito trae la norma que lo respalda y si el plazo está verificado o
 * depende de una resolución de la Junta. Perder una de estas fechas —la
 * inscripción de listas, los acoples— cuesta la elección entera, así que el
 * módulo prioriza decir de dónde sale cada número antes que verse prolijo.
 */
export function Calendario({ supabase }: { supabase: SupabaseClient }) {
  const [hitos, setHitos] = useState<HitoCalendario[] | null>(null);
  const [config, setConfig] = useState<ConfigDiaD | null>(null);
  const [fechaEd, setFechaEd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recargar = useCallback(async () => {
    try {
      const [h, c] = await Promise.all([listarHitos(supabase), obtenerConfig(supabase)]);
      setHitos(h);
      setConfig(c);
      if (c?.fecha) setFechaEd(c.fecha);
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude cargar el calendario");
    }
  }, [supabase]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const guardarFecha = async () => {
    if (!fechaEd) return;
    setOcupado(true);
    const e = await guardarConfig(supabase, { fecha: fechaEd });
    if (e) setError(e);
    else await recargar();
    setOcupado(false);
  };

  const cambiarEstado = async (h: HitoCalendario, estado: HitoCalendario["estado"]) => {
    setOcupado(true);
    const e = await guardarHito(supabase, { ...h, estado });
    if (e) setError(e);
    else await recargar();
    setOcupado(false);
  };

  const hoy = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  const conFechas = useMemo(() => {
    if (!hitos || !config?.fecha) return null;
    return hitos.map((h) => {
      const fecha = fechaDelHito(config.fecha!, h.dias_antes);
      const dias = Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
      return { ...h, fecha, dias };
    });
  }, [hitos, config, hoy]);

  const proximo = useMemo(
    () => conFechas?.filter((h) => h.dias >= 0 && h.estado === "pendiente").sort((a, b) => a.dias - b.dias)[0],
    [conFechas],
  );

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <CalendarClock size={15} className="text-rosa" /> Calendario electoral
        </h2>
        <p className="mt-1 text-[11px] text-texto-2">
          Los plazos legales contados desde el día de la elección. Perder la inscripción de listas o de acoples no
          se arregla después: no hay prórroga.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borde pt-3">
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Fecha de la elección
            <input
              type="date"
              value={fechaEd}
              onChange={(e) => setFechaEd(e.target.value)}
              className="mt-0.5 block rounded-lg border border-borde-2 bg-panel px-2.5 py-1.5 text-xs font-normal outline-none focus:border-rosa/50"
            />
          </label>
          <button
            onClick={() => void guardarFecha()}
            disabled={ocupado || !fechaEd || fechaEd === config?.fecha}
            className="rounded-lg bg-rosa px-3 py-2 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Guardar
          </button>
          <span className="text-[10px] text-texto-3">
            Es la misma fecha que usa el DÍA D. La Junta ya publicó el cronograma 2027: la general provincial es el{" "}
            <b>9 de mayo de 2027</b> (Res. 11/2026).
          </span>
        </div>
      </div>

      {error && <p className="px-1 text-xs text-peligro">{error}</p>}

      {!config?.fecha && (
        <div className="panel-vidrio rounded-2xl border-encurso/40 p-4">
          <p className="text-xs text-encurso">
            Cargá la fecha de la elección para que el calendario calcule cada plazo. Los hitos ya están cargados con
            sus días de anticipación.
          </p>
        </div>
      )}

      {proximo && (
        <div className="panel-vidrio flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border-rosa/40 px-4 py-3 text-xs">
          <span className="font-extrabold text-rosa">Lo próximo</span>
          <span className="font-bold">{proximo.hito}</span>
          <span className="text-texto-2">{fmt(proximo.fecha)}</span>
          <span className={`num font-bold ${proximo.dias <= 15 ? "text-sin" : "text-texto-2"}`}>
            {proximo.dias === 0 ? "es hoy" : `en ${proximo.dias} días`}
          </span>
        </div>
      )}

      {conFechas && (
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead className="text-left text-texto-3">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Plazo</th>
                  <th className="py-1 pr-2 font-semibold">Hito</th>
                  <th className="py-1 pr-2 font-semibold">Fecha</th>
                  <th className="py-1 pr-2 font-semibold">Falta</th>
                  <th className="py-1 pr-2 font-semibold">Norma</th>
                  <th className="py-1 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {conFechas.map((h) => {
                  const pasado = h.dias < 0;
                  const urgente = h.dias >= 0 && h.dias <= 15 && h.estado === "pendiente";
                  return (
                    <tr
                      key={h.id}
                      className={`border-t border-borde/60 ${pasado && h.estado === "pendiente" ? "opacity-70" : ""}`}
                    >
                      <td className="num py-1.5 pr-2 font-bold text-texto-3">
                        T{h.dias_antes >= 0 ? "−" : "+"}
                        {Math.abs(h.dias_antes)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="font-bold">{h.hito}</span>
                        {h.certeza === "a confirmar" && (
                          <span
                            title="El plazo depende de una resolución de la Junta en cada elección"
                            className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-encurso/50 px-1.5 text-[9px] font-bold text-encurso"
                          >
                            <TriangleAlert size={8} /> a confirmar
                          </span>
                        )}
                        {h.notas && <div className="mt-0.5 max-w-96 text-[9.5px] leading-snug text-texto-3">{h.notas}</div>}
                      </td>
                      <td className={`py-1.5 pr-2 whitespace-nowrap ${urgente ? "font-bold text-sin" : ""}`}>
                        {fmt(h.fecha)}
                      </td>
                      <td className={`num py-1.5 pr-2 whitespace-nowrap ${urgente ? "font-bold text-sin" : "text-texto-2"}`}>
                        {h.dias > 0 ? `${h.dias} d` : h.dias === 0 ? "hoy" : `hace ${-h.dias} d`}
                      </td>
                      <td className="max-w-56 py-1.5 pr-2 text-[9.5px] leading-snug text-texto-3">{h.norma}</td>
                      <td className="py-1.5">
                        <div className="flex gap-0.5">
                          {ESTADOS.map((e) => (
                            <button
                              key={e}
                              onClick={() => void cambiarEstado(h, e)}
                              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold transition ${
                                h.estado === e ? CLASE_ESTADO[e] : "border-borde text-texto-3 hover:text-texto"
                              }`}
                            >
                              {e === "cumplido" ? <Check size={9} /> : e}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel-vidrio rounded-2xl border-encurso/40 p-4">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-encurso uppercase">
          <Info size={12} /> De dónde salen estos plazos
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
          Los días son los del <b>cronograma 2027 de la Junta Electoral Provincial</b> (Res. 11/2026), y la columna
          Norma cita el mínimo legal que lo respalda. La ley provincial fija <b>mínimos</b> —60 días para alianzas,
          30 para listas y acoples, 20 para boletas— y la Junta puede adelantarlos por resolución, como hizo con
          las alianzas (T−69 en lugar de T−60).
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-texto-2">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-completo" />
          <span>
            Dos advertencias del relevamiento: la <b>convocatoria no tiene plazo provincial</b> y varió entre T−111
            y T−286, así que queda marcada como a confirmar. Y para <b>fiscales generales</b> el mínimo legal son 24
            horas, pero la Junta siempre exige más (T−5 en 2027): planificá con el cronograma, no con la ley.
          </span>
        </p>
      </div>
    </div>
  );
}

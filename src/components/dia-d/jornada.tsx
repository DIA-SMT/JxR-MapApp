"use client";

import { AlertTriangle, Check, Clock, Plus, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  crearIncidencia,
  guardarAsistencia,
  obtenerAsistencia,
  obtenerIncidencias,
  obtenerParticipacion,
  resolverIncidencia,
  TIPOS_INCIDENCIA,
  type ConfigDiaD,
  type Incidencia,
  type Mesa,
  type ParticipacionCircuito,
} from "@/lib/diad";
import type { SupabaseClient } from "@supabase/supabase-js";

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * Participación en vivo: el fiscal reporta cuánta gente votó en su mesa a cada
 * corte horario y el tablero muestra qué circuitos van flojos. Es el dato que
 * permite traccionar MIENTRAS la elección está abierta.
 */
export function Participacion({
  supabase,
  config,
  mesas,
}: {
  supabase: SupabaseClient;
  config: ConfigDiaD;
  mesas: Mesa[];
}) {
  const cortes = config.cortes?.length ? config.cortes : ["12:00"];
  const [corte, setCorte] = useState(cortes[0]);
  const [filas, setFilas] = useState<ParticipacionCircuito[] | null>(null);
  const [cargadas, setCargadas] = useState<Map<number, number>>(new Map());
  const [mesaTxt, setMesaTxt] = useState("");
  const [votaronTxt, setVotaronTxt] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recargar = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([obtenerParticipacion(supabase, corte), obtenerAsistencia(supabase, corte)]);
      setFilas(p);
      setCargadas(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude cargar la participación");
    }
  }, [supabase, corte]);

  useEffect(() => {
    setFilas(null);
    void recargar();
  }, [recargar]);

  const porMesa = useMemo(() => new Map(mesas.map((m) => [m.mesa, m])), [mesas]);

  const cargar = async () => {
    const n = Number(mesaTxt);
    const v = Number(votaronTxt);
    if (!Number.isInteger(n) || !porMesa.has(n)) {
      setError(`La mesa ${mesaTxt || "(vacía)"} no está en el padrón`);
      return;
    }
    if (!Number.isFinite(v) || v < 0) {
      setError("Poné cuántos votaron");
      return;
    }
    const m = porMesa.get(n)!;
    if (v > m.electores) {
      setError(`La mesa ${n} tiene ${m.electores} electores: no pueden haber votado ${v}`);
      return;
    }
    setOcupado(true);
    setError(null);
    const e = await guardarAsistencia(supabase, n, corte, v);
    if (e) setError(e);
    else {
      setAviso(`Mesa ${n}: ${v} de ${m.electores} a las ${corte}`);
      window.setTimeout(() => setAviso(null), 4000);
      setMesaTxt("");
      setVotaronTxt("");
      await recargar();
    }
    setOcupado(false);
  };

  const totales = useMemo(() => {
    const fs = filas ?? [];
    const votaron = fs.reduce((a, f) => a + Number(f.votaron), 0);
    const electores = fs.reduce((a, f) => a + Number(f.electores_reportados), 0);
    return {
      reportadas: fs.reduce((a, f) => a + Number(f.mesas_reportadas), 0),
      totales: fs.reduce((a, f) => a + Number(f.mesas_totales), 0),
      votaron,
      electores,
      pct: electores > 0 ? (100 * votaron) / electores : null,
    };
  }, [filas]);

  const conDato = (filas ?? []).filter((f) => f.pct != null);
  const promedio = totales.pct;

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
          <Clock size={12} className="text-celeste" /> Corte horario
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cortes.map((c) => (
            <button
              key={c}
              onClick={() => setCorte(c)}
              className={`num rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                corte === c ? "border-rosa bg-rosa/15 text-rosa" : "border-borde-2 text-texto-2 hover:text-texto"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-1.5 border-t border-borde pt-3">
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Mesa
            <input
              value={mesaTxt}
              onChange={(e) => setMesaTxt(e.target.value)}
              placeholder="214"
              inputMode="numeric"
              className="num mt-0.5 block w-20 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs font-normal outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
          </label>
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Votaron
            <input
              value={votaronTxt}
              onChange={(e) => setVotaronTxt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void cargar()}
              placeholder="120"
              inputMode="numeric"
              className="num mt-0.5 block w-24 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs font-normal outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
          </label>
          <button
            onClick={() => void cargar()}
            disabled={ocupado}
            className="flex items-center gap-1 rounded-lg bg-rosa px-3 py-2 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Plus size={12} /> Cargar
          </button>
          {mesaTxt && porMesa.has(Number(mesaTxt)) && (
            <span className="text-[10px] text-texto-3">
              {porMesa.get(Number(mesaTxt))!.escuela} · {numero(porMesa.get(Number(mesaTxt))!.electores)} electores
              {cargadas.has(Number(mesaTxt)) && ` · ya cargada: ${cargadas.get(Number(mesaTxt))}`}
            </span>
          )}
        </div>
        {aviso && <p className="mt-1.5 text-[11px] font-bold text-completo">{aviso} ✓</p>}
        {error && <p className="mt-1.5 text-[11px] text-peligro">{error}</p>}
        <p className="mt-1.5 text-[9px] text-texto-3">
          Re-cargar la misma mesa y corte reemplaza el valor. Los cortes los define el administrador.
        </p>
      </div>

      {/* Resumen del corte */}
      <div className="panel-vidrio flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3 text-xs">
        <span className="flex items-center gap-1.5 font-extrabold">
          <TrendingUp size={13} className="text-rosa" /> {corte}
        </span>
        <span>
          <b className="num">{numero(totales.reportadas)}</b>
          <span className="text-texto-3">/{numero(totales.totales)} mesas reportaron</span>
        </span>
        {totales.pct != null ? (
          <span>
            <b className="num text-rosa">{totales.pct.toFixed(1)}%</b>
            <span className="text-texto-3">
              {" "}
              de participación · {numero(totales.votaron)} de {numero(totales.electores)} electores reportados
            </span>
          </span>
        ) : (
          <span className="text-texto-3">todavía nadie reportó este corte</span>
        )}
      </div>

      {conDato.length > 0 && (
        <div className="panel-vidrio rounded-2xl p-4">
          <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
            Por circuito <span className="font-normal normal-case text-texto-3">· los más flojos abajo</span>
          </h3>
          <div className="mt-2 overflow-auto">
            <table className="w-full min-w-[460px] text-[11px]">
              <thead className="text-left text-texto-3">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Circuito</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Mesas</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Votaron</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Participación</th>
                  <th className="py-1 font-semibold">vs promedio</th>
                </tr>
              </thead>
              <tbody>
                {conDato.map((f) => {
                  const pct = Number(f.pct);
                  const dif = promedio != null ? pct - promedio : 0;
                  const flojo = dif < -3;
                  return (
                    <tr key={f.circuito} className="border-t border-borde/60">
                      <td className="py-1 pr-2 font-semibold">{f.circuito}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">
                        {f.mesas_reportadas}/{f.mesas_totales}
                      </td>
                      <td className="num py-1 pr-2 text-right">{numero(Number(f.votaron))}</td>
                      <td className={`num py-1 pr-2 text-right font-bold ${flojo ? "text-sin" : ""}`}>{pct.toFixed(1)}%</td>
                      <td className="py-1">
                        <span className={`num text-[10px] font-bold ${dif >= 0 ? "text-completo" : "text-sin"}`}>
                          {dif >= 0 ? "+" : ""}
                          {dif.toFixed(1)} pts
                        </span>
                        {flojo && <span className="ml-1 text-[9px] font-bold text-sin">← traccionar</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[9px] text-texto-3">
            El porcentaje se calcula solo sobre las mesas que reportaron, así que es una muestra: sirve para comparar
            circuitos entre sí, no como participación definitiva de la ciudad.
          </p>
        </div>
      )}
    </div>
  );
}

/** Incidencias de la jornada: reportar un problema y resolverlo desde el comando. */
export function Incidencias({ supabase, mesas }: { supabase: SupabaseClient; mesas: Mesa[] }) {
  const [lista, setLista] = useState<Incidencia[] | null>(null);
  const [mesaTxt, setMesaTxt] = useState("");
  const [tipo, setTipo] = useState<string>(TIPOS_INCIDENCIA[0]);
  const [gravedad, setGravedad] = useState<"baja" | "media" | "alta">("media");
  const [detalle, setDetalle] = useState("");
  const [verResueltas, setVerResueltas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const porMesa = useMemo(() => new Map(mesas.map((m) => [m.mesa, m])), [mesas]);

  const recargar = useCallback(async () => {
    try {
      setLista(await obtenerIncidencias(supabase));
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude cargar las incidencias");
    }
  }, [supabase]);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  const crear = async () => {
    if (ocupado) return;
    const n = mesaTxt.trim() === "" ? null : Number(mesaTxt);
    if (n !== null && !porMesa.has(n)) {
      setError(`La mesa ${mesaTxt} no está en el padrón`);
      return;
    }
    if (!detalle.trim()) {
      setError("Contá qué pasó");
      return;
    }
    setOcupado(true);
    setError(null);
    const m = n !== null ? porMesa.get(n)! : null;
    const e = await crearIncidencia(supabase, {
      mesa: n,
      escuela: m?.escuela ?? "",
      circuito: m?.circuito ?? "",
      tipo,
      gravedad,
      detalle,
    });
    if (e) setError(e);
    else {
      setMesaTxt("");
      setDetalle("");
      setGravedad("media");
      await recargar();
    }
    setOcupado(false);
  };

  const alternar = async (i: Incidencia) => {
    setOcupado(true);
    const e = await resolverIncidencia(supabase, i.id, i.estado === "abierta");
    if (e) setError(e);
    else await recargar();
    setOcupado(false);
  };

  const abiertas = (lista ?? []).filter((i) => i.estado === "abierta");
  const resueltas = (lista ?? []).filter((i) => i.estado === "resuelta");
  const orden = { alta: 0, media: 1, baja: 2 } as const;
  const visibles = [...abiertas].sort((a, b) => orden[a.gravedad] - orden[b.gravedad]);
  const colorGravedad = { alta: "border-sin/50 bg-sin/10 text-sin", media: "border-encurso/50 bg-encurso/10 text-encurso", baja: "border-borde-2 text-texto-2" };

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
          <AlertTriangle size={12} className="text-encurso" /> Reportar una incidencia
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <input
            value={mesaTxt}
            onChange={(e) => setMesaTxt(e.target.value)}
            placeholder="Mesa (opcional)"
            inputMode="numeric"
            title="Dejala vacía si el problema es de toda la escuela"
            className="num w-32 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
          />
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="min-w-44 flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none"
          >
            {TIPOS_INCIDENCIA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-borde-2 text-[11px] font-bold">
            {(["baja", "media", "alta"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGravedad(g)}
                className={`px-2.5 py-1.5 transition ${gravedad === g ? colorGravedad[g] : "text-texto-3 hover:text-texto"}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        {mesaTxt && porMesa.has(Number(mesaTxt)) && (
          <p className="mt-1 text-[10px] text-texto-3">
            {porMesa.get(Number(mesaTxt))!.escuela} · Circuito {porMesa.get(Number(mesaTxt))!.circuito}
          </p>
        )}
        <textarea
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          rows={2}
          placeholder="Qué pasó y qué hace falta para resolverlo"
          className="mt-1.5 w-full resize-none rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={() => void crear()}
            disabled={ocupado}
            className="rounded-lg bg-rosa px-3 py-1.5 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Reportar
          </button>
          {error && <span className="text-[10px] text-peligro">{error}</span>}
        </div>
      </div>

      <div className="panel-vidrio rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
            {abiertas.length} abiertas
            {abiertas.some((i) => i.gravedad === "alta") && (
              <span className="ml-2 rounded-full border border-sin/50 bg-sin/10 px-2 py-0.5 text-[9px] text-sin">
                {abiertas.filter((i) => i.gravedad === "alta").length} graves
              </span>
            )}
          </h3>
          {resueltas.length > 0 && (
            <button
              onClick={() => setVerResueltas((v) => !v)}
              className="text-[10px] font-semibold text-rosa hover:underline"
            >
              {verResueltas ? "ocultar" : `ver ${resueltas.length} resueltas`}
            </button>
          )}
        </div>

        {lista === null && <p className="mt-2 text-xs text-texto-2">Cargando…</p>}
        {lista !== null && abiertas.length === 0 && !verResueltas && (
          <p className="mt-2 text-xs text-texto-2">Ninguna incidencia abierta. 👌</p>
        )}

        <div className="mt-2 space-y-1.5">
          {[...visibles, ...(verResueltas ? resueltas : [])].map((i) => (
            <div
              key={i.id}
              className={`rounded-xl border p-2.5 ${i.estado === "resuelta" ? "border-borde bg-panel-2/40 opacity-60" : "border-borde bg-panel-2/70"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${colorGravedad[i.gravedad]}`}>
                  {i.gravedad}
                </span>
                <span className="text-xs font-bold">{i.tipo}</span>
                {i.mesa != null && <span className="num text-[10px] text-texto-3">Mesa {i.mesa}</span>}
                {i.escuela && <span className="min-w-0 flex-1 truncate text-[10px] text-texto-3">{i.escuela}</span>}
                <span className="ml-auto shrink-0 text-[9px] text-texto-3">
                  {new Date(i.creado_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  onClick={() => void alternar(i)}
                  title={i.estado === "abierta" ? "Marcar como resuelta" : "Volver a abrir"}
                  className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                    i.estado === "abierta"
                      ? "border-completo/50 text-completo hover:bg-completo/10"
                      : "border-borde-2 text-texto-3 hover:text-texto"
                  }`}
                >
                  {i.estado === "abierta" ? <Check size={11} /> : "reabrir"}
                </button>
              </div>
              {i.detalle && <p className="mt-1 text-[11px] text-texto-2">{i.detalle}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

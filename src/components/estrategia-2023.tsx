"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  Goal,
  ListFilter,
  MapPin,
  RotateCcw,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIAS_2023,
  esMesaSinEscuela,
  obtenerListas2023,
  obtenerPrioridadEscuelas,
  obtenerVotosPorEscuela2023,
  type Lista2023,
  type PrioridadEscuela,
  type VotosEscuela2023,
} from "@/lib/padron";
import { guardarSeleccionDB, META_VOTOS, presetPeronismoDisperso, resolverSeleccion } from "@/lib/estrategia";
import { descargarCSV } from "@/lib/csv";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

const numero = (n: number) => n.toLocaleString("es-AR");

const TIER_ESTILO: Record<string, string> = {
  A: "border-rosa/60 bg-rosa/15 text-rosa",
  B: "border-rosa/30 bg-rosa/5 text-rosa/80",
  C: "border-borde-2 text-texto-3",
};

/**
 * Estrategia del voto disperso 2023, en dos pestañas:
 *  · Frontera 20K — el motor de prioridad: score por escuela (volumen +
 *    propensión + descubierto de cobertura) y el conjunto mínimo que suma
 *    la meta. Responde "¿dónde actuamos primero?".
 *  · Escuelas por umbral — la mesa de trabajo original (~200 votos/escuela).
 * La meta SIEMPRE se mide en CONCEJAL con la selección de listas del equipo,
 * que ahora vive en la base (compartida entre pantallas, mapa y Elena).
 */
export function Estrategia2023() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [tab, setTab] = useState<"frontera" | "umbral">("frontera");

  // Selección de listas de la categoría activa (la meta usa siempre CONCEJAL)
  const [categoria, setCategoria] = useState<string>("CONCEJAL");
  const [listas, setListas] = useState<Lista2023[]>([]);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [escuelas, setEscuelas] = useState<VotosEscuela2023[]>([]);
  const [universoConcejal, setUniversoConcejal] = useState<VotosEscuela2023[]>([]);
  const [frontera, setFrontera] = useState<PrioridadEscuela[]>([]);
  const [incluidas, setIncluidas] = useState<Map<string, boolean>>(new Map());
  const [verListas, setVerListas] = useState(false);
  const [minVotos, setMinVotos] = useState(100);
  const [maxVotos, setMaxVotos] = useState<number | null>(400);
  const [cargando, setCargando] = useState(true);
  const [recalculando, setRecalculando] = useState(false);

  // Guards contra respuestas fuera de orden (cambios rápidos de categoría/listas)
  const reqCategoria = useRef(0);
  const reqDatos = useRef(0);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
  }, [supabase]);

  const recargarIncluidas = useCallback(async () => {
    const { data } = await supabase.from("estrategia_escuelas").select("escuela, incluida");
    setIncluidas(new Map(((data as Array<{ escuela: string; incluida: boolean }>) ?? []).map((f) => [f.escuela, f.incluida])));
  }, [supabase]);

  // Cambio de categoría: listas + selección resuelta (base → local → preset)
  useEffect(() => {
    const req = ++reqCategoria.current;
    setCargando(true);
    void (async () => {
      const [todas, sel] = await Promise.all([
        obtenerListas2023(supabase, categoria),
        resolverSeleccion(supabase, categoria),
        recargarIncluidas(),
      ]);
      if (reqCategoria.current !== req) return;
      setListas(todas);
      setSeleccion(new Set(sel));
      setCargando(false);
    })();
  }, [supabase, categoria, recargarIncluidas]);

  // Datos: tabla del umbral (categoría activa) + universo/frontera (CONCEJAL)
  useEffect(() => {
    if (cargando) return;
    const req = ++reqDatos.current;
    setRecalculando(true);
    void (async () => {
      const sel = [...seleccion];
      const [filas, filasConcejal] = await Promise.all([
        obtenerVotosPorEscuela2023(supabase, categoria, sel),
        categoria === "CONCEJAL"
          ? Promise.resolve(null)
          : resolverSeleccion(supabase, "CONCEJAL").then((sc) => obtenerVotosPorEscuela2023(supabase, "CONCEJAL", sc)),
      ]);
      if (reqDatos.current !== req) return;
      setEscuelas(filas);
      setUniversoConcejal(filasConcejal ?? filas);
      // Frontera: siempre CONCEJAL con la selección del equipo
      const selConcejal = categoria === "CONCEJAL" ? sel : await resolverSeleccion(supabase, "CONCEJAL");
      const prioridad = await obtenerPrioridadEscuelas(supabase, "CONCEJAL", selConcejal, META_VOTOS);
      if (reqDatos.current !== req) return;
      setFrontera(prioridad);
      setRecalculando(false);
    })();
  }, [supabase, categoria, seleccion, cargando]);

  const alternarLista = (n: number) => {
    setSeleccion((prev) => {
      const nueva = new Set(prev);
      if (nueva.has(n)) nueva.delete(n);
      else nueva.add(n);
      void guardarSeleccionDB(supabase, categoria, [...nueva]);
      return nueva;
    });
  };
  const aplicarPreset = () => {
    const preset = new Set(presetPeronismoDisperso(listas));
    setSeleccion(preset);
    void guardarSeleccionDB(supabase, categoria, [...preset]);
  };

  const alternarEscuela = async (escuela: string) => {
    if (esMesaSinEscuela(escuela)) return; // jamás al universo
    const nuevaIncluida = !(incluidas.get(escuela) ?? false);
    setIncluidas((prev) => new Map(prev).set(escuela, nuevaIncluida));
    setFrontera((prev) => prev.map((f) => (f.escuela === escuela ? { ...f, incluida: nuevaIncluida } : f)));
    const { error } = await supabase.from("estrategia_escuelas").upsert(
      { escuela, incluida: nuevaIncluida, actualizado_por: usuarioId, actualizado_en: new Date().toISOString() },
      { onConflict: "escuela" },
    );
    if (error) {
      setIncluidas((prev) => new Map(prev).set(escuela, !nuevaIncluida));
      setFrontera((prev) => prev.map((f) => (f.escuela === escuela ? { ...f, incluida: !nuevaIncluida } : f)));
    }
  };

  const filtradas = useMemo(
    () =>
      escuelas
        .filter((e) => e.votos >= minVotos && (maxVotos == null || e.votos <= maxVotos))
        .sort((a, b) => b.votos - a.votos),
    [escuelas, minVotos, maxVotos],
  );
  const filtradasReales = useMemo(() => filtradas.filter((e) => !esMesaSinEscuela(e.escuela)), [filtradas]);

  const marcarVisibles = async (valor: boolean) => {
    // solo escuelas REALES: las filas 'Mesa N' no se pueden trabajar
    const objetivo = filtradasReales;
    setIncluidas((prev) => {
      const nueva = new Map(prev);
      for (const e of objetivo) nueva.set(e.escuela, valor);
      return nueva;
    });
    const filas = objetivo.map((e) => ({
      escuela: e.escuela,
      incluida: valor,
      actualizado_por: usuarioId,
      actualizado_en: new Date().toISOString(),
    }));
    for (let i = 0; i < filas.length; i += 100) {
      await supabase.from("estrategia_escuelas").upsert(filas.slice(i, i + 100), { onConflict: "escuela" });
    }
    await recargarIncluidas();
  };

  // Universo: SIEMPRE Concejal, solo escuelas reales incluidas
  const universo = useMemo(() => {
    let votos = 0, n = 0;
    for (const e of universoConcejal) {
      if (!esMesaSinEscuela(e.escuela) && incluidas.get(e.escuela)) {
        votos += Number(e.votos);
        n++;
      }
    }
    return { votos, n };
  }, [universoConcejal, incluidas]);
  const avance = Math.min(100, Math.round((100 * universo.votos) / META_VOTOS));
  const votosVisibles = filtradasReales.reduce((a, e) => a + Number(e.votos), 0);

  // Frontera: métricas de cabecera
  const kpisFrontera = useMemo(() => {
    const enFrontera = frontera.filter((f) => f.en_frontera);
    const huerfanos = frontera.filter((f) => f.referentes === 0).reduce((a, f) => a + Number(f.votos_dispersos), 0);
    return {
      escuelas: enFrontera.length,
      votos: enFrontera.reduce((a, f) => a + Number(f.votos_dispersos), 0),
      huerfanos,
      sinReferente: enFrontera.filter((f) => f.referentes === 0).length,
    };
  }, [frontera]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Goal size={18} className="text-rosa" />
        <h1 className="text-lg font-extrabold">Estrategia · voto disperso 2023</h1>
        <div className="panel-vidrio flex overflow-hidden rounded-xl text-xs font-bold">
          <button
            onClick={() => setTab("frontera")}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition ${tab === "frontera" ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}
          >
            <Crosshair size={12} /> Frontera 20K
          </button>
          <button
            onClick={() => setTab("umbral")}
            className={`px-3 py-1.5 transition ${tab === "umbral" ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}
          >
            Escuelas por umbral
          </button>
        </div>
        {tab === "umbral" && (
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 text-xs font-bold outline-none"
          >
            {CATEGORIAS_2023.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => {
            if (tab === "frontera") {
              descargarCSV(
                "frontera-20k",
                ["Tier", "Escuela", "Circuito", "Votos dispersos", "Positivos", "% disperso", "Electores", "Mesas 2023", "Referentes", "Tareas hechas", "Tareas total", "Score", "Acumulado", "En frontera", "Marcada"],
                frontera.map((f) => [
                  f.tier, f.escuela, f.circuito, f.votos_dispersos, f.positivos, f.pct_disperso,
                  f.electores, f.mesas, f.referentes, f.tareas_hechas, f.tareas_total,
                  f.score, f.acumulado, f.en_frontera, f.incluida,
                ]),
              );
            } else {
              descargarCSV(
                `voto-disperso-${categoria.toLowerCase()}`,
                ["Escuela", "Circuito", "Votos dispersos", "Mesas 2023", "Electores actuales", "Mesa 2023 sin escuela", "Marcada"],
                filtradas.map((e) => [
                  e.escuela, e.circuito, e.votos, e.mesas, e.electores,
                  esMesaSinEscuela(e.escuela), incluidas.get(e.escuela) ?? false,
                ]),
              );
            }
          }}
          title="Descargar la tabla visible como CSV (Excel/Sheets) para seguir procesándola"
          className="ml-auto flex items-center gap-1.5 rounded-xl border border-borde-2 px-3 py-1.5 text-xs font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
        >
          <Download size={13} /> Exportar CSV
        </button>
      </div>

      {/* Meta (siempre Concejal, solo escuelas reales) */}
      <div className={`panel-vidrio rounded-2xl p-4 transition ${recalculando ? "opacity-50" : ""}`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
              Universo construido <span className="normal-case">(se mide en Concejal, solo escuelas reales)</span>
            </div>
            <div className="num text-3xl font-extrabold text-rosa">
              {numero(universo.votos)}
              <span className="ml-1 text-sm font-semibold text-texto-3">/ {numero(META_VOTOS)} votos</span>
            </div>
            <div className="text-[11px] text-texto-2">{universo.n} escuelas marcadas para trabajar</div>
          </div>
          {tab === "umbral" && (
            <div className="text-[11px] text-texto-2 sm:text-right">
              <div>
                Visibles con este umbral: <b className="num text-texto">{filtradasReales.length}</b> escuelas reales ·{" "}
                <b className="num text-texto">{numero(votosVisibles)}</b> votos
                {filtradas.length > filtradasReales.length && (
                  <span className="text-texto-3"> (+{filtradas.length - filtradasReales.length} mesas 2023 sin escuela, no marcables)</span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-end gap-1.5">
                <button
                  onClick={() => void marcarVisibles(true)}
                  className="rounded-lg bg-rosa px-2.5 py-1 text-[10px] font-bold text-white transition hover:brightness-110"
                >
                  Marcar visibles
                </button>
                <button
                  onClick={() => void marcarVisibles(false)}
                  className="rounded-lg border border-borde-2 px-2.5 py-1 text-[10px] font-bold text-texto-2 transition hover:text-texto"
                >
                  Desmarcar visibles
                </button>
              </div>
            </div>
          )}
          {tab === "frontera" && (
            <div className="text-[11px] leading-relaxed text-texto-2 sm:text-right">
              <div>
                Frontera: <b className="num text-texto">{kpisFrontera.escuelas}</b> escuelas suman{" "}
                <b className="num text-texto">{numero(kpisFrontera.votos)}</b> votos
              </div>
              <div>
                <b className="num text-rosa">{numero(kpisFrontera.huerfanos)}</b> votos huérfanos (sin referente en el circuito)
              </div>
              <div className="text-texto-3">{kpisFrontera.sinReferente} escuelas de la frontera sin referente</div>
            </div>
          )}
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-panel-3">
          <div className="h-full rounded-full bg-rosa transition-all" style={{ width: `${avance}%` }} />
        </div>
        <div className="mt-1 text-right text-[10px] text-texto-3">{avance}% de la meta</div>
      </div>

      {/* Selección de listas (compartida con el mapa y Elena vía la base) */}
      <div className="panel-vidrio rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {tab === "umbral" && (
            <>
              <span className="flex items-center gap-1.5 font-bold text-texto-2"><ListFilter size={13} /> Umbral por escuela:</span>
              <label className="flex items-center gap-1.5">
                mín
                <input
                  type="number"
                  value={minVotos}
                  onChange={(e) => setMinVotos(Math.max(0, Number(e.target.value) || 0))}
                  className="num w-20 rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 outline-none focus:border-rosa/50"
                />
              </label>
              <label className="flex items-center gap-1.5">
                máx
                <input
                  type="number"
                  value={maxVotos ?? ""}
                  placeholder="sin tope"
                  onChange={(e) => setMaxVotos(e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))}
                  className="num w-20 rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 outline-none focus:border-rosa/50"
                />
              </label>
              <span className="h-4 w-px bg-borde-2" />
            </>
          )}
          <button
            onClick={() => setVerListas((v) => !v)}
            className="flex items-center gap-1 font-bold text-celeste hover:underline"
          >
            {verListas ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Listas seleccionadas ({categoria}): {seleccion.size} de {listas.length}
          </button>
          <button
            onClick={aplicarPreset}
            title="Volver a la preselección: listas del universo peronista sin banca (excluye los frentes grandes)"
            className="flex items-center gap-1 rounded-lg border border-rosa/40 px-2 py-1 text-[10px] font-bold text-rosa transition hover:border-rosa"
          >
            <RotateCcw size={10} /> Preselección peronismo disperso
          </button>
          <span className="text-[10px] text-texto-3">La selección se guarda en la base: la ven todos y la usa Elena.</span>
        </div>

        {verListas && (
          <div className="mt-3 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {listas.map((l) => {
              const activa = seleccion.has(l.lista_numero);
              return (
                <button
                  key={l.lista_numero}
                  onClick={() => alternarLista(l.lista_numero)}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] transition ${
                    activa ? "border-rosa/50 bg-rosa/10" : "border-borde bg-panel-2/60 hover:border-borde-2"
                  }`}
                >
                  {activa ? <Check size={12} className="shrink-0 text-rosa" /> : <Square size={11} className="shrink-0 text-texto-3" />}
                  <span className="min-w-0 flex-1 truncate" title={`${l.lista_numero} — ${l.lista_nombre}`}>
                    <b className="num">{l.lista_numero}</b> · {l.lista_nombre}
                  </span>
                  <span className="num shrink-0 text-texto-3">{numero(l.votos)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Pestaña Frontera 20K ── */}
      {tab === "frontera" && (
        <div className={`panel-vidrio overflow-x-auto rounded-2xl transition ${recalculando ? "opacity-50" : ""}`}>
          <table className="w-full min-w-[640px] text-left text-xs">
            {/* Encabezado fijo: la tabla llega a 200+ escuelas y sin esto se
                pierde qué columna es cada número al scrollear. */}
            <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
              <tr className="border-b border-borde text-[10px] tracking-wide text-texto-3 uppercase">
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Trabajar</th>
                <th className="px-3 py-2">Escuela</th>
                <th className="px-3 py-2">Circuito</th>
                <th className="px-3 py-2 text-right" title="Votos de las listas seleccionadas (Concejal 2023)">Votos disp.</th>
                <th className="px-3 py-2 text-right" title="Votos dispersos sobre positivos de la escuela: densidad organizativa">Propensión</th>
                <th className="px-3 py-2 text-right" title="Personas asignadas al circuito de la escuela">Referentes</th>
                <th className="px-3 py-2" title="50% volumen + 30% propensión + 20% descubierto de cobertura">Score</th>
                <th className="px-3 py-2 text-right" title="Suma acumulada ordenada por score: dónde se cruza la meta">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={9} className="px-3 py-4 text-texto-3">Calculando prioridad…</td></tr>
              )}
              {!cargando && frontera.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-4 text-texto-3">Sin datos: revisá la selección de listas.</td></tr>
              )}
              {frontera.map((f) => (
                <tr
                  key={f.escuela}
                  className={`border-b border-borde/50 transition hover:bg-panel-3/50 ${f.en_frontera ? "bg-rosa/5" : ""}`}
                >
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${TIER_ESTILO[f.tier]}`}>{f.tier}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => void alternarEscuela(f.escuela)}
                      title={f.incluida ? "Quitar del universo" : "Sumar al universo"}
                      className={`transition ${f.incluida ? "text-rosa" : "text-texto-3 hover:text-texto"}`}
                    >
                      {f.incluida ? <Check size={15} /> : <Square size={13} />}
                    </button>
                  </td>
                  <td className="max-w-80 px-3 py-2 font-semibold">
                    {f.escuela}
                    {f.lat == null && (
                      <span className="ml-1.5 rounded-full border border-borde-2 px-1.5 py-0.5 text-[9px] text-texto-3" title="Sin coordenadas: no se ve como punto en el mapa, pero rankea igual">
                        sin ubicación
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {f.circuito ? (
                      <Link
                        href={`/?tipo=circuito&codigo=${encodeURIComponent(f.circuito)}`}
                        className="flex items-center gap-1 font-semibold text-circuito hover:underline"
                      >
                        <MapPin size={10} /> {f.circuito}
                      </Link>
                    ) : (
                      <span className="text-texto-3">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right font-bold text-rosa">{numero(Number(f.votos_dispersos))}</td>
                  <td className="num px-3 py-2 text-right text-texto-2">
                    {f.pct_disperso != null ? `${f.pct_disperso}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {f.referentes > 0 ? (
                      <span className="num text-texto-2">{f.referentes}</span>
                    ) : (
                      <span className="rounded-full border border-sin/40 bg-sin/10 px-1.5 py-0.5 text-[9px] font-bold text-sin">sin referente</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                        <div className="h-full rounded-full bg-rosa" style={{ width: `${Math.min(100, Number(f.score))}%` }} />
                      </div>
                      <span className="num text-[10px] text-texto-2">{f.score}</span>
                    </div>
                  </td>
                  <td className="num px-3 py-2 text-right text-texto-2">{numero(Number(f.acumulado))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-texto-3">
            La frontera (fondo rosado) es el conjunto mínimo de escuelas que, ordenadas por score, suma los {numero(META_VOTOS)} votos.
            Cobertura medida a nivel circuito (un referente cubre todas las escuelas de su circuito). Solo escuelas reales del padrón vigente.
          </p>
        </div>
      )}

      {/* ── Pestaña Escuelas por umbral ── */}
      {tab === "umbral" && (
        <div className={`panel-vidrio overflow-x-auto rounded-2xl transition ${recalculando ? "opacity-50" : ""}`}>
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-borde text-[10px] tracking-wide text-texto-3 uppercase">
                <th className="px-3 py-2">Trabajar</th>
                <th className="px-3 py-2">Escuela</th>
                <th className="px-3 py-2">Circuito</th>
                <th className="px-3 py-2 text-right">Votos disp.</th>
                <th className="px-3 py-2 text-right" title="Votos 2023 de las listas seleccionadas sobre el padrón ACTUAL de la escuela (aprox: el padrón creció)">% padrón act.</th>
                <th className="px-3 py-2 text-right" title="Mesas de la elección 2023 (no las actuales)">Mesas 23</th>
                <th className="px-3 py-2 text-right" title="Electores del padrón vigente">Electores act.</th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={7} className="px-3 py-4 text-texto-3">Cargando resultados 2023…</td></tr>
              )}
              {!cargando && filtradas.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-texto-3">Ninguna escuela con ese umbral. Ajustá mín/máx o la selección de listas.</td></tr>
              )}
              {filtradas.map((e) => {
                const esMesa = esMesaSinEscuela(e.escuela);
                const marcada = !esMesa && (incluidas.get(e.escuela) ?? false);
                return (
                  <tr key={e.escuela} className={`border-b border-borde/50 transition ${marcada ? "bg-rosa/5" : ""} ${esMesa ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2">
                      {esMesa ? (
                        <Square size={13} className="text-texto-3 opacity-30" />
                      ) : (
                        <button
                          onClick={() => void alternarEscuela(e.escuela)}
                          title={marcada ? "Quitar del universo" : "Sumar al universo"}
                          className={`transition ${marcada ? "text-rosa" : "text-texto-3 hover:text-texto"}`}
                        >
                          {marcada ? <Check size={15} /> : <Square size={13} />}
                        </button>
                      )}
                    </td>
                    <td className="max-w-96 px-3 py-2 font-semibold">
                      {e.escuela}
                      {esMesa && (
                        <span className="ml-1.5 rounded-full border border-borde-2 px-1.5 py-0.5 text-[9px] text-texto-3" title="Mesa 2023 que no existe en el padrón vigente: no se puede trabajar como escuela">
                          mesa 2023 sin escuela actual
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.circuito ? (
                        <Link
                          href={`/?tipo=circuito&codigo=${encodeURIComponent(e.circuito)}`}
                          className="flex items-center gap-1 font-semibold text-circuito hover:underline"
                          title="Ver en el mapa"
                        >
                          <MapPin size={10} /> {e.circuito}
                        </Link>
                      ) : (
                        <span className="text-texto-3">—</span>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right font-bold text-rosa">{numero(Number(e.votos))}</td>
                    <td className="num px-3 py-2 text-right text-texto-2">
                      {e.electores > 0 ? `${((100 * Number(e.votos)) / e.electores).toFixed(1)}%` : "—"}
                    </td>
                    <td className="num px-3 py-2 text-right text-texto-2">{e.mesas}</td>
                    <td className="num px-3 py-2 text-right text-texto-2">{e.electores > 0 ? numero(e.electores) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-texto-3">
        Fuente: escrutinio definitivo 2023 (Junta Electoral, mesa a mesa) cruzado con el padrón
        vigente. Las mesas 2023 sin escuela actual se muestran para no perder votos del análisis,
        pero no integran el universo (no hay escuela donde trabajarlas).
      </p>
    </div>
  );
}

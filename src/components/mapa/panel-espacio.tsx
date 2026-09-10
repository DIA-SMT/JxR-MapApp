"use client";

import { Check, Plus, School, Search, Sparkles, Square, Trash2, UserPlus, Vote, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { etiquetaEspacio } from "@/lib/espacios";
import {
  buscarElectores,
  obtenerPadronDeCircuito,
  obtenerResumen2023Circuito,
  type DetallePadronCircuito,
  type ElectorEncontrado,
  type Resumen2023Circuito,
} from "@/lib/padron";
import {
  armarMesasPeleadas,
  obtenerMesas2025Circuito,
  obtenerRankingCircuito,
  obtenerVotos2025Circuito,
  type FilaRankingEspacio,
  type MesaPeleada,
} from "@/lib/analisis";
import cruceBarrios from "@/lib/datos/barrios-circuitos.json";
import type { ResumenEspacio, useTerritorio } from "@/lib/territorio";
import type { SeleccionEspacio } from "./mapa-electoral";

const BARRIOS_POR_CIRCUITO = (cruceBarrios as unknown as {
  por_circuito: Record<string, Array<{ barrio: string; pct: number }>>;
}).por_circuito;

const numero = (n: number) => n.toLocaleString("es-AR");

const CHIP_ESTADO = {
  sin: { texto: "Sin asignar", clase: "border-sin/40 bg-sin/10 text-sin" },
  en_curso: { texto: "En curso", clase: "border-encurso/40 bg-encurso/10 text-encurso" },
  completo: { texto: "Completo", clase: "border-completo/40 bg-completo/10 text-completo" },
} as const;

/**
 * Panel del espacio seleccionado: quiénes lo tienen asignado y el checklist
 * de tareas de cada asignación. Todas las operaciones son de administradores.
 */
export function PanelEspacio({
  seleccion,
  resumen,
  territorio,
  escuelasUbicadas,
  barrioResaltado,
  onVerBarrio,
  onVerEscuela,
  onCerrar,
}: {
  seleccion: SeleccionEspacio;
  resumen: ResumenEspacio | null;
  territorio: ReturnType<typeof useTerritorio>;
  /** Nombres de escuelas con coordenadas: las que se pueden marcar en el mapa. */
  escuelasUbicadas?: Set<string>;
  barrioResaltado?: string | null;
  onVerBarrio?: (nombre: string) => void;
  onVerEscuela?: (nombre: string) => void;
  onCerrar: () => void;
}) {
  const { supabase, personas, tareas, recargar } = territorio;
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
  }, [supabase]);

  const [personaSel, setPersonaSel] = useState("");
  const [rolAsignacion, setRolAsignacion] = useState("");
  const [nuevaPersona, setNuevaPersona] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoDocumento, setNuevoDocumento] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevaDireccion, setNuevaDireccion] = useState("");
  const [tareaNueva, setTareaNueva] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Padrón del circuito seleccionado (agregados + búsqueda de electores)
  const [padron, setPadron] = useState<DetallePadronCircuito | null>(null);
  const [verEscuelas, setVerEscuelas] = useState(false);
  const [qElector, setQElector] = useState("");
  const [electores, setElectores] = useState<ElectorEncontrado[]>([]);
  const [r2023, setR2023] = useState<Resumen2023Circuito | null>(null);
  const [ver2023, setVer2023] = useState(false);
  // Resultados 2025 (provisorio): ranking del circuito + mesa por mesa
  const [r2025, setR2025] = useState<FilaRankingEspacio[] | null>(null);
  const [tot2025, setTot2025] = useState<{ electores: number; votantes: number; blanco: number } | null>(null);
  const [mesas2025, setMesas2025] = useState<MesaPeleada[] | null>(null);
  const [ver2025, setVer2025] = useState(false);
  const [verMesas25, setVerMesas25] = useState(false);
  const [verBarrios, setVerBarrios] = useState(false);
  useEffect(() => {
    setPadron(null);
    setElectores([]);
    setQElector("");
    setVerEscuelas(false);
    setR2023(null);
    setVer2023(false);
    setR2025(null);
    setTot2025(null);
    setMesas2025(null);
    setVer2025(false);
    setVerMesas25(false);
    setVerBarrios(false);
    if (seleccion.tipo !== "circuito") return;
    const vivo = { actual: true };
    void obtenerPadronDeCircuito(supabase, seleccion.codigo).then((d) => vivo.actual && setPadron(d));
    void obtenerResumen2023Circuito(supabase, seleccion.codigo, "CONCEJAL").then((d) => vivo.actual && setR2023(d));
    void obtenerRankingCircuito(supabase, "2025", seleccion.codigo).then((d) => vivo.actual && setR2025(d));
    void Promise.all([
      obtenerMesas2025Circuito(supabase, seleccion.codigo),
      obtenerVotos2025Circuito(supabase, seleccion.codigo),
    ]).then(([mesas, votos]) => {
      if (!vivo.actual) return;
      setTot2025({
        electores: mesas.reduce((a, m) => a + m.electores, 0),
        votantes: mesas.reduce((a, m) => a + m.total, 0),
        blanco: mesas.reduce((a, m) => a + m.blanco, 0),
      });
      setMesas2025(armarMesasPeleadas(votos, mesas));
    });
    return () => {
      vivo.actual = false;
    };
  }, [supabase, seleccion.tipo, seleccion.codigo]);

  const barriosDelCircuito = seleccion.tipo === "circuito" ? (BARRIOS_POR_CIRCUITO[seleccion.codigo] ?? []) : [];

  // Consultar a Migue sobre ESTE circuito: pregunta libre o sugerencias
  const [qMigue, setQMigue] = useState("");
  const preguntarMigue = (texto: string) => {
    const limpio = texto.trim();
    if (!limpio) return;
    window.dispatchEvent(
      new CustomEvent("jxr:migue-preguntar", {
        detail: `Sobre el circuito ${seleccion.codigo}: ${limpio}`,
      }),
    );
    setQMigue("");
  };
  const SUGERENCIAS_CIRCUITO = [
    "hacé el análisis estratégico completo: 2023, 2025, competitividad, blancos, ausentes y qué acción conviene",
    "¿qué mesas se pierden por pocos votos y cuántos necesito en cada una?",
    "¿cómo evolucionó del 2023 al 2025? ¿crecimos o caímos?",
    "si recuperamos parte de los blancos y ausentes, ¿cuántos votos suman?",
    "¿qué barrios priorizo y con qué estructura (referentes, fiscales)?",
  ];
  useEffect(() => {
    const texto = qElector.trim();
    if (texto.length < 3 || seleccion.tipo !== "circuito") {
      setElectores([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void buscarElectores(supabase, texto, seleccion.codigo, 6).then(setElectores);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [qElector, supabase, seleccion.tipo, seleccion.codigo]);

  const asignaciones = resumen?.asignaciones ?? [];
  const estado = resumen?.estado ?? "sin";
  const chip = CHIP_ESTADO[estado];

  const tareasPorAsignacion = useMemo(() => {
    const mapa = new Map<number, typeof tareas>();
    for (const t of tareas) {
      const lista = mapa.get(t.asignacion_id) ?? [];
      lista.push(t);
      mapa.set(t.asignacion_id, lista);
    }
    return mapa;
  }, [tareas]);

  const personasDisponibles = useMemo(() => {
    const asignadas = new Set(asignaciones.map((a) => a.persona_id));
    return personas.filter((p) => !asignadas.has(p.id));
  }, [personas, asignaciones]);

  const correr = async (fn: () => Promise<{ error: { message: string } | null } | void>) => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fn();
      if (r && r.error) setError(r.error.message);
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const asignar = () =>
    correr(async () => {
      let personaId = Number(personaSel);
      if (nuevaPersona) {
        const nombre = nuevoNombre.trim();
        if (!nombre) return;
        const { data, error } = await supabase
          .from("personas")
          .insert({
            nombre,
            documento: nuevoDocumento.trim() || null,
            telefono: nuevoTelefono.trim() || null,
            direccion: nuevaDireccion.trim() || null,
            creado_por: usuarioId,
          })
          .select("id")
          .single();
        if (error) return { error };
        personaId = data.id;
        setNuevoNombre("");
        setNuevoDocumento("");
        setNuevoTelefono("");
        setNuevaDireccion("");
        setNuevaPersona(false);
      }
      if (!personaId) return;
      const { error } = await supabase.from("asignaciones").insert({
        persona_id: personaId,
        tipo: seleccion.tipo,
        codigo: seleccion.codigo,
        rol_asignacion: rolAsignacion.trim() || null,
        creado_por: usuarioId,
      });
      setPersonaSel("");
      setRolAsignacion("");
      return { error };
    });

  const quitarAsignacion = (id: number) =>
    correr(async () => {
      const { error } = await supabase.from("asignaciones").delete().eq("id", id);
      return { error };
    });

  const agregarTarea = (asignacionId: number) =>
    correr(async () => {
      const titulo = (tareaNueva[asignacionId] ?? "").trim();
      if (!titulo) return;
      const { error } = await supabase
        .from("tareas")
        .insert({ asignacion_id: asignacionId, titulo, creado_por: usuarioId });
      setTareaNueva((t) => ({ ...t, [asignacionId]: "" }));
      return { error };
    });

  const alternarTarea = (id: number, hecha: boolean) =>
    correr(async () => {
      const { error } = await supabase
        .from("tareas")
        .update(
          hecha
            ? { hecha: true, hecha_en: new Date().toISOString(), hecha_por: usuarioId }
            : { hecha: false, hecha_en: null, hecha_por: null },
        )
        .eq("id", id);
      return { error };
    });

  const eliminarTarea = (id: number) =>
    correr(async () => {
      const { error } = await supabase.from("tareas").delete().eq("id", id);
      return { error };
    });

  return (
    // bottom 76px: deja libre el botón flotante de Migue (z-40), que si no tapa el formulario
    <aside className="panel-vidrio absolute top-3 right-3 bottom-[76px] z-20 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-borde bg-panel-2/60 px-4 py-3">
        <div>
          <div className="text-sm font-extrabold">
            {etiquetaEspacio(seleccion.tipo, seleccion.codigo)}
          </div>
          <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${chip.clase}`}>
            {chip.texto}
            {resumen && resumen.tareas.length > 0 && ` · ${resumen.nHechas}/${resumen.tareas.length} tareas`}
          </span>
        </div>
        <button onClick={onCerrar} className="text-texto-3 hover:text-texto">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {/* ── Padrón del circuito ── */}
        {seleccion.tipo === "circuito" && padron && (
          <div className="rounded-xl border border-borde bg-panel-2/70 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
              <Vote size={12} className="text-rosa" /> Padrón del circuito
            </div>
            <div className="num mt-1 text-lg font-extrabold">{numero(padron.total)} <span className="text-xs font-semibold text-texto-2">electores</span></div>
            <div className="mt-0.5 text-[11px] text-texto-2">
              {numero(padron.mujeres)} mujeres · {numero(padron.varones)} varones
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
              <span className="rounded-full border border-borde-2 px-2 py-0.5" title="Franja estimada por rango de DNI">16–25: <b className="num">{numero(padron.franjas_estimadas.e16_25)}</b></span>
              <span className="rounded-full border border-borde-2 px-2 py-0.5">26–40: <b className="num">{numero(padron.franjas_estimadas.e26_40)}</b></span>
              <span className="rounded-full border border-borde-2 px-2 py-0.5">41–60: <b className="num">{numero(padron.franjas_estimadas.e41_60)}</b></span>
              <span className="rounded-full border border-borde-2 px-2 py-0.5">60+: <b className="num">{numero(padron.franjas_estimadas.e60_mas)}</b></span>
            </div>
            <p className="mt-1 text-[9px] text-texto-3">Franjas etarias estimadas por rango de DNI (±3 años)</p>

            <button
              onClick={() => setVerEscuelas((v) => !v)}
              className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-celeste hover:underline"
            >
              <School size={11} /> {padron.escuelas.length} escuelas de votación {verEscuelas ? "▴" : "▾"}
            </button>
            {verEscuelas && (
              <div className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
                {padron.escuelas.map((e) => {
                  const ubicada = escuelasUbicadas ? escuelasUbicadas.has(e.nombre) : true;
                  return (
                    <button
                      key={e.nombre}
                      onClick={() => onVerEscuela?.(e.nombre)}
                      disabled={!onVerEscuela}
                      className="block w-full rounded-lg bg-panel px-2 py-1.5 text-left text-[10px] transition hover:bg-panel-3 disabled:cursor-default"
                      title={ubicada ? "Abrir su ficha y marcarla en el mapa" : "Sin ubicación en el mapa: abre la ficha igual"}
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="shrink-0">{ubicada ? "🏫" : "📋"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{e.nombre}</span>
                          <span className="block text-texto-3">
                            {numero(e.electores)} electores{e.mesas ? ` · ${e.mesas} mesas` : ""}
                            {!ubicada && " · sin ubicación"}
                          </span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Búsqueda de electores dentro del circuito (solo logística) */}
            <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-borde-2 bg-panel px-2 py-1.5">
              <Search size={11} className="shrink-0 text-texto-3" />
              <input
                value={qElector}
                onChange={(e) => setQElector(e.target.value)}
                placeholder="Buscar elector en este circuito…"
                className="w-full bg-transparent text-[11px] outline-none placeholder:text-texto-3"
              />
            </div>
            {electores.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {electores.map((r) => (
                  <div key={`${r.dni}-${r.mesa}`} className="rounded-lg bg-panel px-2 py-1.5 text-[10px]">
                    <div className="font-semibold">{r.apellido_nombre} <span className="text-texto-3">· DNI {r.dni}</span></div>
                    <div className="text-texto-3">
                      {r.mesa ? `Mesa ${r.mesa}${r.orden_mesa ? ` · Orden ${r.orden_mesa}` : ""}` : "sin mesa asignada"}
                      {r.establecimiento ? ` · ${r.establecimiento}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Resultados 2023 del circuito ── */}
        {seleccion.tipo === "circuito" && r2023 && r2023.votos_total > 0 && (
          <div className="rounded-xl border border-borde bg-panel-2/70 p-3">
            <button
              onClick={() => setVer2023((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] font-bold tracking-wide text-texto-2 uppercase"
            >
              <span>Resultados 2023 · Concejal</span>
              <span>{ver2023 ? "▴" : "▾"}</span>
            </button>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
              <span>
                <b className="num text-texto">{numero(r2023.votos_total)}</b>{" "}
                <span className="text-texto-3">votos</span>
              </span>
              {r2023.participacion_pct != null && (
                <span title="Votos 2023 sobre el padrón actual del circuito (aproximado: el padrón creció)">
                  <b className="num text-rosa">{r2023.participacion_pct}%</b>{" "}
                  <span className="text-texto-3">del padrón actual</span>
                </span>
              )}
              <span className="text-texto-3">
                blanco <b className="num text-texto-2">{numero(r2023.blanco)}</b> · nulos{" "}
                <b className="num text-texto-2">{numero(r2023.nulos)}</b>
              </span>
            </div>
            {ver2023 && (
              <div className="mt-2 space-y-1.5">
                {r2023.top_listas.map((l) => {
                  const max = Math.max(1, r2023.top_listas[0]?.votos ?? 1);
                  return (
                    <div key={l.numero} className="text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-texto-2" title={l.nombre}>
                          {l.numero} · {l.nombre}
                        </span>
                        <span className="num shrink-0 font-bold">{numero(l.votos)}</span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel-3">
                        <div className="h-full rounded-full bg-celeste/70" style={{ width: `${Math.max(2, (100 * l.votos) / max)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Resultados 2025 del circuito (provisorio) ── */}
        {seleccion.tipo === "circuito" && r2025 && r2025.length > 0 && (
          <div className="rounded-xl border border-borde bg-panel-2/70 p-3">
            <button
              onClick={() => setVer2025((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] font-bold tracking-wide text-texto-2 uppercase"
            >
              <span>Resultados 2025 · Diputados <span className="font-normal normal-case text-texto-3">(provisorio)</span></span>
              <span>{ver2025 ? "▴" : "▾"}</span>
            </button>

            {/* Competitividad: 1º vs 2º */}
            {(() => {
              const g = r2025[0];
              const s = r2025[1];
              const dif = g && s ? Number(g.votos) - Number(s.votos) : null;
              return (
                <div className="mt-1 space-y-0.5 text-[11px]">
                  <div>
                    <b className="num text-texto">{g?.lista}</b>{" "}
                    <span className="text-texto-3">gana con</span>{" "}
                    <b className="num">{numero(Number(g?.votos ?? 0))}</b>{" "}
                    <span className="text-texto-3">({g?.pct}%)</span>
                  </div>
                  {s && dif != null && (
                    <div className={dif <= 150 ? "font-bold text-sin" : dif <= 500 ? "font-semibold text-encurso" : "text-texto-2"}>
                      +{numero(dif)} sobre {s.lista}
                      {dif <= 150 ? " · ¡circuito en disputa!" : dif <= 500 ? " · competitivo" : ""}
                    </div>
                  )}
                  {tot2025 && (
                    <div className="text-texto-3">
                      participación <b className="num text-texto-2">{tot2025.electores > 0 ? Math.round((100 * tot2025.votantes) / tot2025.electores) : 0}%</b>
                      {" · "}blanco <b className="num text-texto-2">{numero(tot2025.blanco)}</b>
                      {" · "}ausentes <b className="num text-texto-2">{numero(Math.max(0, tot2025.electores - tot2025.votantes))}</b>
                    </div>
                  )}
                </div>
              );
            })()}

            {ver2025 && (
              <div className="mt-2 space-y-1.5">
                {r2025.map((l) => {
                  const max = Math.max(1, Number(r2025[0]?.votos ?? 1));
                  return (
                    <div key={l.lista_id} className="text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-texto-2" title={l.lista}>
                          {l.lista}
                        </span>
                        <span className="num shrink-0 font-bold">
                          {numero(Number(l.votos))} <span className="font-normal text-texto-3">({l.pct}%)</span>
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel-3">
                        <div className="h-full rounded-full bg-rosa/70" style={{ width: `${Math.max(2, (100 * Number(l.votos)) / max)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mesa por mesa: las más peleadas primero */}
            {mesas2025 && mesas2025.length > 0 && (
              <>
                <button
                  onClick={() => setVerMesas25((v) => !v)}
                  className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-celeste hover:underline"
                >
                  {mesas2025.length} mesas · las más peleadas primero {verMesas25 ? "▴" : "▾"}
                </button>
                {verMesas25 && (
                  <div className="mt-1.5 max-h-44 overflow-y-auto">
                    <table className="w-full text-[10px]">
                      <thead className="sticky top-0 bg-panel-2 text-left text-texto-3">
                        <tr>
                          <th className="py-0.5 pr-1 font-semibold">Mesa</th>
                          <th className="py-0.5 pr-1 font-semibold">1º</th>
                          <th className="num py-0.5 pr-1 text-right font-semibold" title="Diferencia entre el 1º y el 2º">Dif.</th>
                          <th className="num py-0.5 pr-1 text-right font-semibold">Blanco</th>
                          <th className="num py-0.5 text-right font-semibold" title="Electores que no fueron a votar">Ausen.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mesas2025.map((m) => (
                          <tr key={m.mesa} className="border-t border-borde/60">
                            <td className="num py-1 pr-1">{m.mesa}</td>
                            <td className="py-1 pr-1" title={`${m.ganador} ${m.votosGanador} vs ${m.segundo ?? "—"} ${m.votosSegundo}`}>
                              {m.ganador} <span className="text-texto-3">vs {m.segundo ?? "—"}</span>
                            </td>
                            <td className={`num py-1 pr-1 text-right ${m.diferencia <= 20 ? "font-bold text-sin" : m.diferencia <= 50 ? "font-semibold text-encurso" : ""}`}>
                              {m.diferencia}
                            </td>
                            <td className="num py-1 pr-1 text-right text-texto-2">{m.blanco}</td>
                            <td className="num py-1 text-right text-texto-2">{m.ausentes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-[9px] text-texto-3">
                      Mesas de la elección nacional 2025: su numeración no es la del padrón provincial.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Barrios que componen el circuito ── */}
        {seleccion.tipo === "circuito" && barriosDelCircuito.length > 0 && (
          <div className="rounded-xl border border-borde bg-panel-2/70 p-3">
            <button
              onClick={() => setVerBarrios((v) => !v)}
              className="flex w-full items-center justify-between text-[11px] font-bold tracking-wide text-texto-2 uppercase"
            >
              <span>{barriosDelCircuito.length} barrios en el circuito</span>
              <span>{verBarrios ? "▴" : "▾"}</span>
            </button>
            {verBarrios && (
              <>
                <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                  {barriosDelCircuito.map((b) => {
                    const activo = barrioResaltado === b.barrio;
                    return (
                      <button
                        key={b.barrio}
                        onClick={() => onVerBarrio?.(b.barrio)}
                        disabled={!onVerBarrio}
                        className={`rounded-full border px-2 py-0.5 text-[10px] transition disabled:cursor-default ${
                          activo
                            ? "border-amarillo bg-amarillo/20 font-bold text-amarillo"
                            : "border-borde-2 text-texto-2 hover:border-amarillo/60 hover:text-texto"
                        }`}
                        title={`${b.pct}% del barrio cae en este circuito · clic para marcarlo en el mapa`}
                      >
                        {b.barrio}
                        {b.pct < 50 ? ` (${b.pct}%)` : ""}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[9px] text-texto-3">
                  Clic en un barrio para marcarlo en el mapa (volvé a tocarlo para quitar la marca).
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Consultarle a Migue sobre este circuito (libre o sugerido) ── */}
        {seleccion.tipo === "circuito" && (
          <div className="rounded-xl border border-rosa/30 bg-rosa/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-rosa uppercase">
              <Sparkles size={12} /> Preguntale a Migue sobre este circuito
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={qMigue}
                onChange={(e) => setQMigue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && preguntarMigue(qMigue)}
                placeholder={`Lo que quieras del ${seleccion.codigo}: mesas, blancos, rivales…`}
                className="min-w-0 flex-1 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50"
              />
              <button
                onClick={() => preguntarMigue(qMigue)}
                disabled={qMigue.trim() === ""}
                className="rounded-lg bg-rosa px-2.5 py-2 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
                title="Migue responde con los datos reales de este circuito"
              >
                <Sparkles size={12} />
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {SUGERENCIAS_CIRCUITO.map((s) => (
                <button
                  key={s}
                  onClick={() => preguntarMigue(s)}
                  className="block w-full rounded-lg border border-borde bg-panel-2/60 px-2 py-1.5 text-left text-[10px] text-texto-2 transition hover:border-rosa/50 hover:text-texto"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {asignaciones.length === 0 && (
          <p className="px-1 text-xs text-texto-2">
            Nadie tiene asignado este espacio todavía. Asigná una persona abajo.
          </p>
        )}

        {asignaciones.map((a) => {
          const suyas = tareasPorAsignacion.get(a.id) ?? [];
          return (
            <div key={a.id} className="rounded-xl border border-borde bg-panel-2/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-bold">{a.personas?.nombre ?? `Persona #${a.persona_id}`}</div>
                  <div className="text-[10px] text-texto-3">
                    {[
                      a.rol_asignacion ?? "responsable",
                      a.personas?.documento ? `DNI ${a.personas.documento}` : null,
                      a.personas?.telefono,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  onClick={() => void quitarAsignacion(a.id)}
                  title="Quitar la asignación (sus tareas se borran)"
                  className="text-texto-3 transition hover:text-peligro"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Checklist */}
              <div className="mt-2 space-y-1">
                {suyas.map((t) => (
                  <div key={t.id} className="group flex items-center gap-2">
                    <button
                      onClick={() => void alternarTarea(t.id, !t.hecha)}
                      className={`shrink-0 transition ${t.hecha ? "text-completo" : "text-texto-3 hover:text-texto"}`}
                      title={t.hecha ? "Marcar como pendiente" : "Marcar como hecha"}
                    >
                      {t.hecha ? <Check size={14} /> : <Square size={13} />}
                    </button>
                    <span className={`flex-1 text-xs ${t.hecha ? "text-texto-3 line-through" : ""}`}>
                      {t.titulo}
                    </span>
                    <button
                      onClick={() => void eliminarTarea(t.id)}
                      className="text-texto-3 opacity-0 transition group-hover:opacity-100 hover:text-peligro"
                      title="Eliminar tarea"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 pt-1">
                  <input
                    value={tareaNueva[a.id] ?? ""}
                    onChange={(e) => setTareaNueva((t) => ({ ...t, [a.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && void agregarTarea(a.id)}
                    placeholder="Nueva tarea del checklist…"
                    className="flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50"
                  />
                  <button
                    onClick={() => void agregarTarea(a.id)}
                    disabled={ocupado}
                    className="rounded-lg bg-rosa p-1.5 text-white transition hover:brightness-110 disabled:opacity-40"
                    title="Agregar tarea"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Asignar persona */}
      <div className="border-t border-borde bg-panel-2/60 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
            Asignar persona
          </span>
          <button
            onClick={() => setNuevaPersona((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-rosa hover:underline"
          >
            <UserPlus size={11} /> {nuevaPersona ? "elegir existente" : "nueva persona"}
          </button>
        </div>

        {nuevaPersona ? (
          <div className="space-y-1.5">
            <input
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre y apellido"
              className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
            <div className="flex gap-1.5">
              <input
                value={nuevoDocumento}
                onChange={(e) => setNuevoDocumento(e.target.value)}
                placeholder="DNI"
                className="w-24 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
              />
              <input
                value={nuevoTelefono}
                onChange={(e) => setNuevoTelefono(e.target.value)}
                placeholder="Teléfono"
                className="flex-1 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
              />
            </div>
            <input
              value={nuevaDireccion}
              onChange={(e) => setNuevaDireccion(e.target.value)}
              placeholder="Dirección (opcional)"
              className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
          </div>
        ) : (
          <select
            value={personaSel}
            onChange={(e) => setPersonaSel(e.target.value)}
            className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none focus:border-rosa/50"
          >
            <option value="">— elegir persona —</option>
            {personasDisponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.documento ? ` · DNI ${p.documento}` : ""}
                {p.telefono ? ` · ${p.telefono}` : ""}
              </option>
            ))}
          </select>
        )}

        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={rolAsignacion}
            onChange={(e) => setRolAsignacion(e.target.value)}
            placeholder="Rol (referente, fiscal…)"
            className="flex-1 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
          />
          <button
            onClick={() => void asignar()}
            disabled={ocupado || (nuevaPersona ? nuevoNombre.trim() === "" : personaSel === "")}
            className="rounded-lg bg-rosa px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Asignar
          </button>
        </div>

        {error && <p className="mt-1.5 text-[10px] text-peligro">{error}</p>}
      </div>
    </aside>
  );
}

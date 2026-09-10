"use client";

import { Building2, ChevronRight, Landmark, MapPin, School, Target, Vote } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { descargarCSV } from "@/lib/csv";
import {
  listarUniversos,
  obtenerUniversoPorLista,
  obtenerUniversoTerritorial,
  type FilaUniverso,
  type FilaUniversoLista,
  type NivelTerritorial,
  type UniversoGuardado,
} from "@/lib/analisis";
import { repartirConFusion, type ListaVotos } from "@/lib/dhondt";

const numero = (n: number) => n.toLocaleString("es-AR");

const NIVELES: Array<{ clave: NivelTerritorial; etiqueta: string; icono: typeof MapPin }> = [
  { clave: "barrio", etiqueta: "Barrio", icono: Building2 },
  { clave: "circuito", etiqueta: "Circuito", icono: MapPin },
  { clave: "escuela", etiqueta: "Escuela", icono: School },
  { clave: "mesa", etiqueta: "Mesa", icono: Vote },
];

/**
 * Análisis territorial de un UNIVERSO de listas: dónde están sus votos, barrio
 * por barrio, circuito por circuito, escuela por escuela y mesa por mesa, con
 * la bolsa de crecimiento (blancos + ausentes) de cada lugar y el desglose de
 * qué lista del universo es fuerte en cada territorio.
 */
export function UniversoTerritorial() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [universos, setUniversos] = useState<UniversoGuardado[]>([]);
  const [universoSel, setUniversoSel] = useState<string>("");
  const [nivel, setNivel] = useState<NivelTerritorial>("barrio");
  const [filas, setFilas] = useState<FilaUniverso[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<FilaUniversoLista[]>([]);
  const [totalPositivos, setTotalPositivos] = useState(0);
  const [listasCiudad, setListasCiudad] = useState<ListaVotos[]>([]);
  const reqRef = useRef(0);

  useEffect(() => {
    void listarUniversos(supabase, "CONCEJAL").then((u) => {
      setUniversos(u);
      if (u.length > 0) setUniversoSel(u[0].nombre);
    });
    // listas de la ciudad: para el % y para simular el reparto de bancas
    void supabase.rpc("listas_2023", { p_categoria: "CONCEJAL" }).then(({ data }) => {
      const filas = (data as Array<{ lista_numero: number; lista_nombre: string; votos: number }>) ?? [];
      setListasCiudad(filas.map((f) => ({ id: f.lista_numero, nombre: f.lista_nombre, votos: Number(f.votos) })));
      setTotalPositivos(filas.reduce((a, f) => a + Number(f.votos), 0));
    });
  }, [supabase]);

  const universo = universos.find((u) => u.nombre === universoSel);
  const listas = useMemo(() => universo?.listas.map((l) => l.numero) ?? [], [universo]);

  const cargar = useCallback(async () => {
    if (listas.length === 0) return;
    const req = ++reqRef.current;
    setCargando(true);
    setError(null);
    setAbierto(null);
    try {
      const r = await obtenerUniversoTerritorial(supabase, { listas, nivel, limite: nivel === "mesa" ? 150 : 400 });
      if (reqRef.current === req) setFilas(r);
    } catch (e) {
      if (reqRef.current === req) setError(e instanceof Error ? e.message : "error");
    } finally {
      if (reqRef.current === req) setCargando(false);
    }
  }, [supabase, listas, nivel]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totalUniverso = useMemo(() => filas.reduce((a, f) => a + Number(f.votos_universo), 0), [filas]);
  const bolsa = useMemo(
    () => filas.reduce((a, f) => a + Number(f.blancos) + Number(f.ausentes), 0),
    [filas],
  );

  // Cuántas bancas daría el universo unificado (D'Hondt, 18 concejales)
  const bancasUnificado = useMemo(() => {
    if (listasCiudad.length === 0 || listas.length < 2) return null;
    const r = repartirConFusion(listasCiudad, listas, "__union__", { bancas: 18 });
    return r.porLista.find((l) => l.nombre === "__union__")?.bancas ?? 0;
  }, [listasCiudad, listas]);

  const abrirDetalle = async (espacio: string) => {
    if (abierto === espacio) {
      setAbierto(null);
      return;
    }
    setAbierto(espacio);
    setDetalle([]);
    try {
      const d = await obtenerUniversoPorLista(supabase, { listas, nivel, codigo: espacio });
      setDetalle(d);
    } catch {
      setDetalle([]);
    }
  };

  const nivelSinBarrio = filas.find((f) => f.espacio === "sin barrio");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Target size={18} className="text-rosa" />
        <h1 className="text-lg font-extrabold">Universo de listas · distribución territorial</h1>
        <select
          value={universoSel}
          onChange={(e) => setUniversoSel(e.target.value)}
          className="rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 text-xs font-bold outline-none"
        >
          {universos.map((u) => (
            <option key={u.nombre} value={u.nombre}>
              {u.nombre} ({u.listas.length} listas)
            </option>
          ))}
        </select>
        <div className="panel-vidrio flex overflow-hidden rounded-xl text-[11px] font-bold">
          {NIVELES.map((n) => (
            <button
              key={n.clave}
              onClick={() => setNivel(n.clave)}
              className={`flex items-center gap-1 px-2.5 py-1.5 transition ${
                nivel === n.clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"
              }`}
            >
              <n.icono size={11} /> {n.etiqueta}
            </button>
          ))}
        </div>
        {filas.length > 0 && (
          <button
            onClick={() =>
              descargarCSV(
                `universo-${universoSel.toLowerCase().replace(/\s+/g, "-")}-por-${nivel}`,
                ["Espacio", "Circuito", "Votos del universo", "Positivos del espacio", "% del espacio", "Electores", "Votantes", "Blancos", "Ausentes", "Participación %", "Listas con votos", "Mesas"],
                filas.map((f) => [f.espacio, f.circuito, f.votos_universo, f.positivos, f.pct_universo, f.electores, f.votantes, f.blancos, f.ausentes, f.participacion_pct, f.listas_con_votos, f.mesas]),
              )
            }
            className="ml-auto rounded-xl border border-borde-2 px-3 py-1.5 text-xs font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
          >
            Exportar CSV
          </button>
        )}
      </div>

      {/* Las listas del universo con su referente */}
      {universo && (
        <div className="panel-vidrio rounded-2xl p-3">
          <div className="mb-1.5 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
            Listas del universo (2023, Concejal)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {universo.listas.map((l) => (
              <span key={l.numero} className="rounded-full border border-borde-2 px-2 py-0.5 text-[10px]">
                <b className="num text-rosa">{l.numero}</b>
                {l.referente ? <span className="text-texto-2"> · {l.referente}</span> : null}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">Votos del universo</div>
          <div className="num text-2xl font-extrabold text-rosa">{numero(totalUniverso)}</div>
          <p className="text-[10px] text-texto-3">
            {totalPositivos > 0 ? `${((100 * totalUniverso) / totalPositivos).toFixed(2)}% de los positivos` : ""}
          </p>
        </div>
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
            <Landmark size={11} /> Bancas si van unidas
          </div>
          <div className="num text-2xl font-extrabold">
            {bancasUnificado ?? "—"}
            <span className="text-sm font-semibold text-texto-3"> de 18</span>
          </div>
          <p className="text-[10px] text-texto-3">hoy, separadas: 0</p>
        </div>
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">
            {nivel === "barrio" ? "Barrios" : nivel === "circuito" ? "Circuitos" : nivel === "escuela" ? "Escuelas" : "Mesas"} con votos
          </div>
          <div className="num text-2xl font-extrabold">{filas.length}</div>
          <p className="text-[10px] text-texto-3">
            {nivel === "mesa" ? "top 150 por votos" : "ordenados por votos del universo"}
          </p>
        </div>
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">Bolsa de crecimiento</div>
          <div className="num text-2xl font-extrabold text-encurso">{numero(bolsa)}</div>
          <p className="text-[10px] text-texto-3">blancos + ausentes en esos territorios</p>
        </div>
      </div>

      {nivel === "barrio" && nivelSinBarrio && (
        <div className="panel-vidrio rounded-2xl border-encurso/40 p-3 text-[11px] text-texto-2">
          <b className="text-encurso">{numero(Number(nivelSinBarrio.votos_universo))} votos</b> quedan en
          &quot;sin barrio&quot;: son mesas cuya escuela todavía no tiene ubicación geográfica confirmada (11 de 128).
          Cuentan en los niveles circuito, escuela y mesa; para el análisis por barrio conviene completar esas
          ubicaciones.
        </div>
      )}

      {error && <p className="px-1 text-xs text-peligro">No se pudo cargar: {error}</p>}
      {cargando && <p className="px-1 text-xs text-texto-3">Calculando…</p>}

      {/* Tabla territorial */}
      {filas.length > 0 && (
        <div className="panel-vidrio overflow-hidden rounded-2xl">
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-2 text-left text-[10px] text-texto-3 uppercase">
                <tr>
                  <th className="px-3 py-2 font-semibold">
                    {nivel === "barrio" ? "Barrio" : nivel === "circuito" ? "Circuito" : nivel === "escuela" ? "Escuela" : "Mesa"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">Votos</th>
                  <th className="px-2 py-2 text-right font-semibold" title="Qué porcentaje de los votos positivos del lugar se llevó el universo">
                    % del lugar
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">Electores</th>
                  <th className="px-2 py-2 text-right font-semibold" title="Participación en 2023">Part.</th>
                  <th className="px-2 py-2 text-right font-semibold">Blancos</th>
                  <th className="px-3 py-2 text-right font-semibold" title="Electores que no fueron a votar">Ausentes</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const esAbierto = abierto === f.espacio;
                  return (
                    <Fragment key={f.espacio}>
                      <tr
                        onClick={() => void abrirDetalle(f.espacio)}
                        className={`cursor-pointer border-t border-borde/60 transition ${esAbierto ? "bg-rosa/10" : "hover:bg-panel-2/60"}`}
                        title="Ver qué lista del universo es fuerte acá"
                      >
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <ChevronRight size={11} className={`shrink-0 text-texto-3 transition ${esAbierto ? "rotate-90" : ""}`} />
                            <span className="font-semibold">{f.espacio}</span>
                            {f.circuito && nivel !== "circuito" && (
                              <Link
                                href={`/?tipo=circuito&codigo=${encodeURIComponent(f.circuito)}`}
                                onClick={(e) => e.stopPropagation()}
                                className="ml-1 text-[9px] text-circuito hover:underline"
                              >
                                circ. {f.circuito}
                              </Link>
                            )}
                          </div>
                        </td>
                        <td className="num px-2 py-1.5 text-right font-bold text-rosa">{numero(Number(f.votos_universo))}</td>
                        <td className="num px-2 py-1.5 text-right text-texto-2">{f.pct_universo}%</td>
                        <td className="num px-2 py-1.5 text-right text-texto-2">{numero(Number(f.electores))}</td>
                        <td className="num px-2 py-1.5 text-right text-texto-2">{f.participacion_pct}%</td>
                        <td className="num px-2 py-1.5 text-right text-texto-2">{numero(Number(f.blancos))}</td>
                        <td className="num px-3 py-1.5 text-right text-texto-2">{numero(Number(f.ausentes))}</td>
                      </tr>
                      {esAbierto && (
                        <tr className="border-t border-borde/60 bg-panel/60">
                          <td colSpan={7} className="px-6 py-2">
                            {detalle.length === 0 ? (
                              <span className="text-[10px] text-texto-3">Cargando desglose…</span>
                            ) : (
                              <div className="space-y-1">
                                <div className="text-[9px] font-bold tracking-wide text-texto-3 uppercase">
                                  Qué lista del universo aporta acá
                                </div>
                                {detalle.map((d) => {
                                  const max = Math.max(1, Number(detalle[0]?.votos ?? 1));
                                  const ref = universo?.listas.find((l) => l.numero === d.lista_numero)?.referente;
                                  return (
                                    <div key={d.lista_numero} className="text-[10px]">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="min-w-0 flex-1 truncate">
                                          <b className="num text-rosa">{d.lista_numero}</b> {d.lista}
                                          {ref ? <span className="text-texto-3"> · {ref}</span> : null}
                                        </span>
                                        <span className="num shrink-0 font-bold">
                                          {numero(Number(d.votos))}{" "}
                                          <span className="font-normal text-texto-3">({d.pct_positivos}%)</span>
                                        </span>
                                      </div>
                                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel-3">
                                        <div className="h-full rounded-full bg-rosa/70" style={{ width: `${Math.max(2, (100 * Number(d.votos)) / max)}%` }} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

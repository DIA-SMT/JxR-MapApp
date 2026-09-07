"use client";

import { Check, ChevronDown, ChevronRight, Goal, ListFilter, MapPin, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CATEGORIAS_2023,
  obtenerListas2023,
  obtenerVotosPorEscuela2023,
  type Lista2023,
  type VotosEscuela2023,
} from "@/lib/padron";
import { guardarSeleccion, leerSeleccion, META_VOTOS, presetPeronismoDisperso } from "@/lib/estrategia";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * Estrategia "voto disperso 2023": identificar, escuela por escuela, dónde las
 * listas chicas del universo peronista sumaron votos (típicamente ~100–400 por
 * escuela) y marcar esas escuelas para trabajarlas con referentes, hasta
 * construir un universo de 20.000 votos. Análisis 100% agregado (escrutinio
 * público); la selección de listas es una decisión del equipo y es editable.
 */
export function Estrategia2023() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string>("CONCEJAL");
  const [listas, setListas] = useState<Lista2023[]>([]);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [escuelas, setEscuelas] = useState<VotosEscuela2023[]>([]);
  const [incluidas, setIncluidas] = useState<Map<string, boolean>>(new Map());
  const [verListas, setVerListas] = useState(false);
  const [minVotos, setMinVotos] = useState(100);
  const [maxVotos, setMaxVotos] = useState<number | null>(400);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
  }, [supabase]);

  const recargarIncluidas = useCallback(async () => {
    const { data } = await supabase.from("estrategia_escuelas").select("escuela, incluida");
    setIncluidas(new Map(((data as Array<{ escuela: string; incluida: boolean }>) ?? []).map((f) => [f.escuela, f.incluida])));
  }, [supabase]);

  // Listas de la categoría + selección persistida (o preset)
  useEffect(() => {
    setCargando(true);
    void (async () => {
      const todas = await obtenerListas2023(supabase, categoria);
      setListas(todas);
      const guardada = leerSeleccion(categoria);
      setSeleccion(new Set(guardada && guardada.length > 0 ? guardada : presetPeronismoDisperso(todas)));
      await recargarIncluidas();
      setCargando(false);
    })();
  }, [supabase, categoria, recargarIncluidas]);

  // Votos por escuela según la selección
  useEffect(() => {
    if (seleccion.size === 0) {
      setEscuelas([]);
      return;
    }
    void obtenerVotosPorEscuela2023(supabase, categoria, [...seleccion]).then(setEscuelas);
  }, [supabase, categoria, seleccion]);

  const alternarLista = (n: number) => {
    setSeleccion((prev) => {
      const nueva = new Set(prev);
      if (nueva.has(n)) nueva.delete(n);
      else nueva.add(n);
      guardarSeleccion(categoria, [...nueva]);
      return nueva;
    });
  };
  const aplicarPreset = () => {
    const preset = new Set(presetPeronismoDisperso(listas));
    setSeleccion(preset);
    guardarSeleccion(categoria, [...preset]);
  };

  const alternarEscuela = async (escuela: string) => {
    const nuevaIncluida = !(incluidas.get(escuela) ?? false);
    setIncluidas((prev) => new Map(prev).set(escuela, nuevaIncluida));
    await supabase.from("estrategia_escuelas").upsert(
      { escuela, incluida: nuevaIncluida, actualizado_por: usuarioId, actualizado_en: new Date().toISOString() },
      { onConflict: "escuela" },
    );
  };

  const filtradas = useMemo(
    () =>
      escuelas
        .filter((e) => e.votos >= minVotos && (maxVotos == null || e.votos <= maxVotos))
        .sort((a, b) => b.votos - a.votos),
    [escuelas, minVotos, maxVotos],
  );

  const marcarVisibles = async (valor: boolean) => {
    setIncluidas((prev) => {
      const nueva = new Map(prev);
      for (const e of filtradas) nueva.set(e.escuela, valor);
      return nueva;
    });
    const filas = filtradas.map((e) => ({
      escuela: e.escuela,
      incluida: valor,
      actualizado_por: usuarioId,
      actualizado_en: new Date().toISOString(),
    }));
    for (let i = 0; i < filas.length; i += 100) {
      await supabase.from("estrategia_escuelas").upsert(filas.slice(i, i + 100), { onConflict: "escuela" });
    }
  };

  // Universo marcado: suma sobre TODAS las escuelas (no solo las visibles)
  const universo = useMemo(() => {
    let votos = 0, n = 0;
    for (const e of escuelas) {
      if (incluidas.get(e.escuela)) {
        votos += e.votos;
        n++;
      }
    }
    return { votos, n };
  }, [escuelas, incluidas]);
  const avance = Math.min(100, Math.round((100 * universo.votos) / META_VOTOS));
  const votosVisibles = filtradas.reduce((a, e) => a + e.votos, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Goal size={18} className="text-rosa" />
        <h1 className="text-lg font-extrabold">Estrategia · voto disperso 2023</h1>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 text-xs font-bold outline-none"
        >
          {CATEGORIAS_2023.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-texto-2">
        Voto peronista disperso del escrutinio 2023: elegí las listas (abajo hay una preselección
        editable de listas sin banca), ajustá el umbral por escuela (~200 votos los moviliza un
        referente con presencia territorial) y marcá escuelas para sumarlas al universo hasta llegar
        a los {numero(META_VOTOS)} votos. Todo el análisis es agregado por escuela: acá no hay datos
        de voto individual (el voto es secreto).
      </p>

      {/* Meta */}
      <div className="panel-vidrio rounded-2xl p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Universo construido</div>
            <div className="num text-3xl font-extrabold text-rosa">
              {numero(universo.votos)}
              <span className="ml-1 text-sm font-semibold text-texto-3">/ {numero(META_VOTOS)} votos</span>
            </div>
            <div className="text-[11px] text-texto-2">{universo.n} escuelas marcadas para trabajar</div>
          </div>
          <div className="text-right text-[11px] text-texto-2">
            <div>
              Visibles con este umbral: <b className="num text-texto">{filtradas.length}</b> escuelas ·{" "}
              <b className="num text-texto">{numero(votosVisibles)}</b> votos
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
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-panel-3">
          <div className="h-full rounded-full bg-rosa transition-all" style={{ width: `${avance}%` }} />
        </div>
        <div className="mt-1 text-right text-[10px] text-texto-3">{avance}% de la meta</div>
      </div>

      {/* Umbral + listas */}
      <div className="panel-vidrio rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
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
          <button
            onClick={() => setVerListas((v) => !v)}
            className="flex items-center gap-1 font-bold text-celeste hover:underline"
          >
            {verListas ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Listas seleccionadas: {seleccion.size} de {listas.length}
          </button>
          <button
            onClick={aplicarPreset}
            title="Volver a la preselección: listas del universo peronista sin banca (excluye los frentes grandes)"
            className="flex items-center gap-1 rounded-lg border border-rosa/40 px-2 py-1 text-[10px] font-bold text-rosa transition hover:border-rosa"
          >
            <RotateCcw size={10} /> Preselección peronismo disperso
          </button>
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

      {/* Tabla de escuelas */}
      <div className="panel-vidrio overflow-x-auto rounded-2xl">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-borde text-[10px] tracking-wide text-texto-3 uppercase">
              <th className="px-3 py-2">Trabajar</th>
              <th className="px-3 py-2">Escuela</th>
              <th className="px-3 py-2">Circuito</th>
              <th className="px-3 py-2 text-right">Votos disp.</th>
              <th className="px-3 py-2 text-right">% padrón</th>
              <th className="px-3 py-2 text-right">Mesas</th>
              <th className="px-3 py-2 text-right">Electores</th>
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
              const marcada = incluidas.get(e.escuela) ?? false;
              return (
                <tr key={e.escuela} className={`border-b border-borde/50 transition ${marcada ? "bg-rosa/5" : ""}`}>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => void alternarEscuela(e.escuela)}
                      title={marcada ? "Quitar del universo" : "Sumar al universo"}
                      className={`transition ${marcada ? "text-rosa" : "text-texto-3 hover:text-texto"}`}
                    >
                      {marcada ? <Check size={15} /> : <Square size={13} />}
                    </button>
                  </td>
                  <td className="max-w-96 px-3 py-2 font-semibold">{e.escuela}</td>
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
                  <td className="num px-3 py-2 text-right font-bold text-rosa">{numero(e.votos)}</td>
                  <td className="num px-3 py-2 text-right text-texto-2">
                    {e.electores > 0 ? `${((100 * e.votos) / e.electores).toFixed(1)}%` : "—"}
                  </td>
                  <td className="num px-3 py-2 text-right text-texto-2">{e.mesas}</td>
                  <td className="num px-3 py-2 text-right text-texto-2">{e.electores > 0 ? numero(e.electores) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-texto-3">
        Fuente: escrutinio definitivo 2023 (Junta Electoral Provincial, mesa a mesa) cruzado con el
        padrón vigente (mesa → escuela, 100% de coincidencia de circuitos). Las filas &quot;Mesa N&quot;
        corresponden a mesas 2023 que ya no existen en el padrón actual.
      </p>
    </div>
  );
}

"use client";

import { Check, Goal, MapPin, School, Square, Table2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { resolverSeleccion } from "@/lib/estrategia";
import {
  obtenerMesasDeEscuela,
  obtenerVotosDeEscuela2023,
  type Escuela,
  type Lista2023,
  type MesaDeEscuela,
} from "@/lib/padron";
import type { SupabaseClient } from "@supabase/supabase-js";

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * Panel interactivo de una escuela de votación: padrón, resultados 2023
 * (ranking de listas + voto disperso según la selección de Estrategia) y
 * alta directa al universo de la estrategia — sin salir del mapa.
 */
export function PanelEscuela({
  supabase,
  escuela,
  usuarioId,
  onVerCircuito,
  onCambioEstrategia,
  onCerrar,
}: {
  supabase: SupabaseClient;
  escuela: Escuela;
  usuarioId: string | null;
  onVerCircuito: (circuito: string) => void;
  onCambioEstrategia?: (escuela: string, incluida: boolean) => void;
  onCerrar: () => void;
}) {
  const [listas, setListas] = useState<Lista2023[]>([]);
  const [seleccionDispersa, setSeleccionDispersa] = useState<Set<number>>(new Set());
  const [enEstrategia, setEnEstrategia] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [mesas, setMesas] = useState<MesaDeEscuela[] | null>(null);
  const [verMesas, setVerMesas] = useState(false);

  useEffect(() => {
    // reset TOTAL al cambiar de escuela: nada del estado anterior puede
    // mostrarse (ni escribirse) bajo el nombre de la nueva
    setCargando(true);
    setListas([]);
    setEnEstrategia(false);
    setSeleccionDispersa(new Set());
    setMesas(null);
    setVerMesas(false);
    let vivo = true;
    void (async () => {
      const [ranking, marcada, sel] = await Promise.all([
        obtenerVotosDeEscuela2023(supabase, escuela.nombre, "CONCEJAL"),
        supabase.from("estrategia_escuelas").select("incluida").eq("escuela", escuela.nombre).maybeSingle(),
        resolverSeleccion(supabase, "CONCEJAL"),
      ]);
      if (!vivo) return; // respuesta de una escuela que ya no está seleccionada
      setListas(ranking);
      setEnEstrategia(Boolean((marcada.data as { incluida?: boolean } | null)?.incluida));
      setSeleccionDispersa(new Set(sel));
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, escuela.nombre]);

  const votosDispersos = useMemo(
    () => listas.filter((l) => seleccionDispersa.has(l.lista_numero)).reduce((a, l) => a + l.votos, 0),
    [listas, seleccionDispersa],
  );
  const maxVotos = Math.max(1, ...listas.map((l) => l.votos));

  const alternarEstrategia = async () => {
    if (cargando) return; // sin estado confirmado no se escribe nada
    const nuevo = !enEstrategia;
    setEnEstrategia(nuevo);
    onCambioEstrategia?.(escuela.nombre, nuevo);
    const { error } = await supabase.from("estrategia_escuelas").upsert(
      { escuela: escuela.nombre, incluida: nuevo, actualizado_por: usuarioId, actualizado_en: new Date().toISOString() },
      { onConflict: "escuela" },
    );
    if (error) {
      // revertir: la UI nunca debe quedar distinta de la base
      setEnEstrategia(!nuevo);
      onCambioEstrategia?.(escuela.nombre, !nuevo);
    }
  };

  const abrirMesas = async () => {
    setVerMesas((v) => !v);
    if (mesas === null) {
      setMesas(await obtenerMesasDeEscuela(supabase, escuela.nombre, "CONCEJAL"));
    }
  };

  return (
    <aside className="panel-vidrio absolute top-3 right-3 bottom-[76px] z-20 flex w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-start justify-between gap-2 border-b border-borde bg-panel-2/60 px-4 py-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
            <School size={11} className="text-celeste" /> Escuela de votación
          </div>
          <div className="mt-0.5 text-[13px] leading-snug font-extrabold">{escuela.nombre}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-texto-2">
            <span className="num font-bold text-texto">{numero(escuela.electores)}</span> electores
            {escuela.mesas ? <span>· {escuela.mesas} mesas</span> : null}
            {escuela.circuito && (
              <button
                onClick={() => onVerCircuito(escuela.circuito as string)}
                className="flex items-center gap-0.5 font-bold text-circuito hover:underline"
              >
                <MapPin size={9} /> Circuito {escuela.circuito}
              </button>
            )}
          </div>
        </div>
        <button onClick={onCerrar} className="text-texto-3 hover:text-texto">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {/* Voto disperso en esta escuela */}
        <div className={`rounded-xl border p-3 ${enEstrategia ? "border-rosa/50 bg-rosa/10" : "border-borde bg-panel-2/70"}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">Voto disperso 2023 (Concejal)</div>
              <div className="num text-xl font-extrabold text-rosa">{numero(votosDispersos)}</div>
              <div className="text-[10px] text-texto-3">según la selección de listas de Estrategia</div>
            </div>
            <button
              onClick={() => void alternarEstrategia()}
              disabled={cargando}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition disabled:opacity-40 ${
                enEstrategia
                  ? "bg-rosa text-white hover:brightness-110"
                  : "border border-rosa/40 text-rosa hover:border-rosa"
              }`}
              title={enEstrategia ? "Quitar del universo de la estrategia" : "Sumar al universo de la estrategia"}
            >
              <Goal size={12} /> {enEstrategia ? "En estrategia ✓" : "Sumar a estrategia"}
            </button>
          </div>
        </div>

        {/* Mesa por mesa */}
        <div className="rounded-xl border border-borde bg-panel-2/70 p-3">
          <button
            onClick={() => void abrirMesas()}
            className="flex w-full items-center justify-between text-[10px] font-bold tracking-wide text-texto-2 uppercase"
          >
            <span className="flex items-center gap-1.5">
              <Table2 size={11} /> Mesa por mesa
            </span>
            <span>{verMesas ? "▴" : "▾"}</span>
          </button>
          {verMesas && (
            <div className="mt-2 overflow-x-auto">
              {mesas === null && <p className="text-[11px] text-texto-3">Cargando…</p>}
              {mesas !== null && mesas.length === 0 && (
                <p className="text-[11px] text-texto-3">Esta escuela no tiene mesas en el padrón vigente.</p>
              )}
              {mesas !== null && mesas.length > 0 && (
                <>
                  <table className="w-full text-left text-[10px]">
                    <thead>
                      <tr className="border-b border-borde text-texto-3">
                        <th className="py-1 pr-2">Mesa</th>
                        <th className="py-1 pr-2 text-right">Electores</th>
                        <th className="py-1 pr-2 text-right">Votos 23</th>
                        <th className="py-1 pr-2 text-right" title="Votos 2023 sobre electores actuales de la mesa (aprox)">Part.%</th>
                        <th className="py-1 text-right">Bl/Nu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesas.map((m) => (
                        <tr key={m.mesa} className="border-b border-borde/40">
                          <td className="num py-1 pr-2 font-bold">{m.mesa}</td>
                          <td className="num py-1 pr-2 text-right">{numero(m.electores)}</td>
                          <td className="num py-1 pr-2 text-right">{m.votos_2023 != null ? numero(m.votos_2023) : "—"}</td>
                          <td className="num py-1 pr-2 text-right">{m.participacion_pct != null ? `${m.participacion_pct}%` : "—"}</td>
                          <td className="num py-1 text-right text-texto-3">
                            {m.blanco_2023 != null ? `${m.blanco_2023}/${m.nulos_2023}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-[9px] text-texto-3">
                    Part.% = votos Concejal 2023 sobre los electores ACTUALES de la mesa (aprox: el padrón creció).
                    Las mesas sin datos 2023 son nuevas.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Ranking de listas 2023 en esta escuela */}
        <div className="rounded-xl border border-borde bg-panel-2/70 p-3">
          <div className="mb-2 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
            Resultados 2023 en esta escuela · Concejal
          </div>
          {cargando && <p className="text-[11px] text-texto-3">Cargando…</p>}
          {!cargando && listas.length === 0 && (
            <p className="text-[11px] text-texto-3">Sin cruce con mesas 2023 (la numeración de sus mesas cambió).</p>
          )}
          <div className="space-y-1.5">
            {listas.slice(0, 12).map((l) => {
              const dispersa = seleccionDispersa.has(l.lista_numero);
              return (
                <div key={l.lista_numero} className="text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`min-w-0 flex-1 truncate ${dispersa ? "font-bold text-rosa" : "text-texto-2"}`} title={l.lista_nombre}>
                      {dispersa ? <Check size={9} className="mr-0.5 inline" /> : <Square size={8} className="mr-0.5 inline opacity-40" />}
                      {l.lista_numero} · {l.lista_nombre}
                    </span>
                    <span className="num shrink-0 font-bold">{numero(l.votos)}</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel-3">
                    <div
                      className={`h-full rounded-full ${dispersa ? "bg-rosa" : "bg-celeste/60"}`}
                      style={{ width: `${Math.max(2, (100 * l.votos) / maxVotos)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {listas.length > 0 && (
            <p className="mt-2 text-[9px] text-texto-3">
              Las listas marcadas en rosa integran la selección de voto disperso (editable en Estrategia).
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

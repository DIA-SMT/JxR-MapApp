"use client";

import { IdCard, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buscarElectores, type ElectorEncontrado } from "@/lib/padron";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "¿Dónde vota?" — soporte al elector: busca por apellido/nombre o DNI en el
 * padrón y muestra escuela, mesa y orden; al elegir, el mapa encuadra su
 * circuito. Solo logística electoral.
 */
export function BuscadorElectores({
  supabase,
  onIrACircuito,
}: {
  supabase: SupabaseClient;
  onIrACircuito: (circuito: string) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ElectorEncontrado[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<ElectorEncontrado | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const texto = q.trim();
    if (texto.length < 3) {
      setResultados([]);
      setAbierto(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      setBuscando(true);
      try {
        const filas = await buscarElectores(supabase, texto, null, 8);
        setResultados(filas);
        setAbierto(true);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [q, supabase]);

  const elegir = (e: ElectorEncontrado) => {
    setElegido(e);
    setAbierto(false);
    setQ("");
    if (e.circuito) onIrACircuito(e.circuito);
  };

  return (
    <div className="pointer-events-auto relative">
      <div className="panel-vidrio flex items-center gap-2 rounded-xl px-3 py-2">
        <Search size={13} className="shrink-0 text-texto-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="¿Dónde vota? Apellido o DNI…"
          className="w-52 bg-transparent text-xs outline-none placeholder:text-texto-3"
        />
        {buscando && <span className="h-2 w-2 animate-pulse rounded-full bg-rosa" />}
      </div>

      {abierto && (
        <div className="panel-vidrio absolute top-full left-0 z-30 mt-1 max-h-80 w-[340px] overflow-y-auto rounded-xl p-1.5">
          {resultados.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-texto-3">Sin coincidencias en el padrón de la Capital.</p>
          )}
          {resultados.map((r) => (
            <button
              key={`${r.dni}-${r.mesa}`}
              onClick={() => elegir(r)}
              className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-3"
            >
              <div className="text-[12px] font-bold">{r.apellido_nombre}</div>
              <div className="text-[10px] text-texto-3">
                DNI {r.dni} · Circuito {r.circuito ?? "?"} · {r.mesa ? `Mesa ${r.mesa}${r.orden_mesa ? ` · Orden ${r.orden_mesa}` : ""}` : "sin mesa asignada"}
              </div>
              {r.establecimiento && <div className="text-[10px] text-celeste">{r.establecimiento}</div>}
            </button>
          ))}
        </div>
      )}

      {elegido && (
        <div className="panel-vidrio absolute top-full left-0 z-30 mt-1 w-[340px] rounded-xl p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-[12px] font-bold">
                <IdCard size={12} className="text-rosa" /> {elegido.apellido_nombre}
              </div>
              <div className="mt-0.5 text-[10px] text-texto-2">DNI {elegido.dni} · {elegido.domicilio ?? "sin domicilio"}</div>
              <div className="mt-1.5 rounded-lg border border-rosa/30 bg-rosa/10 px-2 py-1.5 text-[11px]">
                <div className="flex items-center gap-1 font-bold text-rosa">
                  <MapPin size={11} /> Circuito {elegido.circuito ?? "?"}
                  {elegido.mesa ? ` · Mesa ${elegido.mesa}` : " · sin mesa asignada"}
                  {elegido.orden_mesa ? ` · Orden ${elegido.orden_mesa}` : ""}
                </div>
                {elegido.establecimiento && <div className="mt-0.5 text-texto">{elegido.establecimiento}</div>}
              </div>
            </div>
            <button onClick={() => setElegido(null)} className="text-texto-3 hover:text-texto">
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

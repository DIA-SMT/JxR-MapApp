"use client";

import { IdCard, MapPin, Mic, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CODIGOS, esEspacioValido, etiquetaEspacio } from "@/lib/espacios";
import { buscarElectores, type ElectorEncontrado, type Escuela } from "@/lib/padron";
import type { TipoEspacio } from "@/lib/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Acción estructurada que la búsqueda le pide al mapa. */
export type AccionInteligente =
  | { accion: "ir_espacio"; tipo: TipoEspacio; codigo: string }
  | { accion: "vista"; vista: "operativo" | "padron" | "escuelas" | "v2023" | "prioridad" }
  | { accion: "filtros_padron"; sexo?: "F" | "M" | "todos"; franja?: string }
  | { accion: "escuelas_min"; minimo: number }
  | { accion: "escuela"; nombre: string };

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

interface ReconocedorVoz {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

/**
 * Búsqueda inteligente del mapa (texto o voz):
 *  · nombres/DNI → resultados del padrón en vivo (dónde vota)
 *  · frases ("mujeres de 16 a 25", "voto disperso", "escuelas grandes",
 *    "llevame al 15B") → la IA las convierte en una acción del mapa
 */
export function BusquedaInteligente({
  supabase,
  escuelas,
  onAccion,
  onAviso,
}: {
  supabase: SupabaseClient;
  escuelas: Escuela[];
  onAccion: (a: AccionInteligente) => void;
  onAviso: (texto: string) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<ElectorEncontrado[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [hayVoz, setHayVoz] = useState(false);
  const [elegido, setElegido] = useState<ElectorEncontrado | null>(null);
  const timerRef = useRef<number | null>(null);
  const vozRef = useRef<ReconocedorVoz | null>(null);

  // Reconocimiento de voz (Chrome/Edge): es-AR
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => ReconocedorVoz; webkitSpeechRecognition?: new () => ReconocedorVoz };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    setHayVoz(true);
    const rec = new Ctor();
    rec.lang = "es-AR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const frase = e.results[0]?.[0]?.transcript ?? "";
      if (frase.trim()) {
        setQ(frase);
        void interpretarRef.current(frase);
      }
    };
    rec.onend = () => setEscuchando(false);
    rec.onerror = () => setEscuchando(false);
    vozRef.current = rec;
  }, []);

  const dictar = () => {
    if (!vozRef.current) return;
    if (escuchando) {
      vozRef.current.stop();
      setEscuchando(false);
      return;
    }
    setElegido(null);
    setAbierto(false);
    setEscuchando(true);
    try {
      vozRef.current.start();
    } catch {
      setEscuchando(false);
    }
  };

  // Búsqueda en vivo de electores mientras se escribe
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const texto = q.trim();
    if (texto.length < 3 || interpretando) {
      setResultados([]);
      setAbierto(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      setBuscando(true);
      try {
        const filas = await buscarElectores(supabase, texto, null, 8);
        setResultados(filas);
        setAbierto(filas.length > 0);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [q, supabase, interpretando]);

  /** Enter/✨/voz: primero atajos locales, después la IA. */
  const interpretar = async (fraseCruda?: string) => {
    const frase = (fraseCruda ?? q).trim();
    if (frase.length < 2 || interpretando) return;
    setElegido(null);

    // Atajo local: "15B", "circuito 20", "distrito 7" sin pasar por la IA
    const m = frase.match(/^(?:(distrito|circuito)\s+)?(\d{1,2}\s?[a-gA-G]?)$/i);
    if (m) {
      const codigo = m[2].toUpperCase().replace(/\s+/g, "");
      const tipo: TipoEspacio = (m[1]?.toLowerCase() as TipoEspacio) ?? "circuito";
      if (esEspacioValido(tipo, codigo)) {
        setAbierto(false);
        setQ("");
        onAccion({ accion: "ir_espacio", tipo, codigo });
        onAviso(`${tipo === "distrito" ? "Distrito" : "Circuito"} ${codigo}`);
        return;
      }
    }

    setInterpretando(true);
    setAbierto(false);
    try {
      const res = await fetch("/api/interpretar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frase }),
      });
      const a = (await res.json()) as Record<string, unknown>;
      switch (a.accion) {
        case "ir_espacio":
          onAccion({ accion: "ir_espacio", tipo: a.tipo as TipoEspacio, codigo: String(a.codigo) });
          onAviso(`${a.tipo === "distrito" ? "Distrito" : "Circuito"} ${a.codigo}`);
          setQ("");
          break;
        case "vista": {
          const vista = String(a.vista) as "operativo" | "padron" | "escuelas" | "v2023" | "prioridad";
          onAccion({ accion: "vista", vista });
          onAviso(`Vista ${vista === "v2023" ? "2023" : vista}`);
          setQ("");
          break;
        }
        case "filtros_padron":
          onAccion({
            accion: "filtros_padron",
            sexo: a.sexo as "F" | "M" | "todos" | undefined,
            franja: a.franja as string | undefined,
          });
          onAviso("Padrón microsegmentado");
          setQ("");
          break;
        case "escuelas_min": {
          const minimo = Math.max(0, Number(a.minimo) || 0);
          onAccion({ accion: "escuelas_min", minimo });
          onAviso(`Escuelas con ≥ ${minimo.toLocaleString("es-AR")} electores`);
          setQ("");
          break;
        }
        case "donde_vota": {
          const texto = String(a.texto ?? "").trim();
          if (texto) {
            setQ(texto);
            const filas = await buscarElectores(supabase, texto, null, 8);
            setResultados(filas);
            setAbierto(true);
            if (filas.length === 0) onAviso("No aparece en el padrón de la Capital");
          }
          break;
        }
        default:
          onAviso("No entendí la búsqueda: probá con un circuito, una persona o un filtro");
      }
    } catch {
      onAviso("La búsqueda inteligente no está disponible");
    } finally {
      setInterpretando(false);
    }
  };
  const interpretarRef = useRef(interpretar);
  interpretarRef.current = interpretar;

  const elegir = (e: ElectorEncontrado) => {
    setElegido(e);
    setAbierto(false);
    setQ("");
    if (e.circuito) onAccion({ accion: "ir_espacio", tipo: "circuito", codigo: e.circuito });
  };

  // ── Sugerencias instantáneas (sin red): espacios y escuelas ──
  // "15" → Circuito 15/15A/15B… + Distrito 15; "circuito 18" acota el tipo
  const sugEspacios = useMemo(() => {
    const m = q.trim().match(/^(?:(distrito|circuito)s?\s+)?(\d{1,2}\s?[a-gA-G]?)$/i);
    if (!m || interpretando) return [];
    const parcial = m[2].toUpperCase().replace(/\s+/g, "");
    const tipoPedido = m[1]?.toLowerCase() as TipoEspacio | undefined;
    const filas: Array<{ tipo: TipoEspacio; codigo: string }> = [];
    for (const tipo of ["circuito", "distrito"] as const) {
      if (tipoPedido && tipo !== tipoPedido) continue;
      for (const codigo of CODIGOS[tipo]) {
        if (codigo.startsWith(parcial)) filas.push({ tipo, codigo });
      }
    }
    return filas.slice(0, 8);
  }, [q, interpretando]);

  // Escuelas por nombre (todas las palabras deben aparecer, sin acentos)
  const sugEscuelas = useMemo(() => {
    const texto = normalizar(q.trim());
    if (texto.length < 3 || /^\d+$/.test(texto) || interpretando) return [];
    const tokens = texto.split(/\s+/);
    return escuelas.filter((e) => {
      const n = normalizar(e.nombre);
      return tokens.every((t) => n.includes(t));
    }).slice(0, 5);
  }, [q, escuelas, interpretando]);

  const elegirEspacio = (s: { tipo: TipoEspacio; codigo: string }) => {
    setAbierto(false);
    setElegido(null);
    setQ("");
    onAccion({ accion: "ir_espacio", tipo: s.tipo, codigo: s.codigo });
    onAviso(etiquetaEspacio(s.tipo, s.codigo));
  };
  const elegirEscuela = (e: Escuela) => {
    setAbierto(false);
    setElegido(null);
    setQ("");
    onAccion({ accion: "escuela", nombre: e.nombre });
    if (e.lat == null) onAviso("Escuela sin ubicación en el mapa: igual se abre su ficha");
  };

  const hayPanel = !elegido && (sugEspacios.length > 0 || sugEscuelas.length > 0 || (abierto && resultados.length > 0));

  return (
    <div className="pointer-events-auto relative">
      <div className="panel-vidrio flex items-center gap-1.5 rounded-xl px-2.5 py-1.5">
        <Search size={13} className="shrink-0 text-texto-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void interpretar()}
          placeholder={escuchando ? "Escuchando…" : "Buscar: persona, circuito o pedile a la IA…"}
          className="w-60 bg-transparent text-xs outline-none placeholder:text-texto-3"
        />
        {(buscando || interpretando) && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rosa" />}
        <button
          onClick={() => void interpretar()}
          title="Interpretar con IA (también con Enter): «mujeres de 16 a 25», «voto disperso», «escuelas grandes»…"
          className="shrink-0 rounded-lg p-1.5 text-rosa transition hover:bg-rosa/10"
        >
          <Sparkles size={13} />
        </button>
        {hayVoz && (
          <button
            onClick={dictar}
            title="Buscar por voz"
            className={`shrink-0 rounded-full p-1.5 transition ${
              escuchando ? "pulso-mic bg-rosa text-white" : "text-texto-3 hover:text-rosa"
            }`}
          >
            <Mic size={13} />
          </button>
        )}
      </div>

      {hayPanel && (
        <div className="panel-vidrio absolute top-full left-0 z-30 mt-1 max-h-96 w-[360px] overflow-y-auto rounded-xl p-1.5">
          {sugEspacios.length > 0 && (
            <div className="flex flex-wrap gap-1 p-1">
              {sugEspacios.map((s) => (
                <button
                  key={`${s.tipo}-${s.codigo}`}
                  onClick={() => elegirEspacio(s)}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                    s.tipo === "distrito"
                      ? "border-distrito/50 text-distrito hover:bg-distrito/10"
                      : "border-circuito/50 text-circuito hover:bg-circuito/10"
                  }`}
                >
                  {etiquetaEspacio(s.tipo, s.codigo)}
                </button>
              ))}
            </div>
          )}

          {sugEscuelas.length > 0 && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold tracking-wide text-texto-3 uppercase">
                Escuelas de votación
              </div>
              {sugEscuelas.map((e) => (
                <button
                  key={e.id}
                  onClick={() => elegirEscuela(e)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-3"
                >
                  <div className="text-[12px] font-bold">🏫 {e.nombre}</div>
                  <div className="text-[10px] text-texto-3">
                    {e.electores.toLocaleString("es-AR")} electores · {e.mesas ?? 0} mesas · Circuito {e.circuito ?? "?"}
                    {e.lat == null ? " · sin ubicación en el mapa" : ""}
                  </div>
                </button>
              ))}
            </>
          )}

          {abierto && resultados.length > 0 && (
            <>
              {(sugEspacios.length > 0 || sugEscuelas.length > 0) && (
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold tracking-wide text-texto-3 uppercase">
                  Padrón
                </div>
              )}
              {resultados.map((r) => (
                <button
                  key={`${r.dni}-${r.mesa}`}
                  onClick={() => elegir(r)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-3"
                >
                  <div className="text-[12px] font-bold">{r.apellido_nombre}</div>
                  <div className="text-[10px] text-texto-3">
                    DNI {r.dni} · Circuito {r.circuito ?? "?"} ·{" "}
                    {r.mesa ? `Mesa ${r.mesa}${r.orden_mesa ? ` · Orden ${r.orden_mesa}` : ""}` : "sin mesa asignada"}
                  </div>
                  {r.establecimiento && <div className="text-[10px] text-celeste">{r.establecimiento}</div>}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {elegido && (
        <div className="panel-vidrio absolute top-full left-0 z-30 mt-1 w-[360px] rounded-xl p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-[12px] font-bold">
                <IdCard size={12} className="text-rosa" /> {elegido.apellido_nombre}
              </div>
              <div className="mt-0.5 text-[10px] text-texto-2">
                DNI {elegido.dni} · {elegido.domicilio ?? "sin domicilio"}
              </div>
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

"use client";

import { ChevronDown, ChevronRight, Map as MapIcon, Save, SlidersHorizontal, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CIRCUITOS } from "@/lib/espacios";
import {
  calcularSegmento,
  FRANJAS,
  listarSegmentos,
  type FiltrosSegmento,
  type ResultadoSegmento,
  type Segmento,
} from "@/lib/padron";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * Taller de microsegmentación del padrón: armá cohortes combinando sexo,
 * franja etaria estimada, circuitos y mesa asignada; guardalas con nombre
 * para trabajarlas con el equipo e ir sumando datos. Todo agregado.
 */
export function SegmentosTaller() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  const [sexo, setSexo] = useState<"F" | "M" | null>(null);
  const [franjaClave, setFranjaClave] = useState("todas");
  const [circuitos, setCircuitos] = useState<Set<string>>(new Set());
  const [soloConMesa, setSoloConMesa] = useState(false);
  const [verCircuitos, setVerCircuitos] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSegmento | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [guardados, setGuardados] = useState<Segmento[]>([]);
  const [nombre, setNombre] = useState("");
  const timer = useRef<number | null>(null);
  const reqRef = useRef(0); // vigencia: una respuesta lenta vieja no pisa filtros nuevos

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
    void listarSegmentos(supabase).then(setGuardados);
  }, [supabase]);

  const filtros = useMemo<FiltrosSegmento>(() => {
    const franja = FRANJAS.find((f) => f.clave === franjaClave);
    return {
      sexo,
      edad_min: franja?.min ?? null,
      edad_max: franja?.max ?? null,
      franja_clave: franjaClave,
      circuitos: circuitos.size > 0 ? [...circuitos] : null,
      con_mesa: soloConMesa ? true : null,
    };
  }, [sexo, franjaClave, circuitos, soloConMesa]);

  // Cálculo en vivo (debounce)
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setCalculando(true);
    timer.current = window.setTimeout(async () => {
      const req = ++reqRef.current;
      try {
        const r = await calcularSegmento(supabase, filtros);
        if (reqRef.current === req) setResultado(r);
      } finally {
        if (reqRef.current === req) setCalculando(false);
      }
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [supabase, filtros]);

  const alternarCircuito = (c: string) =>
    setCircuitos((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(c)) nuevo.delete(c);
      else nuevo.add(c);
      return nuevo;
    });

  const guardar = async () => {
    const n = nombre.trim();
    if (!n) return;
    await supabase.from("segmentos").insert({ nombre: n, filtros, creado_por: usuarioId });
    setNombre("");
    setGuardados(await listarSegmentos(supabase));
  };

  const cargar = (s: Segmento) => {
    setSexo((s.filtros.sexo as "F" | "M" | null) ?? null);
    setFranjaClave(s.filtros.franja_clave ?? "todas");
    setCircuitos(new Set(s.filtros.circuitos ?? []));
    setSoloConMesa(Boolean(s.filtros.con_mesa));
  };

  const borrar = async (id: number) => {
    await supabase.from("segmentos").delete().eq("id", id);
    setGuardados(await listarSegmentos(supabase));
  };

  const linkMapa = useMemo(() => {
    const p = new URLSearchParams({ vista: "padron" });
    if (sexo) p.set("sexo", sexo);
    if (franjaClave !== "todas") p.set("franja", franjaClave);
    return `/?${p.toString()}`;
  }, [sexo, franjaClave]);

  const maxCirc = Math.max(1, ...(resultado?.por_circuito.map((f) => f.total) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={18} className="text-rosa" />
        <h1 className="text-lg font-extrabold">Microsegmentación del padrón</h1>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-texto-2">
        Combiná filtros para construir cohortes del electorado, guardalas con nombre y volvé a
        ellas cuando sumes más datos. Las franjas etarias son estimadas por rango de DNI (±3 años)
        y todos los números son agregados.
      </p>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* ── Filtros ── */}
        <div className="space-y-3">
          <div className="panel-vidrio space-y-3 rounded-2xl p-4">
            <div>
              <div className="mb-1.5 text-[10px] font-bold tracking-wide text-texto-2 uppercase">Sexo</div>
              <div className="flex gap-1.5">
                {([null, "F", "M"] as const).map((s) => (
                  <button
                    key={s ?? "todos"}
                    onClick={() => setSexo(s)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      sexo === s ? "border-rosa/60 bg-rosa/15 text-rosa" : "border-borde-2 text-texto-2 hover:text-texto"
                    }`}
                  >
                    {s === null ? "Todos" : s === "F" ? "Mujeres" : "Varones"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
                Franja etaria (estimada)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FRANJAS.map((f) => (
                  <button
                    key={f.clave}
                    onClick={() => setFranjaClave(f.clave)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                      franjaClave === f.clave ? "border-rosa/60 bg-rosa/15 text-rosa" : "border-borde-2 text-texto-2 hover:text-texto"
                    }`}
                  >
                    {f.etiqueta}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <button
                onClick={() => setVerCircuitos((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-bold text-celeste hover:underline"
              >
                {verCircuitos ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Circuitos: {circuitos.size === 0 ? "todos" : `${circuitos.size} seleccionados`}
              </button>
              {verCircuitos && (
                <>
                  <div className="mt-2 flex gap-2 text-[10px]">
                    <button onClick={() => setCircuitos(new Set())} className="text-rosa hover:underline">
                      limpiar
                    </button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-6 gap-1">
                    {CIRCUITOS.map((cc) => (
                      <button
                        key={cc}
                        onClick={() => alternarCircuito(cc)}
                        className={`rounded-md border px-1 py-1 text-[10px] font-bold transition ${
                          circuitos.has(cc)
                            ? "border-circuito/70 bg-circuito/15 text-circuito"
                            : "border-borde text-texto-3 hover:text-texto"
                        }`}
                      >
                        {cc}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-texto-2">
              <input
                type="checkbox"
                checked={soloConMesa}
                onChange={(e) => setSoloConMesa(e.target.checked)}
                className="accent-[#e14f82]"
              />
              Solo electores con mesa asignada
            </label>
          </div>

          {/* Guardar */}
          <div className="panel-vidrio flex items-center gap-2 rounded-2xl p-3">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void guardar()}
              placeholder="Nombre del segmento (ej: Jóvenes zona sur)"
              className="min-w-0 flex-1 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
            <button
              onClick={() => void guardar()}
              disabled={nombre.trim() === ""}
              className="flex items-center gap-1.5 rounded-xl bg-rosa px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <Save size={13} /> Guardar
            </button>
          </div>

          {/* Guardados */}
          {guardados.length > 0 && (
            <div className="panel-vidrio rounded-2xl p-3">
              <div className="mb-2 text-[10px] font-bold tracking-wide text-texto-2 uppercase">Segmentos guardados</div>
              <div className="space-y-1.5">
                {guardados.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-borde bg-panel-2/60 px-2.5 py-1.5">
                    <button onClick={() => cargar(s)} className="min-w-0 flex-1 text-left" title="Cargar estos filtros">
                      <div className="truncate text-xs font-bold">{s.nombre}</div>
                      <div className="text-[9px] text-texto-3">
                        {[
                          s.filtros.sexo === "F" ? "mujeres" : s.filtros.sexo === "M" ? "varones" : null,
                          s.filtros.franja_clave && s.filtros.franja_clave !== "todas" ? s.filtros.franja_clave.replace("_", "–") : null,
                          s.filtros.circuitos?.length ? `${s.filtros.circuitos.length} circuitos` : "toda la ciudad",
                          s.filtros.con_mesa ? "con mesa" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                    <button onClick={() => void borrar(s.id)} className="text-texto-3 transition hover:text-peligro" title="Eliminar">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Resultado ── */}
        <div className="space-y-3">
          <div className="panel-vidrio rounded-2xl p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
                  <Users size={11} /> Electores en el segmento
                </div>
                <div className={`num text-4xl font-extrabold text-rosa transition ${calculando ? "opacity-40" : ""}`}>
                  {resultado ? numero(resultado.total) : "…"}
                </div>
                {resultado && (
                  <div className="mt-0.5 text-[11px] text-texto-2">
                    {numero(resultado.mujeres)} mujeres · {numero(resultado.varones)} varones ·{" "}
                    {numero(resultado.con_mesa)} con mesa
                  </div>
                )}
              </div>
              <Link
                href={linkMapa}
                className="flex items-center gap-1.5 rounded-xl border border-rosa/40 px-3 py-2 text-xs font-bold text-rosa transition hover:border-rosa"
                title="Abrir la vista Padrón del mapa con sexo y franja aplicados (los circuitos se ven en la tabla)"
              >
                <MapIcon size={13} /> Ver en el mapa
              </Link>
            </div>
            {resultado && (
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                <span className="rounded-full border border-borde-2 px-2 py-0.5">16–25: <b className="num">{numero(resultado.franjas_estimadas.e16_25)}</b></span>
                <span className="rounded-full border border-borde-2 px-2 py-0.5">26–40: <b className="num">{numero(resultado.franjas_estimadas.e26_40)}</b></span>
                <span className="rounded-full border border-borde-2 px-2 py-0.5">41–60: <b className="num">{numero(resultado.franjas_estimadas.e41_60)}</b></span>
                <span className="rounded-full border border-borde-2 px-2 py-0.5">60+: <b className="num">{numero(resultado.franjas_estimadas.e60_mas)}</b></span>
              </div>
            )}
          </div>

          {resultado && resultado.por_circuito.length > 0 && (
            <div className="panel-vidrio rounded-2xl p-4">
              <div className="mb-2 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
                Dónde está el segmento (por circuito)
              </div>
              <div className="space-y-1.5">
                {resultado.por_circuito.slice(0, 15).map((f) => (
                  <div key={f.circuito} className="text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/?tipo=circuito&codigo=${encodeURIComponent(f.circuito)}`}
                        className="font-bold text-circuito hover:underline"
                      >
                        Circuito {f.circuito}
                      </Link>
                      <span className="num font-bold">{numero(f.total)}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
                      <div className="h-full rounded-full bg-rosa" style={{ width: `${Math.max(2, (100 * f.total) / maxCirc)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {resultado.por_circuito.length > 15 && (
                <p className="mt-2 text-[10px] text-texto-3">
                  y {resultado.por_circuito.length - 15} circuitos más…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

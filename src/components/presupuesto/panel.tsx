"use client";

import { FileSpreadsheet, History, Landmark, ListChecks, Scale, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listarEscenarios,
  obtenerEjercicio,
  obtenerNecesidadBarrios,
  obtenerPartidas,
  obtenerPoliticas,
  obtenerVedas,
  type Ejercicio,
  type Escenario,
  type PartidaEstado,
  type PoliticaCatalogo,
  type Veda,
} from "@/lib/presupuesto-datos";
import type { BarrioNecesidad } from "@/lib/presupuesto";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { Asignar } from "./asignar";
import { Escenarios } from "./escenarios";
import { Partidas } from "./partidas";
import { Politicas } from "./politicas";

type Seccion = "asignar" | "disponible" | "politicas" | "escenarios";

const SECCIONES: Array<{ clave: Seccion; etiqueta: string; corta: string; icono: typeof Scale; detalle: string }> = [
  { clave: "asignar", etiqueta: "Asignar", corta: "Asignar", icono: Scale, detalle: "Repartir el disponible entre políticas y barrios" },
  { clave: "disponible", etiqueta: "Disponible", corta: "Partidas", icono: FileSpreadsheet, detalle: "Crédito vigente, comprometido y libre por partida" },
  { clave: "politicas", etiqueta: "Políticas", corta: "Políticas", icono: ListChecks, detalle: "Catálogo del Plan Rector: costo, indicador y partidas que las pagan" },
  { clave: "escenarios", etiqueta: "Escenarios", corta: "Escen.", icono: History, detalle: "Propuestas guardadas, aprobación y bitácora" },
];

export interface DatosPresupuesto {
  ejercicio: Ejercicio | null;
  partidas: PartidaEstado[];
  politicas: PoliticaCatalogo[];
  barrios: BarrioNecesidad[];
  escenarios: Escenario[];
  vedas: Veda[];
}

/** Días calendario entre hoy (fecha local) y una fecha 'AAAA-MM-DD', sin horas de por medio. */
function diasHasta(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const hoy = new Date();
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
}

const fechaCorta = (f: string) => {
  const [a, m, d] = f.split("-");
  return `${d}/${m}/${a}`;
};

/**
 * Presupuesto — asignación del crédito disponible a políticas públicas por
 * barrio. Separado a propósito de todo lo electoral de la aplicación: no lee
 * resultados, padrón ni la configuración de la campaña; el criterio es la
 * necesidad que mide el censo y cada decisión queda registrada.
 */
export function Presupuesto({ esSuperadmin }: { esSuperadmin: boolean }) {
  const [supabase] = useState(crearClienteNavegador);
  const [datos, setDatos] = useState<DatosPresupuesto | null>(null);
  const [seccion, setSeccion] = useState<Seccion>("asignar");
  const [error, setError] = useState<string | null>(null);
  const primeraCarga = useRef(true);

  const recargar = useCallback(async () => {
    try {
      const [ejercicio, partidas, politicas, barrios, escenarios, vedas] = await Promise.all([
        obtenerEjercicio(supabase),
        obtenerPartidas(supabase),
        obtenerPoliticas(supabase),
        obtenerNecesidadBarrios(supabase),
        listarEscenarios(supabase),
        obtenerVedas(supabase),
      ]);
      setDatos({ ejercicio, partidas, politicas, barrios, escenarios, vedas });
      setError(null);
      // Sin partidas no hay nada que asignar: se arranca por cargarlas. Solo
      // la primera vez; después cada guardado no tiene que mover de pestaña.
      if (primeraCarga.current) {
        primeraCarga.current = false;
        if (partidas.length === 0) setSeccion("disponible");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude cargar el presupuesto");
    }
  }, [supabase]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  // La veda vigente o la próxima dentro de los 60 días.
  const veda = useMemo(() => {
    for (const v of datos?.vedas ?? []) {
      const alInicio = diasHasta(v.desde);
      const alFin = diasHasta(v.hasta);
      if (alInicio <= 0 && alFin >= 0) return { v, dentro: true, dias: alFin };
      if (alInicio > 0 && alInicio <= 60) return { v, dentro: false, dias: alInicio };
    }
    return null;
  }, [datos?.vedas]);

  // Sin datos, el error es toda la pantalla. Con datos, un aviso arriba: una
  // recarga que falla no puede tirar lo que se estaba armando en Asignar.
  if (error && !datos)
    return (
      <div className="mx-auto max-w-6xl p-4">
        <p className="rounded-xl border border-peligro/40 bg-peligro/10 p-3 text-xs text-peligro">
          {/function|relation|schema cache/i.test(error)
            ? `${error}. Falta aplicar la migración 0016_presupuesto.sql en Supabase.`
            : error}
        </p>
      </div>
    );

  const propuestos = datos ? datos.escenarios.filter((e) => e.estado === "propuesto").length : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      <div className="panel-vidrio rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="flex items-center gap-2 text-sm font-extrabold">
            <Landmark size={15} className="text-rosa" /> Presupuesto {datos?.ejercicio?.ejercicio ?? 2026}
          </h1>
          <span className="text-[11px] text-texto-2">
            Planificar la ejecución del crédito que queda disponible en las políticas del Plan Rector, barrio por barrio.
          </span>
        </div>
        <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-snug text-texto-3">
          <ShieldCheck size={12} className="mt-0.5 shrink-0 text-completo" />
          <span>
            El criterio es la necesidad que mide el Censo 2022: esta herramienta <b>no usa datos electorales</b> ni la
            configuración de la campaña. Las políticas dirigidas a personas se planifican como <b>cupos por barrio</b>: quién
            recibe cada cupo lo resuelve el área que ejecuta el programa. Cada cambio queda en la bitácora.
          </span>
        </p>
      </div>

      {error && datos && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-peligro/40 bg-peligro/10 px-4 py-2 text-[11px] text-peligro">
          <span className="min-w-0 flex-1">No pude actualizar los datos: {error}</span>
          <button onClick={() => void recargar()} className="rounded-lg border border-peligro/50 px-2.5 py-1 font-bold">
            Reintentar
          </button>
        </div>
      )}

      {veda && (
        <div
          className={`flex items-start gap-2 rounded-2xl border px-4 py-2.5 text-[11px] leading-snug ${
            veda.dentro ? "border-sin/50 bg-sin/10 text-sin" : "border-encurso/50 bg-encurso/10 text-encurso"
          }`}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            {veda.dentro ? (
              <>
                <b>
                  Veda del {fechaCorta(veda.v.desde)} al {fechaCorta(veda.v.hasta)} ({veda.v.norma}).
                </b>{" "}
                No se inauguran obras, no se lanzan programas ni se hace ningún acto de gobierno que pueda captar votos. La
                herramienta no aprueba cupos ni programas nuevos hasta el {fechaCorta(veda.v.hasta)}; los programas en curso
                siguen.
              </>
            ) : (
              <>
                Faltan {veda.dias} días para la veda del {fechaCorta(veda.v.desde)} al {fechaCorta(veda.v.hasta)} (
                {veda.v.norma}): en ese período no se inauguran obras ni se lanzan programas, y la herramienta no aprueba cupos
                ni programas nuevos. Conviene que lo que se planifique ahora no tenga su inicio en esas fechas.
              </>
            )}
          </span>
        </div>
      )}

      <div className="panel-vidrio flex flex-wrap overflow-hidden rounded-2xl">
        {SECCIONES.map((s) => (
          <button
            key={s.clave}
            onClick={() => setSeccion(s.clave)}
            title={s.detalle}
            className={`flex min-w-0 flex-auto items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold transition sm:flex-1 sm:gap-2 sm:px-3 ${
              seccion === s.clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:bg-panel-2/60 hover:text-texto"
            }`}
          >
            <s.icono size={14} className="shrink-0" />
            <span className="sm:hidden">{s.corta}</span>
            <span className="hidden truncate sm:inline">{s.etiqueta}</span>
            {s.clave === "escenarios" && propuestos > 0 && (
              <span className="num shrink-0 rounded-full bg-encurso/20 px-1.5 text-[10px] text-encurso" title="Propuestas esperando aprobación">
                {propuestos}
              </span>
            )}
          </button>
        ))}
      </div>

      {!datos && <p className="px-1 text-xs text-texto-2">Cargando partidas, políticas y el censo por barrio…</p>}
      {datos && (
        <>
          {/* Asignar queda montado aunque se cambie de pestaña: si no, se pierde lo armado. */}
          <div hidden={seccion !== "asignar"}>
            <Asignar supabase={supabase} datos={datos} onGuardado={recargar} irA={(s) => setSeccion(s)} />
          </div>
          {seccion === "disponible" && (
            <Partidas supabase={supabase} datos={datos} esSuperadmin={esSuperadmin} onCambio={recargar} />
          )}
          {seccion === "politicas" && (
            <Politicas supabase={supabase} datos={datos} esSuperadmin={esSuperadmin} onCambio={recargar} />
          )}
          {seccion === "escenarios" && (
            <Escenarios supabase={supabase} datos={datos} esSuperadmin={esSuperadmin} onCambio={recargar} />
          )}
        </>
      )}
    </div>
  );
}

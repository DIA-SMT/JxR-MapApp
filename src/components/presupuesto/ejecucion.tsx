"use client";

import { ClipboardCheck, FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerDetalleEscenario, type DetalleEscenario } from "@/lib/presupuesto-datos";
import { pesos } from "@/lib/presupuesto";
import { Vacio } from "@/components/ui/vacio";
import { Seguimiento } from "./seguimiento";
import type { DatosPresupuesto } from "./panel";

/**
 * Paso 5: lo que pasa después de aprobar. Cada área carga qué se hizo en cada
 * barrio, cuánto se gastó y con qué expediente; acá se ve el avance de cada
 * propuesta aprobada.
 */
export function Ejecucion({
  supabase,
  datos,
  elegida,
  onElegir,
  onEjemplo,
  ejemplo,
}: {
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  elegida: number | null;
  onElegir: (id: number) => void;
  onEjemplo?: () => void;
  ejemplo: boolean;
}) {
  const aprobadas = datos.escenarios.filter((e) => e.estado === "aprobado" || e.estado === "ejecutado");
  const id = elegida != null && aprobadas.some((e) => e.id === elegida) ? elegida : (aprobadas[0]?.id ?? null);
  const [detalle, setDetalle] = useState<{ id: number; d: DetalleEscenario } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) return;
    let vivo = true;
    setError(null);
    void obtenerDetalleEscenario(supabase, id)
      .then((d) => vivo && setDetalle({ id, d }))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "no pude cargar la propuesta"));
    return () => {
      vivo = false;
    };
  }, [id, supabase]);

  if (aprobadas.length === 0)
    return (
      <Vacio
        icono={ClipboardCheck}
        titulo="Todavía no hay propuestas aprobadas"
        accion={
          !ejemplo && onEjemplo ? (
            <button
              onClick={onEjemplo}
              className="flex items-center gap-1.5 rounded-lg border border-rosa/40 px-3 py-1.5 text-xs font-bold text-rosa"
            >
              <FlaskConical size={13} /> Ver cómo es con un ejemplo
            </button>
          ) : undefined
        }
      >
        Cuando una propuesta se aprueba con su norma, acá cada área carga lo que va haciendo en cada barrio: si está
        pendiente, en curso o terminado, cuánto se gastó y con qué expediente. Así se ve el avance contra lo
        planificado.
      </Vacio>
    );

  const e = aprobadas.find((x) => x.id === id)!;
  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold">
          <ClipboardCheck size={14} className="text-celeste" /> Ejecución de lo aprobado
        </h3>
        <p className="mt-0.5 text-[11px] text-texto-2">
          Elegí la propuesta. Cada área puede filtrar por lo suyo («Mi área») y cargar el avance; con gasto hace falta
          el expediente.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {aprobadas.map((x) => (
            <button
              key={x.id}
              onClick={() => onElegir(x.id)}
              className={`min-w-0 rounded-xl border-2 px-3 py-1.5 text-left transition ${
                x.id === id ? "border-celeste bg-celeste/10" : "border-borde-2 hover:border-celeste/50"
              }`}
            >
              <span className={`block truncate text-[11.5px] font-bold ${x.id === id ? "text-celeste" : ""}`}>
                {x.nombre}
              </span>
              <span className="block truncate text-[10px] text-texto-3">
                {x.estado === "ejecutado" ? "ejecutada" : "aprobada"} · {x.norma || "sin norma"} ·{" "}
                {pesos(Number(x.resumen.asignado ?? 0), true)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[11px] text-peligro">{error}</p>}
      {detalle?.id === id ? (
        <Seguimiento key={id} supabase={supabase} escenario={e.id} detalle={detalle.d} />
      ) : (
        !error && <p className="px-1 text-[11px] text-texto-3">Cargando la propuesta…</p>
      )}
    </div>
  );
}

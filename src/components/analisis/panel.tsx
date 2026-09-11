"use client";

import { ArrowRight, CalendarClock, DoorOpen, Target, Users } from "lucide-react";
import { useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { Contactos, Muestra } from "./campo";
import { Calendario } from "./calendario";
import { Transferencia, VotoJoven } from "./flujos";

type Seccion = "transferencia" | "contactos" | "joven" | "muestra" | "calendario";

const SECCIONES: Array<{ clave: Seccion; etiqueta: string; corta: string; icono: typeof Users; detalle: string }> = [
  { clave: "transferencia", etiqueta: "Transferencia", corta: "Flujos", icono: ArrowRight, detalle: "A dónde se fue cada voto entre 2023 y 2025" },
  { clave: "contactos", etiqueta: "Contactos", corta: "Campo", icono: DoorOpen, detalle: "El dato propio: timbreo y propensión medida por territorio" },
  { clave: "joven", etiqueta: "Voto joven", corta: "Joven", icono: Users, detalle: "Dónde está el electorado con menos lealtad partidaria" },
  { clave: "muestra", etiqueta: "Muestra", corta: "Muestra", icono: Target, detalle: "Cuántas entrevistas hacer en cada circuito" },
  { clave: "calendario", etiqueta: "Calendario", corta: "Plazos", icono: CalendarClock, detalle: "Los plazos legales de la elección" },
];

/** Análisis político: las herramientas que no son del mapa ni de la jornada. */
export function AnalisisPolitico() {
  const [supabase] = useState(crearClienteNavegador);
  const [seccion, setSeccion] = useState<Seccion>("transferencia");

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      <div className="panel-vidrio flex flex-wrap overflow-hidden rounded-2xl">
        {SECCIONES.map((s) => (
          <button
            key={s.clave}
            onClick={() => setSeccion(s.clave)}
            title={s.detalle}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold transition sm:gap-2 sm:px-3 ${
              seccion === s.clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:bg-panel-2/60 hover:text-texto"
            }`}
          >
            <s.icono size={14} className="shrink-0" />
            <span className="sm:hidden">{s.corta}</span>
            <span className="hidden truncate sm:inline">{s.etiqueta}</span>
          </button>
        ))}
      </div>

      {seccion === "transferencia" && <Transferencia supabase={supabase} />}
      {seccion === "contactos" && <Contactos supabase={supabase} />}
      {seccion === "joven" && <VotoJoven supabase={supabase} />}
      {seccion === "muestra" && <Muestra supabase={supabase} />}
      {seccion === "calendario" && <Calendario supabase={supabase} />}
    </div>
  );
}

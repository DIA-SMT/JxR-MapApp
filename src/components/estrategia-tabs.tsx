"use client";

import { Calculator, Crosshair, Target } from "lucide-react";
import { useState } from "react";
import { BancasDHondt } from "./bancas-dhondt";
import { Estrategia2023 } from "./estrategia-2023";
import { UniversoTerritorial } from "./universo-territorial";

type Seccion = "voto-disperso" | "universo" | "bancas";

const SECCIONES: Array<{ clave: Seccion; etiqueta: string; icono: typeof Target; detalle: string }> = [
  { clave: "voto-disperso", etiqueta: "Voto disperso", icono: Crosshair, detalle: "Frontera 20K y escuelas por umbral" },
  { clave: "universo", etiqueta: "Universo territorial", icono: Target, detalle: "Dónde están los votos de un conjunto de listas" },
  { clave: "bancas", etiqueta: "Bancas · D'Hondt", icono: Calculator, detalle: "Piso, techo y escenarios de unificación" },
];

/** Las tres mesas de trabajo de la estrategia electoral, en una sola pantalla. */
export function EstrategiaTabs() {
  const [seccion, setSeccion] = useState<Seccion>("voto-disperso");

  return (
    <div className="space-y-4">
      <div className="panel-vidrio flex flex-wrap overflow-hidden rounded-2xl">
        {SECCIONES.map((s) => (
          <button
            key={s.clave}
            onClick={() => setSeccion(s.clave)}
            title={s.detalle}
            className={`flex min-w-0 flex-1 items-center justify-center gap-2 px-4 py-3 text-xs font-bold transition ${
              seccion === s.clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:bg-panel-2/60 hover:text-texto"
            }`}
          >
            <s.icono size={14} className="shrink-0" />
            <span className="truncate">{s.etiqueta}</span>
          </button>
        ))}
      </div>

      {seccion === "voto-disperso" && <Estrategia2023 />}
      {seccion === "universo" && <UniversoTerritorial />}
      {seccion === "bancas" && <BancasDHondt />}
    </div>
  );
}

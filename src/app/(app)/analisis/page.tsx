import { AnalisisPolitico } from "@/components/analisis/panel";

export const metadata = { title: "Análisis" };

/** Herramientas de análisis político: flujos, campo, cohortes, muestra y plazos. */
export default function PaginaAnalisis() {
  return (
    <div className="h-full overflow-y-auto">
      <AnalisisPolitico />
    </div>
  );
}

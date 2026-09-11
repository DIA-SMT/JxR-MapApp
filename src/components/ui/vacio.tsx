import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Estado vacío.
 *
 * Las pantallas sin datos decían una sola frase gris suelta ("No hay personas
 * cargadas todavía.") y quedaban leyéndose como un error. Un estado vacío tiene
 * que decir tres cosas: qué va acá, por qué está vacío y cuál es el próximo
 * paso. Se usa igual para "todavía no cargaste nada" que para "el filtro no
 * devolvió nada", que son situaciones distintas: la segunda lleva `variante
 *="filtro"` y no propone crear nada.
 */
export function Vacio({
  icono: Icono,
  titulo,
  children,
  accion,
  variante = "inicial",
}: {
  icono: LucideIcon;
  titulo: string;
  /** Una o dos frases: qué se hace acá o por qué no hay nada. */
  children?: ReactNode;
  accion?: ReactNode;
  variante?: "inicial" | "filtro";
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-borde-2 px-6 text-center ${
        variante === "filtro" ? "py-8" : "py-12"
      }`}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-panel-3 text-texto-3">
        <Icono size={19} />
      </div>
      <p className="mt-3 text-[13px] font-bold text-texto">{titulo}</p>
      {children && <div className="mt-1 max-w-md text-[11px] leading-relaxed text-texto-2">{children}</div>}
      {accion && <div className="mt-3.5">{accion}</div>}
    </div>
  );
}

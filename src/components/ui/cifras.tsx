import type { ReactNode } from "react";

/**
 * Tira de cifras del centro de comando.
 *
 * Las pantallas venían resolviendo los indicadores como una línea de texto
 * corrido ("6/1.087 mesas con fiscal · 1 ausentes · 3 incidencias abiertas"):
 * se lee entera o no se lee. Acá cada cifra es un bloque —número grande arriba,
 * etiqueta chica abajo— separado por una línea fina, que es lo que permite
 * encontrar un dato de un vistazo el día de la elección.
 */

type Tono = "neutro" | "marca" | "alerta" | "ok" | "aviso";

const TONO_VALOR: Record<Tono, string> = {
  neutro: "text-texto",
  marca: "text-rosa",
  alerta: "text-sin",
  ok: "text-completo",
  aviso: "text-encurso",
};

/** Contenedor: el panel con las cifras en fila y lo que venga al final a la derecha. */
export function Cifras({
  children,
  acciones,
  className = "",
}: {
  children: ReactNode;
  /** Botones o enlaces que van pegados al borde derecho. */
  acciones?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel-vidrio flex flex-wrap items-center gap-y-3 rounded-2xl px-4 py-3 ${className}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-y-3">{children}</div>
      {acciones && <div className="flex shrink-0 items-center gap-2 pl-3">{acciones}</div>}
    </div>
  );
}

/**
 * Una cifra. `de` agrega el denominador en gris ("6 / 1.087"), `unidad` un
 * sufijo pegado al número ("41,0 %") y `nota` un detalle a la derecha del
 * valor, para no inflar la etiqueta.
 */
export function Cifra({
  valor,
  etiqueta,
  de,
  unidad,
  nota,
  tono = "neutro",
  titulo,
}: {
  valor: ReactNode;
  etiqueta: string;
  de?: ReactNode;
  unidad?: string;
  nota?: ReactNode;
  tono?: Tono;
  titulo?: string;
}) {
  return (
    <div
      title={titulo}
      className="min-w-0 border-l border-borde pr-5 pl-5 first:border-l-0 first:pl-0"
    >
      <div className="flex items-baseline gap-1">
        <span className={`num text-lg leading-none font-bold ${TONO_VALOR[tono]}`}>{valor}</span>
        {unidad && <span className={`text-[11px] font-bold ${TONO_VALOR[tono]}`}>{unidad}</span>}
        {de !== undefined && <span className="num text-[11px] leading-none text-texto-3">/ {de}</span>}
        {nota && <span className="text-[10px] leading-none text-texto-3">{nota}</span>}
      </div>
      <div className="mt-1 truncate text-[9.5px] font-bold tracking-wide text-texto-3 uppercase">{etiqueta}</div>
    </div>
  );
}

/**
 * Cifra que solo aparece cuando hay algo que mirar: cero fiscales ausentes no
 * merece un bloque, uno sí. Evita que la tira se llene de ceros tranquilos.
 */
export function CifraSiHay({
  valor,
  etiqueta,
  tono = "alerta",
  titulo,
}: {
  valor: number;
  etiqueta: string;
  tono?: Tono;
  titulo?: string;
}) {
  if (!valor) return null;
  return <Cifra valor={valor.toLocaleString("es-AR")} etiqueta={etiqueta} tono={tono} titulo={titulo} />;
}

/** Texto al pie de una tira, para las aclaraciones de método. */
export function NotaCifras({ children }: { children: ReactNode }) {
  return <p className="w-full pt-2 text-[10px] leading-snug text-texto-3">{children}</p>;
}

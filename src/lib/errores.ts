/**
 * Registro de errores: lo que falla queda en la tabla errores_app (migración
 * 0018) para que el superadmin lo vea, aunque Vercel ya haya borrado sus
 * registros. Nada de esto puede tirar abajo la pantalla: si registrar falla,
 * se sigue.
 */

/** Saca datos personales antes de guardar: documentos (7 u 8 cifras) y correos. */
export function enmascarar(texto: string): string {
  return texto.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]").replace(/\b\d{1,2}\.?\d{3}\.?\d{3}\b/g, "[número]");
}

export interface ErrorNormalizado {
  mensaje: string;
  detalle: string;
}

export function normalizarError(e: unknown): ErrorNormalizado {
  if (e instanceof Error) {
    return {
      mensaje: enmascarar(e.message || e.name).slice(0, 1000),
      detalle: enmascarar(e.stack ?? "").slice(0, 4000),
    };
  }
  if (typeof e === "string") return { mensaje: enmascarar(e).slice(0, 1000), detalle: "" };
  try {
    return { mensaje: enmascarar(JSON.stringify(e)).slice(0, 1000), detalle: "" };
  } catch {
    return { mensaje: "error sin descripción", detalle: "" };
  }
}

/** Errores del navegador que no dicen nada útil y no se guardan. */
export function esRuido(mensaje: string): boolean {
  return (
    /ResizeObserver loop/i.test(mensaje) ||
    /Script error\.?$/i.test(mensaje) ||
    /AbortError|The user aborted a request/i.test(mensaje) ||
    /NEXT_REDIRECT|NEXT_NOT_FOUND/.test(mensaje)
  );
}

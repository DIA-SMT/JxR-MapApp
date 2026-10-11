"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { registrarError } from "@/components/registro-errores";

/**
 * Si una pantalla se rompe, en lugar de la página en blanco se ve esto, y el
 * error queda en el registro para el superadmin.
 */
export default function ErrorPantalla({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    registrarError(error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel-vidrio max-w-md rounded-2xl p-6 text-center">
        <TriangleAlert size={28} className="mx-auto text-encurso" />
        <h1 className="mt-2 text-base font-extrabold">Algo falló en esta pantalla</h1>
        <p className="mt-1 text-xs leading-relaxed text-texto-2">
          Ya quedó anotado para revisarlo. Probá de nuevo; si sigue fallando, avisale al superadmin.
          {error.digest && <span className="mt-1 block text-[10px] text-texto-3">Código: {error.digest}</span>}
        </p>
        <button
          onClick={reset}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-rosa px-4 py-2 text-xs font-bold text-white transition hover:brightness-110"
        >
          <RotateCcw size={13} /> Probar de nuevo
        </button>
      </div>
    </div>
  );
}

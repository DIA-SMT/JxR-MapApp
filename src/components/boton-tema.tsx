"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Alterna entre modo oscuro (default) y claro. Persiste en localStorage y
 *  avisa al mapa (que cambia el estilo base) vía el evento jxr:tema. */
export function BotonTema() {
  const [claro, setClaro] = useState(false);
  useEffect(() => {
    setClaro(document.documentElement.classList.contains("claro"));
  }, []);

  const alternar = () => {
    const nuevo = !claro;
    setClaro(nuevo);
    document.documentElement.classList.toggle("claro", nuevo);
    try {
      localStorage.setItem("jxr:tema", nuevo ? "claro" : "oscuro");
    } catch {
      // sin persistencia: el tema dura la sesión
    }
    window.dispatchEvent(new Event("jxr:tema"));
  };

  return (
    <button
      onClick={alternar}
      title={claro ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      className="rounded-lg border border-borde-2 p-2 text-texto-3 transition hover:border-rosa/50 hover:text-rosa"
    >
      {claro ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}

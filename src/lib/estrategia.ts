import type { Lista2023 } from "./padron";

/**
 * Estrategia "voto disperso 2023": preselección editable de listas.
 *
 * La preselección es solo un punto de partida MECÁNICO: listas cuyo nombre
 * remite al universo peronista y que quedaron fuera del reparto grande
 * (se excluyen los frentes principales). La decisión política final es del
 * equipo: en la pantalla Estrategia se puede prender y apagar cada lista.
 */

/** Frentes grandes 2023 (con banca o estructura provincial): fuera del preset. */
export const LISTAS_GRANDES_2023 = new Set([830, 831, 832, 901, 929]);

const PALABRAS_PERONISTAS =
  /LEALTAD|VICTORIA|PERON|JUSTICIA SOCIAL|MILITANCIA|CIUDADANA|LABORISTA|PUEBLO|COMPROMISO|ORGANIZADOS|POPULAR|INCLUSION|TODOS/i;

export function presetPeronismoDisperso(listas: Lista2023[]): number[] {
  return listas
    .filter(
      (l) =>
        !LISTAS_GRANDES_2023.has(l.lista_numero) &&
        PALABRAS_PERONISTAS.test(l.lista_nombre),
    )
    .map((l) => l.lista_numero);
}

export const META_VOTOS = 20000;

/** Selección de listas persistida por categoría (localStorage, lado cliente). */
export const claveSeleccion = (categoria: string) => `jxr:estrategia:sel:${categoria}`;

export function leerSeleccion(categoria: string): number[] | null {
  try {
    const crudo = localStorage.getItem(claveSeleccion(categoria));
    if (!crudo) return null;
    const lista = JSON.parse(crudo) as unknown;
    return Array.isArray(lista) ? lista.filter((n) => Number.isInteger(n)) : null;
  } catch {
    return null;
  }
}

export function guardarSeleccion(categoria: string, listas: number[]) {
  try {
    localStorage.setItem(claveSeleccion(categoria), JSON.stringify(listas));
  } catch {
    // sin persistencia local: no es grave
  }
}

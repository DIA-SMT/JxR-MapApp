/**
 * Datos de EJEMPLO para probar la herramienta antes de tener el reporte de la
 * Contaduría y los costos reales. Los montos son inventados —del orden de lo
 * que maneja la municipalidad, pero inventados— y viven solo en el navegador:
 * en modo ejemplo no se guarda nada.
 *
 * Lo único real es el censo: la necesidad de cada barrio es la verdadera.
 */

import type { PartidaEstado, PoliticaCatalogo } from "./presupuesto-datos";

const partida = (
  id: number,
  codigo: string,
  jurisdiccion: string,
  pp: string,
  clase: "corriente" | "capital",
  libre: number,
): PartidaEstado => ({
  id,
  codigo,
  anexo: "Departamento Ejecutivo",
  jurisdiccion,
  programa: "Ejemplo",
  clase,
  partida_principal: pp,
  afectacion: "",
  credito_vigente: libre,
  comprometido: 0,
  estimada: true,
  fuente_dato: "Ejemplo con montos inventados",
  actualizado_en: "",
  disponible: libre,
  reservado: 0,
  libre,
  excedido: 0,
});

/** Cinco "bolsas" de plata libre, una por tipo de gasto. */
export const PARTIDAS_EJEMPLO: PartidaEstado[] = [
  partida(-1, "EJ-52", "Obras Públicas", "52", "capital", 3_000_000_000),
  partida(-2, "EJ-51", "Equipamiento", "51", "capital", 600_000_000),
  partida(-3, "EJ-12", "Bienes y servicios", "12", "corriente", 900_000_000),
  partida(-4, "EJ-13", "Servicios públicos", "13", "corriente", 500_000_000),
  partida(-5, "EJ-31", "Ayudas y transferencias", "31", "corriente", 300_000_000),
];

/** Costo por unidad inventado para cada política activa (por código del Plan Rector). */
export const COSTOS_EJEMPLO: Record<string, number> = {
  "1.1": 18_000, // por habitante alcanzado
  "1.2": 2_500,
  "2.2": 120_000, // por hogar con su cuadra reparada
  "3.1": 90_000,
  "4.1": 15_000,
  "4.3": 6_000,
  "6.2": 4_000,
  "7.1": 3_000,
  "7.2": 2_500,
  "8.3": 9_000,
  "10.4": 7_000,
  "11.2": 25_000, // por persona sin cobertura atendida
  "11.3": 12_000,
  "11.4": 30_000,
  "12.1": 45_000, // por niña o niño
  "12.4": 20_000,
  "13.1": 11_000,
  "13.2": 1_500,
  "15.1": 8_000,
  "15.4": 5_000,
  "16.1": 15_000,
  "16.2": 35_000,
  "16.3": 60_000,
  "17.1": 40_000, // por persona capacitada
  "17.3": 55_000,
};

/** El catálogo real con los costos de ejemplo puestos donde falta el costo. */
export function politicasEjemplo(politicas: PoliticaCatalogo[]): PoliticaCatalogo[] {
  return politicas.map((p) =>
    p.activa && COSTOS_EJEMPLO[p.codigo] && !p.costo_unitario ? { ...p, costo_unitario: COSTOS_EJEMPLO[p.codigo] } : p,
  );
}

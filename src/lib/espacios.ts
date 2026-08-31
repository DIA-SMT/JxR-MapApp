import type { TipoEspacio } from "./tipos";

/** Los 20 distritos oficiales de San Miguel de Tucumán. */
export const DISTRITOS = Array.from({ length: 20 }, (_, i) => String(i + 1));

/** Los 47 circuitos electorales (códigos de public/data/circuitos.json). */
export const CIRCUITOS = [
  "1", "1A", "2", "2A", "3", "4", "5", "6", "7", "7A", "8", "8A", "9", "9A",
  "10", "10A", "11", "11A", "12", "12A", "13", "13A",
  "14", "14A", "14B", "14C", "14D", "15", "15A", "15B", "16", "16A", "17", "17A",
  "18", "18A", "18B", "18C", "18D", "18E", "18F", "18G", "19", "19A", "20", "21", "22",
];

export const CODIGOS: Record<TipoEspacio, string[]> = {
  distrito: DISTRITOS,
  circuito: CIRCUITOS,
};

export function etiquetaEspacio(tipo: TipoEspacio, codigo: string): string {
  return tipo === "distrito" ? `Distrito ${codigo}` : `Circuito ${codigo}`;
}

export function esEspacioValido(tipo: TipoEspacio, codigo: string): boolean {
  return CODIGOS[tipo]?.includes(codigo) ?? false;
}

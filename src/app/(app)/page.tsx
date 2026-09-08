import { MapaElectoral, type InicialMapa } from "@/components/mapa/mapa-electoral";
import { esEspacioValido } from "@/lib/espacios";
import type { TipoEspacio } from "@/lib/tipos";

const VISTAS = ["operativo", "padron", "escuelas", "v2023"] as const;
const FRANJAS = ["todas", "16_25", "26_40", "41_60", "60_mas"] as const;

/**
 * Mapa comando. Estado inicial por URL:
 *  ?tipo=circuito&codigo=15B  → selecciona y encuadra un espacio
 *  ?vista=padron&sexo=F&franja=16_25 → vista y microsegmentación
 */
export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; codigo?: string; vista?: string; sexo?: string; franja?: string }>;
}) {
  const p = await searchParams;
  const inicial: InicialMapa = {};

  if ((p.tipo === "distrito" || p.tipo === "circuito") && p.codigo && esEspacioValido(p.tipo as TipoEspacio, p.codigo)) {
    inicial.tipo = p.tipo as TipoEspacio;
    inicial.codigo = p.codigo;
  }
  if (p.vista && (VISTAS as readonly string[]).includes(p.vista)) inicial.vista = p.vista as InicialMapa["vista"];
  if (p.sexo === "F" || p.sexo === "M") inicial.sexo = p.sexo;
  if (p.franja && (FRANJAS as readonly string[]).includes(p.franja)) inicial.franja = p.franja;

  return <MapaElectoral inicial={Object.keys(inicial).length > 0 ? inicial : null} />;
}

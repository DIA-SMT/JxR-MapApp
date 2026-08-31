import { MapaElectoral } from "@/components/mapa/mapa-electoral";
import { esEspacioValido } from "@/lib/espacios";
import type { TipoEspacio } from "@/lib/tipos";

/** Mapa comando: ?tipo=distrito|circuito&codigo=… selecciona y encuadra un espacio. */
export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; codigo?: string }>;
}) {
  const { tipo, codigo } = await searchParams;
  const inicial =
    (tipo === "distrito" || tipo === "circuito") && codigo && esEspacioValido(tipo as TipoEspacio, codigo)
      ? { tipo: tipo as TipoEspacio, codigo }
      : null;

  return <MapaElectoral inicial={inicial} />;
}

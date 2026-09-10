import { FichaImpresa } from "@/components/ficha-impresa";

/** Ficha del circuito lista para imprimir y entregar en mano al referente. */
export default async function PaginaFichaCircuito({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  return <FichaImpresa codigo={decodeURIComponent(codigo).toUpperCase()} />;
}

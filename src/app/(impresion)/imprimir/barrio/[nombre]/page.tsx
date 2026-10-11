import { FichaBarrio } from "@/components/presupuesto/ficha-barrio";

/** La ficha de un barrio para imprimir: demandas, qué recibe, cómo va la obra y qué áreas intervienen. */
export default async function PaginaFichaBarrio({
  params,
  searchParams,
}: {
  params: Promise<{ nombre: string }>;
  searchParams: Promise<{ propuesta?: string; ejemplo?: string }>;
}) {
  const { nombre } = await params;
  const { propuesta, ejemplo } = await searchParams;
  const n = Number(propuesta);
  return (
    <FichaBarrio
      barrio={decodeURIComponent(nombre)}
      propuesta={Number.isInteger(n) && n > 0 ? n : null}
      ejemplo={ejemplo === "1"}
    />
  );
}

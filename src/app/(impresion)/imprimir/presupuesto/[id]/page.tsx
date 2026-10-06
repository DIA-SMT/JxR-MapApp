import { notFound } from "next/navigation";
import { InformePresupuesto } from "@/components/presupuesto/informe";

/** La propuesta de asignación en hojas A4, para imprimir o guardar como PDF y adjuntar al expediente. */
export default async function PaginaInformePresupuesto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  return <InformePresupuesto id={n} />;
}

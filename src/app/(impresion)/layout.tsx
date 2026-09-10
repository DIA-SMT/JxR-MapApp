import { redirect } from "next/navigation";
import { sesionConPerfil } from "@/lib/supabase/servidor";

/**
 * Layout de impresión: exige sesión pero no monta header ni chat — la página
 * es una hoja pensada para imprimir y entregar en mano.
 */
export default async function LayoutImpresion({ children }: { children: React.ReactNode }) {
  const sesion = await sesionConPerfil();
  if (!sesion) redirect("/acceso");
  return <div className="min-h-screen bg-white text-neutral-900">{children}</div>;
}

import { Presupuesto } from "@/components/presupuesto/panel";
import { sesionConPerfil } from "@/lib/supabase/servidor";

export const metadata = { title: "Presupuesto" };

/**
 * Presupuesto: asignar el crédito disponible a políticas públicas por barrio.
 * No alcanza con tener usuario en el comando: hay que ser superadmin o estar
 * habilitado. La base lo vuelve a exigir en cada tabla y función.
 */
export default async function PaginaPresupuesto() {
  const sesion = await sesionConPerfil();
  const esSuperadmin = sesion?.perfil.rol === "superadmin";
  const { data: habilitado } = esSuperadmin || !sesion ? { data: esSuperadmin } : await sesion.supabase.rpc("puede_presupuesto");

  if (!esSuperadmin && habilitado !== true) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-xl p-6">
          <div className="panel-vidrio rounded-2xl p-5 text-xs leading-relaxed text-texto-2">
            <h1 className="text-sm font-extrabold text-texto">Presupuesto</h1>
            <p className="mt-1.5">
              Esta sección la usan solo el superadmin y las personas que él habilita. Si tenés que trabajar en la asignación
              del presupuesto, pedile acceso.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <Presupuesto esSuperadmin={esSuperadmin} />
    </div>
  );
}

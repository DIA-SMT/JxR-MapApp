import { redirect } from "next/navigation";
import { UsuariosAdmin } from "@/components/usuarios-admin";
import { sesionConPerfil } from "@/lib/supabase/servidor";

/** Gestión de usuarios — exclusiva del superadmin. */
export default async function PaginaUsuarios() {
  const sesion = await sesionConPerfil();
  if (!sesion || sesion.perfil.rol !== "superadmin") redirect("/");

  return (
    <div className="fondo-grilla h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <UsuariosAdmin miId={sesion.perfil.id} />
      </div>
    </div>
  );
}

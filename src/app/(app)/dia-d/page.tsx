import { DiaD } from "@/components/dia-d/panel";
import { sesionConPerfil } from "@/lib/supabase/servidor";

export const metadata = { title: "DÍA D" };

/** DÍA D: el comando de la jornada electoral. */
export default async function PaginaDiaD() {
  const sesion = await sesionConPerfil();
  return (
    <div className="h-full overflow-y-auto">
      <DiaD esSuperadmin={sesion?.perfil.rol === "superadmin"} />
    </div>
  );
}

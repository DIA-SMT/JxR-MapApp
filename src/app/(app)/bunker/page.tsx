import { BunkerVivo } from "@/components/bunker-vivo";
import { sesionConPerfil } from "@/lib/supabase/servidor";

export const metadata = { title: "Búnker" };

/** Búnker: escrutinio propio en vivo la noche de la elección. */
export default async function PaginaBunker() {
  const sesion = await sesionConPerfil();
  return (
    <div className="h-full overflow-y-auto">
      <BunkerVivo esSuperadmin={sesion?.perfil.rol === "superadmin"} />
    </div>
  );
}

import { Goal, Map as MapIcon, Users, UserCog } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BotonSalir } from "@/components/boton-salir";
import { LogoJxR } from "@/components/marca";
import { MigueChat } from "@/components/migue-chat";
import { sesionConPerfil } from "@/lib/supabase/servidor";

/**
 * Layout autenticado: exige sesión + perfil y fuerza el cambio de contraseña
 * del primer ingreso antes de dejar usar cualquier pantalla.
 */
export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await sesionConPerfil();
  if (!sesion) redirect("/acceso");
  const { perfil } = sesion;
  if (perfil.debe_cambiar_password) redirect("/cambiar-password");

  return (
    <div className="flex h-screen flex-col">
      <header className="panel-vidrio z-30 flex items-center justify-between gap-3 border-x-0 border-t-0 px-4 py-2">
        <div className="flex items-center gap-5">
          <Link href="/">
            <LogoJxR />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-texto-2 transition hover:bg-panel-3 hover:text-rosa"
            >
              <MapIcon size={14} /> Mapa
            </Link>
            <Link
              href="/personas"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-texto-2 transition hover:bg-panel-3 hover:text-rosa"
            >
              <Users size={14} /> Personas
            </Link>
            <Link
              href="/estrategia"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-texto-2 transition hover:bg-panel-3 hover:text-rosa"
            >
              <Goal size={14} /> Estrategia
            </Link>
            {perfil.rol === "superadmin" && (
              <Link
                href="/usuarios"
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-texto-2 transition hover:bg-panel-3 hover:text-rosa"
              >
                <UserCog size={14} /> Usuarios
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-xs font-bold">{perfil.nombre}</div>
            <div className="text-[10px] text-texto-3">
              {perfil.rol === "superadmin" ? "Superadmin" : "Admin"}
            </div>
          </div>
          <BotonSalir />
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">{children}</main>

      <MigueChat />
    </div>
  );
}

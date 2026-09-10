import Link from "next/link";
import { redirect } from "next/navigation";
import { BotonSalir } from "@/components/boton-salir";
import { BotonTema } from "@/components/boton-tema";
import { LogoJxR } from "@/components/marca";
import { ElenaChat } from "@/components/elena-chat";
import { NavApp } from "@/components/nav-app";
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
      <header className="panel-vidrio z-30 flex items-center justify-between gap-2 border-x-0 border-t-0 px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <Link href="/" className="shrink-0">
            <LogoJxR />
          </Link>
          <NavApp esSuperadmin={perfil.rol === "superadmin"} />
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* El nombre no cabe en pantallas chicas y no es información crítica */}
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-xs font-bold">{perfil.nombre}</div>
            <div className="text-[10px] text-texto-3">
              {perfil.rol === "superadmin" ? "Superadmin" : "Admin"}
            </div>
          </div>
          <BotonTema />
          <BotonSalir />
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">{children}</main>

      <ElenaChat />
    </div>
  );
}

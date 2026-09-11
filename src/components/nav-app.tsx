"use client";

import { Activity, Goal, Map as MapIcon, Menu, SlidersHorizontal, UserCog, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const SECCIONES = [
  { href: "/", etiqueta: "Mapa", icono: MapIcon },
  { href: "/personas", etiqueta: "Personas", icono: Users },
  { href: "/estrategia", etiqueta: "Estrategia", icono: Goal },
  { href: "/segmentos", etiqueta: "Segmentos", icono: SlidersHorizontal },
  { href: "/dia-d", etiqueta: "DÍA D", icono: Activity },
] as const;

/**
 * Navegación de la app. En pantallas chicas los cinco links no caben (se
 * cortaban), así que pasan a un menú desplegable; desde `md` se muestran
 * en línea como siempre.
 */
export function NavApp({ esSuperadmin }: { esSuperadmin: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();

  // Al navegar, el menú se cierra solo
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  const items = [...SECCIONES, ...(esSuperadmin ? [{ href: "/usuarios", etiqueta: "Usuarios", icono: UserCog } as const] : [])];
  const claseLink = (activo: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
      activo ? "bg-rosa/15 text-rosa" : "text-texto-2 hover:bg-panel-3 hover:text-rosa"
    }`;

  return (
    <>
      {/* En línea, desde md */}
      <nav className="hidden items-center gap-1 text-sm md:flex">
        {items.map((s) => (
          <Link key={s.href} href={s.href} className={claseLink(pathname === s.href)}>
            <s.icono size={14} /> {s.etiqueta}
          </Link>
        ))}
      </nav>

      {/* Botón del menú, solo en pantallas chicas */}
      <button
        onClick={() => setAbierto((v) => !v)}
        className="rounded-lg p-1.5 text-texto-2 transition hover:bg-panel-3 hover:text-rosa md:hidden"
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={abierto}
      >
        {abierto ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Menú desplegable */}
      {abierto && (
        <>
          <button
            onClick={() => setAbierto(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40 md:hidden"
            aria-label="Cerrar menú"
          />
          <nav className="panel-solido fixed top-[54px] right-2 left-2 z-50 flex flex-col gap-1 rounded-2xl p-2 text-sm md:hidden">
            {items.map((s) => (
              <Link key={s.href} href={s.href} className={claseLink(pathname === s.href)}>
                <s.icono size={15} /> {s.etiqueta}
              </Link>
            ))}
          </nav>
        </>
      )}
    </>
  );
}

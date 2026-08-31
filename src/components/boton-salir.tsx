"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

export function BotonSalir() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await crearClienteNavegador().auth.signOut();
        router.replace("/acceso");
        router.refresh();
      }}
      title="Cerrar sesión"
      className="rounded-lg border border-borde-2 p-2 text-texto-3 transition hover:border-peligro/50 hover:text-peligro"
    >
      <LogOut size={14} />
    </button>
  );
}

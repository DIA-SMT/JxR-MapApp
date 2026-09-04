"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoJxR } from "@/components/marca";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

/**
 * Cambio de contraseña obligatorio en el primer ingreso: hasta no completarlo,
 * el layout de la app redirige siempre acá.
 */
export default function PaginaCambiarPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cambiar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    if (password.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password === "123456") {
      setError("No podés reutilizar la contraseña inicial.");
      return;
    }
    setGuardando(true);
    const supabase = crearClienteNavegador();
    const { data: { user }, error: errorSesion } = await supabase.auth.getUser();
    if (errorSesion || !user) {
      router.replace("/acceso");
      return;
    }
    const { error: errorClave } = await supabase.auth.updateUser({ password });
    if (errorClave) {
      setError(
        errorClave.message.includes("different")
          ? "La nueva contraseña debe ser distinta de la actual."
          : `No se pudo cambiar: ${errorClave.message}`,
      );
      setGuardando(false);
      return;
    }
    await supabase.from("perfiles").update({ debe_cambiar_password: false }).eq("id", user.id);
    router.replace("/");
    router.refresh();
  };

  return (
    <main className="fondo-grilla flex min-h-screen items-center justify-center p-4">
      <div className="panel-vidrio w-full max-w-sm rounded-2xl p-8">
        <div className="mb-3 flex justify-center">
          <LogoJxR tam={40} />
        </div>
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amarillo/30 bg-amarillo/10 px-3 py-2.5">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amarillo" />
          <p className="text-xs leading-relaxed text-texto-2">
            <strong className="text-texto">Primer ingreso.</strong> Por seguridad tenés que
            elegir una contraseña nueva antes de usar el sistema.
          </p>
        </div>

        <form onSubmit={cambiar} className="space-y-3">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-texto-2 uppercase tracking-wide">
              <KeyRound size={11} /> Nueva contraseña
            </span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
              className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/60"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-texto-2 uppercase tracking-wide">
              <KeyRound size={11} /> Repetila
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/60"
            />
          </label>

          {error && (
            <p className="rounded-lg border border-peligro/40 bg-peligro/10 px-3 py-2 text-xs text-peligro">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="w-full rounded-xl bg-rosa py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar y entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}

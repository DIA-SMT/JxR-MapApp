"use client";

import { LockKeyhole, LogIn, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoJxR } from "@/components/marca";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

export default function PaginaAcceso() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (entrando) return;
    setEntrando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setError("Email o contraseña incorrectos.");
      setEntrando(false);
      return;
    }
    router.replace("/");
    router.refresh();
  };

  return (
    <main className="fondo-grilla flex min-h-screen items-center justify-center p-4">
      <div className="panel-vidrio w-full max-w-sm rounded-2xl p-8">
        <div className="mb-2 flex justify-center">
          <LogoJxR tam={44} />
        </div>
        <p className="mb-6 text-center text-xs text-texto-2">
          Asignación de distritos y circuitos electorales
          <br />
          San Miguel de Tucumán · acceso solo para administradores
        </p>

        <form onSubmit={entrar} className="space-y-3">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-texto-2 uppercase tracking-wide">
              <Mail size={11} /> Email
            </span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin1@jxr.com"
              className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/60"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-texto-2 uppercase tracking-wide">
              <LockKeyhole size={11} /> Contraseña
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
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
            disabled={entrando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-rosa py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            <LogIn size={15} />
            {entrando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}

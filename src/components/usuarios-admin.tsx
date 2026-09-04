"use client";

import { KeyRound, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import type { Perfil } from "@/lib/tipos";

/** Alta y baja de usuarios administradores — pantalla exclusiva del superadmin. */
export function UsuariosAdmin({ miId }: { miId: string }) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<"admin" | "superadmin">("admin");
  const [passwordInicial, setPasswordInicial] = useState("123456");
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recargar = useCallback(async () => {
    const { data } = await supabase
      .from("perfiles")
      .select("id, email, nombre, rol, debe_cambiar_password")
      .order("creado_en");
    setUsuarios((data as Perfil[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const crear = async () => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), nombre: nombre.trim(), rol, passwordInicial }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "no se pudo crear");
        return;
      }
      setEmail("");
      setNombre("");
      setRol("admin");
      setPasswordInicial("123456");
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const eliminar = async (id: string) => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? "no se pudo eliminar");
      setConfirmarBorrar(null);
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <UserCog size={18} className="text-rosa" />
        <h1 className="text-lg font-extrabold">Usuarios del sistema</h1>
        <span className="num rounded-full border border-borde-2 px-2 py-0.5 text-[10px] text-texto-2">
          {usuarios.length}
        </span>
      </div>

      <p className="text-xs text-texto-2">
        Cada usuario entra con la contraseña inicial y el sistema le exige cambiarla en el primer
        ingreso. Al eliminar un usuario se revoca su acceso de inmediato.
      </p>

      {/* Alta */}
      <div className="panel-vidrio flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@jxr.com"
          type="email"
          className="min-w-44 flex-1 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          className="w-36 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
        <select
          value={rol}
          onChange={(e) => setRol(e.target.value as "admin" | "superadmin")}
          className="rounded-xl border border-borde-2 bg-panel-2 px-2.5 py-2 text-sm outline-none focus:border-rosa/50"
        >
          <option value="admin">Admin</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <input
          value={passwordInicial}
          onChange={(e) => setPasswordInicial(e.target.value)}
          placeholder="Contraseña inicial"
          title="Contraseña inicial (la debe cambiar al entrar)"
          className="w-36 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/50"
        />
        <button
          onClick={() => void crear()}
          disabled={ocupado || email.trim() === "" || nombre.trim() === "" || passwordInicial.length < 6}
          className="flex items-center gap-1.5 rounded-xl bg-rosa px-3.5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <Plus size={14} /> Crear
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-peligro/40 bg-peligro/10 px-3 py-2 text-xs text-peligro">{error}</p>
      )}

      {/* Listado */}
      <div className="space-y-2">
        {usuarios.map((u) => (
          <div key={u.id} className="panel-vidrio flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{u.nombre}</span>
                <span
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    u.rol === "superadmin"
                      ? "border-amarillo/40 bg-amarillo/10 text-amarillo"
                      : "border-rosa/40 bg-rosa/10 text-rosa"
                  }`}
                >
                  <ShieldCheck size={9} /> {u.rol}
                </span>
                {u.debe_cambiar_password && (
                  <span
                    className="flex items-center gap-1 rounded-full border border-borde-2 px-2 py-0.5 text-[10px] text-texto-3"
                    title="Todavía no entró: debe cambiar la contraseña inicial"
                  >
                    <KeyRound size={9} /> clave inicial pendiente
                  </span>
                )}
              </div>
              <div className="text-[11px] text-texto-3">{u.email}</div>
            </div>
            {u.id !== miId &&
              (confirmarBorrar === u.id ? (
                <button
                  onClick={() => void eliminar(u.id)}
                  disabled={ocupado}
                  className="rounded-lg bg-peligro px-3 py-1.5 text-[11px] font-bold text-white"
                >
                  ¿Eliminar definitivamente?
                </button>
              ) : (
                <button
                  onClick={() => setConfirmarBorrar(u.id)}
                  className="rounded-lg border border-borde-2 p-2 text-texto-3 transition hover:border-peligro/50 hover:text-peligro"
                  title="Eliminar usuario"
                >
                  <Trash2 size={13} />
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

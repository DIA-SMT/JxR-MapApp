"use client";

import { MapPin, Pencil, Plus, Save, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { etiquetaEspacio } from "@/lib/espacios";
import { useTerritorio } from "@/lib/territorio";
import type { Persona } from "@/lib/tipos";

/** ABM de personas del operativo, con sus espacios asignados a la vista. */
export function PersonasAdmin() {
  const { supabase, personas, asignaciones, tareas, cargando, recargar } = useTerritorio();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<Persona | null>(null);
  const [confirmarBorrar, setConfirmarBorrar] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const porPersona = useMemo(() => {
    const hechasPorAsignacion = new Map<number, { hechas: number; total: number }>();
    for (const t of tareas) {
      const r = hechasPorAsignacion.get(t.asignacion_id) ?? { hechas: 0, total: 0 };
      r.total++;
      if (t.hecha) r.hechas++;
      hechasPorAsignacion.set(t.asignacion_id, r);
    }
    const mapa = new Map<number, { espacios: typeof asignaciones; hechas: number; total: number }>();
    for (const a of asignaciones) {
      const r = mapa.get(a.persona_id) ?? { espacios: [], hechas: 0, total: 0 };
      r.espacios.push(a);
      const t = hechasPorAsignacion.get(a.id);
      if (t) {
        r.hechas += t.hechas;
        r.total += t.total;
      }
      mapa.set(a.persona_id, r);
    }
    return mapa;
  }, [asignaciones, tareas]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return personas;
    return personas.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        (p.telefono ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q),
    );
  }, [personas, busqueda]);

  const crear = async () => {
    const n = nombre.trim();
    if (!n) return;
    setError(null);
    const { error } = await supabase
      .from("personas")
      .insert({ nombre: n, telefono: telefono.trim() || null, email: email.trim() || null });
    if (error) setError(error.message);
    setNombre("");
    setTelefono("");
    setEmail("");
    await recargar();
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    setError(null);
    const { error } = await supabase
      .from("personas")
      .update({
        nombre: editando.nombre.trim(),
        telefono: editando.telefono?.trim() || null,
        email: editando.email?.trim() || null,
        notas: editando.notas?.trim() || null,
      })
      .eq("id", editando.id);
    if (error) setError(error.message);
    setEditando(null);
    await recargar();
  };

  const eliminar = async (id: number) => {
    setError(null);
    const { error } = await supabase.from("personas").delete().eq("id", id);
    if (error) setError(error.message);
    setConfirmarBorrar(null);
    await recargar();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-celeste" />
        <h1 className="text-lg font-extrabold">Personas del operativo</h1>
        <span className="num rounded-full border border-borde-2 px-2 py-0.5 text-[10px] text-texto-2">
          {personas.length}
        </span>
      </div>

      {/* Alta */}
      <div className="panel-vidrio flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void crear()}
          placeholder="Nombre y apellido"
          className="min-w-40 flex-1 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="Teléfono"
          className="w-36 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (opcional)"
          className="w-48 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <button
          onClick={() => void crear()}
          disabled={nombre.trim() === ""}
          className="flex items-center gap-1.5 rounded-xl bg-azul px-3.5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <Plus size={14} /> Agregar
        </button>
      </div>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre, teléfono o email…"
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
      />

      {error && (
        <p className="rounded-lg border border-peligro/40 bg-peligro/10 px-3 py-2 text-xs text-peligro">{error}</p>
      )}

      {/* Listado */}
      <div className="space-y-2">
        {cargando && <p className="text-sm text-texto-3">Cargando…</p>}
        {!cargando && filtradas.length === 0 && (
          <p className="text-sm text-texto-3">No hay personas {busqueda ? "que coincidan" : "cargadas todavía"}.</p>
        )}
        {filtradas.map((p) => {
          const r = porPersona.get(p.id);
          const enEdicion = editando?.id === p.id;
          return (
            <div key={p.id} className="panel-vidrio rounded-2xl p-3">
              {enEdicion ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={editando.nombre}
                    onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                    className="min-w-40 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.telefono ?? ""}
                    onChange={(e) => setEditando({ ...editando, telefono: e.target.value })}
                    placeholder="Teléfono"
                    className="w-32 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.email ?? ""}
                    onChange={(e) => setEditando({ ...editando, email: e.target.value })}
                    placeholder="Email"
                    className="w-44 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.notas ?? ""}
                    onChange={(e) => setEditando({ ...editando, notas: e.target.value })}
                    placeholder="Notas"
                    className="min-w-40 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <button onClick={() => void guardarEdicion()} className="rounded-lg bg-azul p-2 text-white" title="Guardar">
                    <Save size={13} />
                  </button>
                  <button onClick={() => setEditando(null)} className="rounded-lg border border-borde-2 p-2 text-texto-3" title="Cancelar">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{p.nombre}</span>
                      {r && r.total > 0 && (
                        <span className="num text-[10px] text-texto-3">
                          tareas {r.hechas}/{r.total}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-texto-3">
                      {[p.telefono, p.email, p.notas].filter(Boolean).join(" · ") || "sin datos de contacto"}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(r?.espacios ?? []).map((a) => (
                        <Link
                          key={a.id}
                          href={`/?tipo=${a.tipo}&codigo=${encodeURIComponent(a.codigo)}`}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition hover:brightness-125 ${
                            a.tipo === "distrito"
                              ? "border-distrito/40 bg-distrito/10 text-distrito"
                              : "border-circuito/40 bg-circuito/10 text-circuito"
                          }`}
                          title="Ver en el mapa"
                        >
                          <MapPin size={9} />
                          {etiquetaEspacio(a.tipo, a.codigo)}
                          {a.rol_asignacion ? ` · ${a.rol_asignacion}` : ""}
                        </Link>
                      ))}
                      {(r?.espacios ?? []).length === 0 && (
                        <span className="text-[10px] text-texto-3">sin espacios asignados</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setEditando(p)}
                      className="rounded-lg border border-borde-2 p-2 text-texto-3 transition hover:text-texto"
                      title="Editar"
                    >
                      <Pencil size={12} />
                    </button>
                    {confirmarBorrar === p.id ? (
                      <button
                        onClick={() => void eliminar(p.id)}
                        className="rounded-lg bg-peligro px-2.5 py-1.5 text-[11px] font-bold text-white"
                        title="Se borran también sus asignaciones y tareas"
                      >
                        ¿Borrar?
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmarBorrar(p.id)}
                        className="rounded-lg border border-borde-2 p-2 text-texto-3 transition hover:border-peligro/50 hover:text-peligro"
                        title="Eliminar persona"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

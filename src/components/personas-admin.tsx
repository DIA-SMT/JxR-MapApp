"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  IdCard,
  ListChecks,
  MapPin,
  Pencil,
  Plus,
  Save,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { etiquetaEspacio } from "@/lib/espacios";
import { useTerritorio } from "@/lib/territorio";
import type { Persona } from "@/lib/tipos";

/**
 * ABM de personas del operativo. Las personas NO son usuarios del sistema:
 * son gente real e identificable del territorio (nombre, DNI, dirección,
 * teléfono) a la que se le asignan espacios y tareas. Desde acá también se
 * gestiona el checklist de cada asignación sin pasar por el mapa.
 */
export function PersonasAdmin() {
  const { supabase, personas, asignaciones, tareas, cargando, recargar } = useTerritorio();
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
  }, [supabase]);

  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<Persona | null>(null);
  const [confirmarBorrar, setConfirmarBorrar] = useState<number | null>(null);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [tareaNueva, setTareaNueva] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const tareasPorAsignacion = useMemo(() => {
    const mapa = new Map<number, typeof tareas>();
    for (const t of tareas) {
      const lista = mapa.get(t.asignacion_id) ?? [];
      lista.push(t);
      mapa.set(t.asignacion_id, lista);
    }
    return mapa;
  }, [tareas]);

  const porPersona = useMemo(() => {
    const mapa = new Map<number, { espacios: typeof asignaciones; hechas: number; total: number }>();
    for (const a of asignaciones) {
      const r = mapa.get(a.persona_id) ?? { espacios: [], hechas: 0, total: 0 };
      r.espacios.push(a);
      for (const t of tareasPorAsignacion.get(a.id) ?? []) {
        r.total++;
        if (t.hecha) r.hechas++;
      }
      mapa.set(a.persona_id, r);
    }
    return mapa;
  }, [asignaciones, tareasPorAsignacion]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return personas;
    return personas.filter((p) =>
      [p.nombre, p.documento, p.telefono, p.email, p.direccion]
        .some((campo) => (campo ?? "").toLowerCase().includes(q)),
    );
  }, [personas, busqueda]);

  const crear = async () => {
    const n = nombre.trim();
    if (!n) return;
    setError(null);
    const { error } = await supabase.from("personas").insert({
      nombre: n,
      documento: documento.trim() || null,
      telefono: telefono.trim() || null,
      direccion: direccion.trim() || null,
      creado_por: usuarioId,
    });
    if (error) setError(error.message);
    setNombre("");
    setDocumento("");
    setTelefono("");
    setDireccion("");
    await recargar();
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    setError(null);
    const { error } = await supabase
      .from("personas")
      .update({
        nombre: editando.nombre.trim(),
        documento: editando.documento?.trim() || null,
        direccion: editando.direccion?.trim() || null,
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

  const agregarTarea = async (asignacionId: number) => {
    const titulo = (tareaNueva[asignacionId] ?? "").trim();
    if (!titulo) return;
    setError(null);
    const { error } = await supabase
      .from("tareas")
      .insert({ asignacion_id: asignacionId, titulo, creado_por: usuarioId });
    if (error) setError(error.message);
    setTareaNueva((t) => ({ ...t, [asignacionId]: "" }));
    await recargar();
  };

  const alternarTarea = async (id: number, hecha: boolean) => {
    const { error } = await supabase
      .from("tareas")
      .update(
        hecha
          ? { hecha: true, hecha_en: new Date().toISOString(), hecha_por: usuarioId }
          : { hecha: false, hecha_en: null, hecha_por: null },
      )
      .eq("id", id);
    if (error) setError(error.message);
    await recargar();
  };

  const eliminarTarea = async (id: number) => {
    const { error } = await supabase.from("tareas").delete().eq("id", id);
    if (error) setError(error.message);
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

      <p className="text-xs text-texto-2">
        Personas reales e identificables del territorio (no son usuarios del sistema). Cargalas acá
        y asignales espacios desde el mapa; el checklist de cada una también se maneja desde su ficha.
      </p>

      {/* Alta */}
      <div className="panel-vidrio flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void crear()}
          placeholder="Nombre y apellido"
          className="min-w-44 flex-1 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <input
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          placeholder="DNI"
          className="w-32 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="Teléfono"
          className="w-36 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
        />
        <input
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
          placeholder="Dirección"
          className="min-w-40 flex-1 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
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
        placeholder="Buscar por nombre, DNI, teléfono, dirección o email…"
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
          const abierta = expandida === p.id;
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
                    value={editando.documento ?? ""}
                    onChange={(e) => setEditando({ ...editando, documento: e.target.value })}
                    placeholder="DNI"
                    className="w-28 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.telefono ?? ""}
                    onChange={(e) => setEditando({ ...editando, telefono: e.target.value })}
                    placeholder="Teléfono"
                    className="w-32 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.direccion ?? ""}
                    onChange={(e) => setEditando({ ...editando, direccion: e.target.value })}
                    placeholder="Dirección"
                    className="min-w-36 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.email ?? ""}
                    onChange={(e) => setEditando({ ...editando, email: e.target.value })}
                    placeholder="Email"
                    className="w-40 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <input
                    value={editando.notas ?? ""}
                    onChange={(e) => setEditando({ ...editando, notas: e.target.value })}
                    placeholder="Notas"
                    className="min-w-36 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-celeste/50"
                  />
                  <button onClick={() => void guardarEdicion()} className="rounded-lg bg-azul p-2 text-white" title="Guardar">
                    <Save size={13} />
                  </button>
                  <button onClick={() => setEditando(null)} className="rounded-lg border border-borde-2 p-2 text-texto-3" title="Cancelar">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{p.nombre}</span>
                        {p.documento && (
                          <span className="flex items-center gap-1 rounded-full border border-borde-2 bg-panel-2 px-2 py-0.5 text-[10px] font-semibold text-texto-2">
                            <IdCard size={10} /> DNI {p.documento}
                          </span>
                        )}
                        {r && r.total > 0 && (
                          <span className="num text-[10px] text-texto-3">
                            tareas {r.hechas}/{r.total}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-texto-3">
                        {[p.telefono, p.direccion, p.email, p.notas].filter(Boolean).join(" · ") ||
                          "sin datos de contacto"}
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
                          <span className="text-[10px] text-texto-3">
                            sin espacios asignados — asignale uno desde el mapa
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {(r?.espacios ?? []).length > 0 && (
                        <button
                          onClick={() => setExpandida(abierta ? null : p.id)}
                          className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold transition ${
                            abierta
                              ? "border-celeste/50 text-celeste"
                              : "border-borde-2 text-texto-3 hover:text-texto"
                          }`}
                          title="Ver y cargar las tareas de esta persona"
                        >
                          <ListChecks size={12} />
                          Tareas
                          {abierta ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        </button>
                      )}
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

                  {/* Checklist por asignación, directo desde la ficha */}
                  {abierta && (
                    <div className="mt-3 space-y-2 border-t border-borde pt-3">
                      {(r?.espacios ?? []).map((a) => {
                        const suyas = tareasPorAsignacion.get(a.id) ?? [];
                        return (
                          <div key={a.id} className="rounded-xl border border-borde bg-panel-2/70 p-2.5">
                            <div className="mb-1.5 text-[11px] font-bold text-texto-2">
                              {etiquetaEspacio(a.tipo, a.codigo)}
                              {a.rol_asignacion ? ` · ${a.rol_asignacion}` : ""}
                            </div>
                            <div className="space-y-1">
                              {suyas.map((t) => (
                                <div key={t.id} className="group flex items-center gap-2">
                                  <button
                                    onClick={() => void alternarTarea(t.id, !t.hecha)}
                                    className={`shrink-0 transition ${t.hecha ? "text-completo" : "text-texto-3 hover:text-texto"}`}
                                    title={t.hecha ? "Marcar como pendiente" : "Marcar como hecha"}
                                  >
                                    {t.hecha ? <Check size={14} /> : <Square size={13} />}
                                  </button>
                                  <span className={`flex-1 text-xs ${t.hecha ? "text-texto-3 line-through" : ""}`}>
                                    {t.titulo}
                                  </span>
                                  <button
                                    onClick={() => void eliminarTarea(t.id)}
                                    className="text-texto-3 opacity-0 transition group-hover:opacity-100 hover:text-peligro"
                                    title="Eliminar tarea"
                                  >
                                    <X size={11} />
                                  </button>
                                </div>
                              ))}
                              <div className="flex items-center gap-1.5 pt-1">
                                <input
                                  value={tareaNueva[a.id] ?? ""}
                                  onChange={(e) => setTareaNueva((t) => ({ ...t, [a.id]: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && void agregarTarea(a.id)}
                                  placeholder="Nueva tarea…"
                                  className="flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-celeste/50"
                                />
                                <button
                                  onClick={() => void agregarTarea(a.id)}
                                  className="rounded-lg bg-azul p-1.5 text-white transition hover:brightness-110"
                                  title="Agregar tarea"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

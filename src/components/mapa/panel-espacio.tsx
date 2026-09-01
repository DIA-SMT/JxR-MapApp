"use client";

import { Check, Plus, Square, Trash2, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { etiquetaEspacio } from "@/lib/espacios";
import type { ResumenEspacio, useTerritorio } from "@/lib/territorio";
import type { SeleccionEspacio } from "./mapa-electoral";

const CHIP_ESTADO = {
  sin: { texto: "Sin asignar", clase: "border-sin/40 bg-sin/10 text-sin" },
  en_curso: { texto: "En curso", clase: "border-encurso/40 bg-encurso/10 text-encurso" },
  completo: { texto: "Completo", clase: "border-completo/40 bg-completo/10 text-completo" },
} as const;

/**
 * Panel del espacio seleccionado: quiénes lo tienen asignado y el checklist
 * de tareas de cada asignación. Todas las operaciones son de administradores.
 */
export function PanelEspacio({
  seleccion,
  resumen,
  territorio,
  onCerrar,
}: {
  seleccion: SeleccionEspacio;
  resumen: ResumenEspacio | null;
  territorio: ReturnType<typeof useTerritorio>;
  onCerrar: () => void;
}) {
  const { supabase, personas, tareas, recargar } = territorio;
  const [usuarioId, setUsuarioId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
  }, [supabase]);

  const [personaSel, setPersonaSel] = useState("");
  const [rolAsignacion, setRolAsignacion] = useState("");
  const [nuevaPersona, setNuevaPersona] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoDocumento, setNuevoDocumento] = useState("");
  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevaDireccion, setNuevaDireccion] = useState("");
  const [tareaNueva, setTareaNueva] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asignaciones = resumen?.asignaciones ?? [];
  const estado = resumen?.estado ?? "sin";
  const chip = CHIP_ESTADO[estado];

  const tareasPorAsignacion = useMemo(() => {
    const mapa = new Map<number, typeof tareas>();
    for (const t of tareas) {
      const lista = mapa.get(t.asignacion_id) ?? [];
      lista.push(t);
      mapa.set(t.asignacion_id, lista);
    }
    return mapa;
  }, [tareas]);

  const personasDisponibles = useMemo(() => {
    const asignadas = new Set(asignaciones.map((a) => a.persona_id));
    return personas.filter((p) => !asignadas.has(p.id));
  }, [personas, asignaciones]);

  const correr = async (fn: () => Promise<{ error: { message: string } | null } | void>) => {
    if (ocupado) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await fn();
      if (r && r.error) setError(r.error.message);
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const asignar = () =>
    correr(async () => {
      let personaId = Number(personaSel);
      if (nuevaPersona) {
        const nombre = nuevoNombre.trim();
        if (!nombre) return;
        const { data, error } = await supabase
          .from("personas")
          .insert({
            nombre,
            documento: nuevoDocumento.trim() || null,
            telefono: nuevoTelefono.trim() || null,
            direccion: nuevaDireccion.trim() || null,
            creado_por: usuarioId,
          })
          .select("id")
          .single();
        if (error) return { error };
        personaId = data.id;
        setNuevoNombre("");
        setNuevoDocumento("");
        setNuevoTelefono("");
        setNuevaDireccion("");
        setNuevaPersona(false);
      }
      if (!personaId) return;
      const { error } = await supabase.from("asignaciones").insert({
        persona_id: personaId,
        tipo: seleccion.tipo,
        codigo: seleccion.codigo,
        rol_asignacion: rolAsignacion.trim() || null,
        creado_por: usuarioId,
      });
      setPersonaSel("");
      setRolAsignacion("");
      return { error };
    });

  const quitarAsignacion = (id: number) =>
    correr(async () => {
      const { error } = await supabase.from("asignaciones").delete().eq("id", id);
      return { error };
    });

  const agregarTarea = (asignacionId: number) =>
    correr(async () => {
      const titulo = (tareaNueva[asignacionId] ?? "").trim();
      if (!titulo) return;
      const { error } = await supabase
        .from("tareas")
        .insert({ asignacion_id: asignacionId, titulo, creado_por: usuarioId });
      setTareaNueva((t) => ({ ...t, [asignacionId]: "" }));
      return { error };
    });

  const alternarTarea = (id: number, hecha: boolean) =>
    correr(async () => {
      const { error } = await supabase
        .from("tareas")
        .update(
          hecha
            ? { hecha: true, hecha_en: new Date().toISOString(), hecha_por: usuarioId }
            : { hecha: false, hecha_en: null, hecha_por: null },
        )
        .eq("id", id);
      return { error };
    });

  const eliminarTarea = (id: number) =>
    correr(async () => {
      const { error } = await supabase.from("tareas").delete().eq("id", id);
      return { error };
    });

  return (
    // bottom 76px: deja libre el botón flotante de Migue (z-40), que si no tapa el formulario
    <aside className="panel-vidrio absolute top-3 right-3 bottom-[76px] z-20 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-borde bg-panel-2/60 px-4 py-3">
        <div>
          <div className="text-sm font-extrabold">
            {etiquetaEspacio(seleccion.tipo, seleccion.codigo)}
          </div>
          <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${chip.clase}`}>
            {chip.texto}
            {resumen && resumen.tareas.length > 0 && ` · ${resumen.nHechas}/${resumen.tareas.length} tareas`}
          </span>
        </div>
        <button onClick={onCerrar} className="text-texto-3 hover:text-texto">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {asignaciones.length === 0 && (
          <p className="px-1 text-xs text-texto-2">
            Nadie tiene asignado este espacio todavía. Asigná una persona abajo.
          </p>
        )}

        {asignaciones.map((a) => {
          const suyas = tareasPorAsignacion.get(a.id) ?? [];
          return (
            <div key={a.id} className="rounded-xl border border-borde bg-panel-2/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-bold">{a.personas?.nombre ?? `Persona #${a.persona_id}`}</div>
                  <div className="text-[10px] text-texto-3">
                    {[
                      a.rol_asignacion ?? "responsable",
                      a.personas?.documento ? `DNI ${a.personas.documento}` : null,
                      a.personas?.telefono,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  onClick={() => void quitarAsignacion(a.id)}
                  title="Quitar la asignación (sus tareas se borran)"
                  className="text-texto-3 transition hover:text-peligro"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Checklist */}
              <div className="mt-2 space-y-1">
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
                    placeholder="Nueva tarea del checklist…"
                    className="flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-celeste/50"
                  />
                  <button
                    onClick={() => void agregarTarea(a.id)}
                    disabled={ocupado}
                    className="rounded-lg bg-azul p-1.5 text-white transition hover:brightness-110 disabled:opacity-40"
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

      {/* Asignar persona */}
      <div className="border-t border-borde bg-panel-2/60 p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
            Asignar persona
          </span>
          <button
            onClick={() => setNuevaPersona((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-celeste hover:underline"
          >
            <UserPlus size={11} /> {nuevaPersona ? "elegir existente" : "nueva persona"}
          </button>
        </div>

        {nuevaPersona ? (
          <div className="space-y-1.5">
            <input
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre y apellido"
              className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-celeste/50"
            />
            <div className="flex gap-1.5">
              <input
                value={nuevoDocumento}
                onChange={(e) => setNuevoDocumento(e.target.value)}
                placeholder="DNI"
                className="w-24 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-celeste/50"
              />
              <input
                value={nuevoTelefono}
                onChange={(e) => setNuevoTelefono(e.target.value)}
                placeholder="Teléfono"
                className="flex-1 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-celeste/50"
              />
            </div>
            <input
              value={nuevaDireccion}
              onChange={(e) => setNuevaDireccion(e.target.value)}
              placeholder="Dirección (opcional)"
              className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-celeste/50"
            />
          </div>
        ) : (
          <select
            value={personaSel}
            onChange={(e) => setPersonaSel(e.target.value)}
            className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none focus:border-celeste/50"
          >
            <option value="">— elegir persona —</option>
            {personasDisponibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.documento ? ` · DNI ${p.documento}` : ""}
                {p.telefono ? ` · ${p.telefono}` : ""}
              </option>
            ))}
          </select>
        )}

        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={rolAsignacion}
            onChange={(e) => setRolAsignacion(e.target.value)}
            placeholder="Rol (referente, fiscal…)"
            className="flex-1 rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-celeste/50"
          />
          <button
            onClick={() => void asignar()}
            disabled={ocupado || (nuevaPersona ? nuevoNombre.trim() === "" : personaSel === "")}
            className="rounded-lg bg-azul px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Asignar
          </button>
        </div>

        {error && <p className="mt-1.5 text-[10px] text-peligro">{error}</p>}
      </div>
    </aside>
  );
}

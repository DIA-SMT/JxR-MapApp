"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import type { Asignacion, Persona, Tarea, TipoEspacio } from "@/lib/tipos";

export type EstadoCobertura = "sin" | "en_curso" | "completo";

export interface ResumenEspacio {
  asignaciones: Asignacion[];
  tareas: Tarea[];
  nHechas: number;
  estado: EstadoCobertura;
}

export const claveEspacio = (tipo: TipoEspacio, codigo: string) => `${tipo}:${codigo}`;

/**
 * Datos vivos del operativo: personas, asignaciones (con su persona) y tareas,
 * agregados por espacio. Toda mutación llama a `recargar()`.
 */
export function useTerritorio() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    const [p, a, t] = await Promise.all([
      supabase.from("personas").select("id, nombre, telefono, email, notas").order("nombre"),
      supabase
        .from("asignaciones")
        .select("id, persona_id, tipo, codigo, rol_asignacion, personas (id, nombre, telefono, email, notas)")
        .order("creado_en"),
      supabase.from("tareas").select("id, asignacion_id, titulo, hecha, hecha_en").order("creado_en"),
    ]);
    setPersonas((p.data as Persona[]) ?? []);
    setAsignaciones((a.data as unknown as Asignacion[]) ?? []);
    setTareas((t.data as Tarea[]) ?? []);
    setCargando(false);
  }, [supabase]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const porEspacio = useMemo(() => {
    const tareasPorAsignacion = new Map<number, Tarea[]>();
    for (const t of tareas) {
      const lista = tareasPorAsignacion.get(t.asignacion_id) ?? [];
      lista.push(t);
      tareasPorAsignacion.set(t.asignacion_id, lista);
    }
    const mapa = new Map<string, ResumenEspacio>();
    for (const a of asignaciones) {
      const clave = claveEspacio(a.tipo, a.codigo);
      const r = mapa.get(clave) ?? { asignaciones: [], tareas: [], nHechas: 0, estado: "sin" as EstadoCobertura };
      r.asignaciones.push(a);
      for (const t of tareasPorAsignacion.get(a.id) ?? []) {
        r.tareas.push(t);
        if (t.hecha) r.nHechas++;
      }
      mapa.set(clave, r);
    }
    for (const r of mapa.values()) {
      r.estado =
        r.tareas.length > 0 && r.nHechas === r.tareas.length ? "completo" : "en_curso";
    }
    return mapa;
  }, [asignaciones, tareas]);

  return { supabase, personas, asignaciones, tareas, porEspacio, cargando, recargar };
}

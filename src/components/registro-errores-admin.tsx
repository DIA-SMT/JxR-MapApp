"use client";

import { Bug, Check, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

interface FilaError {
  id: number;
  primera_vez: string;
  ultima_vez: string;
  veces: number;
  origen: "navegador" | "servidor";
  donde: string;
  mensaje: string;
  detalle: string;
  usuario_email: string;
  navegador: string;
  revisado: boolean;
}

const fecha = (s: string) =>
  new Date(s).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Lo que falló en la app: para el superadmin, sin depender de los registros de Vercel (duran una hora). */
export function RegistroErroresAdmin() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [filas, setFilas] = useState<FilaError[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [abierto, setAbierto] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("errores_app")
      .select("*")
      .order("ultima_vez", { ascending: false })
      .limit(200);
    if (e) {
      setError(
        e.code === "42P01" || e.code === "PGRST205"
          ? "El registro de errores todavía no está activado en la base (falta la migración 0018)."
          : e.message,
      );
      return;
    }
    setError(null);
    setFilas((data as FilaError[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const revisar = async (ids: number[]) => {
    if (ids.length === 0) return;
    const { error: e } = await supabase.from("errores_app").update({ revisado: true }).in("id", ids);
    if (e) setError(e.message);
    else await cargar();
  };

  const visibles = (filas ?? []).filter((f) => !soloPendientes || !f.revisado);
  const pendientes = (filas ?? []).filter((f) => !f.revisado).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Bug size={16} className="text-rosa" />
        <h2 className="text-base font-extrabold">Registro de errores</h2>
        {filas && (
          <span
            className={`num rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              pendientes > 0 ? "border-encurso/50 bg-encurso/10 text-encurso" : "border-completo/50 text-completo"
            }`}
          >
            {pendientes > 0 ? `${pendientes} sin revisar` : "todo revisado"}
          </span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] text-texto-2">
          <input
            type="checkbox"
            checked={soloPendientes}
            onChange={(e) => setSoloPendientes(e.target.checked)}
            className="accent-[#e14f82]"
          />
          solo sin revisar
        </label>
        <button
          onClick={() => void cargar()}
          className="flex items-center gap-1 rounded-lg border border-borde-2 px-2 py-1 text-[11px] font-bold text-texto-2 hover:text-rosa"
        >
          <RefreshCw size={11} /> Actualizar
        </button>
      </div>
      <p className="text-[11px] text-texto-3">
        Lo que falló en la aplicación, en el navegador de cada usuario o en el servidor. El mismo error repetido suma
        veces en lugar de una fila nueva. Los números de documento y los correos se guardan tapados. Se borra a los 90
        días.
      </p>

      {error && (
        <p className="rounded-lg border border-encurso/40 bg-encurso/10 px-3 py-2 text-xs text-encurso">{error}</p>
      )}
      {!filas && !error && <p className="text-[11px] text-texto-3">Cargando…</p>}
      {filas && visibles.length === 0 && (
        <p className="panel-vidrio rounded-2xl p-4 text-center text-[11px] text-texto-3">
          {soloPendientes ? "No hay errores sin revisar." : "No se registró ningún error."}
        </p>
      )}

      {visibles.length > 1 && soloPendientes && (
        <button
          onClick={() => void revisar(visibles.map((f) => f.id))}
          className="text-[11px] font-bold text-texto-2 hover:text-completo"
        >
          Marcar los {visibles.length} como revisados
        </button>
      )}

      <div className="space-y-1.5">
        {visibles.map((f) => (
          <div key={f.id} className={`panel-vidrio rounded-xl ${f.revisado ? "opacity-60" : ""}`}>
            <div className="flex items-start gap-2 px-3 py-2">
              <button
                onClick={() => setAbierto(abierto === f.id ? null : f.id)}
                className="mt-0.5 shrink-0 text-texto-3"
                aria-label="Ver el detalle"
              >
                {abierto === f.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-semibold break-words">{f.mensaje}</div>
                <div className="mt-0.5 text-[10px] text-texto-3">
                  <span className={f.origen === "servidor" ? "text-encurso" : ""}>{f.origen}</span> · {f.donde || "—"} ·{" "}
                  {f.usuario_email || "sin usuario"} · {fecha(f.ultima_vez)}
                  {f.veces > 1 && (
                    <>
                      {" "}
                      · <b className="num text-texto-2">{f.veces} veces</b> desde {fecha(f.primera_vez)}
                    </>
                  )}
                </div>
              </div>
              {!f.revisado && (
                <button
                  onClick={() => void revisar([f.id])}
                  title="Marcar como revisado"
                  className="shrink-0 rounded-md border border-borde-2 p-1 text-texto-3 hover:border-completo/50 hover:text-completo"
                >
                  <Check size={12} />
                </button>
              )}
            </div>
            {abierto === f.id && (
              <div className="border-t border-borde px-3 py-2">
                {f.navegador && <div className="mb-1 text-[10px] text-texto-3">{f.navegador}</div>}
                <pre className="max-h-60 overflow-auto text-[10px] leading-snug whitespace-pre-wrap text-texto-2">
                  {f.detalle || "sin más detalle"}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

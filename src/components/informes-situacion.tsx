"use client";

import { FileText, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

interface Informe {
  id: number;
  titulo: string;
  contenido: string;
  generado_en: string;
}

/** Render mínimo: **texto** → negrita real (el formato que usa Elena). */
function ConNegritas({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-bold text-texto">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * Informes de situación: Elena recorre el operativo completo (cobertura,
 * estrategia, oportunidades, alertas, fichas) y escribe el parte, que queda
 * guardado y compartido para todo el equipo.
 */
export function InformesSituacion() {
  const [supabase] = useState(crearClienteNavegador);
  const [informes, setInformes] = useState<Informe[] | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    const { data } = await supabase
      .from("informes")
      .select("id, titulo, contenido, generado_en")
      .order("generado_en", { ascending: false })
      .limit(30);
    setInformes((data as Informe[]) ?? []);
  };
  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generar = async () => {
    if (generando) return;
    setGenerando(true);
    setError(null);
    try {
      const res = await fetch("/api/informe", { method: "POST" });
      const data = (await res.json()) as { informe?: Informe; error?: string };
      if (!res.ok || !data.informe) throw new Error(data.error ?? "no pude generar el informe");
      setInformes((xs) => [data.informe!, ...(xs ?? [])]);
      setAbierto(data.informe.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude generar el informe");
    } finally {
      setGenerando(false);
    }
  };

  const borrar = async (id: number) => {
    await supabase.from("informes").delete().eq("id", id);
    setInformes((xs) => (xs ?? []).filter((i) => i.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="panel-vidrio flex flex-wrap items-center justify-between gap-2 rounded-2xl p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <FileText size={15} className="text-rosa" /> Informes de situación
          </h2>
          <p className="mt-0.5 text-[11px] text-texto-2">
            Elena recorre el operativo completo (cobertura, estrategia, oportunidades, alertas y fichas) y escribe
            el parte. Queda guardado para todo el equipo.
          </p>
        </div>
        <button
          onClick={() => void generar()}
          disabled={generando}
          className="flex items-center gap-1.5 rounded-xl bg-rosa px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <Sparkles size={13} /> {generando ? "Elena está recorriendo los datos…" : "Generar informe ahora"}
        </button>
      </div>

      {error && <p className="px-1 text-xs text-peligro">{error}</p>}

      {informes !== null && informes.length === 0 && (
        <p className="px-1 text-xs text-texto-2">Todavía no hay informes: generá el primero.</p>
      )}

      {(informes ?? []).map((inf) => (
        <div key={inf.id} className="panel-vidrio rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setAbierto((a) => (a === inf.id ? null : inf.id))}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-[13px] font-bold">{inf.titulo}</div>
              <div className="text-[10px] text-texto-3">
                {new Date(inf.generado_en).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                {abierto === inf.id ? "cerrar ▴" : "leer ▾"}
              </div>
            </button>
            <button
              onClick={() => void borrar(inf.id)}
              title="Borrar el informe"
              className="shrink-0 text-texto-3 transition hover:text-peligro"
            >
              <Trash2 size={13} />
            </button>
          </div>
          {abierto === inf.id && (
            <div className="mt-3 border-t border-borde pt-3 text-xs leading-relaxed whitespace-pre-wrap text-texto-2">
              <ConNegritas texto={inf.contenido} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

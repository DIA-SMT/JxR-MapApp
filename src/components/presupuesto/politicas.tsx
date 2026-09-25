"use client";

import { ChevronDown, ChevronRight, ListChecks, Save, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INDICADORES, parsearImporte, partidaCompatible, PARTIDAS_PRINCIPALES, type Clase, type TipoPolitica } from "@/lib/presupuesto";
import { guardarPolitica, type PoliticaCatalogo } from "@/lib/presupuesto-datos";
import { Vacio } from "@/components/ui/vacio";
import { pesos } from "./asignar";
import type { DatosPresupuesto } from "./panel";

const TIPOS: Array<[TipoPolitica | "institucional", string]> = [
  ["obra", "Obra"],
  ["servicio", "Servicio"],
  ["transferencia_personas", "Cupos a personas"],
  ["programa_social", "Programa social"],
  ["institucional", "Institucional"],
];
type Filtro = "listas" | "faltan" | "todas";

/**
 * El catálogo de políticas: las 63 líneas del Plan Rector 2023-2030. Para que
 * el motor use una política le hacen falta tres cosas: estar activa, tener
 * costo por unidad y tener un indicador de necesidad del censo.
 */
export function Politicas({
  supabase,
  datos,
  esSuperadmin,
  onCambio,
}: {
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  esSuperadmin: boolean;
  onCambio: () => Promise<void> | void;
}) {
  const [filtro, setFiltro] = useState<Filtro>("listas");
  const [q, setQ] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);

  const necesidadCiudad = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(INDICADORES)) out[k] = datos.barrios.reduce((a, b) => a + (b.indicadores[k] ?? 0), 0);
    return out;
  }, [datos.barrios]);

  const lista = useMemo(() => {
    const texto = q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return datos.politicas.filter((p) => {
      const lista = p.activa && p.tipo !== "institucional" && !!p.costo_unitario && !!INDICADORES[p.indicador];
      if (filtro === "listas" && !lista) return false;
      if (filtro === "faltan" && (lista || !p.activa)) return false;
      if (!texto) return true;
      return `${p.codigo} ${p.nombre} ${p.eje} ${p.secretaria}`
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .includes(texto);
    });
  }, [datos.politicas, filtro, q]);

  const conteo = useMemo(() => {
    const listas = datos.politicas.filter((p) => p.activa && p.tipo !== "institucional" && p.costo_unitario && INDICADORES[p.indicador]).length;
    const faltan = datos.politicas.filter((p) => p.activa && p.tipo !== "institucional" && !(p.costo_unitario && INDICADORES[p.indicador])).length;
    return { listas, faltan, todas: datos.politicas.length };
  }, [datos.politicas]);

  return (
    <div className="space-y-3">
      <div className="panel-vidrio flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <div className="flex min-w-48 flex-1 items-center gap-1.5 rounded-xl border border-borde-2 bg-panel px-2.5 py-2">
          <Search size={13} className="shrink-0 text-texto-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Código, nombre, eje o secretaría…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-texto-3"
          />
        </div>
        <div className="flex overflow-hidden rounded-xl border border-borde-2 text-[11px] font-bold">
          {(
            [
              ["listas", `Listas (${conteo.listas})`],
              ["faltan", `Les falta un dato (${conteo.faltan})`],
              ["todas", `Todas (${conteo.todas})`],
            ] as Array<[Filtro, string]>
          ).map(([k, t]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`px-2.5 py-2 transition ${filtro === k ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <p className="px-1 text-[10.5px] leading-snug text-texto-3">
        Las 63 líneas estratégicas del Plan Rector 2023-2030. El documento no numera las líneas: el código es el eje y el orden
        de aparición (el 4.1 del catálogo es la primera línea del eje 4, no el objetivo 4.1 del documento).
      </p>

      {conteo.listas === 0 && filtro === "listas" && (
        <Vacio icono={ListChecks} titulo="Ninguna política está lista para asignar" variante="filtro">
          Las líneas del Plan Rector vienen cargadas sin costo por unidad: ese número lo tiene cada secretaría. Pasá a «Les
          falta un dato» y completalo.
        </Vacio>
      )}

      <div className="space-y-1.5">
        {lista.map((p) => (
          <FilaPolitica
            key={p.id}
            p={p}
            datos={datos}
            necesidadCiudad={necesidadCiudad}
            abierta={abierta === p.id}
            onAbrir={() => setAbierta(abierta === p.id ? null : p.id)}
            puedeEditar={esSuperadmin}
            onGuardar={async (cambios) => {
              const e = await guardarPolitica(supabase, p.id, cambios);
              if (!e) await onCambio();
              return e;
            }}
          />
        ))}
      </div>
      {!esSuperadmin && <p className="px-1 text-[11px] text-texto-3">El catálogo lo edita el superadmin.</p>}
    </div>
  );
}

function FilaPolitica({
  p,
  datos,
  necesidadCiudad,
  abierta,
  onAbrir,
  puedeEditar,
  onGuardar,
}: {
  p: PoliticaCatalogo;
  datos: DatosPresupuesto;
  necesidadCiudad: Record<string, number>;
  abierta: boolean;
  onAbrir: () => void;
  puedeEditar: boolean;
  onGuardar: (cambios: Partial<PoliticaCatalogo>) => Promise<string | null>;
}) {
  const [f, setF] = useState({
    tipo: p.tipo as string,
    clase: p.clase,
    unidad: p.unidad,
    costo: p.costo_unitario != null ? String(p.costo_unitario) : "",
    indicador: p.indicador,
    pps: p.partidas_principales,
    afectaciones: p.afectaciones.join(", "),
    prioridad: p.prioridad,
    piso: p.piso != null ? String(p.piso) : "",
    tope: p.tope != null ? String(p.tope) : "",
    activa: p.activa,
  });
  const [msj, setMsj] = useState<{ ok: boolean; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const compatibles = useMemo(
    () => datos.partidas.filter((x) => x.libre > 0 && partidaCompatible(x, p)),
    [datos.partidas, p],
  );
  const libre = compatibles.reduce((a, x) => a + x.libre, 0);
  const info = INDICADORES[p.indicador];
  const lista = p.activa && p.tipo !== "institucional" && !!p.costo_unitario && !!info;
  const necesidad = info ? necesidadCiudad[p.indicador] ?? 0 : 0;

  const guardar = async () => {
    const costo = f.costo.trim() ? parsearImporte(f.costo) : null;
    const piso = f.piso.trim() ? parsearImporte(f.piso) : null;
    const tope = f.tope.trim() ? parsearImporte(f.tope) : null;
    if ((costo != null && !(costo > 0)) || (piso != null && !(piso >= 0)) || (tope != null && !(tope >= 0))) {
      return setMsj({ ok: false, t: "Revisá los montos: costo mayor a cero, piso y tope no negativos." });
    }
    if (piso != null && tope != null && piso > tope) return setMsj({ ok: false, t: "El piso no puede superar al tope." });
    setOcupado(true);
    const e = await onGuardar({
      tipo: f.tipo as TipoPolitica,
      clase: f.clase,
      unidad: f.unidad.trim(),
      costo_unitario: costo,
      indicador: f.indicador,
      // si cambió la sección, las partidas de la otra sección no aplican
      partidas_principales: f.pps.filter((pp) => PARTIDAS_PRINCIPALES[pp]?.clase === f.clase),
      afectaciones: f.afectaciones
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      prioridad: f.prioridad,
      piso,
      tope,
      activa: f.activa,
    });
    setOcupado(false);
    setMsj(e ? { ok: false, t: e } : { ok: true, t: "Guardado ✓" });
  };

  const campo = "rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50 disabled:opacity-60";
  const etiqueta = "mb-0.5 block text-[9.5px] font-bold tracking-wide text-texto-3 uppercase";

  return (
    <div className={`panel-vidrio rounded-2xl ${p.activa ? "" : "opacity-60"}`}>
      <button onClick={onAbrir} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        {abierta ? <ChevronDown size={13} className="shrink-0 text-texto-3" /> : <ChevronRight size={13} className="shrink-0 text-texto-3" />}
        <span className="num w-10 shrink-0 text-[11px] font-bold text-texto-3">{p.codigo}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold">{p.nombre}</div>
          <div className="truncate text-[10px] text-texto-3">
            {p.eje}
            {p.secretaria ? ` · ${p.secretaria}` : ""}
          </div>
        </div>
        <span className="hidden shrink-0 text-right text-[10px] text-texto-2 sm:block">
          {p.costo_unitario ? `${pesos(p.costo_unitario)} / ${p.unidad || "unidad"}` : "sin costo"}
          <br />
          <span className="text-texto-3">{info ? info.etiqueta : "sin indicador"}</span>
        </span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${
            lista
              ? "border-completo/50 bg-completo/10 text-completo"
              : p.activa
                ? "border-encurso/50 bg-encurso/10 text-encurso"
                : "border-borde-2 text-texto-3"
          }`}
        >
          {lista ? "lista" : p.activa ? "falta dato" : "inactiva"}
        </span>
      </button>

      {abierta && (
        <div className="border-t border-borde px-4 py-3">
          {p.notas && <p className="mb-2 text-[10.5px] leading-snug text-encurso">{p.notas}</p>}
          <div className="mb-3 grid gap-2 text-[10.5px] text-texto-2 sm:grid-cols-3">
            <div>
              <span className="text-texto-3">Necesidad en la ciudad: </span>
              <b className="num">{info ? `${Math.round(necesidad).toLocaleString("es-AR")} ${info.unidad}` : "—"}</b>
            </div>
            <div>
              <span className="text-texto-3">Costo de cubrirla toda: </span>
              <b className="num">{info && p.costo_unitario ? pesos(necesidad * p.costo_unitario, true) : "—"}</b>
            </div>
            <div>
              <span className="text-texto-3">La pueden pagar: </span>
              <b className="num">
                {compatibles.length} partidas · {pesos(libre, true)}
              </b>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className={etiqueta}>Tipo</span>
              <select disabled={!puedeEditar} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={`w-full ${campo}`}>
                {TIPOS.map(([k, t]) => (
                  <option key={k} value={k}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={etiqueta}>Clase económica</span>
              <select disabled={!puedeEditar} value={f.clase} onChange={(e) => setF({ ...f, clase: e.target.value as Clase })} className={`w-full ${campo}`}>
                <option value="capital">Capital (Sección 2)</option>
                <option value="corriente">Corriente (Sección 1)</option>
              </select>
            </label>
            <label>
              <span className={etiqueta}>Indicador de necesidad (Censo 2022)</span>
              <select disabled={!puedeEditar} value={f.indicador} onChange={(e) => setF({ ...f, indicador: e.target.value })} className={`w-full ${campo}`}>
                <option value="">— sin indicador —</option>
                {Object.entries(INDICADORES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={etiqueta}>Unidad</span>
              <input disabled={!puedeEditar} value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })} placeholder="hogar conectado, cupo, luminaria…" className={`w-full ${campo}`} />
            </label>
            <label>
              <span className={etiqueta}>Costo por unidad ($)</span>
              <input disabled={!puedeEditar} value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} placeholder="ej. 1.850.000" inputMode="decimal" className={`num w-full ${campo}`} />
            </label>
            <label>
              <span className={etiqueta}>Prioridad · {f.prioridad.toFixed(1)}</span>
              <input
                disabled={!puedeEditar}
                type="range"
                min={0}
                max={5}
                step={0.5}
                value={f.prioridad}
                onChange={(e) => setF({ ...f, prioridad: Number(e.target.value) })}
                className="mt-1.5 w-full accent-[#e14f82]"
              />
            </label>
            <label>
              <span className={etiqueta}>Piso ($, se cubre primero)</span>
              <input disabled={!puedeEditar} value={f.piso} onChange={(e) => setF({ ...f, piso: e.target.value })} placeholder="opcional" inputMode="decimal" className={`num w-full ${campo}`} />
            </label>
            <label>
              <span className={etiqueta}>Tope ($)</span>
              <input disabled={!puedeEditar} value={f.tope} onChange={(e) => setF({ ...f, tope: e.target.value })} placeholder="opcional" inputMode="decimal" className={`num w-full ${campo}`} />
            </label>
          </div>

          <div className="mt-2 flex flex-wrap items-end gap-4">
            <div>
              <span className={etiqueta}>Partidas principales que la pueden pagar (Ord. 570/80)</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(PARTIDAS_PRINCIPALES)
                  .filter(([, v]) => v.asignable && v.clase === f.clase)
                  .map(([pp, v]) => (
                    <label
                      key={pp}
                      title={v.nombre}
                      className="flex items-center gap-1 rounded-md border border-borde-2 px-1.5 py-1 text-[10.5px]"
                    >
                      <input
                        disabled={!puedeEditar}
                        type="checkbox"
                        checked={f.pps.includes(pp)}
                        onChange={(e) =>
                          setF({ ...f, pps: e.target.checked ? [...f.pps, pp].sort() : f.pps.filter((x) => x !== pp) })
                        }
                        className="accent-[#e14f82]"
                      />
                      {pp} <span className="text-texto-3">{v.nombre}</span>
                    </label>
                  ))}
              </div>
            </div>
            <label className="min-w-56 flex-1">
              <span className={etiqueta}>Recursos afectados que admite (separados por coma)</span>
              <input disabled={!puedeEditar} value={f.afectaciones} onChange={(e) => setF({ ...f, afectaciones: e.target.value })} placeholder="ej. Fondo Federal Solidario" className={`w-full ${campo}`} />
            </label>
            <label className="flex items-center gap-1.5 pb-1.5 text-[11px]">
              <input disabled={!puedeEditar} type="checkbox" checked={f.activa} onChange={(e) => setF({ ...f, activa: e.target.checked })} className="accent-[#e14f82]" />
              activa
            </label>
          </div>

          {f.tipo === "transferencia_personas" && (
            <p className="mt-2 text-[10.5px] leading-snug text-texto-3">
              Se planifica en <b>cupos por barrio</b>. La herramienta no registra beneficiarios: la selección de quién recibe
              cada cupo la hace el área responsable con su propio registro y criterios de elegibilidad.
            </p>
          )}

          {puedeEditar && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => void guardar()}
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg bg-rosa px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
              >
                <Save size={12} /> {ocupado ? "Guardando…" : "Guardar"}
              </button>
              {msj && <span className={`text-[11px] font-bold ${msj.ok ? "text-completo" : "text-peligro"}`}>{msj.t}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

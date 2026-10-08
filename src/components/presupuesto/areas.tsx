"use client";

import { Building2, ChevronDown, ChevronRight, DoorOpen, Download, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AREA,
  AREAS_POLITICA,
  AREAS_TERRITORIALES,
  areasDePolitica,
  cadena,
  hijos,
  nombreCorto,
  ORGANIGRAMA,
  secretariaDe,
  type Area,
} from "@/lib/organigrama";
import { demandasDeBarrio, pct, pesos, type BarrioNecesidad } from "@/lib/presupuesto";
import type { PoliticaCatalogo } from "@/lib/presupuesto-datos";
import { descargarCSV } from "@/lib/csv";

/** Título con la cadena de mando y el responsable, para el hover. */
const detalleArea = (x: Area) =>
  `${cadena(x.id)
    .map((c) => c.nombre)
    .join(
      " › ",
    )}${x.responsable ? `\nResponsable: ${x.responsable}` : ""}${x.confirmar ? "\n(dependencia a confirmar)" : ""}`;

export function ChipArea({ area, lidera = false }: { area: Area; lidera?: boolean }) {
  return (
    <span
      title={detalleArea(area)}
      className={`inline-block max-w-full truncate rounded-full border px-1.5 py-px align-middle text-[9.5px] font-semibold ${
        lidera ? "border-celeste/50 bg-celeste/10 text-celeste" : "border-borde-2 text-texto-2"
      }`}
    >
      {nombreCorto(area)}
    </span>
  );
}

/** «Lidera X · participan Y, Z» de una política. */
export function AreasDePolitica({ codigo, compacto = false }: { codigo: string; compacto?: boolean }) {
  const { lidera, participan } = areasDePolitica(codigo);
  if (!lidera) return <span className="text-[10px] text-texto-3">sin área asignada</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] text-texto-3">
      <span>Lidera</span> <ChipArea area={lidera} lidera />
      {!compacto && participan.length > 0 && (
        <>
          <span>· participan</span>
          {participan.map((x) => (
            <ChipArea key={x.id} area={x} />
          ))}
        </>
      )}
    </span>
  );
}

/**
 * El organigrama con lo que hace cada área en el Plan Rector: qué políticas
 * lidera y en cuáles participa. Para ver de un vistazo quién tiene que
 * coordinar con quién.
 */
export function OrganigramaVista({ politicas }: { politicas: PoliticaCatalogo[] }) {
  const porCodigo = useMemo(() => new Map(politicas.map((p) => [p.codigo, p])), [politicas]);
  const rol = useMemo(() => {
    const m = new Map<string, { lidera: PoliticaCatalogo[]; participa: PoliticaCatalogo[] }>();
    const de = (id: string) => m.get(id) ?? (m.set(id, { lidera: [], participa: [] }), m.get(id)!);
    for (const [codigo, r] of Object.entries(AREAS_POLITICA)) {
      const p = porCodigo.get(codigo);
      if (!p) continue;
      de(r.lidera).lidera.push(p);
      for (const x of r.participan) de(x).participa.push(p);
    }
    return m;
  }, [porCodigo]);
  // cuántas políticas toca cada rama, para ordenar y para el resumen
  const enRama = (id: string): number =>
    (rol.get(id)?.lidera.length ?? 0) + hijos(id).reduce((s, h) => s + enRama(h.id), 0);
  const secretarias = ORGANIGRAMA.filter((x) => x.tipo === "secretaria").sort((a, b) => enRama(b.id) - enRama(a.id));
  const [abierta, setAbierta] = useState<string | null>(secretarias[0]?.id ?? null);

  const fila = (x: Area, nivel: number) => {
    const r = rol.get(x.id);
    const vacia = !r || (r.lidera.length === 0 && r.participa.length === 0);
    return (
      <div key={x.id} style={{ paddingLeft: nivel * 14 }}>
        <div className={`rounded-lg border px-2.5 py-1.5 ${vacia ? "border-borde/60 opacity-60" : "border-borde"}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-[11px] font-bold">
              {x.nombre}
              {x.confirmar && (
                <span
                  className="ml-1 text-[9.5px] font-normal text-encurso"
                  title="La dependencia no se lee con certeza en el organigrama recibido"
                >
                  (dependencia a confirmar)
                </span>
              )}
            </span>
            {x.responsable && <span className="text-[10px] text-texto-3">{x.responsable}</span>}
          </div>
          {r && r.lidera.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {r.lidera.map((p) => (
                <span
                  key={p.id}
                  title={p.nombre}
                  className={`max-w-64 truncate rounded-full border border-celeste/50 bg-celeste/10 px-1.5 py-px text-[9.5px] font-semibold text-celeste ${p.activa ? "" : "opacity-60"}`}
                >
                  {p.codigo} {p.nombre}
                </span>
              ))}
            </div>
          )}
          {r && r.participa.length > 0 && (
            <div className="mt-1 text-[9.5px] text-texto-3">
              Participa en: {r.participa.map((p) => `${p.codigo} ${p.nombre}`).join(" · ")}
            </div>
          )}
        </div>
      </div>
    );
  };
  const rama = (x: Area, nivel: number): React.ReactNode[] => [
    fila(x, nivel),
    ...hijos(x.id)
      .filter((h) => !h.id.endsWith("-despacho"))
      .flatMap((h) => rama(h, nivel + 1)),
  ];

  return (
    <div className="space-y-1.5">
      <p className="px-1 text-[10.5px] leading-snug text-texto-3">
        Qué lidera y en qué participa cada área del organigrama municipal. En celeste, las políticas que lidera. La
        asignación de áreas a políticas es una propuesta para validar con cada secretaría.
      </p>
      {secretarias.map((s) => {
        const abierto = abierta === s.id;
        const n = enRama(s.id);
        return (
          <div key={s.id} className="panel-vidrio rounded-2xl">
            <button
              onClick={() => setAbierta(abierto ? null : s.id)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
              {abierto ? (
                <ChevronDown size={13} className="text-texto-3" />
              ) : (
                <ChevronRight size={13} className="text-texto-3" />
              )}
              <Building2 size={13} className="text-celeste" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold">{s.nombre}</span>
                <span className="block truncate text-[10px] text-texto-3">{s.responsable}</span>
              </span>
              <span className="num shrink-0 text-[10.5px] text-texto-2">
                lidera {n} línea{n === 1 ? "" : "s"}
              </span>
            </button>
            {abierto && <div className="space-y-1 border-t border-borde px-3 py-2.5">{rama(s, 0).slice(1)}</div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Para un barrio: sus principales demandas según el censo, qué políticas las
 * atienden y qué áreas tienen que intervenir; más las que ya reciben plata en
 * este reparto y las puertas de entrada al barrio.
 */
export function QuienInterviene({
  barrio,
  barrios,
  politicas,
  asignaciones,
}: {
  barrio: BarrioNecesidad;
  barrios: BarrioNecesidad[];
  politicas: PoliticaCatalogo[];
  asignaciones: Array<{ codigo: string; monto: number }>;
}) {
  const demandas = useMemo(() => demandasDeBarrio(barrio, barrios), [barrio, barrios]);
  const activas = politicas.filter((p) => p.activa && p.tipo !== "institucional");

  // las áreas que lideran lo que se le asigna al barrio, con su plata
  const porArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of asignaciones) {
      const l = AREAS_POLITICA[x.codigo]?.lidera;
      if (l) m.set(l, (m.get(l) ?? 0) + x.monto);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [asignaciones]);

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-celeste/30 bg-celeste/5 p-2.5">
      <div>
        <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-wide text-celeste uppercase">
          <Users size={11} /> Principales demandas (Censo 2022)
        </div>
        {demandas.length === 0 ? (
          <p className="mt-0.5 text-[10.5px] text-texto-3">
            Ninguna carencia del censo supera el promedio de la ciudad.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {demandas.map((d) => {
              const atienden = activas.filter((p) => p.indicador === d.indicador);
              return (
                <li key={d.indicador} className="text-[10.5px] leading-snug">
                  <b>{d.etiqueta}</b>: {pct(d.tasa)}{" "}
                  <span className="text-texto-3">
                    ({d.veces.toLocaleString("es-AR", { maximumFractionDigits: 1 })} veces la ciudad,{" "}
                    {pct(d.tasaCiudad)})
                  </span>
                  {atienden.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {atienden.map((p) => {
                        const l = areasDePolitica(p.codigo).lidera;
                        return (
                          <span key={p.id} className="text-[9.5px] text-texto-3">
                            {p.codigo} → {l ? <ChipArea area={l} lidera /> : "sin área"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {porArea.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[9.5px] font-bold tracking-wide text-celeste uppercase">
            <Building2 size={11} /> Quién ejecuta lo asignado
          </div>
          <div className="mt-1 space-y-0.5">
            {porArea.map(([id, monto]) => {
              const x = AREA.get(id)!;
              return (
                <div key={id} className="flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="min-w-0 truncate" title={detalleArea(x)}>
                    {nombreCorto(x)} <span className="text-texto-3">· {nombreCorto(secretariaDe(id) ?? x)}</span>
                  </span>
                  <span className="num shrink-0 font-bold">{pesos(monto, true)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 text-[10px] text-texto-3">
        <DoorOpen size={11} className="text-celeste" /> Entrada al barrio:
        {AREAS_TERRITORIALES.map((id) => (
          <ChipArea key={id} area={AREA.get(id)!} />
        ))}
      </div>
    </div>
  );
}

export interface FilaPorArea {
  area: Area;
  secretaria: Area;
  monto: number;
  politicas: string[];
  barrios: number;
  participan: Area[];
}

/** Agrupa una asignación por el área que lidera cada política. */
export function agruparPorArea(
  filas: Array<{ codigo: string; nombre: string; barrio: string; monto: number }>,
): FilaPorArea[] {
  const m = new Map<string, { monto: number; politicas: Set<string>; barrios: Set<string>; participan: Set<string> }>();
  for (const f of filas) {
    const r = AREAS_POLITICA[f.codigo];
    const id = r?.lidera ?? "";
    const x = m.get(id) ?? { monto: 0, politicas: new Set(), barrios: new Set(), participan: new Set() };
    x.monto += f.monto;
    x.politicas.add(`${f.codigo} ${f.nombre}`);
    x.barrios.add(f.barrio);
    for (const p of r?.participan ?? []) x.participan.add(p);
    m.set(id, x);
  }
  return [...m.entries()]
    .filter(([id]) => AREA.has(id))
    .map(([id, x]) => ({
      area: AREA.get(id)!,
      secretaria: secretariaDe(id)!,
      monto: x.monto,
      politicas: [...x.politicas],
      barrios: x.barrios.size,
      participan: [...x.participan].map((p) => AREA.get(p)!).filter(Boolean),
    }))
    .sort((a, b) => b.monto - a.monto);
}

/** La asignación vista por área: quién ejecuta cuánto, dónde y con quién se coordina. */
export function PorArea({
  filas,
  archivo,
}: {
  filas: Array<{ codigo: string; nombre: string; barrio: string; monto: number }>;
  archivo: string;
}) {
  const grupos = useMemo(() => agruparPorArea(filas), [filas]);
  if (grupos.length === 0) return null;
  const exportar = () =>
    descargarCSV(
      archivo,
      ["secretaria", "area_que_lidera", "responsable", "monto", "barrios", "politicas", "areas_que_participan"],
      grupos.map((g) => [
        g.secretaria.nombre,
        g.area.nombre,
        g.area.responsable ?? "",
        Math.round(g.monto),
        g.barrios,
        g.politicas.join(" | "),
        g.participan.map((p) => p.nombre).join(" | "),
      ]),
    );
  return (
    <details className="mt-3">
      <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-texto-2 hover:text-rosa">
        <Building2 size={12} className="text-celeste" /> Por área responsable ({grupos.length} áreas)
      </summary>
      <div className="mt-1 flex justify-end">
        <button
          onClick={exportar}
          className="flex items-center gap-1 text-[10.5px] font-bold text-texto-2 hover:text-rosa"
        >
          <Download size={11} /> Planilla para cada área
        </button>
      </div>
      <div className="mt-1 max-h-72 overflow-auto">
        <table className="w-full min-w-[620px] text-[10.5px]">
          <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
            <tr>
              <th className="py-1 pr-2 font-semibold">Área que lidera</th>
              <th className="py-1 pr-2 text-right font-semibold">Monto</th>
              <th className="py-1 pr-2 text-right font-semibold">Barrios</th>
              <th className="py-1 font-semibold">Políticas · coordina con</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.area.id} className="border-t border-borde/60 align-top">
                <td className="max-w-56 py-1 pr-2">
                  <div className="truncate font-semibold" title={detalleArea(g.area)}>
                    {nombreCorto(g.area)}
                  </div>
                  <div className="truncate text-[9.5px] text-texto-3">{g.secretaria.nombre}</div>
                </td>
                <td className="num py-1 pr-2 text-right font-bold">{pesos(g.monto, true)}</td>
                <td className="num py-1 pr-2 text-right">{g.barrios}</td>
                <td className="py-1 text-texto-2">
                  {g.politicas.join(" · ")}
                  {g.participan.length > 0 && (
                    <div className="text-[9.5px] text-texto-3">Con: {g.participan.map(nombreCorto).join(", ")}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

"use client";

import { ClipboardCheck, Save, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  obtenerEjecucion,
  registrarEjecucion,
  SinSeguimiento,
  type DetalleEscenario,
  type EstadoEjecucion,
  type FilaEjecucion,
} from "@/lib/presupuesto-datos";
import { parsearImporte, pct, plural } from "@/lib/presupuesto";
import { descargarCSV } from "@/lib/csv";
import { pesos } from "./asignar";
import { MapaBarrios } from "./mapa-barrios";
import { AREA, AREAS_POLITICA, nombreCorto } from "@/lib/organigrama";

export const ESTADOS_EJECUCION: Record<EstadoEjecucion, { texto: string; clase: string }> = {
  pendiente: { texto: "Pendiente", clase: "text-texto-3" },
  en_curso: { texto: "En curso", clase: "text-encurso" },
  terminado: { texto: "Terminado", clase: "text-completo" },
  no_se_hara: { texto: "No se hará", clase: "text-peligro" },
};

type Borrador = { estado: EstadoEjecucion; monto: string; unidades: string; expediente: string; nota: string };
const clave = (politica: number, barrio: string) => `${politica}|${barrio}`;
/** Un número guardado, escrito como se lo tipea acá (coma decimal, sin miles): «1,234» vuelve a leerse 1,234. */
const aTexto = (n: number) => (n ? n.toLocaleString("es-AR", { useGrouping: false, maximumFractionDigits: 20 }) : "");
const POR_PAGINA = 60;

/**
 * El avance de lo aprobado, celda por celda: estado, cuánto se gastó, qué se
 * logró y con qué expediente. Las reglas las controla la base; acá se avisan
 * antes para no tener que adivinar por qué falló.
 */
export function Seguimiento({
  supabase,
  escenario,
  detalle,
}: {
  supabase: SupabaseClient;
  escenario: number;
  detalle: DetalleEscenario;
}) {
  const [filas, setFilas] = useState<Map<string, FilaEjecucion> | null>(null);
  const [sinTabla, setSinTabla] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Record<string, Borrador>>({});
  const [politica, setPolitica] = useState<number | "todas">("todas");
  const [area, setAreaEstado] = useState<string>("todas");
  useEffect(() => {
    try {
      const guardada = localStorage.getItem("jxr:presupuesto-mi-area");
      if (guardada) setAreaEstado(guardada);
    } catch {
      // sin almacenamiento, arranca en «todas»
    }
  }, []);
  const setArea = (v: string) => {
    setAreaEstado(v);
    try {
      localStorage.setItem("jxr:presupuesto-mi-area", v);
    } catch {
      // no pasa nada: solo no se recuerda
    }
  };
  // Cargar en bloque sobre lo que se está viendo
  const [enBloque, setEnBloque] = useState<{ estado: EstadoEjecucion | ""; expediente: string }>({
    estado: "",
    expediente: "",
  });
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoEjecucion | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");
  const [cuantas, setCuantas] = useState(POR_PAGINA);
  const [ocupado, setOcupado] = useState(false);
  const [msj, setMsj] = useState<{ ok: boolean; t: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const l = await obtenerEjecucion(supabase, escenario);
      setFilas(new Map(l.map((f) => [clave(f.politica_id, f.barrio), f])));
    } catch (e) {
      if (e instanceof SinSeguimiento) setSinTabla(e.message);
      else setMsj({ ok: false, t: e instanceof Error ? e.message : "no pude cargar el seguimiento" });
    }
  }, [supabase, escenario]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const celdas = useMemo(
    () =>
      detalle.asignaciones.map((a) => {
        const f = filas?.get(clave(a.politica_id, a.barrio));
        return {
          k: clave(a.politica_id, a.barrio),
          a,
          estado: (f?.estado ?? "pendiente") as EstadoEjecucion,
          ejecutado: f?.monto_ejecutado ?? 0,
          logrado: f?.unidades_logradas ?? 0,
          expediente: f?.expediente ?? "",
          nota: f?.nota ?? "",
          quien: f?.actualizado_email ?? "",
        };
      }),
    [detalle, filas],
  );

  const total = useMemo(() => {
    const t = { asignado: 0, ejecutado: 0, porEstado: { pendiente: 0, en_curso: 0, terminado: 0, no_se_hara: 0 } };
    for (const c of celdas) {
      t.asignado += c.a.monto;
      t.ejecutado += c.ejecutado;
      t.porEstado[c.estado] += 1;
    }
    return t;
  }, [celdas]);

  const porPolitica = useMemo(() => {
    const m = new Map<
      number,
      { nombre: string; asignado: number; ejecutado: number; terminadas: number; celdas: number }
    >();
    for (const c of celdas) {
      const x = m.get(c.a.politica_id) ?? {
        nombre: `${c.a.politica_codigo} ${c.a.politica_nombre}`,
        asignado: 0,
        ejecutado: 0,
        terminadas: 0,
        celdas: 0,
      };
      x.asignado += c.a.monto;
      x.ejecutado += c.ejecutado;
      x.celdas += 1;
      if (c.estado === "terminado") x.terminadas += 1;
      m.set(c.a.politica_id, x);
    }
    return [...m.entries()].sort((a, b) => b[1].asignado - a[1].asignado);
  }, [celdas]);

  // % ejecutado por barrio; los barrios con asignación y sin gasto se pintan con el tono más claro
  const valoresMapa = useMemo(() => {
    const m = new Map<string, { a: number; e: number }>();
    for (const c of celdas) {
      const x = m.get(c.a.barrio) ?? { a: 0, e: 0 };
      x.a += c.a.monto;
      x.e += c.ejecutado;
      m.set(c.a.barrio, x);
    }
    return Object.fromEntries([...m.entries()].map(([b, x]) => [b, Math.max(0.01, x.a > 0 ? (100 * x.e) / x.a : 0)]));
  }, [celdas]);

  const visibles = useMemo(() => {
    const q = busqueda.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    return celdas
      .filter((c) => politica === "todas" || c.a.politica_id === politica)
      .filter((c) => area === "todas" || AREAS_POLITICA[c.a.politica_codigo]?.lidera === area)
      .filter((c) => estadoFiltro === "todos" || (borrador[c.k]?.estado ?? c.estado) === estadoFiltro)
      .filter((c) => !q || c.a.barrio.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
      .sort((x, y) => y.a.monto - x.a.monto);
  }, [celdas, politica, area, estadoFiltro, busqueda, borrador]);

  const editar = (c: (typeof celdas)[number], cambio: Partial<Borrador>) =>
    setBorrador((b) => {
      const actual: Borrador = b[c.k] ?? {
        estado: c.estado,
        monto: aTexto(c.ejecutado),
        unidades: aTexto(c.logrado),
        expediente: c.expediente,
        nota: c.nota,
      };
      const n = { ...actual, ...cambio };
      // si ya hay gasto, deja de estar pendiente
      if (cambio.monto != null && parsearImporte(cambio.monto || "0") > 0 && n.estado === "pendiente")
        n.estado = "en_curso";
      return { ...b, [c.k]: n };
    });

  /** Lo que la base va a rechazar, dicho antes. */
  const problema = (c: (typeof celdas)[number], b: Borrador): string | null => {
    const monto = b.monto.trim() ? parsearImporte(b.monto) : 0;
    const unidades = b.unidades.trim() ? parsearImporte(b.unidades) : 0;
    if (!(monto >= 0) || !(unidades >= 0)) return "monto o unidades que no se entienden";
    if (monto > 0 && b.estado === "pendiente") return "con gasto no puede estar pendiente";
    if (monto > 0 && b.expediente.trim().length < 3) return "falta el expediente";
    if (b.estado === "no_se_hara" && b.nota.trim().length < 5) return "explicá por qué no se hará";
    if (monto > c.a.monto + 1 && b.nota.trim().length < 5) return "se gasta más de lo asignado: explicalo en la nota";
    return null;
  };

  const pendientes = Object.keys(borrador);
  const conProblema = celdas.filter((c) => borrador[c.k] && problema(c, borrador[c.k]));

  const guardar = async () => {
    if (conProblema.length > 0)
      return setMsj({
        ok: false,
        t: `Revisá ${conProblema.length} fila${conProblema.length === 1 ? "" : "s"} marcadas en rojo.`,
      });
    setOcupado(true);
    setMsj(null);
    const enviadas = celdas.filter((c) => borrador[c.k]);
    const e = await registrarEjecucion(
      supabase,
      escenario,
      enviadas.map((c) => {
        const b = borrador[c.k];
        return {
          politica_id: c.a.politica_id,
          barrio: c.a.barrio,
          estado: b.estado,
          monto_ejecutado: b.monto.trim() ? parsearImporte(b.monto) : 0,
          unidades_logradas: b.unidades.trim() ? parsearImporte(b.unidades) : 0,
          expediente: b.expediente.trim(),
          nota: b.nota.trim(),
        };
      }),
    );
    setOcupado(false);
    if (e) return setMsj({ ok: false, t: e });
    // solo se descarta lo que se mandó
    setBorrador((b) => {
      const n = { ...b };
      for (const c of enviadas) if (n[c.k] === borrador[c.k]) delete n[c.k];
      return n;
    });
    setMsj({ ok: true, t: "Avance guardado." });
    await cargar();
  };

  const exportar = () =>
    descargarCSV(
      `seguimiento-propuesta-${escenario}.csv`,
      [
        "politica_codigo",
        "politica",
        "barrio",
        "asignado",
        "estado",
        "ejecutado",
        "unidades_logradas",
        "unidad",
        "expediente",
        "nota",
        "actualizado_por",
      ],
      celdas.map((c) => [
        c.a.politica_codigo,
        c.a.politica_nombre,
        c.a.barrio,
        Math.round(c.a.monto),
        ESTADOS_EJECUCION[c.estado].texto,
        Math.round(c.ejecutado),
        c.logrado,
        c.a.unidad,
        c.expediente,
        c.nota,
        c.quien,
      ]),
    );

  if (sinTabla)
    return (
      <div className="mt-3 rounded-xl border border-encurso/40 bg-encurso/5 p-3 text-[11px] text-encurso">
        {sinTabla}
      </div>
    );
  if (!filas) return <p className="mt-3 text-[11px] text-texto-3">Cargando el seguimiento…</p>;

  type Celda = (typeof celdas)[number];
  const valores = (c: Celda) => {
    const b = borrador[c.k];
    const v: Borrador = b ?? {
      estado: c.estado,
      monto: aTexto(c.ejecutado),
      unidades: aTexto(c.logrado),
      expediente: c.expediente,
      nota: c.nota,
    };
    return { b, v, mal: b ? problema(c, b) : null };
  };
  const controles = (c: Celda, v: Borrador) => ({
    estado: (
      <select
        value={v.estado}
        aria-label="Estado"
        onChange={(e) => editar(c, { estado: e.target.value as EstadoEjecucion })}
        className={`${campo} border-borde-2 font-bold ${ESTADOS_EJECUCION[v.estado].clase}`}
      >
        {Object.entries(ESTADOS_EJECUCION).map(([k, x]) => (
          <option key={k} value={k}>
            {x.texto}
          </option>
        ))}
      </select>
    ),
    monto: (
      <input
        value={v.monto}
        aria-label="Gastado en pesos"
        onChange={(e) => editar(c, { monto: e.target.value.replace(/[^0-9.,]/g, "") })}
        placeholder="$ gastado"
        inputMode="decimal"
        className={`num ${campo} border-borde-2`}
      />
    ),
    unidades: (
      <input
        value={v.unidades}
        aria-label="Logrado"
        onChange={(e) => editar(c, { unidades: e.target.value.replace(/[^0-9.,]/g, "") })}
        placeholder={plural(c.a.unidad)}
        inputMode="decimal"
        title={`Cuántas ${plural(c.a.unidad)} se lograron`}
        className={`num ${campo} border-borde-2`}
      />
    ),
    expediente: (
      <input
        value={v.expediente}
        aria-label="Expediente"
        onChange={(e) => editar(c, { expediente: e.target.value })}
        placeholder="Expte. Nº"
        className={`${campo} border-borde-2`}
      />
    ),
    nota: (
      <input
        value={v.nota}
        aria-label="Nota"
        onChange={(e) => editar(c, { nota: e.target.value })}
        placeholder="nota (opcional)"
        className={`${campo} border-borde-2`}
      />
    ),
  });

  const avance = total.asignado > 0 ? (100 * total.ejecutado) / total.asignado : 0;
  const campo =
    "w-full min-w-0 rounded-md border bg-panel px-1.5 py-1 text-[10.5px] outline-none placeholder:text-texto-3 focus:border-rosa/50";

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-celeste/40 bg-celeste/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-extrabold">
          <ClipboardCheck size={13} className="text-celeste" /> Seguimiento de la ejecución
        </h4>
        <button onClick={exportar} className="text-[10.5px] font-bold text-texto-2 hover:text-rosa">
          Descargar planilla
        </button>
      </div>

      {/* En una frase, y la barra */}
      <div>
        <p className="text-[12px] leading-relaxed">
          Se gastaron <b className="num">{pesos(total.ejecutado, true)}</b> de{" "}
          <b className="num">{pesos(total.asignado, true)}</b> aprobados (<b className="num">{pct(avance)}</b>). De{" "}
          {celdas.length} obras o cupos por barrio:{" "}
          <b className="text-completo">{total.porEstado.terminado} terminados</b>,{" "}
          <b className="text-encurso">{total.porEstado.en_curso} en curso</b>, {total.porEstado.pendiente} pendientes
          {total.porEstado.no_se_hara > 0 && (
            <>
              {" "}
              y <b className="text-peligro">{total.porEstado.no_se_hara} que no se harán</b>
            </>
          )}
          .
        </p>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-3">
          <div className="h-full rounded-full bg-celeste" style={{ width: `${Math.min(100, avance)}%` }} />
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_1fr]">
        {/* Por política */}
        <div className="min-w-0">
          <div className="text-[9.5px] font-bold tracking-wide text-texto-3 uppercase">Por política</div>
          <div className="mt-1 max-h-64 space-y-1 overflow-auto pr-1">
            {porPolitica.map(([id, p]) => {
              const av = p.asignado > 0 ? (100 * p.ejecutado) / p.asignado : 0;
              return (
                <button
                  key={id}
                  onClick={() => setPolitica(politica === id ? "todas" : id)}
                  className={`block w-full rounded-lg border px-2 py-1 text-left transition ${politica === id ? "border-celeste" : "border-borde hover:border-borde-2"}`}
                >
                  <div className="flex items-center justify-between gap-2 text-[10.5px]">
                    <span className="min-w-0 truncate font-semibold" title={p.nombre}>
                      {p.nombre}
                    </span>
                    <span className="num shrink-0 text-texto-2">{pct(av)}</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-panel-3">
                    <div className="h-full rounded-full bg-celeste" style={{ width: `${Math.min(100, av)}%` }} />
                  </div>
                  <div className="mt-0.5 text-[9.5px] text-texto-3">
                    {pesos(p.ejecutado, true)} de {pesos(p.asignado, true)} · {p.terminadas} de {p.celdas} barrios
                    terminados
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-w-0">
          <MapaBarrios
            valores={valoresMapa}
            formatear={(v) => pct(v < 0.05 ? 0 : v, 0)}
            etiqueta="% gastado de lo aprobado"
            alto="h-[280px]"
            tope={100}
          />
        </div>
      </div>

      {/* Cargar el avance */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9.5px] font-bold tracking-wide text-texto-3 uppercase">Cargar el avance</span>
          <select
            value={politica}
            onChange={(e) => {
              setPolitica(e.target.value === "todas" ? "todas" : Number(e.target.value));
              setCuantas(POR_PAGINA);
            }}
            className="max-w-64 rounded-md border border-borde-2 bg-panel px-1.5 py-1 text-[10.5px] outline-none"
          >
            <option value="todas">Todas las políticas</option>
            {porPolitica.map(([id, p]) => (
              <option key={id} value={id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <select
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setCuantas(POR_PAGINA);
            }}
            title="Cada área carga el avance de lo que lidera. Se recuerda en este navegador."
            className="max-w-56 rounded-md border border-borde-2 bg-panel px-1.5 py-1 text-[10.5px] outline-none"
          >
            <option value="todas">Mi área: todas</option>
            {[
              ...new Set(
                celdas.map((c) => AREAS_POLITICA[c.a.politica_codigo]?.lidera).filter((x): x is string => !!x),
              ),
            ]
              .map((id) => AREA.get(id)!)
              .sort((x, y) => x.nombre.localeCompare(y.nombre))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {nombreCorto(x)}
                </option>
              ))}
          </select>
          <select
            value={estadoFiltro}
            onChange={(e) => setEstadoFiltro(e.target.value as EstadoEjecucion | "todos")}
            className="rounded-md border border-borde-2 bg-panel px-1.5 py-1 text-[10.5px] outline-none"
          >
            <option value="todos">Todos los estados</option>
            {Object.entries(ESTADOS_EJECUCION).map(([k, v]) => (
              <option key={k} value={k}>
                {v.texto}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1 rounded-md border border-borde-2 bg-panel px-1.5 py-1">
            <Search size={11} className="text-texto-3" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar barrio…"
              className="w-28 bg-transparent text-[10.5px] outline-none placeholder:text-texto-3"
            />
          </span>
        </div>

        {/* En bloque: lo mismo a todo lo que coincide con el filtro */}
        {visibles.length > 1 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-celeste/40 px-2 py-1.5 text-[10.5px]">
            <span className="text-texto-3">A las {visibles.length} filas del filtro:</span>
            <select
              value={enBloque.estado}
              onChange={(e) => setEnBloque({ ...enBloque, estado: e.target.value as EstadoEjecucion | "" })}
              className="rounded-md border border-borde-2 bg-panel px-1.5 py-1 text-[10.5px] outline-none"
            >
              <option value="">estado sin cambiar</option>
              {Object.entries(ESTADOS_EJECUCION).map(([k, x]) => (
                <option key={k} value={k}>
                  {x.texto}
                </option>
              ))}
            </select>
            <input
              value={enBloque.expediente}
              onChange={(e) => setEnBloque({ ...enBloque, expediente: e.target.value })}
              placeholder="mismo expediente (opcional)"
              className="w-44 rounded-md border border-borde-2 bg-panel px-1.5 py-1 text-[10.5px] outline-none placeholder:text-texto-3"
            />
            <button
              onClick={() => {
                for (const c of visibles)
                  editar(c, {
                    ...(enBloque.estado ? { estado: enBloque.estado } : {}),
                    ...(enBloque.expediente.trim() ? { expediente: enBloque.expediente.trim() } : {}),
                  });
                setEnBloque({ estado: "", expediente: "" });
              }}
              disabled={!enBloque.estado && !enBloque.expediente.trim()}
              className="rounded-md bg-celeste/80 px-2 py-1 font-bold text-white disabled:opacity-40"
            >
              Aplicar
            </button>
            <span className="text-[9.5px] text-texto-3">Queda como cambio sin guardar: revisalo y guardá.</span>
          </div>
        )}

        {/* Celular: una tarjeta por barrio y política */}
        <div
          className={`mt-1.5 max-h-[520px] space-y-1.5 overflow-auto sm:hidden ${ocupado ? "pointer-events-none opacity-60" : ""}`}
        >
          {visibles.slice(0, cuantas).map((c) => {
            const { v, mal, b } = valores(c);
            return (
              <div
                key={c.k}
                className={`rounded-lg border p-2 ${mal ? "border-peligro/50 bg-peligro/10" : b ? "border-rosa/40 bg-rosa/5" : "border-borde"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold">{c.a.barrio}</div>
                    <div className="truncate text-[9.5px] text-texto-3">
                      {c.a.politica_codigo} {c.a.politica_nombre}
                    </div>
                  </div>
                  <div className="num shrink-0 text-right text-[10.5px]">
                    {pesos(c.a.monto, true)}
                    <div className="text-[9.5px] text-texto-3">aprobado</div>
                  </div>
                </div>
                {mal && <div className="mt-0.5 text-[9.5px] font-bold text-peligro">{mal}</div>}
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {controles(c, v).estado}
                  {controles(c, v).monto}
                  {controles(c, v).unidades}
                  {controles(c, v).expediente}
                  <div className="col-span-2">{controles(c, v).nota}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-1.5 hidden max-h-[420px] overflow-auto sm:block">
          <table className={`w-full min-w-[860px] text-[10.5px] ${ocupado ? "pointer-events-none opacity-60" : ""}`}>
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
              <tr>
                <th className="py-1 pr-2 font-semibold">Barrio · política</th>
                <th className="py-1 pr-2 text-right font-semibold">Aprobado</th>
                <th className="w-28 py-1 pr-2 font-semibold">Estado</th>
                <th className="w-28 py-1 pr-2 font-semibold">Gastado $</th>
                <th className="w-24 py-1 pr-2 font-semibold">Logrado</th>
                <th className="w-32 py-1 pr-2 font-semibold">Expediente</th>
                <th className="py-1 font-semibold">Nota</th>
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, cuantas).map((c) => {
                const { v, mal, b } = valores(c);
                const k = controles(c, v);
                return (
                  <tr
                    key={c.k}
                    className={`border-t border-borde/60 align-top ${mal ? "bg-peligro/10" : b ? "bg-rosa/5" : ""}`}
                  >
                    <td className="max-w-56 py-1 pr-2">
                      <div className="truncate font-semibold">{c.a.barrio}</div>
                      <div className="truncate text-[9.5px] text-texto-3" title={c.a.politica_nombre}>
                        {c.a.politica_codigo} {c.a.politica_nombre}
                      </div>
                      {mal && <div className="text-[9.5px] font-bold text-peligro">{mal}</div>}
                    </td>
                    <td className="num py-1 pr-2 text-right">
                      {pesos(c.a.monto, true)}
                      <div className="text-[9.5px] text-texto-3">
                        {Math.round(c.a.unidades).toLocaleString("es-AR")}{" "}
                        {plural(c.a.unidad, Math.round(c.a.unidades))}
                      </div>
                    </td>
                    <td className="py-1 pr-2">{k.estado}</td>
                    <td className="py-1 pr-2">{k.monto}</td>
                    <td className="py-1 pr-2">{k.unidades}</td>
                    <td className="py-1 pr-2">{k.expediente}</td>
                    <td className="py-1">{k.nota}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          {visibles.length === 0 && (
            <p className="py-3 text-center text-[11px] text-texto-3">Nada coincide con el filtro.</p>
          )}
          {visibles.length > cuantas && (
            <button
              onClick={() => setCuantas((n) => n + POR_PAGINA)}
              className="mt-1 w-full rounded-md border border-borde-2 py-1 text-[10.5px] font-bold text-texto-2 hover:text-rosa"
            >
              Mostrar {Math.min(POR_PAGINA, visibles.length - cuantas)} más (quedan {visibles.length - cuantas})
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void guardar()}
            disabled={ocupado || pendientes.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-celeste px-3 py-1.5 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Save size={12} />{" "}
            {ocupado
              ? "Guardando…"
              : pendientes.length > 0
                ? `Guardar ${pendientes.length} cambio${pendientes.length === 1 ? "" : "s"}`
                : "Sin cambios"}
          </button>
          {pendientes.length > 0 && (
            <button onClick={() => setBorrador({})} className="text-[10.5px] text-texto-3 hover:text-texto">
              deshacer
            </button>
          )}
          {msj && <span className={`text-[11px] font-bold ${msj.ok ? "text-completo" : "text-peligro"}`}>{msj.t}</span>}
          <span className="w-full text-[10px] text-texto-3">
            Con gasto hace falta el expediente. «No se hará» y gastar más de lo aprobado piden una nota. Cada cambio
            queda en la bitácora con quién lo cargó.
          </span>
        </div>
      </div>
    </div>
  );
}

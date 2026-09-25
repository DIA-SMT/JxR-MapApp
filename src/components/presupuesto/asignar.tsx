"use client";

import { Download, Info, Lock, LockOpen, Save, Scale, Search, TriangleAlert, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asignarPresupuesto, type ResultadoAsignacion } from "@/lib/asignacion";
import { armarEntradas, INDICADORES, libreAsignable, parsearImporte, type Partida } from "@/lib/presupuesto";
import { guardarEscenario, type Ajuste } from "@/lib/presupuesto-datos";
import { descargarCSV } from "@/lib/csv";
import { Cifra, Cifras } from "@/components/ui/cifras";
import { Vacio } from "@/components/ui/vacio";
import { MapaBarrios } from "./mapa-barrios";
import type { DatosPresupuesto } from "./panel";

const numero = (n: number) => Math.round(n).toLocaleString("es-AR");

/** $ 1.234.567 o, compacto, $ 1.234,6 M. */
export function pesos(n: number, compacto = false): string {
  if (compacto && Math.abs(n) >= 1e6) {
    return `$ ${(n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: n >= 1e9 ? 0 : 1 })} M`;
  }
  return `$ ${Math.round(n).toLocaleString("es-AR")}`;
}

const TIPO: Record<string, string> = {
  obra: "Obra",
  servicio: "Servicio",
  transferencia_personas: "Cupos a personas",
  programa_social: "Programa",
  institucional: "Institucional",
};

type Vista = "total" | "hogar";

export function Asignar({
  supabase,
  datos,
  onGuardado,
  irA,
}: {
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  onGuardado: () => Promise<void> | void;
  irA: (s: "disponible" | "politicas" | "escenarios") => void;
}) {
  const [intensidad, setIntensidad] = useState(1);
  const [equidad, setEquidad] = useState(1);
  const [excluidasManual, setExcluidasManual] = useState<Set<number>>(new Set());
  const [fijos, setFijos] = useState<Record<string, number>>({});
  // por qué se tocó cada celda: quien aprueba ve cada desvío del criterio
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [barrio, setBarrio] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("total");
  const [busqueda, setBusqueda] = useState("");
  const [nombre, setNombre] = useState("");
  const [criterio, setCriterio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const candidatas = useMemo(
    () => datos.politicas.filter((p) => p.activa && p.tipo !== "institucional"),
    [datos.politicas],
  );

  // El motor trabaja sobre lo LIBRE: lo que ya reservan los escenarios aprobados no se vuelve a repartir.
  const partidasLibres = useMemo<Partida[]>(
    () => datos.partidas.map((p) => ({ ...p, credito_vigente: p.libre, comprometido: 0 })),
    [datos.partidas],
  );

  const parametros = useMemo(
    () => ({
      intensidad,
      equidad,
      politicas: candidatas.filter((p) => !excluidasManual.has(p.id)).map((p) => p.id),
      fijos,
    }),
    [intensidad, equidad, candidatas, excluidasManual, fijos],
  );
  // Los deslizadores responden al instante; el cálculo va un paso atrás si hace falta.
  const diferidos = useDeferredValue(parametros);

  const calculo = useMemo(() => {
    const t0 = performance.now();
    const entradas = armarEntradas(partidasLibres, datos.politicas, datos.barrios, {
      ...diferidos,
      politicas: diferidos.politicas.length ? diferidos.politicas : [-1],
    });
    const resultado = asignarPresupuesto(entradas.fuentes, entradas.politicas, entradas.necesidades, {
      equidad: diferidos.equidad,
      pasos: 4000,
    });
    return { entradas, resultado, ms: performance.now() - t0 };
  }, [partidasLibres, datos.politicas, datos.barrios, diferidos]);
  const { resultado: r, entradas } = calculo;
  const recalculando = parametros !== diferidos;

  // Un fijo cuya celda salió del juego (se sacó la política, perdió el costo o
  // sus partidas) no se guarda ni pide motivo: se muestra aparte para soltarlo.
  const clavesEnJuego = useMemo(() => new Set(entradas.necesidades.map((n) => `${n.politica}|${n.destino}`)), [entradas]);
  const fijosVigentes = Object.keys(fijos).filter((k) => clavesEnJuego.has(k));
  const fijosHuerfanos = Object.keys(fijos).filter((k) => !clavesEnJuego.has(k));
  const soltar = (claves: string[]) => {
    setFijos((f) => {
      const n = { ...f };
      for (const k of claves) delete n[k];
      return n;
    });
    setMotivos((m) => {
      const n = { ...m };
      for (const k of claves) delete n[k];
      return n;
    });
  };

  // Lo que el motor daría SIN los montos fijados, para mostrar y guardar el desvío.
  const sinAjustes = useMemo(() => {
    if (Object.keys(diferidos.fijos).length === 0) return null;
    const e = armarEntradas(partidasLibres, datos.politicas, datos.barrios, {
      ...diferidos,
      fijos: {},
      politicas: diferidos.politicas.length ? diferidos.politicas : [-1],
    });
    const base = asignarPresupuesto(e.fuentes, e.politicas, e.necesidades, { equidad: diferidos.equidad, pasos: 4000 });
    return new Map(base.asignaciones.map((a) => [`${a.politica}|${a.destino}`, a.monto]));
  }, [partidasLibres, datos.politicas, datos.barrios, diferidos]);

  const polPorId = useMemo(() => new Map(datos.politicas.map((p) => [String(p.id), p])), [datos.politicas]);
  const partidaPorId = useMemo(() => new Map(datos.partidas.map((p) => [String(p.id), p])), [datos.partidas]);
  const barrioPorId = useMemo(() => new Map(datos.barrios.map((b) => [b.id, b])), [datos.barrios]);

  // Solo lo asignable: personal, intereses, inversión financiera y amortización no entran.
  const libreTotal = useMemo(() => libreAsignable(partidasLibres), [partidasLibres]);

  const porBarrio = useMemo(() => {
    const m = new Map<string, { monto: number; politicas: number }>();
    for (const a of r.asignaciones) {
      const x = m.get(a.destino) ?? { monto: 0, politicas: 0 };
      x.monto += a.monto;
      x.politicas += 1;
      m.set(a.destino, x);
    }
    return m;
  }, [r]);

  const valoresMapa = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [b, x] of porBarrio) {
      if (vista === "total") out[b] = x.monto;
      else {
        const h = barrioPorId.get(b)?.hogares ?? 0;
        if (h > 0) out[b] = x.monto / h;
      }
    }
    return out;
  }, [porBarrio, vista, barrioPorId]);

  const filasBarrio = useMemo(() => {
    const q = busqueda
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
    return [...porBarrio.entries()]
      .map(([id, x]) => {
        const b = barrioPorId.get(id);
        return {
          id,
          monto: x.monto,
          politicas: x.politicas,
          hogares: b?.hogares ?? 0,
          pctNbi: b && b.hogares > 0 ? (100 * (b.indicadores.nbi ?? 0)) / b.hogares : 0,
        };
      })
      .filter((f) => !q || f.id.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
      .sort((a, b) => b.monto - a.monto);
  }, [porBarrio, barrioPorId, busqueda]);

  const financiadoPor = useMemo(() => {
    const m = new Map<string, Array<{ partida: string; monto: number }>>();
    for (const f of r.financiamiento) {
      const l = m.get(f.politica) ?? [];
      l.push({ partida: partidaPorId.get(f.fuente)?.codigo ?? f.fuente, monto: f.monto });
      m.set(f.politica, l);
    }
    return m;
  }, [r, partidaPorId]);

  const exportar = () => {
    descargarCSV(
      "asignacion-presupuesto.csv",
      ["politica_codigo", "politica", "tipo", "barrio", "monto", "unidades", "unidad", "cobertura_pct", "fijado"],
      r.asignaciones.map((a) => {
        const p = polPorId.get(a.politica);
        return [
          p?.codigo,
          p?.nombre,
          p ? TIPO[p.tipo] : "",
          a.destino,
          Math.round(a.monto),
          a.unidades,
          p?.unidad,
          (100 * a.cobertura).toFixed(1),
          fijos[`${a.politica}|${a.destino}`] != null,
        ];
      }),
    );
  };

  const guardar = async () => {
    if (guardando) return;
    setMensaje(null);
    if (!nombre.trim()) return setMensaje({ ok: false, texto: "Poné un nombre al escenario." });
    if (criterio.trim().length < 20)
      return setMensaje({ ok: false, texto: "Explicá el criterio (al menos 20 caracteres): es el fundamento del acto." });
    const sinMotivo = fijosVigentes.filter((k) => (motivos[k] ?? "").trim().length < 5);
    if (sinMotivo.length > 0) {
      return setMensaje({
        ok: false,
        texto: `Hay ${sinMotivo.length} montos fijados a mano sin motivo (en ${sinMotivo.map((k) => k.split("|")[1]).join(", ")}). Explicá cada uno.`,
      });
    }
    const ajustes: Ajuste[] = fijosVigentes.map((k) => {
      const [politica, barrio] = k.split("|");
      const efectivo = r.fijados.find((x) => x.politica === politica && x.destino === barrio)?.efectivo ?? 0;
      return { politica, barrio, montoMotor: sinAjustes?.get(k) ?? 0, montoFijado: efectivo, motivo: motivos[k].trim() };
    });
    setGuardando(true);
    const { error } = await guardarEscenario(supabase, {
      nombre,
      criterio,
      parametros: {
        intensidad,
        equidad,
        politicas: parametros.politicas,
        fijos: Object.fromEntries(fijosVigentes.map((k) => [k, fijos[k]])),
      },
      resultado: r,
      ajustes,
      // el costo con que se calculó: la base rechaza si cambió en el medio
      costos: new Map(entradas.politicas.map((p) => [p.id, p.costoUnitario])),
    });
    setGuardando(false);
    if (error) return setMensaje({ ok: false, texto: error });
    setMensaje({ ok: true, texto: "Escenario guardado como borrador." });
    setNombre("");
    setCriterio("");
    await onGuardado();
  };

  // ── estados vacíos ──
  if (datos.partidas.length === 0)
    return (
      <Vacio
        icono={Scale}
        titulo="Todavía no hay partidas cargadas"
        accion={
          <button onClick={() => irA("disponible")} className="rounded-lg bg-rosa px-3 py-1.5 text-xs font-bold text-white">
            Cargar partidas
          </button>
        }
      >
        Para asignar hace falta saber cuánto queda libre en cada partida. Se carga desde el reporte de ejecución de la
        Contaduría: la ordenanza del presupuesto no trae ese detalle.
      </Vacio>
    );

  const sinCosto = candidatas.filter((p) => !(p.costo_unitario && p.costo_unitario > 0));
  if (candidatas.length === sinCosto.length)
    return (
      <Vacio
        icono={Scale}
        titulo="Ninguna política tiene costo por unidad"
        accion={
          <button onClick={() => irA("politicas")} className="rounded-lg bg-rosa px-3 py-1.5 text-xs font-bold text-white">
            Completar costos
          </button>
        }
      >
        El motor necesita saber cuánto cuesta cada unidad (una conexión, un cupo, una luminaria) para convertir pesos en
        necesidad cubierta. Hay {candidatas.length} políticas activas esperando su costo.
      </Vacio>
    );

  const seleccion = barrio ? barrioPorId.get(barrio) : null;
  const asignacionesBarrio = barrio ? r.asignaciones.filter((a) => a.destino === barrio) : [];

  return (
    <div className="space-y-3">
      {/* Parámetros */}
      <div className="panel-vidrio rounded-2xl p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="flex items-center justify-between text-[10px] font-bold tracking-wide text-texto-3 uppercase">
              Priorizar la necesidad concentrada
              <span className="num text-texto-2 normal-case">{intensidad.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={intensidad}
              onChange={(e) => setIntensidad(Number(e.target.value))}
              className="mt-1.5 w-full accent-[#e14f82]"
            />
            <span className="text-[10px] leading-snug text-texto-3">
              0: cada hogar con necesidad vale lo mismo esté donde esté. Más alto: pesan más los barrios donde la necesidad
              es mayor que el promedio de la ciudad.
            </span>
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-[10px] font-bold tracking-wide text-texto-3 uppercase">
              Repartir entre barrios
              <span className="num text-texto-2 normal-case">{equidad.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={4}
              step={0.1}
              value={equidad}
              onChange={(e) => setEquidad(Number(e.target.value))}
              className="mt-1.5 w-full accent-[#e14f82]"
            />
            <span className="text-[10px] leading-snug text-texto-3">
              0: se cubre primero, hasta agotarla, la necesidad que más rinde. Más alto: los primeros hogares de cada barrio
              valen más que los últimos, y el presupuesto llega a más barrios.
            </span>
          </label>
        </div>

        <div className="mt-3 border-t border-borde pt-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            <span>Políticas en juego</span>
            <span className="font-normal normal-case">
              {candidatas.filter((p) => !excluidasManual.has(p.id)).length} de {candidatas.length} · tocá para sacar o volver a poner
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {candidatas.map((p) => {
              const fuera = excluidasManual.has(p.id);
              const sinDato = !(p.costo_unitario && p.costo_unitario > 0) || !INDICADORES[p.indicador];
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    setExcluidasManual((s) => {
                      const n = new Set(s);
                      if (n.has(p.id)) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                  title={`${p.nombre}${sinDato ? " · falta costo o indicador" : ""}`}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                    fuera
                      ? "border-borde text-texto-3 line-through"
                      : sinDato
                        ? "border-encurso/40 text-encurso"
                        : "border-rosa/40 bg-rosa/10 text-rosa"
                  }`}
                >
                  {p.codigo} {p.nombre.length > 28 ? p.nombre.slice(0, 27) + "…" : p.nombre}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Resultado */}
      <Cifras
        className={recalculando ? "opacity-70" : ""}
        acciones={
          <span className="num text-[10px] text-texto-3" title="Tiempo del motor de asignación en este navegador">
            {Math.round(calculo.ms)} ms
          </span>
        }
      >
        <Cifra valor={pesos(libreTotal, true)} etiqueta="libre en partidas" />
        <Cifra
          valor={pesos(r.asignado, true)}
          etiqueta="asignado"
          tono="marca"
          nota={libreTotal > 0 ? `${Math.round((100 * r.asignado) / libreTotal)}%` : undefined}
        />
        <Cifra
          valor={pesos(r.sinAsignar, true)}
          etiqueta="sin asignar"
          tono={r.sinAsignar > libreTotal * 0.05 ? "aviso" : "neutro"}
          titulo="Partidas que ninguna política activa puede usar, o necesidad ya cubierta"
        />
        <Cifra valor={numero(porBarrio.size)} de={numero(datos.barrios.length)} etiqueta="barrios alcanzados" />
        <Cifra
          valor={numero(r.porPolitica.filter((p) => p.monto > 0).length)}
          de={numero(entradas.politicas.length)}
          etiqueta="políticas financiadas"
        />
      </Cifras>

      {(r.avisos.length > 0 || entradas.excluidas.length > 0) && (
        <details className="panel-vidrio rounded-2xl border-encurso/40 px-4 py-2.5 text-[11px]">
          <summary className="flex cursor-pointer items-center gap-1.5 font-bold text-encurso">
            <TriangleAlert size={12} />
            {entradas.excluidas.length > 0 && `${entradas.excluidas.length} políticas quedaron afuera`}
            {entradas.excluidas.length > 0 && r.avisos.length > 0 && " · "}
            {r.avisos.length > 0 && `${r.avisos.length} avisos del cálculo`}
          </summary>
          <ul className="mt-2 space-y-0.5 text-texto-2">
            {entradas.excluidas.map((e) => (
              <li key={e.politica}>
                · <b>{e.politica}</b>: {e.motivo}
              </li>
            ))}
            {r.avisos.map((a) => (
              <li key={a}>· {a}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Mapa + detalle del barrio */}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex overflow-hidden rounded-lg border border-borde-2 text-[11px] font-bold">
              {(
                [
                  ["total", "Monto total"],
                  ["hogar", "Por hogar"],
                ] as Array<[Vista, string]>
              ).map(([v, t]) => (
                <button
                  key={v}
                  onClick={() => setVista(v)}
                  className={`px-2.5 py-1.5 transition ${vista === v ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-texto-3">Tocá un barrio para ver y ajustar su asignación</span>
          </div>
          <MapaBarrios
            valores={valoresMapa}
            formatear={(v) => pesos(v, vista === "total")}
            etiqueta={vista === "total" ? "Asignado" : "Asignado por hogar"}
            seleccionado={barrio}
            onSeleccionar={setBarrio}
          />
        </div>

        <div className="panel-vidrio min-w-0 rounded-2xl p-4">
          {!seleccion ? (
            <Vacio icono={Info} titulo="Elegí un barrio" variante="filtro">
              En el mapa o en la tabla de abajo. Vas a ver qué recibe, cuánta necesidad cubre y podés fijar montos a mano.
            </Vacio>
          ) : (
            <BarrioDetalle
              key={seleccion.id}
              celdas={entradas.necesidades.filter((n) => n.destino === seleccion.id)}
              costos={new Map(entradas.politicas.map((p) => [p.id, p.costoUnitario]))}
              fijados={r.fijados}
              motor={sinAjustes}
              motivos={motivos}
              onMotivo={(pol, texto) => setMotivos((m) => ({ ...m, [`${pol}|${seleccion.id}`]: texto }))}
              nombre={seleccion.nombre}
              hogares={seleccion.hogares}
              poblacion={seleccion.poblacion}
              indicadores={seleccion.indicadores}
              asignaciones={asignacionesBarrio}
              politicas={polPorId}
              fijos={fijos}
              onFijar={(pol, monto) =>
                monto == null
                  ? soltar([`${pol}|${seleccion.id}`])
                  : setFijos((f) => ({ ...f, [`${pol}|${seleccion.id}`]: monto }))
              }
              onCerrar={() => setBarrio(null)}
            />
          )}
        </div>
      </div>

      {/* Por política */}
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Por política</h3>
        <div className="mt-2 overflow-auto">
          <table className="w-full min-w-[760px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
              <tr>
                <th className="py-1 pr-2 font-semibold">Política</th>
                <th className="num py-1 pr-2 text-right font-semibold">Asignado</th>
                <th className="num py-1 pr-2 text-right font-semibold">Unidades</th>
                <th className="py-1 pr-2 font-semibold">Cobertura</th>
                <th className="py-1 pr-2 font-semibold">Frena por</th>
                <th className="py-1 font-semibold">La pagan</th>
              </tr>
            </thead>
            <tbody>
              {[...r.porPolitica]
                .sort((a, b) => b.monto - a.monto)
                .map((p) => {
                  const pol = polPorId.get(p.politica);
                  const cob = p.necesidad > 0 ? p.unidades / p.necesidad : 0;
                  return (
                    <tr key={p.politica} className="border-t border-borde/60 transition hover:bg-panel-3/50">
                      <td className="max-w-72 py-1.5 pr-2">
                        <div className="truncate font-semibold" title={pol?.nombre}>
                          <span className="text-texto-3">{pol?.codigo}</span> {pol?.nombre}
                        </div>
                        <div className="text-[9.5px] text-texto-3">
                          {pol ? TIPO[pol.tipo] : ""} · {pol?.costo_unitario ? pesos(pol.costo_unitario) : "—"} por{" "}
                          {pol?.unidad || "unidad"}
                        </div>
                      </td>
                      <td className="num py-1.5 pr-2 text-right font-bold">{pesos(p.monto, true)}</td>
                      <td className="num py-1.5 pr-2 text-right">
                        {numero(p.unidades)}
                        <span className="text-texto-3"> / {numero(p.necesidad)}</span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                            <div className="h-full rounded-full bg-rosa" style={{ width: `${Math.min(100, 100 * cob)}%` }} />
                          </div>
                          <span className="num text-texto-2">{(100 * cob).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 text-texto-2">
                        {p.saturada === "fondos"
                          ? "sin fondos compatibles"
                          : p.saturada === "tope"
                            ? "llegó a su tope"
                            : p.saturada === "necesidad"
                              ? "necesidad cubierta"
                              : p.monto > 0
                                ? "rinde menos que otras"
                                : "—"}
                      </td>
                      <td className="max-w-56 truncate py-1.5 text-[10px] text-texto-3">
                        {(financiadoPor.get(p.politica) ?? [])
                          .sort((a, b) => b.monto - a.monto)
                          .map((f) => `${f.partida} (${pesos(f.monto, true)})`)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Por barrio */}
      <div className="panel-vidrio rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Por barrio</h3>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-borde-2 bg-panel px-2 py-1">
              <Search size={12} className="text-texto-3" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar barrio…"
                className="w-36 bg-transparent text-[11px] outline-none placeholder:text-texto-3"
              />
            </div>
            <button
              onClick={exportar}
              className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
            >
              <Download size={12} /> CSV
            </button>
          </div>
        </div>
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
              <tr>
                <th className="py-1 pr-2 font-semibold">Barrio</th>
                <th className="num py-1 pr-2 text-right font-semibold">Asignado</th>
                <th className="num py-1 pr-2 text-right font-semibold">Por hogar</th>
                <th className="num py-1 pr-2 text-right font-semibold">Hogares</th>
                <th className="num py-1 pr-2 text-right font-semibold">NBI</th>
                <th className="num py-1 text-right font-semibold">Políticas</th>
              </tr>
            </thead>
            <tbody>
              {filasBarrio.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setBarrio(f.id)}
                  className={`cursor-pointer border-t border-borde/60 transition hover:bg-panel-3/50 ${barrio === f.id ? "bg-rosa/10" : ""}`}
                >
                  <td className="py-1 pr-2 font-semibold">{f.id}</td>
                  <td className="num py-1 pr-2 text-right font-bold">{pesos(f.monto, true)}</td>
                  <td className="num py-1 pr-2 text-right">{f.hogares > 0 ? pesos(f.monto / f.hogares) : "—"}</td>
                  <td className="num py-1 pr-2 text-right text-texto-2">{numero(f.hogares)}</td>
                  <td className="num py-1 pr-2 text-right text-texto-2">{f.pctNbi.toFixed(1)}%</td>
                  <td className="num py-1 text-right text-texto-2">{f.politicas}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filasBarrio.length === 0 && (
            <p className="py-4 text-center text-[11px] text-texto-3">
              {busqueda ? "Ningún barrio con asignación coincide." : "Todavía no se asignó nada."}
            </p>
          )}
        </div>
      </div>

      {/* Guardar */}
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
          <Save size={12} className="text-rosa" /> Guardar como escenario
        </h3>
        <p className="mt-1 text-[10.5px] text-texto-3">
          Se guarda como borrador. Para que reserve crédito, lo tiene que aprobar el superadmin con el número de la norma.
          La base vuelve a controlar que ninguna partida quede excedida.
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-[240px_1fr]">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre (ej. Plan barrios sur, 2º semestre)"
            className="rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
          />
          <textarea
            value={criterio}
            onChange={(e) => setCriterio(e.target.value)}
            rows={2}
            placeholder="Criterio: por qué esta asignación (qué se priorizó y con qué fundamento). Queda como antecedente del acto."
            className="resize-y rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void guardar()}
            disabled={guardando || r.asignado <= 0}
            className="flex items-center gap-1.5 rounded-lg bg-rosa px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Save size={13} /> {guardando ? "Guardando…" : "Guardar escenario"}
          </button>
          <span className={`text-[10px] ${criterio.trim().length >= 20 ? "text-completo" : "text-texto-3"}`}>
            criterio: {criterio.trim().length}/20
          </span>
          {mensaje && (
            <span className={`text-[11px] font-bold ${mensaje.ok ? "text-completo" : "text-peligro"}`}>{mensaje.texto}</span>
          )}
          {fijosHuerfanos.length > 0 && (
            <span className="flex items-center gap-1.5 text-[10.5px] text-encurso">
              {fijosHuerfanos.length} monto{fijosHuerfanos.length === 1 ? "" : "s"} fijado{fijosHuerfanos.length === 1 ? "" : "s"} de políticas que ya no están en juego (no se guarda{fijosHuerfanos.length === 1 ? "" : "n"})
              <button onClick={() => soltar(fijosHuerfanos)} className="font-bold underline">
                soltar
              </button>
            </span>
          )}
          {mensaje?.ok && (
            <button onClick={() => irA("escenarios")} className="text-[11px] font-semibold text-rosa hover:underline">
              ver escenarios
            </button>
          )}
        </div>
      </div>

      <MetodoNota />
    </div>
  );
}

/**
 * Lo que recibe un barrio, con la posibilidad de fijar montos a mano. Solo se
 * ofrecen las políticas con necesidad en ESTE barrio (si no, un monto fijado
 * se descartaría en silencio), el monto se acota a lo que se puede cubrir y
 * cada ajuste pide su motivo: queda guardado junto a lo que daba el motor.
 */
function BarrioDetalle({
  nombre,
  hogares,
  poblacion,
  indicadores,
  asignaciones,
  politicas,
  celdas,
  costos,
  fijos,
  fijados,
  motor,
  motivos,
  onFijar,
  onMotivo,
  onCerrar,
}: {
  nombre: string;
  hogares: number;
  poblacion: number;
  indicadores: Record<string, number>;
  asignaciones: ResultadoAsignacion["asignaciones"];
  politicas: Map<string, DatosPresupuesto["politicas"][number]>;
  celdas: Array<{ politica: string; unidades: number }>;
  costos: Map<string, number>;
  fijos: Record<string, number>;
  fijados: ResultadoAsignacion["fijados"];
  motor: Map<string, number> | null;
  motivos: Record<string, string>;
  onFijar: (politica: string, monto: number | null) => void;
  onMotivo: (politica: string, texto: string) => void;
  onCerrar: () => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState("");
  const total = asignaciones.reduce((a, x) => a + x.monto, 0);
  const porPol = new Map(asignaciones.map((a) => [a.politica, a]));
  const filas = celdas
    .map((c) => ({ id: c.politica, necesidad: c.unidades, a: porPol.get(c.politica), pol: politicas.get(c.politica) }))
    .filter((f) => f.pol)
    .sort((x, y) => (y.a?.monto ?? 0) - (x.a?.monto ?? 0));
  const ajustados = filas.filter((f) => fijos[`${f.id}|${nombre}`] != null).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-extrabold">{nombre}</h3>
          <p className="text-[10px] text-texto-3">
            {Math.round(poblacion).toLocaleString("es-AR")} hab. · {Math.round(hogares).toLocaleString("es-AR")} hogares ·
            NBI {hogares > 0 ? ((100 * (indicadores.nbi ?? 0)) / hogares).toFixed(1) : "0"}% · sin cloaca{" "}
            {hogares > 0 ? ((100 * (indicadores.sin_cloaca ?? 0)) / hogares).toFixed(1) : "0"}%
          </p>
        </div>
        <button onClick={onCerrar} className="shrink-0 text-texto-3 hover:text-texto" aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
      <div className="num mt-2 text-xl font-extrabold text-rosa">{pesos(total, true)}</div>
      <p className="text-[10px] text-texto-3">
        {hogares > 0 ? `${pesos(total / hogares)} por hogar · ` : ""}
        {ajustados > 0 ? `${ajustados} ajustado${ajustados === 1 ? "" : "s"} a mano` : "el candado fija un monto y el resto se reoptimiza"}
      </p>

      {filas.length === 0 && (
        <p className="mt-3 text-[11px] text-texto-3">Ninguna política en juego tiene necesidad medida en este barrio.</p>
      )}

      <div className="mt-3 max-h-[300px] space-y-1 overflow-auto pr-1">
        {filas.map(({ id, necesidad, a, pol }) => {
          const clave = `${id}|${nombre}`;
          const fijado = fijos[clave] != null;
          const info = INDICADORES[pol!.indicador];
          const costo = costos.get(id) ?? pol!.costo_unitario ?? 0;
          const maximo = necesidad * costo;
          const estado = fijados.find((x) => x.politica === id && x.destino === nombre);
          const delMotor = motor?.get(clave) ?? 0;
          return (
            <div key={id} className={`rounded-lg border px-2 py-1.5 ${fijado ? "border-rosa/40 bg-rosa/5" : "border-borde"}`}>
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={pol!.nombre}>
                  <span className="text-texto-3">{pol!.codigo}</span> {pol!.nombre}
                </span>
                <span className="num shrink-0 text-[11px] font-bold">{a ? pesos(a.monto, true) : "—"}</span>
                <button
                  onClick={() => {
                    if (fijado) onFijar(id, null);
                    else {
                      setEditando(id);
                      setValor(String(Math.round(a?.monto ?? 0)));
                    }
                  }}
                  title={fijado ? "Soltar: que lo decida el motor" : "Fijar un monto a mano"}
                  className={`shrink-0 transition ${fijado ? "text-rosa" : "text-texto-3 hover:text-texto"}`}
                >
                  {fijado ? <Lock size={12} /> : <LockOpen size={12} />}
                </button>
              </div>
              {a && (
                <div className="mt-0.5 text-[9.5px] text-texto-3">
                  {Math.round(a.unidades).toLocaleString("es-AR")} {pol!.unidad || "unidades"} · cubre el{" "}
                  {(100 * a.cobertura).toFixed(1)}% de {info ? info.etiqueta.toLowerCase() : "la necesidad"}
                </div>
              )}
              {fijado && (
                <div className="mt-1 space-y-1">
                  <div className="text-[9.5px] text-texto-2">
                    Fijado en {pesos(fijos[clave])}
                    {estado && Math.abs(estado.efectivo - fijos[clave]) >= 1 && (
                      <span className="text-encurso"> · se asignan {pesos(estado.efectivo)} ({estado.motivo})</span>
                    )}
                    {motor && <span className="text-texto-3"> · el motor daba {pesos(delMotor)}</span>}
                  </div>
                  <input
                    value={motivos[clave] ?? ""}
                    onChange={(e) => onMotivo(id, e.target.value)}
                    placeholder="Motivo del ajuste (obligatorio): lo ve quien aprueba"
                    className={`w-full rounded-md border bg-panel px-2 py-1 text-[10.5px] outline-none placeholder:text-texto-3 focus:border-rosa/50 ${
                      (motivos[clave] ?? "").trim().length >= 5 ? "border-borde-2" : "border-encurso/60"
                    }`}
                  />
                </div>
              )}
              {editando === id && !fijado && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <input
                    autoFocus
                    value={valor}
                    onChange={(e) => setValor(e.target.value.replace(/[^0-9.,]/g, ""))}
                    inputMode="numeric"
                    className="num w-32 rounded-md border border-borde-2 bg-panel px-2 py-1 text-[11px] outline-none focus:border-rosa/50"
                  />
                  <button
                    onClick={() => {
                      const n = parsearImporte(valor || "0");
                      if (!Number.isFinite(n) || n < 0) return;
                      onFijar(id, Math.min(n, maximo));
                      setEditando(null);
                    }}
                    className="rounded-md bg-rosa px-2 py-1 text-[10px] font-bold text-white"
                  >
                    Fijar
                  </button>
                  <button onClick={() => setEditando(null)} className="text-[10px] text-texto-3 hover:text-texto">
                    cancelar
                  </button>
                  <span className="w-full text-[9.5px] text-texto-3">
                    Máximo {pesos(maximo)}: cubrir toda la necesidad del barrio. 0 lo deja sin esta política.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetodoNota() {
  return (
    <div className="panel-vidrio rounded-2xl border-encurso/40 p-4">
      <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-encurso uppercase">
        <Info size={12} /> Cómo decide el motor
      </h3>
      <div className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-texto-2">
        <p>
          Cada política convierte pesos en <b>unidades de necesidad cubiertas</b> —hogares conectados, cupos, personas
          atendidas— según su costo por unidad, y la necesidad de cada barrio la da el Censo 2022. El valor se mide en{" "}
          <b>pesos de necesidad cubierta</b>: prioridad de la política × intensidad de la necesidad en el barrio × costo de
          cubrirla. Así una política no se come el presupuesto solo porque sus unidades sean más baratas.
        </p>
        <p>
          Cada partida paga solo lo que su sección, su partida principal y su afectación permiten, y personal (PP 11),
          intereses (21), inversión financiera (61) y amortización (71)
          nunca entran. Con eso, el motor reparte el crédito libre para cubrir la mayor necesidad posible: es el{" "}
          <b>óptimo</b> del problema (salvo, a lo sumo, un incremento por barrio y política, que es lo que permite
          recalcular la ciudad entera en milisegundos), y cuando una partida se agota reasigna qué partida paga qué
          antes de dejar a una política sin fondos.
        </p>
        <p>
          <b>Límites.</b> La necesidad por barrio se reparte desde los radios censales en proporción a la superficie; los
          barrios más chicos que un radio pueden no aparecer, y los cuatro nombres repetidos del mapa (Vial, San José, San
          Martín, San Miguel) salen sumados. El censo es de 2022.
        </p>
      </div>
    </div>
  );
}

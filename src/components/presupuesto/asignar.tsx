"use client";

import {
  Download,
  FlaskConical,
  Info,
  Lock,
  LockOpen,
  Save,
  Scale,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asignarPresupuesto, type ResultadoAsignacion } from "@/lib/asignacion";
import {
  armarEntradas,
  INDICADORES,
  leerLimites,
  libreAsignable,
  parsearImporte,
  pct,
  plural,
  type Partida,
} from "@/lib/presupuesto";
import { guardarEscenario, type Ajuste } from "@/lib/presupuesto-datos";
import { descargarCSV } from "@/lib/csv";
import { Vacio } from "@/components/ui/vacio";
import { MapaBarrios } from "./mapa-barrios";
import { CRITERIOS, pesos } from "@/lib/presupuesto";
export { pesos, resumenParametros } from "@/lib/presupuesto";
import { MontosPorPolitica } from "./montos-politica";
import { QuienInterviene } from "./areas";
import { conSigno } from "./comparar";
import { obtenerDetalleEscenario } from "@/lib/presupuesto-datos";
import type { DatosPresupuesto } from "./panel";

const numero = (n: number) => Math.round(n).toLocaleString("es-AR");

const TIPO: Record<string, string> = {
  obra: "Obra",
  servicio: "Servicio",
  transferencia_personas: "Cupos a personas",
  programa_social: "Programa",
  institucional: "Institucional",
};

type Vista = "total" | "hogar" | "diferencia";

/** Para retomar una propuesta guardada: el criterio, las políticas y lo decidido a mano. */
export interface PlantillaReparto {
  /** Id de la propuesta de origen (también sirve de key para reiniciar Repartir). */
  origen: number;
  nombre: string;
  criterio: string;
  intensidad: number;
  equidad: number;
  politicas: number[];
  fijos: Record<string, number>;
  motivos: Record<string, string>;
  limites: Record<string, { piso?: number; tope?: number }>;
}

/** Un número como se tipea acá: coma decimal, sin separador de miles. */
const aTexto = (n: number) => n.toLocaleString("es-AR", { useGrouping: false, maximumFractionDigits: 2 });

export function Asignar({
  supabase,
  datos,
  ejemplo = false,
  inicial,
  onGuardado,
  irA,
  onEjemplo,
  onSoltarPlantilla,
}: {
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  /** Modo ejemplo: montos inventados, no se guarda. */
  ejemplo?: boolean;
  /** Una propuesta guardada desde la que se arranca («Duplicar y ajustar»). */
  inicial?: PlantillaReparto | null;
  onGuardado: () => Promise<void> | void;
  irA: (s: "disponible" | "politicas" | "escenarios") => void;
  onEjemplo?: () => void;
  onSoltarPlantilla?: () => void;
}) {
  const [intensidad, setIntensidad] = useState(inicial?.intensidad ?? 1);
  const [equidad, setEquidad] = useState(inicial?.equidad ?? 1);
  const [excluidasManual, setExcluidasManual] = useState<Set<number>>(() => {
    if (!inicial || inicial.politicas.length === 0) return new Set();
    const dentro = new Set(inicial.politicas);
    return new Set(
      datos.politicas.filter((p) => p.activa && p.tipo !== "institucional" && !dentro.has(p.id)).map((p) => p.id),
    );
  });
  const [fijos, setFijos] = useState<Record<string, number>>(inicial?.fijos ?? {});
  // «al menos» y «como máximo» por política, tal como se escribieron
  const [textoLimites, setTextoLimites] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const [id, l] of Object.entries(inicial?.limites ?? {})) {
      if (l.piso != null) t[`${id}|piso`] = aTexto(l.piso);
      if (l.tope != null) t[`${id}|tope`] = aTexto(l.tope);
    }
    return t;
  });
  const leidos = useMemo(() => leerLimites(textoLimites), [textoLimites]);
  // por qué se tocó cada celda: quien aprueba ve cada desvío del criterio
  const [motivos, setMotivos] = useState<Record<string, string>>(inicial?.motivos ?? {});
  const [barrio, setBarrio] = useState<string | null>(null);
  // En pantallas angostas el detalle queda debajo del mapa: al elegir un barrio, se lo trae a la vista.
  const detalleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (barrio && window.innerWidth < 1024) detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [barrio]);
  const [vista, setVista] = useState<Vista>("total");
  const [busqueda, setBusqueda] = useState("");
  const [nombre, setNombre] = useState(inicial ? `${inicial.nombre} (ajustada)` : "");
  const [criterio, setCriterio] = useState(inicial?.criterio ?? "");
  const guardarRef = useRef<HTMLDivElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);

  // Comparar lo que se está armando contra una propuesta guardada
  const [compararId, setCompararId] = useState<number | null>(null);
  const [comparada, setComparada] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    setComparada(null);
    if (compararId == null) return;
    let vivo = true;
    void obtenerDetalleEscenario(supabase, compararId)
      .then((d) => {
        if (!vivo) return;
        const m = new Map<string, number>();
        for (const a of d.asignaciones) m.set(a.barrio, (m.get(a.barrio) ?? 0) + a.monto);
        setComparada(m);
      })
      .catch(() => vivo && setCompararId(null));
    return () => {
      vivo = false;
    };
  }, [compararId, supabase]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const candidatas = useMemo(
    () => datos.politicas.filter((p) => p.activa && p.tipo !== "institucional"),
    [datos.politicas],
  );

  // El motor trabaja sobre lo LIBRE: lo que ya reservan los escenarios aprobados no se vuelve a repartir.
  const partidasLibres = useMemo<Partida[]>(
    () =>
      datos.partidas.map((p) => ({
        ...p,
        credito_vigente: p.libre,
        comprometido: 0,
      })),
    [datos.partidas],
  );

  // Lo que vale es lo efectivo: lo decidido acá o, si falta, lo del catálogo. Un piso por encima del
  // tope (contando el del catálogo) no se aplica. Solo cuentan las políticas que están en juego.
  const { limites, invalidas } = useMemo(() => {
    const enJuego = new Map(candidatas.filter((p) => !excluidasManual.has(p.id)).map((p) => [p.id, p]));
    const invalidas = new Set([...leidos.invalidas].filter((id) => enJuego.has(id)));
    const limites: typeof leidos.limites = {};
    for (const [idTxt, l] of Object.entries(leidos.limites)) {
      const pol = enJuego.get(Number(idTxt));
      if (!pol) continue;
      const piso = l.piso ?? pol.piso;
      const tope = l.tope ?? pol.tope;
      if (piso != null && tope != null && piso > tope) invalidas.add(pol.id);
      else limites[pol.id] = l;
    }
    return { limites, invalidas };
  }, [leidos, candidatas, excluidasManual]);

  const parametros = useMemo(
    () => ({
      intensidad,
      equidad,
      politicas: candidatas.filter((p) => !excluidasManual.has(p.id)).map((p) => p.id),
      fijos,
      limites,
    }),
    [intensidad, equidad, candidatas, excluidasManual, fijos, limites],
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
  const clavesEnJuego = useMemo(
    () => new Set(entradas.necesidades.map((n) => `${n.politica}|${n.destino}`)),
    [entradas],
  );
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
    const base = asignarPresupuesto(e.fuentes, e.politicas, e.necesidades, {
      equidad: diferidos.equidad,
      pasos: 4000,
    });
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

  // barrio por barrio: lo que se está armando menos lo de la propuesta guardada
  const diferencias = useMemo(() => {
    if (!comparada) return null;
    const ids = new Set([...porBarrio.keys(), ...comparada.keys()]);
    return [...ids].map((id) => ({ id, dif: (porBarrio.get(id)?.monto ?? 0) - (comparada.get(id) ?? 0) }));
  }, [porBarrio, comparada]);

  const valoresMapa = useMemo(() => {
    const out: Record<string, number> = {};
    if (vista === "diferencia") {
      for (const d of diferencias ?? []) out[d.id] = d.dif;
      return out;
    }
    for (const [b, x] of porBarrio) {
      if (vista === "total") out[b] = x.monto;
      else {
        const h = barrioPorId.get(b)?.hogares ?? 0;
        if (h > 0) out[b] = x.monto / h;
      }
    }
    return out;
  }, [porBarrio, vista, barrioPorId, diferencias]);

  const filasBarrioTodas = useMemo(
    () => [...porBarrio.entries()].map(([id, x]) => ({ id, monto: x.monto })).sort((a, b) => b.monto - a.monto),
    [porBarrio],
  );

  const filasBarrio = useMemo(() => {
    const q = busqueda.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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

  const politicasConPlata = r.porPolitica.filter((p) => p.monto > 0);
  const topBarrios = filasBarrioTodas.slice(0, 3);

  const financiadoPor = useMemo(() => {
    const m = new Map<string, Array<{ partida: string; monto: number }>>();
    for (const f of r.financiamiento) {
      const l = m.get(f.politica) ?? [];
      l.push({
        partida: partidaPorId.get(f.fuente)?.codigo ?? f.fuente,
        monto: f.monto,
      });
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
    if (!nombre.trim()) return setMensaje({ ok: false, texto: "Poné un nombre a la propuesta." });
    if (criterio.trim().length < 20)
      return setMensaje({
        ok: false,
        texto: "Explicá el criterio (al menos 20 caracteres): es el fundamento del acto.",
      });
    if (invalidas.size > 0)
      return setMensaje({ ok: false, texto: "Hay montos por política sin corregir (al menos / como máximo)." });
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
      return {
        politica,
        barrio,
        montoMotor: sinAjustes?.get(k) ?? 0,
        montoFijado: efectivo,
        motivo: motivos[k].trim(),
      };
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
        // solo los de políticas que entraron al reparto
        limites: Object.fromEntries(
          Object.entries(limites)
            .filter(([id]) => entradas.politicas.some((p) => p.id === id))
            .map(([id, l]) => {
              const p = polPorId.get(id);
              return [id, { ...l, nombre: p ? `${p.codigo} ${p.nombre}` : undefined }];
            }),
        ),
      },
      resultado: r,
      ajustes,
      // el costo con que se calculó: la base rechaza si cambió en el medio
      costos: new Map(entradas.politicas.map((p) => [p.id, p.costoUnitario])),
    });
    setGuardando(false);
    if (error) return setMensaje({ ok: false, texto: error });
    setMensaje({ ok: true, texto: "Propuesta guardada como borrador." });
    setNombre("");
    setCriterio("");
    await onGuardado();
  };

  // ── estados vacíos: dicen qué falta y ofrecen probar el ejemplo ──
  const botonEjemplo = onEjemplo && (
    <button
      onClick={onEjemplo}
      className="flex items-center gap-1.5 rounded-lg border border-rosa/40 px-3 py-1.5 text-xs font-bold text-rosa"
    >
      <FlaskConical size={13} /> Probar con un ejemplo
    </button>
  );
  if (libreTotal <= 0)
    return (
      <Vacio
        icono={Scale}
        titulo="Primero hace falta saber cuánta plata hay"
        accion={
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => irA("disponible")}
              className="rounded-lg bg-rosa px-3 py-1.5 text-xs font-bold text-white"
            >
              Ir al paso 1 · Plata disponible
            </button>
            {botonEjemplo}
          </div>
        }
      >
        Para repartir, la herramienta necesita la plata que queda libre en el presupuesto. Se carga en el paso 1: con el
        reporte de la Contaduría, o con una estimación rápida por tipo de gasto. Mientras tanto podés ver cómo funciona
        con un ejemplo de montos inventados.
      </Vacio>
    );

  const sinCosto = candidatas.filter((p) => !(p.costo_unitario && p.costo_unitario > 0));
  if (candidatas.length === sinCosto.length)
    return (
      <Vacio
        icono={Scale}
        titulo="Falta el costo de las políticas"
        accion={
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => irA("politicas")}
              className="rounded-lg bg-rosa px-3 py-1.5 text-xs font-bold text-white"
            >
              Ir al paso 2 · Políticas y costos
            </button>
            {botonEjemplo}
          </div>
        }
      >
        Para convertir pesos en obras o cupos, la herramienta necesita saber cuánto cuesta cada unidad (una cuadra, una
        conexión, un cupo). Hay {candidatas.length} políticas esperando su costo en el paso 2.
      </Vacio>
    );

  const seleccion = barrio ? barrioPorId.get(barrio) : null;
  const asignacionesBarrio = barrio ? r.asignaciones.filter((a) => a.destino === barrio) : [];
  const criterioActual = CRITERIOS.find((c) => c.intensidad === intensidad && c.equidad === equidad)?.clave ?? null;
  const enJuego = candidatas.filter((p) => !excluidasManual.has(p.id)).length;

  return (
    <div className="space-y-3">
      {/* ¿Cómo querés repartir? */}
      <div className="panel-vidrio rounded-2xl p-4">
        <h3 className="text-sm font-extrabold">¿Cómo querés repartir?</h3>
        <p className="mt-0.5 text-[11px] text-texto-2">
          Elegí un criterio: la herramienta reparte sola la plata disponible entre las políticas y los barrios, y el
          mapa se actualiza al instante.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {CRITERIOS.map((c) => {
            const activo = criterioActual === c.clave;
            return (
              <button
                key={c.clave}
                onClick={() => {
                  setIntensidad(c.intensidad);
                  setEquidad(c.equidad);
                }}
                className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${
                  activo ? "border-rosa bg-rosa/10" : "border-borde-2 hover:border-rosa/50"
                }`}
              >
                <span className={`block text-xs font-extrabold ${activo ? "text-rosa" : ""}`}>{c.titulo}</span>
                <span className="mt-0.5 block text-[10.5px] leading-snug text-texto-2">{c.texto}</span>
              </button>
            );
          })}
        </div>

        <details className="mt-3 border-t border-borde pt-2.5">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-texto-2 hover:text-rosa">
            <SlidersHorizontal size={12} /> Ajuste fino
            {criterioActual ? "" : " (personalizado)"}
          </summary>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="flex items-center justify-between text-[10px] font-bold tracking-wide text-texto-3 uppercase">
                Cuánto pesa la necesidad concentrada
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
                A la izquierda, cada hogar con necesidad vale lo mismo esté donde esté. A la derecha, pesan más los
                barrios donde la necesidad supera el promedio de la ciudad.
              </span>
            </label>
            <label className="block">
              <span className="flex items-center justify-between text-[10px] font-bold tracking-wide text-texto-3 uppercase">
                Cuánto repartir entre barrios
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
                A la izquierda, se cubre primero y por completo la necesidad que más rinde. A la derecha, la plata se
                reparte y llega a más barrios.
              </span>
            </label>
          </div>
        </details>

        <details className="mt-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-texto-2 hover:text-rosa">
            <Info size={12} /> Qué políticas entran ({enJuego} de {candidatas.length})
          </summary>
          <p className="mt-1.5 text-[10.5px] text-texto-3">Tocá una para sacarla del reparto o volver a ponerla.</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
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
                  title={`${p.nombre}${sinDato ? " · falta el costo: no entra hasta cargarlo" : ""}`}
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
        </details>
      </div>

      {inicial && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed border-celeste/50 bg-celeste/10 px-4 py-2.5 text-[11px] text-celeste">
          <span className="min-w-0 flex-1">
            Partís de la propuesta <b>«{inicial.nombre}»</b>: el criterio, las políticas, los montos decididos y los
            ajustes a mano ya están cargados. Cambiá lo que quieras y guardalo como una propuesta nueva; la original no
            se toca.
          </span>
          {onSoltarPlantilla && (
            <button onClick={onSoltarPlantilla} className="shrink-0 font-bold underline">
              Empezar de cero
            </button>
          )}
        </div>
      )}

      <MontosPorPolitica
        politicas={candidatas.filter((p) => entradas.politicas.some((e) => e.id === String(p.id)))}
        montoActual={new Map(r.porPolitica.map((p) => [p.politica, p.monto]))}
        texto={textoLimites}
        onTexto={setTextoLimites}
        limites={limites}
        invalidas={invalidas}
      />

      {/* Resultado, primero en una frase */}
      <div
        className={`panel-vidrio rounded-2xl border-2 border-rosa/30 px-4 py-3 transition ${recalculando ? "opacity-70" : ""}`}
      >
        <div className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">Así queda el reparto</div>
        <p className="mt-1 text-[13px] leading-relaxed">
          De <b className="num">{pesos(libreTotal, true)}</b> disponibles se reparten{" "}
          <b className="num text-rosa">{pesos(r.asignado, true)}</b> entre{" "}
          <b className="num">{numero(porBarrio.size)}</b> barrios, a través de{" "}
          <b className="num">{numero(politicasConPlata.length)}</b>{" "}
          {politicasConPlata.length === 1 ? "política" : "políticas"}.
          {topBarrios.length > 0 && (
            <>
              {" "}
              Los que más reciben:{" "}
              {topBarrios.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && (i === topBarrios.length - 1 ? " y " : ", ")}
                  <button
                    onClick={() => setBarrio(b.id)}
                    className="font-bold underline decoration-rosa/40 underline-offset-2 hover:text-rosa"
                  >
                    «{b.id}»
                  </button>
                </span>
              ))}
              .
            </>
          )}
        </p>
        {datos.escenarios.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-borde pt-2 text-[11px]">
            <span className="text-texto-3">Comparar con</span>
            <select
              value={compararId ?? ""}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                setCompararId(v);
                setVista(v == null ? "total" : "diferencia");
              }}
              className="max-w-72 rounded-md border border-borde-2 bg-panel px-1.5 py-1 text-[11px] outline-none"
            >
              <option value="">ninguna propuesta</option>
              {datos.escenarios.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre} · {e.estado}
                </option>
              ))}
            </select>
            {compararId != null && !diferencias && <span className="text-texto-3">cargando…</span>}
            {diferencias && (
              <span>
                Frente a esa propuesta:{" "}
                <b className="num">{conSigno(r.asignado - [...comparada!.values()].reduce((s, x) => s + x, 0))}</b> en
                total, <b className="num text-rosa">{diferencias.filter((d) => d.dif >= 1).length}</b> barrios reciben
                más y <b className="num text-celeste">{diferencias.filter((d) => d.dif <= -1).length}</b> menos.
              </span>
            )}
          </div>
        )}
        {r.sinAsignar > libreTotal * 0.05 && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-encurso">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <span>
              Quedan <b className="num">{pesos(r.sinAsignar, true)}</b> sin repartir: esa plata está en partidas que
              ninguna política activa puede usar, o ya se cubrió toda la necesidad posible. Podés sumar políticas o
              cargar el costo de las que faltan en el paso 2.
            </span>
          </p>
        )}
      </div>

      {(r.avisos.length > 0 || entradas.excluidas.length > 0) && (
        <details className="panel-vidrio rounded-2xl border-encurso/40 px-4 py-2.5 text-[11px]">
          <summary className="flex cursor-pointer items-center gap-1.5 font-bold text-encurso">
            <TriangleAlert size={12} />
            {entradas.excluidas.length > 0 &&
              `${entradas.excluidas.length} políticas no entran al reparto (ver por qué)`}
            {entradas.excluidas.length > 0 && r.avisos.length > 0 && " · "}
            {r.avisos.length > 0 && `${r.avisos.length} avisos`}
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
                  ...(diferencias ? [["diferencia", "Diferencia"]] : []),
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
            <span className="text-right text-[10px] text-texto-3">
              {vista === "diferencia"
                ? "Rosa: recibe más que en la guardada. Celeste: menos."
                : "Cuanto más rosa, más recibe. Tocá un barrio para ver el detalle."}
            </span>
          </div>
          <MapaBarrios
            valores={valoresMapa}
            divergente={vista === "diferencia"}
            formatear={(v) => (vista === "diferencia" ? conSigno(v) : pesos(v, vista === "total"))}
            etiqueta={vista === "total" ? "Asignado" : vista === "hogar" ? "Asignado por hogar" : "Ahora − guardada"}
            seleccionado={barrio}
            onSeleccionar={setBarrio}
          />
        </div>

        <div ref={detalleRef} className="panel-vidrio min-w-0 scroll-mt-20 rounded-2xl p-4">
          {!seleccion ? (
            <Vacio icono={Info} titulo="Tocá un barrio en el mapa" variante="filtro">
              Vas a ver qué recibe de cada política y cuánto de su necesidad cubre. Si querés darle más o menos a algo,
              lo podés cambiar a mano desde ahí.
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
                  : setFijos((f) => ({
                      ...f,
                      [`${pol}|${seleccion.id}`]: monto,
                    }))
              }
              onCerrar={() => setBarrio(null)}
            />
          )}
          {seleccion && (
            <QuienInterviene
              barrio={seleccion}
              ejemplo={ejemplo}
              barrios={datos.barrios}
              politicas={datos.politicas}
              asignaciones={asignacionesBarrio.map((x) => ({
                codigo: polPorId.get(x.politica)?.codigo ?? "",
                monto: x.monto,
              }))}
            />
          )}
        </div>
      </div>

      {/* Por política */}
      <details className="panel-vidrio group rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-extrabold hover:text-rosa">
          Detalle por política{" "}
          <span className="text-[11px] font-normal text-texto-3">· cuánto recibe cada una y de qué partida sale</span>
        </summary>
        <div className="mt-2 overflow-auto">
          <table className="w-full min-w-[760px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
              <tr>
                <th className="py-1 pr-2 font-semibold">Política</th>
                <th className="num py-1 pr-2 text-right font-semibold">Asignado</th>
                <th className="num py-1 pr-2 text-right font-semibold">Qué se logra</th>
                <th className="py-1 pr-2 font-semibold">Necesidad cubierta</th>
                <th className="py-1 pr-2 font-semibold">Por qué no recibe más</th>
                <th className="py-1 font-semibold">Sale de</th>
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
                        {numero(p.unidades)}{" "}
                        <span className="text-texto-3">{plural(pol?.unidad ?? "", Math.round(p.unidades))}</span>
                        <div className="text-[9.5px] text-texto-3">de {numero(p.necesidad)} que hacen falta</div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-3">
                            <div
                              className="h-full rounded-full bg-rosa"
                              style={{ width: `${Math.min(100, 100 * cob)}%` }}
                            />
                          </div>
                          <span className="num text-texto-2">{pct(100 * cob)}</span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 text-texto-2">
                        {p.saturada === "fondos"
                          ? "no hay partidas que la puedan pagar"
                          : p.saturada === "tope"
                            ? "llegó al tope que se le puso"
                            : p.saturada === "necesidad"
                              ? "ya cubre toda la necesidad"
                              : p.monto > 0
                                ? "otras resuelven más necesidad por peso"
                                : "otras resuelven más necesidad por peso"}
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
      </details>

      {/* Por barrio */}
      <details className="panel-vidrio rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-extrabold hover:text-rosa">
          Detalle por barrio{" "}
          <span className="text-[11px] font-normal text-texto-3">· la lista completa, para buscar o descargar</span>
        </summary>
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
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
            <Download size={12} /> Descargar planilla
          </button>
        </div>
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
              <tr>
                <th className="py-1 pr-2 font-semibold">Barrio</th>
                <th className="num py-1 pr-2 text-right font-semibold">Asignado</th>
                <th className="num py-1 pr-2 text-right font-semibold">Por hogar</th>
                <th className="num py-1 pr-2 text-right font-semibold">Hogares</th>
                <th
                  className="num py-1 pr-2 text-right font-semibold"
                  title="Hogares con necesidades básicas insatisfechas"
                >
                  Hogares con NBI
                </th>
                <th className="num py-1 text-right font-semibold">Políticas que recibe</th>
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
                  <td className="num py-1 pr-2 text-right text-texto-2">{pct(f.pctNbi)}</td>
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
      </details>

      {/* Guardar */}
      <div ref={guardarRef} className="panel-vidrio scroll-mt-4 rounded-2xl p-4">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-texto-2 uppercase">
          <Save size={12} className="text-rosa" /> ¿Te sirve este reparto? Guardalo como propuesta
        </h3>
        {ejemplo ? (
          <p className="mt-1 text-[11px] font-semibold text-encurso">
            En el ejemplo no se guarda nada. Cuando tengas la plata disponible y los costos reales (pasos 1 y 2), salí
            del ejemplo y guardá acá la propuesta.
            {onEjemplo && (
              <button onClick={onEjemplo} className="ml-1.5 font-bold underline">
                Salir del ejemplo
              </button>
            )}
          </p>
        ) : (
          <p className="mt-1 text-[10.5px] text-texto-3">
            Guardar no gasta ni reserva nada: queda como borrador para comparar. En el paso 4 se manda a aprobar, y la
            aprueba otra persona con el número de la norma. Recién ahí la plata queda reservada.
          </p>
        )}
        {!ejemplo && (
          <>
            <div className="mt-2 grid gap-2 md:grid-cols-[240px_1fr]">
              <input
                ref={nombreRef}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre (ej. Plan barrios sur, 2º semestre)"
                className="rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
              />
              <textarea
                value={criterio}
                onChange={(e) => setCriterio(e.target.value)}
                rows={2}
                placeholder="¿Por qué este reparto? Ej.: se priorizó cloacas y agua en los barrios con más NBI del sur. Queda como fundamento de la norma."
                className="resize-y rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void guardar()}
                disabled={guardando || r.asignado <= 0 || ejemplo}
                title={
                  ejemplo ? "En el ejemplo no se guarda nada: salí del ejemplo para trabajar con datos reales" : ""
                }
                className="flex items-center gap-1.5 rounded-lg bg-rosa px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <Save size={13} /> {guardando ? "Guardando…" : "Guardar propuesta"}
              </button>
              <span className={`text-[10px] ${criterio.trim().length >= 20 ? "text-completo" : "text-texto-3"}`}>
                {criterio.trim().length >= 20
                  ? "✓ fundamento"
                  : `el porqué: faltan ${20 - criterio.trim().length} letras`}
              </span>
              {mensaje && (
                <span className={`text-[11px] font-bold ${mensaje.ok ? "text-completo" : "text-peligro"}`}>
                  {mensaje.texto}
                </span>
              )}
              {fijosHuerfanos.length > 0 && (
                <span className="flex items-center gap-1.5 text-[10.5px] text-encurso">
                  {fijosHuerfanos.length} monto
                  {fijosHuerfanos.length === 1 ? "" : "s"} fijado
                  {fijosHuerfanos.length === 1 ? "" : "s"} de políticas que ya no están en juego (no se guarda
                  {fijosHuerfanos.length === 1 ? "" : "n"})
                  <button onClick={() => soltar(fijosHuerfanos)} className="font-bold underline">
                    soltar
                  </button>
                </span>
              )}
              {mensaje?.ok && (
                <button
                  onClick={() => irA("escenarios")}
                  className="text-[11px] font-semibold text-rosa hover:underline"
                >
                  ir al paso 4 →
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <MetodoNota />

      {/* Siempre a mano: cuánto se reparte y guardar, sin subir y bajar */}
      <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-rosa/40 bg-panel/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="min-w-0 flex-1 text-[11.5px]">
          <b className="num text-rosa">{pesos(r.asignado, true)}</b> en <b className="num">{numero(porBarrio.size)}</b>{" "}
          barrios · {numero(politicasConPlata.length)} políticas
          {diferencias && (
            <span className="text-texto-3">
              {" "}
              · frente a la guardada {conSigno(r.asignado - [...comparada!.values()].reduce((s, x) => s + x, 0))}
            </span>
          )}
          {recalculando && <span className="text-texto-3"> · recalculando…</span>}
        </span>
        {ejemplo ? (
          <span className="text-[11px] font-bold text-encurso">Ejemplo: no se guarda</span>
        ) : (
          <button
            onClick={() => {
              guardarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              setTimeout(() => nombreRef.current?.focus(), 400);
            }}
            disabled={r.asignado <= 0}
            className="flex items-center gap-1.5 rounded-lg bg-rosa px-3 py-1.5 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Save size={12} /> Guardar propuesta
          </button>
        )}
      </div>
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
    .map((c) => ({
      id: c.politica,
      necesidad: c.unidades,
      a: porPol.get(c.politica),
      pol: politicas.get(c.politica),
    }))
    .filter((f) => f.pol)
    .sort((x, y) => (y.a?.monto ?? 0) - (x.a?.monto ?? 0));
  const ajustados = filas.filter((f) => fijos[`${f.id}|${nombre}`] != null).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-extrabold">{nombre}</h3>
          <p className="text-[10px] text-texto-3">
            {Math.round(poblacion).toLocaleString("es-AR")} hab. · {Math.round(hogares).toLocaleString("es-AR")} hogares
            · NBI {pct(hogares > 0 ? (100 * (indicadores.nbi ?? 0)) / hogares : 0)} · sin cloaca{" "}
            {pct(hogares > 0 ? (100 * (indicadores.sin_cloaca ?? 0)) / hogares : 0)}
          </p>
        </div>
        <button onClick={onCerrar} className="shrink-0 text-texto-3 hover:text-texto" aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
      <div className="num mt-2 text-xl font-extrabold text-rosa">{pesos(total, true)}</div>
      <p className="text-[10px] text-texto-3">
        {hogares > 0 ? `${pesos(total / hogares)} por hogar · ` : ""}
        {ajustados > 0
          ? `${ajustados} ajustado${ajustados === 1 ? "" : "s"} a mano`
          : "tocá el candado para darle un monto a mano; el resto se reacomoda solo"}
      </p>

      {filas.length === 0 && (
        <p className="mt-3 text-[11px] text-texto-3">
          Ninguna política en juego tiene necesidad medida en este barrio.
        </p>
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
            <div
              key={id}
              className={`rounded-lg border px-2 py-1.5 ${fijado ? "border-rosa/40 bg-rosa/5" : "border-borde"}`}
            >
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
                  {Math.round(a.unidades).toLocaleString("es-AR")} {plural(pol!.unidad, Math.round(a.unidades))} · cubre
                  el {pct(100 * a.cobertura)} de {info ? info.etiqueta.toLowerCase() : "la necesidad"}
                </div>
              )}
              {fijado && (
                <div className="mt-1 space-y-1">
                  <div className="text-[9.5px] text-texto-2">
                    Fijado en {pesos(fijos[clave])}
                    {estado && Math.abs(estado.efectivo - fijos[clave]) >= 1 && (
                      <span className="text-encurso">
                        {" "}
                        · se asignan {pesos(estado.efectivo)} ({estado.motivo})
                      </span>
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
    <details className="panel-vidrio rounded-2xl p-4">
      <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-extrabold hover:text-rosa">
        <Info size={14} className="text-rosa" /> ¿Cómo decide a dónde va la plata?
      </summary>
      <p className="mt-1.5 text-[12px] leading-relaxed">
        Mira cuánta necesidad tiene cada barrio según el Censo 2022 (hogares sin cloaca, sin agua, con NBI…) y cuánto
        cuesta cubrirla con cada política. Pone cada peso donde más necesidad resuelve, respetando qué partidas pueden
        pagar qué cosa. El criterio que elegís arriba decide si concentrar o repartir.
      </p>
      <div className="mt-2 space-y-1.5 border-t border-borde pt-2 text-[11px] leading-relaxed text-texto-2">
        <div className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">El detalle técnico</div>
        <p>
          Cada política convierte pesos en <b>unidades de necesidad cubiertas</b> —hogares conectados, cupos, personas
          atendidas— según su costo por unidad, y la necesidad de cada barrio la da el Censo 2022. El valor se mide en{" "}
          <b>pesos de necesidad cubierta</b>: prioridad de la política × intensidad de la necesidad en el barrio × costo
          de cubrirla. Así una política no se come el presupuesto solo porque sus unidades sean más baratas.
        </p>
        <p>
          Cada partida paga solo lo que su sección, su partida principal y su afectación permiten, y personal (PP 11),
          intereses (21), inversión financiera (61) y amortización (71) nunca entran. Con eso, el motor reparte el
          crédito libre para cubrir la mayor necesidad posible: es el <b>óptimo</b> del problema (salvo, a lo sumo, un
          incremento por barrio y política, que es lo que permite recalcular la ciudad entera en milisegundos), y cuando
          una partida se agota reasigna qué partida paga qué antes de dejar a una política sin fondos.
        </p>
        <p>
          <b>Límites.</b> La necesidad por barrio se reparte desde los radios censales en proporción a la superficie;
          los barrios más chicos que un radio pueden no aparecer, y los cuatro nombres repetidos del mapa (Vial, San
          José, San Martín, San Miguel) salen sumados. El censo es de 2022.
        </p>
      </div>
    </details>
  );
}

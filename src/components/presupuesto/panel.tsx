"use client";

import {
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  FlaskConical,
  History,
  Landmark,
  ListChecks,
  Scale,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listarEscenarios,
  obtenerEjercicio,
  obtenerNecesidadBarrios,
  obtenerPartidas,
  obtenerPoliticas,
  obtenerVedas,
  type Ejercicio,
  type Escenario,
  type PartidaEstado,
  type PoliticaCatalogo,
  type Veda,
} from "@/lib/presupuesto-datos";
import { INDICADORES, libreAsignable, type BarrioNecesidad } from "@/lib/presupuesto";
import { PARTIDAS_EJEMPLO, politicasEjemplo, propuestasEjemplo } from "@/lib/presupuesto-ejemplo";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { Asignar, type PlantillaReparto } from "./asignar";
import { Ejecucion } from "./ejecucion";
import { Escenarios } from "./escenarios";
import { Partidas } from "./partidas";
import { Politicas } from "./politicas";

type Seccion = "disponible" | "politicas" | "asignar" | "escenarios" | "ejecucion";

/** Los cinco pasos, en el orden en que se usan. */
const PASOS: Array<{
  clave: Seccion;
  n: number;
  etiqueta: string;
  icono: typeof Scale;
  queHacer: string;
}> = [
  {
    clave: "disponible",
    n: 1,
    etiqueta: "Plata disponible",
    icono: FileSpreadsheet,
    queHacer: "Cargá cuánta plata queda libre para gastar",
  },
  {
    clave: "politicas",
    n: 2,
    etiqueta: "Políticas y costos",
    icono: ListChecks,
    queHacer: "Poné cuánto cuesta cada política por unidad",
  },
  {
    clave: "asignar",
    n: 3,
    etiqueta: "Repartir",
    icono: Scale,
    queHacer: "Elegí un criterio y mirá cómo se reparte por barrio",
  },
  {
    clave: "escenarios",
    n: 4,
    etiqueta: "Guardar y aprobar",
    icono: History,
    queHacer: "Guardá la propuesta y que la apruebe otra persona",
  },
  {
    clave: "ejecucion",
    n: 5,
    etiqueta: "Ejecución",
    icono: ClipboardCheck,
    queHacer: "Cargá qué se hizo en cada barrio y mirá el avance",
  },
];

export interface DatosPresupuesto {
  ejercicio: Ejercicio | null;
  partidas: PartidaEstado[];
  politicas: PoliticaCatalogo[];
  barrios: BarrioNecesidad[];
  escenarios: Escenario[];
  vedas: Veda[];
}

/** Días calendario entre hoy (fecha local) y una fecha 'AAAA-MM-DD', sin horas de por medio. */
function diasHasta(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const hoy = new Date();
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
}

const fechaCorta = (f: string) => {
  const [a, m, d] = f.split("-");
  return `${d}/${m}/${a}`;
};

/**
 * Presupuesto — asignación del crédito disponible a políticas públicas por
 * barrio. Separado a propósito de todo lo electoral de la aplicación: no lee
 * resultados, padrón ni la configuración de la campaña; el criterio es la
 * necesidad que mide el censo y cada decisión queda registrada.
 */
export function Presupuesto({ esSuperadmin }: { esSuperadmin: boolean }) {
  const [supabase] = useState(crearClienteNavegador);
  const [datos, setDatos] = useState<DatosPresupuesto | null>(null);
  const [seccion, setSeccion] = useState<Seccion>("disponible");
  // Modo ejemplo: montos y costos inventados, solo en el navegador. Nada se guarda.
  const [ejemplo, setEjemplo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primeraCarga = useRef(true);
  // «Duplicar y ajustar»: Repartir arranca desde una propuesta guardada
  const [plantilla, setPlantilla] = useState<PlantillaReparto | null>(null);
  // Qué propuesta se mira en el paso 5
  const [enEjecucion, setEnEjecucion] = useState<number | null>(null);
  // Quién está usando la herramienta: para avisar antes si no puede aprobar lo que armó
  const [miId, setMiId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMiId(data.user?.id ?? null));
  }, [supabase]);

  const recargar = useCallback(async () => {
    try {
      const [ejercicio, partidas, politicas, barrios, escenarios, vedas] = await Promise.all([
        obtenerEjercicio(supabase),
        obtenerPartidas(supabase),
        obtenerPoliticas(supabase),
        obtenerNecesidadBarrios(supabase),
        listarEscenarios(supabase),
        obtenerVedas(supabase),
      ]);
      setDatos({ ejercicio, partidas, politicas, barrios, escenarios, vedas });
      setError(null);
      // Sin partidas no hay nada que asignar: se arranca por cargarlas. Solo
      // la primera vez; después cada guardado no tiene que mover de pestaña.
      // Se arranca por el primer paso que falta. Solo la primera vez: después
      // cada guardado no tiene que mover de pestaña.
      if (primeraCarga.current) {
        primeraCarga.current = false;
        const hayPlata = libreAsignable(partidas) > 0;
        const hayCostos = politicas.some(
          (p) => p.activa && p.tipo !== "institucional" && p.costo_unitario && INDICADORES[p.indicador],
        );
        setSeccion(!hayPlata ? "disponible" : !hayCostos ? "politicas" : "asignar");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude cargar el presupuesto");
    }
  }, [supabase]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  // La veda vigente o la próxima dentro de los 60 días.
  const veda = useMemo(() => {
    for (const v of datos?.vedas ?? []) {
      const alInicio = diasHasta(v.desde);
      const alFin = diasHasta(v.hasta);
      if (alInicio <= 0 && alFin >= 0) return { v, dentro: true, dias: alFin };
      if (alInicio > 0 && alInicio <= 60) return { v, dentro: false, dias: alInicio };
    }
    return null;
  }, [datos?.vedas]);

  const delEjemplo = useMemo(
    () => (ejemplo && datos ? propuestasEjemplo(datos.politicas, datos.barrios) : null),
    [ejemplo, datos],
  );

  // Sin datos, el error es toda la pantalla. Con datos, un aviso arriba: una
  // recarga que falla no puede tirar lo que se estaba armando en Asignar.
  if (error && !datos)
    return (
      <div className="mx-auto max-w-6xl p-4">
        <p className="rounded-xl border border-peligro/40 bg-peligro/10 p-3 text-xs text-peligro">
          {/function|relation|schema cache/i.test(error)
            ? `${error}. Falta aplicar la migración 0016_presupuesto.sql en Supabase.`
            : error}
        </p>
      </div>
    );

  const propuestos = datos ? datos.escenarios.filter((e) => e.estado === "propuesto").length : 0;

  // Lo que ve cada pestaña: en modo ejemplo, la plata, los costos y las propuestas son inventados,
  // y se leen de un cliente en memoria: nada toca la base.
  const vista: DatosPresupuesto | null =
    datos && ejemplo && delEjemplo
      ? {
          ...datos,
          partidas: PARTIDAS_EJEMPLO,
          politicas: politicasEjemplo(datos.politicas),
          escenarios: delEjemplo.escenarios,
        }
      : datos;
  const cliente = ejemplo && delEjemplo ? delEjemplo.cliente : supabase;

  const estado: Record<Seccion, boolean> | null = datos
    ? {
        disponible: libreAsignable(datos.partidas) > 0,
        politicas: datos.politicas.some(
          (p) => p.activa && p.tipo !== "institucional" && !!p.costo_unitario && !!INDICADORES[p.indicador],
        ),
        asignar: datos.escenarios.length > 0,
        escenarios: datos.escenarios.some((e) => e.estado === "aprobado" || e.estado === "ejecutado"),
        ejecucion: datos.escenarios.some((e) => e.estado === "ejecutado"),
      }
    : null;

  const alternarEjemplo = () => {
    if (!ejemplo) setSeccion("asignar");
    setPlantilla(null);
    setEnEjecucion(null);
    setEjemplo((e) => !e);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      <div className="panel-vidrio rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="flex items-center gap-2 text-sm font-extrabold">
            <Landmark size={15} className="text-rosa" /> Presupuesto {datos?.ejercicio?.ejercicio ?? 2026}
          </h1>
          <span className="order-last w-full text-[11px] text-texto-2 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
            Repartir la plata que queda libre del presupuesto entre las políticas del Plan Rector, según la necesidad de
            cada barrio.
          </span>
          <button
            onClick={alternarEjemplo}
            className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition ${
              ejemplo ? "border-encurso bg-encurso/15 text-encurso" : "border-rosa/40 text-rosa hover:bg-rosa/10"
            }`}
          >
            {ejemplo ? <X size={13} /> : <FlaskConical size={13} />}
            {ejemplo ? "Salir del ejemplo" : "Probar con un ejemplo"}
          </button>
        </div>
        <details className="mt-1.5 text-[10.5px] leading-snug text-texto-3">
          <summary className="flex cursor-pointer items-center gap-1.5 hover:text-texto-2">
            <ShieldCheck size={12} className="shrink-0 text-completo" /> Reglas de la herramienta
          </summary>
          <p className="mt-1 pl-5">
            El criterio es la necesidad que mide el Censo 2022: esta herramienta <b>no usa datos electorales</b> ni la
            configuración de la campaña. Las políticas dirigidas a personas se planifican como <b>cupos por barrio</b>:
            quién recibe cada cupo lo resuelve el área que ejecuta el programa. Aprobar exige el número de norma y una
            persona distinta de la que armó la propuesta. Cada cambio queda en la bitácora.
          </p>
        </details>
      </div>

      {ejemplo && (
        <div className="flex items-start gap-2 rounded-2xl border-2 border-dashed border-encurso/60 bg-encurso/10 px-4 py-2.5 text-[11px] leading-snug text-encurso">
          <FlaskConical size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>Estás en un EJEMPLO.</b> La plata disponible (5 partidas, $5.300 M), los costos y dos propuestas —una
            aprobada y con obras en marcha— son inventados; la necesidad de cada barrio es la real del censo. Recorré
            los cinco pasos: repartí, compará propuestas, abrí el informe y cargá avances. <b>No se guarda nada.</b>
          </span>
        </div>
      )}

      {error && datos && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-peligro/40 bg-peligro/10 px-4 py-2 text-[11px] text-peligro">
          <span className="min-w-0 flex-1">No pude actualizar los datos: {error}</span>
          <button onClick={() => void recargar()} className="rounded-lg border border-peligro/50 px-2.5 py-1 font-bold">
            Reintentar
          </button>
        </div>
      )}

      {veda && (
        <div
          className={`flex items-start gap-2 rounded-2xl border px-4 py-2.5 text-[11px] leading-snug ${
            veda.dentro ? "border-sin/50 bg-sin/10 text-sin" : "border-encurso/50 bg-encurso/10 text-encurso"
          }`}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            {veda.dentro ? (
              <>
                <b>
                  Veda del {fechaCorta(veda.v.desde)} al {fechaCorta(veda.v.hasta)} ({veda.v.norma}).
                </b>{" "}
                No se inauguran obras, no se lanzan programas ni se hace ningún acto de gobierno que pueda captar votos.
                La herramienta no aprueba cupos ni programas nuevos hasta el {fechaCorta(veda.v.hasta)}; los programas
                en curso siguen.
              </>
            ) : (
              <>
                Faltan {veda.dias} días para la veda del {fechaCorta(veda.v.desde)} al {fechaCorta(veda.v.hasta)} (
                {veda.v.norma}): en ese período no se inauguran obras ni se lanzan programas, y la herramienta no
                aprueba cupos ni programas nuevos. Conviene que lo que se planifique ahora no tenga su inicio en esas
                fechas.
              </>
            )}
          </span>
        </div>
      )}

      {/* Los pasos: cada uno dice qué se hace ahí y si ya está hecho */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PASOS.map((p) => {
          const activo = seccion === p.clave;
          const hecho = !ejemplo && (estado?.[p.clave] ?? false);
          return (
            <button
              key={p.clave}
              onClick={() => setSeccion(p.clave)}
              className={`panel-vidrio flex min-w-0 items-start gap-2.5 rounded-2xl border-2 px-3 py-2.5 text-left transition ${
                activo ? "border-rosa" : "border-transparent hover:border-borde-2"
              }`}
            >
              <span
                className={`num flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  hecho ? "bg-completo text-white" : activo ? "bg-rosa text-white" : "bg-panel-3 text-texto-2"
                }`}
              >
                {hecho ? <Check size={13} /> : p.n}
              </span>
              <span className="min-w-0">
                <span className={`flex items-center gap-1.5 text-xs font-extrabold ${activo ? "text-rosa" : ""}`}>
                  <span className="leading-tight sm:truncate">{p.etiqueta}</span>
                  {p.clave === "escenarios" && propuestos > 0 && (
                    <span
                      className="num shrink-0 rounded-full bg-encurso/20 px-1.5 text-[10px] text-encurso"
                      title="Propuestas esperando aprobación"
                    >
                      {propuestos}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 hidden text-[10px] leading-snug text-texto-3 sm:block">{p.queHacer}</span>
              </span>
            </button>
          );
        })}
      </div>

      {!datos && <p className="px-1 text-xs text-texto-2">Cargando partidas, políticas y el censo por barrio…</p>}
      {datos && vista && (
        <>
          {/* Repartir queda montado aunque se cambie de pestaña: si no, se pierde lo armado.
              Con key por modo: entrar o salir del ejemplo arranca de cero. */}
          <div hidden={seccion !== "asignar"}>
            <Asignar
              key={`${ejemplo ? "ejemplo" : "real"}-${plantilla?.origen ?? "nueva"}`}
              supabase={cliente}
              datos={vista}
              ejemplo={ejemplo}
              inicial={plantilla}
              onGuardado={async () => {
                setPlantilla(null);
                await recargar();
              }}
              irA={(s) => setSeccion(s)}
              onEjemplo={alternarEjemplo}
              onSoltarPlantilla={() => setPlantilla(null)}
            />
          </div>
          {/* En el ejemplo, las otras pestañas muestran los datos inventados y no se editan */}
          {seccion === "disponible" && (
            <Partidas supabase={supabase} datos={vista} esSuperadmin={esSuperadmin && !ejemplo} onCambio={recargar} />
          )}
          {seccion === "politicas" && (
            <Politicas supabase={supabase} datos={vista} esSuperadmin={esSuperadmin && !ejemplo} onCambio={recargar} />
          )}
          {seccion === "escenarios" && (
            <Escenarios
              supabase={cliente}
              datos={vista}
              esSuperadmin={esSuperadmin}
              onCambio={recargar}
              ejemplo={ejemplo}
              miId={miId}
              onDuplicar={(p) => {
                setPlantilla(p);
                setSeccion("asignar");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onVerEjecucion={(id) => {
                setEnEjecucion(id);
                setSeccion("ejecucion");
              }}
            />
          )}
          {seccion === "ejecucion" && (
            <Ejecucion
              supabase={cliente}
              datos={vista}
              elegida={enEjecucion}
              onElegir={setEnEjecucion}
              onEjemplo={alternarEjemplo}
              ejemplo={ejemplo}
            />
          )}
        </>
      )}
    </div>
  );
}

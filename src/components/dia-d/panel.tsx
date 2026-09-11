"use client";

import { AlertTriangle, Activity, ClipboardCheck, Lock, Phone, Settings, TrendingUp, Unlock, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  contacto,
  guardarConfig,
  obtenerConfig,
  obtenerFiscales,
  obtenerIncidencias,
  obtenerMesas,
  type ConfigDiaD,
  type Mesa,
} from "@/lib/diad";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import type { Persona } from "@/lib/tipos";
import { Escrutinio } from "./escrutinio";
import { Fiscales } from "./fiscales";
import { Incidencias, Participacion } from "./jornada";

const numero = (n: number) => n.toLocaleString("es-AR");

type Seccion = "fiscales" | "participacion" | "incidencias" | "escrutinio" | "config";

const SECCIONES: Array<{ clave: Seccion; etiqueta: string; corta: string; icono: typeof Users; detalle: string }> = [
  { clave: "fiscales", etiqueta: "Fiscales", corta: "Fiscales", icono: Users, detalle: "Quién está en cada mesa y contacto en un clic" },
  { clave: "participacion", etiqueta: "Participación", corta: "Particip.", icono: TrendingUp, detalle: "Cuánta gente votó a cada corte horario y dónde traccionar" },
  { clave: "incidencias", etiqueta: "Incidencias", corta: "Incid.", icono: AlertTriangle, detalle: "Problemas de la jornada y su resolución" },
  { clave: "escrutinio", etiqueta: "Escrutinio", corta: "Escrut.", icono: ClipboardCheck, detalle: "Carga de telegramas y proyección de bancas" },
  { clave: "config", etiqueta: "Configuración", corta: "Config.", icono: Settings, detalle: "Los parámetros de la jornada (los carga el administrador)" },
];

/**
 * DÍA D — el comando de la jornada electoral. Cuatro mesas de trabajo
 * (fiscales, participación, incidencias y escrutinio) más la configuración,
 * que es donde el administrador define todo lo de la elección concreta.
 */
export function DiaD({ esSuperadmin }: { esSuperadmin: boolean }) {
  const [supabase] = useState(crearClienteNavegador);
  const [config, setConfig] = useState<ConfigDiaD | null>(null);
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [seccion, setSeccion] = useState<Seccion>("fiscales");
  const [resumen, setResumen] = useState({ conFiscal: 0, ausentes: 0, incidencias: 0 });
  const [error, setError] = useState<string | null>(null);

  const cargarResumen = useCallback(async () => {
    try {
      const [fs, inc] = await Promise.all([obtenerFiscales(supabase), obtenerIncidencias(supabase)]);
      setResumen({
        conFiscal: fs.length,
        ausentes: fs.filter((f) => f.estado === "ausente").length,
        incidencias: inc.filter((i) => i.estado === "abierta").length,
      });
    } catch {
      // el resumen es informativo: si falla, las pestañas siguen andando
    }
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      try {
        const [c, ms, { data: ps }] = await Promise.all([
          obtenerConfig(supabase),
          obtenerMesas(supabase),
          supabase.from("personas").select("id, nombre, documento, direccion, telefono, email, notas").order("nombre"),
        ]);
        setConfig(c);
        setMesas(ms);
        setPersonas((ps as Persona[]) ?? []);
        // sin listas cargadas no hay nada que hacer salvo configurar
        if (c && (c.listas ?? []).length === 0) setSeccion("config");
      } catch (e) {
        setError(e instanceof Error ? e.message : "no pude cargar el DÍA D");
      }
      void cargarResumen();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const abrirCerrar = async (activa: boolean) => {
    const e = await guardarConfig(supabase, { activa });
    if (e) setError(e);
    else setConfig((c) => (c ? { ...c, activa } : c));
  };

  if (error) return <p className="p-4 text-xs text-peligro">{error}</p>;
  if (!config || !mesas) return <p className="p-4 text-xs text-texto-2">Cargando el DÍA D…</p>;

  const tel = contacto(config.telefono_comando);

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-3 sm:p-4">
      {/* Cabecera de la jornada */}
      <div className="panel-vidrio flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl px-4 py-3 text-xs">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">
          <Activity size={15} className={config.activa ? "animate-pulse text-rosa" : "text-texto-3"} />
          {config.eleccion}
        </span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
            config.activa ? "border-completo/50 bg-completo/10 text-completo" : "border-borde-2 text-texto-3"
          }`}
        >
          {config.activa ? "jornada abierta" : "jornada cerrada"}
        </span>
        {config.fecha && (
          <span className="text-texto-2">
            {new Date(`${config.fecha}T12:00:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
            {" · "}
            {config.hora_apertura}–{config.hora_cierre}
          </span>
        )}
        <span className="text-texto-3">
          <b className="num text-texto-2">{numero(resumen.conFiscal)}</b>/{numero(mesas.length)} mesas con fiscal
        </span>
        {resumen.ausentes > 0 && (
          <span className="font-bold text-sin">
            <b className="num">{resumen.ausentes}</b> fiscales ausentes
          </span>
        )}
        {resumen.incidencias > 0 && (
          <span className="font-bold text-encurso">
            <b className="num">{resumen.incidencias}</b> incidencias abiertas
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {tel.tel && (
            <a
              href={tel.tel}
              title={`Llamar al comando · ${tel.crudo}`}
              className="flex items-center gap-1.5 rounded-lg border border-rosa/40 px-2.5 py-1 font-bold text-rosa transition hover:border-rosa"
            >
              <Phone size={12} /> Comando
            </a>
          )}
          {esSuperadmin && (
            <button
              onClick={() => void abrirCerrar(!config.activa)}
              title={config.activa ? "Cerrar la jornada (deja de refrescarse solo; los datos quedan)" : "Abrir la jornada"}
              className="flex items-center gap-1.5 rounded-lg border border-borde-2 px-2.5 py-1 font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
            >
              {config.activa ? <Lock size={12} /> : <Unlock size={12} />}
              {config.activa ? "Cerrar" : "Abrir"}
            </button>
          )}
        </div>
      </div>

      {/* Secciones */}
      <div className="panel-vidrio flex flex-wrap overflow-hidden rounded-2xl">
        {SECCIONES.map((s) => (
          <button
            key={s.clave}
            onClick={() => setSeccion(s.clave)}
            title={s.detalle}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-3 text-xs font-bold transition sm:gap-2 sm:px-3 ${
              seccion === s.clave ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:bg-panel-2/60 hover:text-texto"
            }`}
          >
            <s.icono size={14} className="shrink-0" />
            {/* etiqueta corta en pantallas chicas: la larga se truncaba */}
            <span className="sm:hidden">{s.corta}</span>
            <span className="hidden truncate sm:inline">{s.etiqueta}</span>
            {s.clave === "incidencias" && resumen.incidencias > 0 && (
              <span className="num shrink-0 rounded-full bg-sin/20 px-1.5 text-[10px] text-sin">{resumen.incidencias}</span>
            )}
          </button>
        ))}
      </div>

      {seccion === "fiscales" && (
        <Fiscales supabase={supabase} config={config} personas={personas} onCambio={cargarResumen} />
      )}
      {seccion === "participacion" && <Participacion supabase={supabase} config={config} mesas={mesas} />}
      {seccion === "incidencias" && <Incidencias supabase={supabase} mesas={mesas} />}
      {seccion === "escrutinio" && (
        <Escrutinio supabase={supabase} config={config} mesas={mesas} esSuperadmin={esSuperadmin} />
      )}
      {seccion === "config" && (
        <Configuracion
          config={config}
          totalMesas={mesas.length}
          onGuardado={(c) => setConfig(c)}
          guardar={(cambios) => guardarConfig(supabase, cambios)}
        />
      )}
    </div>
  );
}

/** Todos los parámetros de la jornada. Los define el administrador. */
function Configuracion({
  config,
  totalMesas,
  onGuardado,
  guardar,
}: {
  config: ConfigDiaD;
  totalMesas: number;
  onGuardado: (c: ConfigDiaD) => void;
  guardar: (cambios: Partial<ConfigDiaD>) => Promise<string | null>;
}) {
  const [f, setF] = useState<ConfigDiaD>(config);
  const [listasTexto, setListasTexto] = useState((config.listas ?? []).join("\n"));
  const [cortesTexto, setCortesTexto] = useState((config.cortes ?? []).join(", "));
  const [ocupado, setOcupado] = useState(false);
  const [msj, setMsj] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ConfigDiaD>(k: K, v: ConfigDiaD[K]) => setF((x) => ({ ...x, [k]: v }));

  const listas = useMemo(() => listasTexto.split("\n").map((l) => l.trim()).filter(Boolean), [listasTexto]);
  const cortes = useMemo(
    () => cortesTexto.split(/[,\s]+/).map((c) => c.trim()).filter((c) => /^\d{1,2}:\d{2}$/.test(c)),
    [cortesTexto],
  );

  const aplicar = async () => {
    if (ocupado) return;
    if (listas.length === 0) {
      setError("Cargá al menos una lista");
      return;
    }
    setOcupado(true);
    setError(null);
    const cambios: Partial<ConfigDiaD> = { ...f, listas, cortes };
    const e = await guardar(cambios);
    if (e) setError(e);
    else {
      const nuevo = { ...f, listas, cortes };
      onGuardado(nuevo);
      setF(nuevo);
      setMsj("Guardado ✓");
      window.setTimeout(() => setMsj(null), 3000);
    }
    setOcupado(false);
  };

  const campo = "w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50";
  const etiqueta = "mb-1 block text-[10px] font-bold tracking-wide text-texto-3 uppercase";

  return (
    <div className="panel-vidrio space-y-4 rounded-2xl p-4">
      <div>
        <h3 className="text-sm font-extrabold">Parámetros de la jornada</h3>
        <p className="mt-0.5 text-[11px] text-texto-2">
          Todo lo que cambia de una elección a otra se define acá. El resto de las pestañas trabaja con estos valores.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={etiqueta}>Nombre de la elección</label>
          <input value={f.eleccion} onChange={(e) => set("eleccion", e.target.value)} placeholder="Concejales 2027" className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Fecha</label>
          <input type="date" value={f.fecha ?? ""} onChange={(e) => set("fecha", e.target.value || null)} className={campo} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={etiqueta}>Apertura</label>
            <input value={f.hora_apertura} onChange={(e) => set("hora_apertura", e.target.value)} placeholder="08:00" className={campo} />
          </div>
          <div className="flex-1">
            <label className={etiqueta}>Cierre</label>
            <input value={f.hora_cierre} onChange={(e) => set("hora_cierre", e.target.value)} placeholder="18:00" className={campo} />
          </div>
        </div>
        <div>
          <label className={etiqueta}>Categoría</label>
          <select value={f.categoria} onChange={(e) => set("categoria", e.target.value)} className={campo}>
            {["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR", "DIPUTADO NACIONAL"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={etiqueta}>Bancas en juego</label>
            <input
              type="number"
              value={f.bancas}
              onChange={(e) => set("bancas", Math.max(0, Number(e.target.value) || 0))}
              title="18 concejales o 19 legisladores por la Sección Capital"
              className={`num ${campo}`}
            />
          </div>
          <div className="flex-1">
            <label className={etiqueta}>Mesas esperadas</label>
            <input
              type="number"
              value={f.mesas_esperadas}
              onChange={(e) => set("mesas_esperadas", Math.max(1, Number(e.target.value) || 1))}
              className={`num ${campo}`}
            />
          </div>
        </div>
        <div>
          <label className={etiqueta}>Meta de votos propia</label>
          <input
            type="number"
            value={f.meta_votos}
            onChange={(e) => set("meta_votos", Math.max(0, Number(e.target.value) || 0))}
            placeholder="0 = sin meta"
            className={`num ${campo}`}
          />
        </div>
        <div>
          <label className={etiqueta}>Teléfono del comando</label>
          <input
            value={f.telefono_comando}
            onChange={(e) => set("telefono_comando", e.target.value)}
            placeholder="381 5123456"
            inputMode="tel"
            className={campo}
          />
        </div>
      </div>

      <div>
        <label className={etiqueta}>Cortes horarios de participación</label>
        <input value={cortesTexto} onChange={(e) => setCortesTexto(e.target.value)} placeholder="10:00, 12:00, 14:00, 16:00, 18:00" className={campo} />
        <p className="mt-1 text-[10px] text-texto-3">
          {cortes.length > 0 ? `Se van a usar: ${cortes.join(" · ")}` : "Escribí las horas en formato HH:MM separadas por coma"}
        </p>
      </div>

      <div>
        <label className={etiqueta}>Listas que compiten (una por línea, como van a figurar en el telegrama)</label>
        <textarea
          value={listasTexto}
          onChange={(e) => setListasTexto(e.target.value)}
          rows={7}
          placeholder={"JxR\nFrente Tucumán Primero\nLa Libertad Avanza"}
          className={`resize-y ${campo}`}
        />
        <p className="mt-1 text-[10px] text-texto-3">
          {listas.length} lista{listas.length === 1 ? "" : "s"}. El orden es el que se ve en la carga del telegrama:
          conviene ponerlas como están en el acta para cargar más rápido.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-borde pt-3">
        <button
          onClick={() => void aplicar()}
          disabled={ocupado}
          className="rounded-xl bg-rosa px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {ocupado ? "Guardando…" : "Guardar configuración"}
        </button>
        {msj && <span className="text-[11px] font-bold text-completo">{msj}</span>}
        {error && <span className="text-[11px] text-peligro">{error}</span>}
        <span className="ml-auto text-[10px] text-texto-3">
          El padrón provincial tiene {numero(totalMesas)} mesas cargadas.
        </span>
      </div>
    </div>
  );
}

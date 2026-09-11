"use client";

import { DoorOpen, Info, Plus, Save, Target, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  borrarContacto,
  borrarMuestra,
  guardarMuestra,
  listarMuestras,
  obtenerContactos,
  obtenerResumenContactos,
  registrarContacto,
  TEMAS_CONTACTO,
  type Contacto,
  type MuestraGuardada,
  type ResumenContactos,
} from "@/lib/analisis-politico";
import { disenarMuestra, type DisenoMuestral } from "@/lib/muestra";
import { obtenerPadronPorCircuito } from "@/lib/padron";
import { CODIGOS } from "@/lib/espacios";
import { descargarCSV } from "@/lib/csv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Cifra, Cifras } from "@/components/ui/cifras";
import { Vacio } from "@/components/ui/vacio";

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * Contactos territoriales: el dato propio de la campaña.
 *
 * Se carga AGREGADO por territorio y jornada —una planilla de conteo, no un
 * fichero de votantes— porque eso da la señal de propensión sin guardar a quién
 * se golpeó la puerta, que es la línea que la aplicación no cruza.
 */
export function Contactos({ supabase }: { supabase: SupabaseClient }) {
  const [resumen, setResumen] = useState<ResumenContactos[] | null>(null);
  const [ultimos, setUltimos] = useState<Contacto[]>([]);
  const [nivel, setNivel] = useState<"circuito" | "escuela">("circuito");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // alta de una jornada
  const [circuito, setCircuito] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [fav, setFav] = useState("");
  const [ind, setInd] = useState("");
  const [con, setCon] = useState("");
  const [noat, setNoat] = useState("");
  const [tema, setTema] = useState<string>(TEMAS_CONTACTO[0]);
  const [notas, setNotas] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      const [r, u] = await Promise.all([obtenerResumenContactos(supabase, nivel), obtenerContactos(supabase, 40)]);
      setResumen(r);
      setUltimos(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "no pude cargar los contactos");
    }
  }, [supabase, nivel]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const totales = useMemo(() => {
    const r = resumen ?? [];
    const f = r.reduce((a, x) => a + Number(x.favorables), 0);
    const i = r.reduce((a, x) => a + Number(x.indecisos), 0);
    const c = r.reduce((a, x) => a + Number(x.contrarios), 0);
    const resp = f + i + c;
    return {
      contactados: r.reduce((a, x) => a + Number(x.contactados), 0),
      favorables: f,
      indecisos: i,
      contrarios: c,
      pctFav: resp > 0 ? (100 * f) / resp : null,
      territorios: r.length,
    };
  }, [resumen]);

  const registrar = async () => {
    if (ocupado) return;
    if (!circuito) {
      setError("Elegí el circuito");
      return;
    }
    const n = (v: string) => Math.max(0, Number(v) || 0);
    const favN = n(fav), indN = n(ind), conN = n(con), noatN = n(noat);
    if (favN + indN + conN + noatN === 0) {
      setError("Cargá al menos un contacto");
      return;
    }
    setOcupado(true);
    setError(null);
    const e = await registrarContacto(supabase, {
      fecha,
      nivel: "circuito",
      codigo: circuito,
      circuito,
      escuela: "",
      contactados: favN + indN + conN + noatN,
      favorables: favN,
      indecisos: indN,
      contrarios: conN,
      no_atendieron: noatN,
      tema,
      persona_id: null,
      notas,
    });
    if (e) setError(e);
    else {
      setAviso(`Circuito ${circuito}: ${favN + indN + conN + noatN} contactos cargados`);
      window.setTimeout(() => setAviso(null), 4000);
      setFav(""); setInd(""); setCon(""); setNoat(""); setNotas("");
      await recargar();
    }
    setOcupado(false);
  };

  const campo = "num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-right text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50";

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <DoorOpen size={15} className="text-rosa" /> Contactos en el territorio
        </h2>
        <p className="mt-1 text-[11px] text-texto-2">
          El dato que genera la campaña, no el que viene de la Junta. Cada jornada de timbreo se carga como conteo
          por circuito: cuántas puertas y cómo respondieron.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borde pt-3">
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Fecha
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="mt-0.5 block rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs font-normal outline-none" />
          </label>
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Circuito
            <select value={circuito} onChange={(e) => setCircuito(e.target.value)}
              className="mt-0.5 block rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs font-normal outline-none">
              <option value="">— elegir —</option>
              {CODIGOS.circuito.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold tracking-wide text-completo uppercase">
            Favorables
            <input value={fav} onChange={(e) => setFav(e.target.value)} placeholder="0" inputMode="numeric" className={`mt-0.5 block ${campo}`} />
          </label>
          <label className="text-[10px] font-bold tracking-wide text-encurso uppercase">
            Indecisos
            <input value={ind} onChange={(e) => setInd(e.target.value)} placeholder="0" inputMode="numeric" className={`mt-0.5 block ${campo}`} />
          </label>
          <label className="text-[10px] font-bold tracking-wide text-sin uppercase">
            Contrarios
            <input value={con} onChange={(e) => setCon(e.target.value)} placeholder="0" inputMode="numeric" className={`mt-0.5 block ${campo}`} />
          </label>
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            No atendió
            <input value={noat} onChange={(e) => setNoat(e.target.value)} placeholder="0" inputMode="numeric" className={`mt-0.5 block ${campo}`} />
          </label>
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Tema que más salió
            <select value={tema} onChange={(e) => setTema(e.target.value)}
              className="mt-0.5 block rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs font-normal outline-none">
              {TEMAS_CONTACTO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas de la jornada (zona, quién fue, qué pasó…)"
          className="mt-2 w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => void registrar()} disabled={ocupado}
            className="flex items-center gap-1.5 rounded-xl bg-rosa px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40">
            <Plus size={13} /> Cargar jornada
          </button>
          {aviso && <span className="text-[11px] font-bold text-completo">{aviso} ✓</span>}
          {error && <span className="text-[11px] text-peligro">{error}</span>}
        </div>
      </div>

      {totales.contactados > 0 && (
        <Cifras>
          <Cifra valor={numero(totales.contactados)} etiqueta="puertas contactadas" tono="marca" />
          {totales.pctFav != null && (
            <Cifra
              valor={totales.pctFav.toFixed(1)}
              unidad="%"
              etiqueta="favorable"
              tono="ok"
              titulo="Sobre quienes respondieron, no sobre el total de puertas"
            />
          )}
          <Cifra valor={numero(totales.favorables)} etiqueta="favorables" tono="ok" />
          <Cifra valor={numero(totales.indecisos)} etiqueta="indecisos" tono="aviso" />
          <Cifra valor={numero(totales.contrarios)} etiqueta="contrarios" tono="alerta" />
          <Cifra
            valor={numero(totales.territorios)}
            etiqueta={totales.territorios === 1 ? "territorio trabajado" : "territorios trabajados"}
          />
        </Cifras>
      )}

      {resumen && resumen.length > 0 && (
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Propensión medida</h3>
            <div className="flex overflow-hidden rounded-lg border border-borde-2 text-[10px] font-bold">
              {(["circuito", "escuela"] as const).map((n) => (
                <button key={n} onClick={() => setNivel(n)}
                  className={`px-2 py-1 transition ${nivel === n ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 overflow-auto">
            <table className="w-full min-w-[560px] text-[11px]">
              <thead className="text-left text-texto-3">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Territorio</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Contactos</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Favorable</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Contrario</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Atendieron</th>
                  <th className="py-1 pr-2 font-semibold">Tema</th>
                  <th className="py-1 font-semibold">Último</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((f) => {
                  const n = Number(f.favorables) + Number(f.indecisos) + Number(f.contrarios);
                  return (
                    <tr key={f.espacio} className="border-t border-borde/60">
                      <td className="py-1 pr-2 font-semibold">{f.espacio}</td>
                      <td className="num py-1 pr-2 text-right">{numero(Number(f.contactados))}</td>
                      <td className={`num py-1 pr-2 text-right font-bold ${n < 30 ? "text-texto-3" : "text-completo"}`}>
                        {f.pct_favorable != null ? `${f.pct_favorable}%` : "—"}
                        {n < 30 && n > 0 && <span className="ml-1 text-[9px] font-normal">(n={n})</span>}
                      </td>
                      <td className="num py-1 pr-2 text-right text-sin">{f.pct_contrario != null ? `${f.pct_contrario}%` : "—"}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">{f.efectividad != null ? `${f.efectividad}%` : "—"}</td>
                      <td className="py-1 pr-2 text-texto-2">{f.tema_top ?? "—"}</td>
                      <td className="py-1 text-[10px] text-texto-3">{f.ultima_fecha ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[9px] text-texto-3">
            El porcentaje favorable se calcula sobre quienes respondieron, no sobre las puertas golpeadas. Con menos
            de 30 respuestas el número se muestra en gris: no alcanza para concluir nada de ese territorio.
          </p>
        </div>
      )}

      {ultimos.length > 0 && (
        <div className="panel-vidrio rounded-2xl p-4">
          <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Últimas jornadas</h3>
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {ultimos.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2/60 px-2 py-1.5 text-[11px]">
                <span className="text-texto-3">{c.fecha}</span>
                <span className="font-bold">Circ. {c.codigo}</span>
                <span className="num text-texto-2">{numero(c.contactados)} contactos</span>
                <span className="text-completo">{c.favorables} fav</span>
                <span className="text-encurso">{c.indecisos} ind</span>
                <span className="text-sin">{c.contrarios} con</span>
                {c.tema && <span className="text-texto-3">· {c.tema}</span>}
                <button onClick={async () => { await borrarContacto(supabase, c.id); await recargar(); }}
                  title="Borrar esta jornada" className="ml-auto text-texto-3 transition hover:text-peligro">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel-vidrio rounded-2xl border-encurso/40 p-4">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-encurso uppercase">
          <Info size={12} /> Por qué se carga agregado
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-texto-2">
          Un registro con nombre y respuesta de cada vecino sería un fichero de opinión política, que es dato
          sensible bajo la Ley 25.326 y necesita consentimiento expreso. El conteo por territorio da la misma señal
          para decidir dónde trabajar, sin construir ese fichero.
        </p>
      </div>
    </div>
  );
}

/**
 * Diseño muestral: cuántas entrevistas hacer en cada circuito para que la
 * encuesta represente a la ciudad, y con qué peso ponderar después.
 */
export function Muestra({ supabase }: { supabase: SupabaseClient }) {
  const [padron, setPadron] = useState<Array<{ circuito: string; electores: number }> | null>(null);
  const [modo, setModo] = useState<"n" | "margen">("margen");
  const [n, setN] = useState(600);
  const [margenObjetivo, setMargenObjetivo] = useState(4);
  const [confianza, setConfianza] = useState(95);
  const [minimo, setMinimo] = useState(10);
  const [guardadas, setGuardadas] = useState<MuestraGuardada[]>([]);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setGuardadas(await listarMuestras(supabase).catch(() => []));
  }, [supabase]);

  useEffect(() => {
    void obtenerPadronPorCircuito(supabase, { sexo: null, edadMin: null, edadMax: null })
      .then((filas) =>
        setPadron(
          filas
            .filter((f) => f.circuito)
            .map((f) => ({ circuito: f.circuito as string, electores: Number(f.total) })),
        ),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "no pude cargar el padrón"));
    void recargar();
  }, [supabase, recargar]);

  const diseno: DisenoMuestral | null = useMemo(() => {
    if (!padron || padron.length === 0) return null;
    try {
      return disenarMuestra(padron, {
        n: modo === "n" ? n : undefined,
        margenObjetivo: modo === "margen" ? margenObjetivo : undefined,
        confianza,
        minimoPorEstrato: minimo,
      });
    } catch {
      return null;
    }
  }, [padron, modo, n, margenObjetivo, confianza, minimo]);

  const guardar = async () => {
    if (!diseno || !nombre.trim()) {
      setError("Ponele un nombre al diseño");
      return;
    }
    setError(null);
    const e = await guardarMuestra(supabase, {
      nombre: nombre.trim(),
      n_objetivo: diseno.n,
      confianza: diseno.confianza,
      margen: diseno.margen,
      estratos: diseno.estratos.map((s) => ({
        circuito: s.circuito, electores: s.electores, entrevistas: s.entrevistas, peso: s.peso,
      })),
      notas: "",
    });
    if (e) setError(e);
    else {
      setAviso("Diseño guardado ✓");
      window.setTimeout(() => setAviso(null), 3000);
      setNombre("");
      await recargar();
    }
  };

  const exportar = () => {
    if (!diseno) return;
    descargarCSV(
      `muestra-${diseno.n}-entrevistas.csv`,
      ["circuito", "electores", "entrevistas", "pct_padron", "peso"],
      diseno.estratos.map((e) => [
        e.circuito,
        e.electores,
        e.entrevistas,
        (100 * e.proporcionPoblacion).toFixed(2),
        e.peso,
      ]),
    );
  };

  const campo = "rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-xs outline-none focus:border-rosa/50";

  return (
    <div className="space-y-3">
      <div className="panel-vidrio rounded-2xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold">
          <Target size={15} className="text-rosa" /> Diseño muestral
        </h2>
        <p className="mt-1 text-[11px] text-texto-2">
          Tener el padrón cargado permite usar la aplicación como marco muestral: dice cuántas entrevistas hacer en
          cada circuito para que la encuesta represente a la ciudad, en lugar de encuestar donde es cómodo.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borde pt-3">
          <div className="flex overflow-hidden rounded-lg border border-borde-2 text-[11px] font-bold">
            {([["margen", "Por margen"], ["n", "Por cantidad"]] as const).map(([m, et]) => (
              <button key={m} onClick={() => setModo(m)}
                className={`px-2.5 py-2 transition ${modo === m ? "bg-rosa/20 text-rosa" : "text-texto-3 hover:text-texto"}`}>
                {et}
              </button>
            ))}
          </div>
          {modo === "margen" ? (
            <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
              Margen buscado (± puntos)
              <input type="number" step="0.5" min="1" max="10" value={margenObjetivo}
                onChange={(e) => setMargenObjetivo(Math.max(1, Number(e.target.value) || 4))}
                className={`num mt-0.5 block w-24 ${campo}`} />
            </label>
          ) : (
            <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
              Entrevistas
              <input type="number" min="50" step="50" value={n}
                onChange={(e) => setN(Math.max(50, Number(e.target.value) || 600))}
                className={`num mt-0.5 block w-24 ${campo}`} />
            </label>
          )}
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Confianza
            <select value={confianza} onChange={(e) => setConfianza(Number(e.target.value))} className={`mt-0.5 block ${campo}`}>
              {[90, 95, 99].map((c) => <option key={c} value={c}>{c}%</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold tracking-wide text-texto-3 uppercase">
            Mínimo por circuito
            <input type="number" min="0" max="60" value={minimo}
              onChange={(e) => setMinimo(Math.max(0, Number(e.target.value) || 0))}
              title="Para que ningún circuito quede sin representación"
              className={`num mt-0.5 block w-24 ${campo}`} />
          </label>
        </div>
      </div>

      {error && <p className="px-1 text-xs text-peligro">{error}</p>}
      {!padron && !error && <p className="px-1 text-xs text-texto-2">Cargando el padrón por circuito…</p>}

      {diseno && (
        <>
          <Cifras
            acciones={
              <>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del diseño"
                  className="w-40 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50" />
                <button onClick={() => void guardar()} title="Guardar este diseño"
                  className="rounded-lg bg-rosa p-2 text-white transition hover:brightness-110">
                  <Save size={12} />
                </button>
                <button onClick={exportar} className="rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa">
                  CSV
                </button>
              </>
            }
          >
            <Cifra valor={numero(diseno.n)} etiqueta="entrevistas" tono="marca" />
            <Cifra valor={`±${diseno.margen}`} etiqueta={`puntos al ${diseno.confianza}%`} />
            <Cifra valor={numero(diseno.poblacion)} etiqueta="electores representados" />
            <Cifra valor={numero(diseno.estratos.length)} etiqueta="circuitos" />
          </Cifras>
          {aviso && <p className="px-1 text-[11px] font-bold text-completo">{aviso}</p>}

          {diseno.avisos.length > 0 && (
            <div className="panel-vidrio rounded-2xl border-encurso/40 p-3">
              {diseno.avisos.map((a) => (
                <p key={a} className="text-[11px] text-encurso">· {a}</p>
              ))}
            </div>
          )}

          <div className="panel-vidrio rounded-2xl p-4">
            <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Cuántas entrevistas por circuito</h3>
            <div className="mt-2 overflow-auto">
              <table className="w-full min-w-[480px] text-[11px]">
                <thead className="text-left text-texto-3">
                  <tr>
                    <th className="py-1 pr-2 font-semibold">Circuito</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Entrevistas</th>
                    <th className="num py-1 pr-2 text-right font-semibold">Electores</th>
                    <th className="num py-1 pr-2 text-right font-semibold">% del padrón</th>
                    <th className="num py-1 text-right font-semibold">Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {diseno.estratos.map((s) => (
                    <tr key={s.circuito} className="border-t border-borde/60">
                      <td className="py-1 pr-2 font-semibold">{s.circuito}</td>
                      <td className="num py-1 pr-2 text-right font-bold text-rosa">{s.entrevistas}</td>
                      <td className="num py-1 pr-2 text-right text-texto-2">{numero(s.electores)}</td>
                      <td className="num py-1 pr-2 text-right text-texto-3">{(100 * s.proporcionPoblacion).toFixed(2)}%</td>
                      <td className={`num py-1 text-right ${s.peso > 1.15 || s.peso < 0.85 ? "font-bold text-encurso" : "text-texto-2"}`}>
                        {s.peso}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[9px] text-texto-3">
              El <b>peso</b> es cuánto vale cada respuesta al sumar los resultados: los circuitos que quedaron
              sobre-representados por el mínimo pesan menos de 1, y los sub-representados más. Aplicarlo es lo que
              devuelve la proporción real de la ciudad. El margen usa p=0,5, que es el peor caso.
            </p>
          </div>

          {guardadas.length > 0 && (
            <div className="panel-vidrio rounded-2xl p-4">
              <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Diseños guardados</h3>
              <div className="mt-2 space-y-1">
                {guardadas.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2/60 px-2 py-1.5 text-[11px]">
                    <span className="font-bold">{m.nombre}</span>
                    <span className="num text-texto-2">{numero(m.n_objetivo)} entrevistas</span>
                    {m.margen != null && <span className="num text-texto-3">±{m.margen} al {m.confianza}%</span>}
                    <span className="text-[9px] text-texto-3">{new Date(m.creado_en).toLocaleDateString("es-AR")}</span>
                    <button onClick={async () => { await borrarMuestra(supabase, m.id); await recargar(); }}
                      className="ml-auto text-texto-3 transition hover:text-peligro">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

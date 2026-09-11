"use client";

import { Activity, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { repartirDHondt } from "@/lib/dhondt";
import type { ConfigDiaD, Mesa } from "@/lib/diad";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Cifra, Cifras } from "@/components/ui/cifras";

const numero = (n: number) => n.toLocaleString("es-AR");

interface Carga {
  id: number;
  mesa: number;
  circuito: string;
  electores: number | null;
  votos: Record<string, number>;
  blancos: number;
  nulos: number;
  total: number;
  cargado_en: string;
}

/**
 * Escrutinio propio: los fiscales cargan el telegrama de su mesa y el tablero
 * proyecta totales y bancas por D'Hondt, mesa a mesa, horas antes de los datos
 * oficiales. La configuración de la elección la define el administrador en la
 * pestaña Configuración.
 */
export function Escrutinio({
  supabase,
  config,
  mesas,
  esSuperadmin,
  onCambio,
}: {
  supabase: SupabaseClient;
  config: ConfigDiaD;
  mesas: Mesa[];
  esSuperadmin: boolean;
  onCambio?: () => void;
}) {
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  const [mesa, setMesa] = useState("");
  const [votosMesa, setVotosMesa] = useState<Record<string, string>>({});
  const [blancos, setBlancos] = useState("");
  const [nulos, setNulos] = useState("");
  const [guardadoOk, setGuardadoOk] = useState<number | null>(null);

  const listas = useMemo(() => (config.listas ?? []).filter(Boolean), [config.listas]);
  const porMesa = useMemo(() => new Map(mesas.map((m) => [m.mesa, m])), [mesas]);

  const recargar = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("diad_cargas")
      .select("id, mesa, circuito, electores, votos, blancos, nulos, total, cargado_en")
      .order("cargado_en", { ascending: false })
      .range(0, 1999);
    if (e) setError(e.message);
    setCargas((data as Carga[]) ?? []);
    setActualizado(new Date());
    onCambio?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  // En vivo: mientras la jornada está abierta el tablero se refresca solo
  const abiertaRef = useRef(false);
  abiertaRef.current = config.activa;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (abiertaRef.current) void recargar();
    }, 15000);
    return () => window.clearInterval(id);
  }, [recargar]);

  const totales = useMemo(() => {
    const porLista = new Map<string, number>(listas.map((l) => [l, 0]));
    let blancosTot = 0, nulosTot = 0, votantes = 0;
    const porCircuito = new Map<string, { mesas: number; votos: Map<string, number> }>();
    for (const c of cargas) {
      for (const l of listas) porLista.set(l, (porLista.get(l) ?? 0) + Number(c.votos?.[l] ?? 0));
      blancosTot += c.blancos;
      nulosTot += c.nulos;
      votantes += c.total;
      const r = porCircuito.get(c.circuito) ?? { mesas: 0, votos: new Map<string, number>() };
      r.mesas++;
      for (const l of listas) r.votos.set(l, (r.votos.get(l) ?? 0) + Number(c.votos?.[l] ?? 0));
      porCircuito.set(c.circuito, r);
    }
    const positivos = [...porLista.values()].reduce((a, v) => a + v, 0);
    return { porLista, blancosTot, nulosTot, votantes, positivos, porCircuito };
  }, [cargas, listas]);

  const reparto = useMemo(() => {
    if (totales.positivos === 0) return null;
    return repartirDHondt(
      listas.map((l, i) => ({ id: i, nombre: l, votos: totales.porLista.get(l) ?? 0 })),
      { bancas: config.bancas },
    );
  }, [config.bancas, listas, totales]);

  const cargarMesa = async () => {
    const n = Number(mesa);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Poné el número de mesa");
      return;
    }
    // la mesa trae su circuito y su padrón del padrón provincial: no se pide a mano
    const m = porMesa.get(n);
    if (!m) {
      setError(`La mesa ${n} no está en el padrón provincial`);
      return;
    }
    setOcupado(true);
    setError(null);
    const votos: Record<string, number> = {};
    for (const l of listas) votos[l] = Math.max(0, Number(votosMesa[l]) || 0);
    const b = Math.max(0, Number(blancos) || 0);
    const nu = Math.max(0, Number(nulos) || 0);
    const total = Object.values(votos).reduce((a, v) => a + v, 0) + b + nu;
    if (total > m.electores) {
      setError(`La mesa ${n} tiene ${m.electores} electores: no pueden haber ${total} votos`);
      setOcupado(false);
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { error: e } = await supabase.from("diad_cargas").upsert(
      {
        mesa: n,
        circuito: m.circuito ?? "",
        escuela: m.escuela ?? "",
        electores: m.electores,
        votos,
        blancos: b,
        nulos: nu,
        total,
        cargado_por: u.user?.id ?? null,
        cargado_en: new Date().toISOString(),
      },
      { onConflict: "mesa" },
    );
    if (e) setError(e.message);
    else {
      setGuardadoOk(n);
      window.setTimeout(() => setGuardadoOk(null), 4000);
      setMesa("");
      setVotosMesa({});
      setBlancos("");
      setNulos("");
      await recargar();
    }
    setOcupado(false);
  };

  const borrarCarga = async (id: number) => {
    await supabase.from("diad_cargas").delete().eq("id", id);
    await recargar();
  };

  const reiniciar = async () => {
    if (!window.confirm("¿Borrar TODAS las mesas escrutadas? Esto no se puede deshacer.")) return;
    setOcupado(true);
    const { error: e } = await supabase.from("diad_cargas").delete().gte("id", 0);
    if (e) setError(e.message);
    await recargar();
    setOcupado(false);
  };

  if (listas.length === 0) {
    return (
      <div className="panel-vidrio rounded-2xl p-4">
        <p className="text-xs text-texto-2">
          Todavía no hay listas cargadas. El administrador las define en <b>Configuración</b>, una por línea y
          escritas como van a figurar en el telegrama.
        </p>
      </div>
    );
  }

  // Un decimal debajo de 10%: con 3 de 1.087 mesas, redondear a entero mostraba
  // "0% escrutado" cuando ya había datos en pantalla.
  const avance = Math.min(100, (100 * cargas.length) / Math.max(1, config.mesas_esperadas));
  const pctEscrutado = avance > 0 && avance < 10 ? Number(avance.toFixed(1)) : Math.round(avance);
  const ranking = listas
    .map((l) => ({ nombre: l, votos: totales.porLista.get(l) ?? 0 }))
    .sort((a, b) => b.votos - a.votos);
  const bancasPorLista = new Map((reparto?.porLista ?? []).map((r) => [r.nombre, r.bancas]));
  const mesaElegida = porMesa.get(Number(mesa));

  return (
    <div className="space-y-3">
      <Cifras
        acciones={
          <span className="flex items-center gap-2 text-[10px] text-texto-3">
            {actualizado ? `actualizado ${actualizado.toLocaleTimeString("es-AR")}` : ""}
            <button onClick={() => void recargar()} title="Actualizar ahora" className="transition hover:text-texto">
              <RefreshCw size={12} />
            </button>
          </span>
        }
      >
        <Cifra
          valor={pctEscrutado}
          unidad="%"
          etiqueta="escrutado"
          tono="marca"
          nota={
            <span className="flex items-center gap-1">
              <Activity size={10} className={config.activa ? "animate-pulse text-rosa" : "text-texto-3"} />
            </span>
          }
        />
        <Cifra valor={numero(cargas.length)} de={numero(config.mesas_esperadas)} etiqueta="mesas cargadas" />
        <Cifra valor={numero(totales.votantes)} etiqueta="votantes" />
        <Cifra valor={numero(totales.blancosTot)} etiqueta="blancos" />
        <Cifra valor={numero(totales.nulosTot)} etiqueta="nulos" />
        {config.meta_votos > 0 && (
          <Cifra
            valor={numero(config.meta_votos)}
            etiqueta="meta propia"
            tono="aviso"
            titulo="Meta de votos propia fijada en Configuración"
          />
        )}
      </Cifras>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[380px_1fr]">
        {/* Carga del telegrama */}
        <div className="panel-vidrio h-fit min-w-0 rounded-2xl p-4">
          <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Cargar telegrama de mesa</h3>
          <input
            value={mesa}
            onChange={(e) => setMesa(e.target.value)}
            placeholder="Número de mesa"
            inputMode="numeric"
            className="num mt-2 w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-sm outline-none placeholder:text-texto-3 focus:border-rosa/50"
          />
          {mesaElegida ? (
            <p className="mt-1 text-[10px] text-texto-3">
              {mesaElegida.escuela} · Circuito {mesaElegida.circuito} · {numero(mesaElegida.electores)} electores
            </p>
          ) : (
            mesa.trim() !== "" && <p className="mt-1 text-[10px] text-sin">Esa mesa no está en el padrón</p>
          )}

          <div className="mt-2 space-y-1.5">
            {listas.map((l) => (
              <label key={l} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate" title={l}>{l}</span>
                <input
                  value={votosMesa[l] ?? ""}
                  onChange={(e) => setVotosMesa((v) => ({ ...v, [l]: e.target.value }))}
                  placeholder="0"
                  inputMode="numeric"
                  className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-right text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
                />
              </label>
            ))}
            <div className="flex gap-1.5 border-t border-borde pt-1.5">
              <label className="flex flex-1 items-center gap-2 text-xs">
                <span className="flex-1 text-texto-2">En blanco</span>
                <input
                  value={blancos}
                  onChange={(e) => setBlancos(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-right text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
                />
              </label>
              <label className="flex flex-1 items-center gap-2 text-xs">
                <span className="flex-1 text-texto-2">Nulos</span>
                <input
                  value={nulos}
                  onChange={(e) => setNulos(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void cargarMesa()}
                  placeholder="0"
                  inputMode="numeric"
                  className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-right text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
                />
              </label>
            </div>
          </div>
          <button
            onClick={() => void cargarMesa()}
            disabled={ocupado}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-rosa px-4 py-2.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            <Plus size={13} /> Cargar mesa
          </button>
          {guardadoOk != null && (
            <p className="mt-1.5 text-center text-[11px] font-bold text-completo">Mesa {guardadoOk} cargada ✓</p>
          )}
          {error && <p className="mt-1.5 text-[11px] text-peligro">{error}</p>}
          <p className="mt-1.5 text-[9px] text-texto-3">
            La escuela, el circuito y el padrón salen solos del número de mesa. Si la mesa ya estaba cargada se
            reemplaza, así se corrigen errores. El total se calcula y se controla contra el padrón.
          </p>
        </div>

        <div className="min-w-0 space-y-3">
          {/* Resultado + bancas */}
          <div className="panel-vidrio rounded-2xl p-4">
            <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
              Resultado en vivo · {config.categoria}
              {reparto && (
                <span className="font-normal normal-case text-texto-3"> · {config.bancas} bancas (D&rsquo;Hondt)</span>
              )}
            </h3>
            {ranking.every((r) => r.votos === 0) ? (
              <p className="mt-2 text-xs text-texto-2">
                Sin mesas cargadas todavía: el tablero se llena solo a medida que los fiscales cargan.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {ranking.map((r, i) => {
                  const max = Math.max(1, ranking[0]?.votos ?? 1);
                  const pct = totales.positivos > 0 ? (100 * r.votos) / totales.positivos : 0;
                  const b = bancasPorLista.get(r.nombre) ?? 0;
                  return (
                    <div key={r.nombre} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {i + 1}. {r.nombre}
                          {b > 0 && (
                            <span className="num ml-1.5 rounded-full bg-rosa/15 px-1.5 py-0.5 text-[10px] font-extrabold text-rosa">
                              {b} banca{b === 1 ? "" : "s"}
                            </span>
                          )}
                        </span>
                        <span className="num shrink-0 font-bold">
                          {numero(r.votos)} <span className="font-normal text-texto-3">({pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
                        <div className="h-full rounded-full bg-rosa/70" style={{ width: `${Math.max(1, (100 * r.votos) / max)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="pt-1 text-[9px] text-texto-3">
                  Proyección sobre las mesas cargadas ({pctEscrutado}% del total esperado): puede moverse hasta el
                  escrutinio completo.
                </p>
              </div>
            )}
          </div>

          {/* Por circuito */}
          {totales.porCircuito.size > 0 && (
            <div className="panel-vidrio rounded-2xl p-4">
              <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Por circuito</h3>
              <div className="mt-2 overflow-auto">
                <table className="w-full min-w-[420px] text-[11px]">
                  <thead className="text-left text-texto-3">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">Circuito</th>
                      <th className="num py-1 pr-2 text-right font-semibold">Mesas</th>
                      <th className="py-1 pr-2 font-semibold">Puntero</th>
                      <th className="num py-1 text-right font-semibold">Votos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...totales.porCircuito.entries()]
                      .sort((a, b) => b[1].mesas - a[1].mesas)
                      .map(([circ, r]) => {
                        const lider = [...r.votos.entries()].sort((a, b) => b[1] - a[1])[0];
                        return (
                          <tr key={circ} className="border-t border-borde/60">
                            <td className="py-1 pr-2 font-semibold">{circ}</td>
                            <td className="num py-1 pr-2 text-right">{r.mesas}</td>
                            <td className="max-w-0 truncate py-1 pr-2">{lider && lider[1] > 0 ? lider[0] : "—"}</td>
                            <td className="num py-1 text-right">{lider ? numero(lider[1]) : 0}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Últimas cargas */}
          {cargas.length > 0 && (
            <div className="panel-vidrio rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Últimas mesas cargadas</h3>
                {esSuperadmin && (
                  <button
                    onClick={() => void reiniciar()}
                    disabled={ocupado}
                    className="flex items-center gap-1 text-[10px] font-semibold text-peligro hover:underline disabled:opacity-40"
                  >
                    <Trash2 size={11} /> borrar las {cargas.length}
                  </button>
                )}
              </div>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {cargas.slice(0, 30).map((c) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg bg-panel-2/60 px-2 py-1.5 text-[11px]">
                    <span className="num font-bold">Mesa {c.mesa}</span>
                    <span className="text-texto-3">circ. {c.circuito}</span>
                    <span className="num ml-auto text-texto-2">{numero(c.total)} votos</span>
                    <span className="text-[9px] text-texto-3">
                      {new Date(c.cargado_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <button
                      onClick={() => void borrarCarga(c.id)}
                      title="Borrar esta carga"
                      className="text-texto-3 transition hover:text-peligro"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

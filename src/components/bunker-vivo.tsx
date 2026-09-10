"use client";

import { Activity, Lock, Plus, RefreshCw, Trash2, Unlock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { repartirDHondt } from "@/lib/dhondt";
import { CODIGOS } from "@/lib/espacios";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

const numero = (n: number) => n.toLocaleString("es-AR");

interface Config {
  eleccion: string;
  categoria: string;
  bancas: number;
  mesas_esperadas: number;
  listas: string[];
  activa: boolean;
}

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
 * Búnker: escrutinio propio en vivo la noche de la elección. Los fiscales
 * cargan el telegrama de su mesa desde el teléfono y el tablero se actualiza
 * solo: totales, proyección de bancas (D'Hondt) y avance por circuito.
 */
export function BunkerVivo({ esSuperadmin }: { esSuperadmin: boolean }) {
  const [supabase] = useState(crearClienteNavegador);
  const [config, setConfig] = useState<Config | null>(null);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  // Setup (solo visible con el búnker cerrado)
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("CONCEJAL");
  const [bancas, setBancas] = useState(18);
  const [mesasEsperadas, setMesasEsperadas] = useState(1350);
  const [listasTexto, setListasTexto] = useState("");

  // Carga de mesa
  const [mesa, setMesa] = useState("");
  const [circuito, setCircuito] = useState("");
  const [electores, setElectores] = useState("");
  const [votosMesa, setVotosMesa] = useState<Record<string, string>>({});
  const [blancos, setBlancos] = useState("");
  const [nulos, setNulos] = useState("");
  const [guardadoOk, setGuardadoOk] = useState<number | null>(null);

  const cargarTodo = useCallback(async () => {
    const [c, x] = await Promise.all([
      supabase.from("bunker_config").select("eleccion, categoria, bancas, mesas_esperadas, listas, activa").eq("id", 1).maybeSingle(),
      supabase
        .from("bunker_cargas")
        .select("id, mesa, circuito, electores, votos, blancos, nulos, total, cargado_en")
        .order("cargado_en", { ascending: false })
        .range(0, 1999),
    ]);
    if (c.data) {
      const cfg = c.data as Config;
      setConfig(cfg);
      setNombre((v) => v || cfg.eleccion);
      setCategoria((v) => (v === "CONCEJAL" ? cfg.categoria : v));
      setBancas((v) => (v === 18 ? cfg.bancas : v));
      setMesasEsperadas((v) => (v === 1350 ? cfg.mesas_esperadas : v));
      if (!listasTexto && Array.isArray(cfg.listas)) setListasTexto(cfg.listas.join("\n"));
    }
    setCargas((x.data as Carga[]) ?? []);
    setActualizado(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    void cargarTodo();
  }, [cargarTodo]);

  // En vivo: mientras el búnker está abierto, el tablero se refresca solo
  const activaRef = useRef(false);
  activaRef.current = config?.activa ?? false;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (activaRef.current) void cargarTodo();
    }, 15000);
    return () => window.clearInterval(id);
  }, [cargarTodo]);

  const listas = useMemo(() => (config?.listas ?? []).filter(Boolean), [config]);

  const totales = useMemo(() => {
    const porLista = new Map<string, number>(listas.map((l) => [l, 0]));
    let blancosTot = 0, nulosTot = 0, votantes = 0, electoresTot = 0;
    const porCircuito = new Map<string, { mesas: number; votos: Map<string, number> }>();
    for (const c of cargas) {
      for (const l of listas) porLista.set(l, (porLista.get(l) ?? 0) + Number(c.votos?.[l] ?? 0));
      blancosTot += c.blancos;
      nulosTot += c.nulos;
      votantes += c.total;
      electoresTot += c.electores ?? 0;
      const r = porCircuito.get(c.circuito) ?? { mesas: 0, votos: new Map<string, number>() };
      r.mesas++;
      for (const l of listas) r.votos.set(l, (r.votos.get(l) ?? 0) + Number(c.votos?.[l] ?? 0));
      porCircuito.set(c.circuito, r);
    }
    const positivos = [...porLista.values()].reduce((a, v) => a + v, 0);
    return { porLista, blancosTot, nulosTot, votantes, electoresTot, positivos, porCircuito };
  }, [cargas, listas]);

  const reparto = useMemo(() => {
    if (!config || totales.positivos === 0) return null;
    return repartirDHondt(
      listas.map((l, i) => ({ id: i, nombre: l, votos: totales.porLista.get(l) ?? 0 })),
      { bancas: config.bancas },
    );
  }, [config, listas, totales]);

  const guardarConfig = async (activa: boolean) => {
    setOcupado(true);
    setError(null);
    const { data: u } = await supabase.auth.getUser();
    const { error: e } = await supabase
      .from("bunker_config")
      .update({
        eleccion: nombre.trim() || "Elección",
        categoria,
        bancas,
        mesas_esperadas: mesasEsperadas,
        listas: listasTexto.split("\n").map((l) => l.trim()).filter(Boolean),
        activa,
        actualizado_por: u.user?.id ?? null,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", 1);
    if (e) setError(e.message);
    else await cargarTodo();
    setOcupado(false);
  };

  const reiniciar = async () => {
    if (!window.confirm("¿Borrar TODAS las mesas cargadas? Esto no se puede deshacer.")) return;
    setOcupado(true);
    const { error: e } = await supabase.from("bunker_cargas").delete().gte("id", 0);
    if (e) setError(e.message);
    await cargarTodo();
    setOcupado(false);
  };

  const cargarMesa = async () => {
    const nMesa = Number(mesa);
    if (!Number.isInteger(nMesa) || nMesa <= 0 || !circuito) {
      setError("Completá número de mesa y circuito");
      return;
    }
    setOcupado(true);
    setError(null);
    const votos: Record<string, number> = {};
    for (const l of listas) votos[l] = Math.max(0, Number(votosMesa[l]) || 0);
    const b = Math.max(0, Number(blancos) || 0);
    const n = Math.max(0, Number(nulos) || 0);
    const total = Object.values(votos).reduce((a, v) => a + v, 0) + b + n;
    const { data: u } = await supabase.auth.getUser();
    const { error: e } = await supabase.from("bunker_cargas").upsert(
      {
        mesa: nMesa,
        circuito,
        electores: electores ? Math.max(0, Number(electores) || 0) : null,
        votos,
        blancos: b,
        nulos: n,
        total,
        cargado_por: u.user?.id ?? null,
        cargado_en: new Date().toISOString(),
      },
      { onConflict: "mesa" },
    );
    if (e) setError(e.message);
    else {
      setGuardadoOk(nMesa);
      window.setTimeout(() => setGuardadoOk(null), 4000);
      setMesa("");
      setElectores("");
      setVotosMesa({});
      setBlancos("");
      setNulos("");
      await cargarTodo();
    }
    setOcupado(false);
  };

  const borrarCarga = async (id: number) => {
    await supabase.from("bunker_cargas").delete().eq("id", id);
    await cargarTodo();
  };

  if (!config) return <p className="p-4 text-xs text-texto-2">Cargando el búnker…</p>;

  // ── Búnker cerrado: configuración de la elección ──
  if (!config.activa) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-4">
        <div className="panel-vidrio rounded-2xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <Activity size={15} className="text-rosa" /> Búnker · escrutinio propio en vivo
          </h2>
          <p className="mt-1 text-[11px] text-texto-2">
            La noche de la elección, cada fiscal carga el telegrama de su mesa desde el teléfono y este tablero
            proyecta resultados y bancas en tiempo real, mesa a mesa — horas antes que los datos oficiales.
          </p>
          {cargas.length > 0 && (
            <p className="mt-2 rounded-lg border border-encurso/40 bg-encurso/10 px-2 py-1.5 text-[11px] text-encurso">
              Hay {cargas.length} mesas cargadas de una elección anterior: al abrir el búnker se retoman; usá
              «Reiniciar» para arrancar de cero.
            </p>
          )}
          <div className="mt-3 space-y-2">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre de la elección (ej: Concejales 2027)"
              className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none"
              >
                {["CONCEJAL", "LEGISLADOR", "INTENDENTE", "DIPUTADO NACIONAL"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-texto-2">
                Bancas
                <input
                  type="number"
                  value={bancas}
                  onChange={(e) => setBancas(Math.max(0, Number(e.target.value) || 0))}
                  className="num w-16 rounded-lg border border-borde-2 bg-panel px-2 py-2 text-xs outline-none"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-texto-2">
                Mesas esperadas
                <input
                  type="number"
                  value={mesasEsperadas}
                  onChange={(e) => setMesasEsperadas(Math.max(1, Number(e.target.value) || 1))}
                  className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-2 text-xs outline-none"
                />
              </label>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold tracking-wide text-texto-3 uppercase">
                Listas que compiten (una por línea, como van a aparecer en el telegrama)
              </div>
              <textarea
                value={listasTexto}
                onChange={(e) => setListasTexto(e.target.value)}
                rows={6}
                placeholder={"JxR\nFrente X\nLista Y"}
                className="w-full rounded-lg border border-borde-2 bg-panel px-2.5 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void guardarConfig(true)}
                disabled={ocupado || listasTexto.trim() === ""}
                className="flex items-center gap-1.5 rounded-xl bg-rosa px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <Unlock size={13} /> Abrir el búnker
              </button>
              {cargas.length > 0 && esSuperadmin && (
                <button
                  onClick={() => void reiniciar()}
                  disabled={ocupado}
                  className="flex items-center gap-1.5 rounded-xl border border-peligro/50 px-4 py-2 text-xs font-bold text-peligro transition hover:bg-peligro/10 disabled:opacity-40"
                >
                  <Trash2 size={13} /> Reiniciar (borra las {cargas.length} mesas)
                </button>
              )}
            </div>
            {error && <p className="text-[11px] text-peligro">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Búnker abierto: carga + tablero en vivo ──
  // Un decimal debajo de 10%: con 3 de 1.350 mesas, redondear a entero mostraba
  // "0% escrutado" cuando ya había datos en pantalla.
  const avance = Math.min(100, (100 * cargas.length) / Math.max(1, config.mesas_esperadas));
  const pctEscrutado = avance > 0 && avance < 10 ? Number(avance.toFixed(1)) : Math.round(avance);
  const ranking = listas
    .map((l) => ({ nombre: l, votos: totales.porLista.get(l) ?? 0 }))
    .sort((a, b) => b.votos - a.votos);
  const bancasPorLista = new Map((reparto?.porLista ?? []).map((r) => [r.nombre, r.bancas]));

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
      {/* KPIs en vivo */}
      <div className="panel-vidrio flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3 text-xs">
        <span className="flex items-center gap-1.5 font-extrabold">
          <Activity size={14} className="animate-pulse text-rosa" /> {config.eleccion}
        </span>
        <span>
          <b className="num">{numero(cargas.length)}</b>
          <span className="text-texto-3">/{numero(config.mesas_esperadas)} mesas · </span>
          <b className="num text-rosa">{pctEscrutado}%</b>
          <span className="text-texto-3"> escrutado</span>
        </span>
        <span>
          <b className="num">{numero(totales.votantes)}</b> <span className="text-texto-3">votantes</span>
        </span>
        <span className="text-texto-3">
          blancos <b className="num text-texto-2">{numero(totales.blancosTot)}</b> · nulos{" "}
          <b className="num text-texto-2">{numero(totales.nulosTot)}</b>
        </span>
        <span className="ml-auto flex items-center gap-2 text-[10px] text-texto-3">
          {actualizado ? `actualizado ${actualizado.toLocaleTimeString("es-AR")}` : ""}
          <button onClick={() => void cargarTodo()} title="Actualizar ahora" className="transition hover:text-texto">
            <RefreshCw size={12} />
          </button>
          {esSuperadmin && (
            <button
              onClick={() => void guardarConfig(false)}
              title="Cerrar el búnker (deja de recibir cargas; los datos quedan)"
              className="flex items-center gap-1 transition hover:text-texto"
            >
              <Lock size={12} /> cerrar
            </button>
          )}
        </span>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[380px_1fr]">
        {/* Carga de mesa (primero en mobile: es lo que usa el fiscal) */}
        <div className="panel-vidrio h-fit min-w-0 rounded-2xl p-4">
          <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Cargar telegrama de mesa</h3>
          <div className="mt-2 flex gap-1.5">
            <input
              value={mesa}
              onChange={(e) => setMesa(e.target.value)}
              placeholder="Mesa"
              inputMode="numeric"
              className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
            <select
              value={circuito}
              onChange={(e) => setCircuito(e.target.value)}
              className="flex-1 rounded-lg border border-borde-2 bg-panel px-2 py-2 text-xs outline-none"
            >
              <option value="">— circuito —</option>
              {CODIGOS.circuito.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              value={electores}
              onChange={(e) => setElectores(e.target.value)}
              placeholder="Electores"
              inputMode="numeric"
              title="Electores habilitados de la mesa (opcional, para la participación)"
              className="num w-20 rounded-lg border border-borde-2 bg-panel px-2 py-2 text-xs outline-none placeholder:text-texto-3 focus:border-rosa/50"
            />
          </div>
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
            Si la mesa ya estaba cargada, se reemplaza (así se corrigen errores). El total se calcula solo.
          </p>
        </div>

        <div className="min-w-0 space-y-3">
          {/* Resultado + bancas proyectadas */}
          <div className="panel-vidrio rounded-2xl p-4">
            <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">
              Resultado en vivo · {config.categoria}
              {reparto && <span className="font-normal normal-case text-texto-3"> · {config.bancas} bancas (D&apos;Hondt)</span>}
            </h3>
            {ranking.every((r) => r.votos === 0) ? (
              <p className="mt-2 text-xs text-texto-2">Sin mesas cargadas todavía: el tablero se llena solo a medida que los fiscales cargan.</p>
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
                  Proyección sobre las mesas cargadas ({pctEscrutado}% del total esperado): puede moverse hasta el escrutinio completo.
                </p>
              </div>
            )}
          </div>

          {/* Avance por circuito */}
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
              <h3 className="text-[11px] font-bold tracking-wide text-texto-2 uppercase">Últimas mesas cargadas</h3>
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

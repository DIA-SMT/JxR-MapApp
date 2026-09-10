"use client";

import { Calculator, Check, Info, Layers, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import { descargarCSV } from "@/lib/csv";
import {
  curvaDeBancas,
  repartirConFusion,
  repartirDHondt,
  type ListaVotos,
} from "@/lib/dhondt";

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * Bancas en juego según el marco legal de Tucumán:
 *  · Concejo Deliberante de la Capital: 18 concejales, renovación TOTAL cada
 *    4 años (Ley 5529, arts. 13 y 15) → 18 bancas también en 2027.
 *  · Legislatura: 49 legisladores, de los cuales 19 por la Sección I, que
 *    comprende exactamente el departamento Capital (Constitución, arts. 43-45).
 */
const BANCAS_POR_CATEGORIA: Record<string, number> = {
  CONCEJAL: 18,
  LEGISLADOR: 19,
};

interface FilaLista {
  lista_numero: number;
  lista_nombre: string;
  votos: number;
}

/**
 * Simulador de reparto de bancas (D'Hondt) sobre los resultados reales, con
 * escenarios de unificación de listas.
 *
 * El sistema tucumano reparte por LISTA, no por alianza: cada acople compite
 * por separado en concejales y legisladores aunque sume sus votos al mismo
 * candidato a intendente. Por eso la fragmentación se paga carísimo, y el
 * simulador permite medir exactamente cuánto.
 */
export function BancasDHondt() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [categoria, setCategoria] = useState("CONCEJAL");
  const [bancas, setBancas] = useState(18);
  const [pisoPct, setPisoPct] = useState(0);
  const [filas, setFilas] = useState<FilaLista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [unir, setUnir] = useState<Set<number>>(new Set());
  const [universos, setUniversos] = useState<Array<{ nombre: string; listas: number[] }>>([]);

  useEffect(() => {
    setCargando(true);
    setUnir(new Set());
    setBancas(BANCAS_POR_CATEGORIA[categoria] ?? 18);
    void supabase
      .rpc("listas_2023", { p_categoria: categoria })
      .then(({ data }) => {
        setFilas((data as FilaLista[]) ?? []);
        setCargando(false);
      });
  }, [supabase, categoria]);

  // Universos guardados (ej. "Sin banca 2027") para cargarlos de un clic
  useEffect(() => {
    void supabase
      .from("universos_listas")
      .select("nombre, categoria, lista_numero")
      .eq("categoria", categoria)
      .then(({ data }) => {
        const mapa = new Map<string, number[]>();
        for (const f of (data as Array<{ nombre: string; lista_numero: number }>) ?? []) {
          mapa.set(f.nombre, [...(mapa.get(f.nombre) ?? []), f.lista_numero]);
        }
        setUniversos([...mapa.entries()].map(([nombre, listas]) => ({ nombre, listas })));
      });
  }, [supabase, categoria]);

  const listas = useMemo<ListaVotos[]>(
    () => filas.map((f) => ({ id: f.lista_numero, nombre: f.lista_nombre, votos: Number(f.votos) })),
    [filas],
  );

  const opciones = useMemo(
    () => ({ bancas, pisoPct: pisoPct > 0 ? pisoPct : undefined, basePiso: "validos" as const }),
    [bancas, pisoPct],
  );

  const real = useMemo(() => (listas.length > 0 ? repartirDHondt(listas, opciones) : null), [listas, opciones]);
  const simulado = useMemo(
    () => (listas.length > 0 && unir.size >= 2 ? repartirConFusion(listas, [...unir], "▲ LISTAS UNIFICADAS", opciones) : null),
    [listas, unir, opciones],
  );

  // Cuántos votos hacen falta para 1, 2, 3… bancas si una lista nueva entra
  // al escenario (excluyendo las que se están unificando, para no contarlas dos veces)
  const curva = useMemo(() => {
    if (listas.length === 0) return [];
    const resto = listas.filter((l) => !unir.has(Number(l.id)));
    return curvaDeBancas([...resto, { id: "__nueva__", nombre: "nueva", votos: 0 }], "__nueva__", opciones, 6);
  }, [listas, unir, opciones]);

  const votosUnidos = useMemo(
    () => listas.filter((l) => unir.has(Number(l.id))).reduce((a, l) => a + l.votos, 0),
    [listas, unir],
  );
  const bancasSeparadas = useMemo(
    () => (real ? real.porLista.filter((l) => unir.has(Number(l.id))).reduce((a, l) => a + l.bancas, 0) : 0),
    [real, unir],
  );
  const bancasUnidas = simulado?.porLista.find((l) => l.nombre.startsWith("▲"))?.bancas ?? 0;

  const alternar = (n: number) =>
    setUnir((prev) => {
      const s = new Set(prev);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator size={18} className="text-rosa" />
        <h1 className="text-lg font-extrabold">Reparto de bancas · D&apos;Hondt</h1>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 text-xs font-bold outline-none"
        >
          <option value="CONCEJAL">CONCEJAL (18 bancas)</option>
          <option value="LEGISLADOR">LEGISLADOR (19 bancas)</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-texto-2">
          bancas
          <input
            type="number"
            value={bancas}
            onChange={(e) => setBancas(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            className="num w-16 rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 outline-none focus:border-rosa/50"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-texto-2" title="La Constitución de Tucumán NO fija piso: el campo sirve para simular una reforma">
          piso %
          <input
            type="number"
            value={pisoPct}
            onChange={(e) => setPisoPct(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
            className="num w-14 rounded-lg border border-borde-2 bg-panel-2 px-2 py-1 outline-none focus:border-rosa/50"
          />
        </label>
        {real && (
          <button
            onClick={() =>
              descargarCSV(
                `reparto-bancas-${categoria.toLowerCase()}`,
                ["Lista", "Nombre", "Votos", "% positivos", "Bancas", "Faltan para la siguiente"],
                real.porLista.map((l) => [l.id, l.nombre, l.votos, l.pct, l.bancas, l.faltanParaLaSiguiente]),
              )
            }
            className="ml-auto rounded-xl border border-borde-2 px-3 py-1.5 text-xs font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
          >
            Exportar CSV
          </button>
        )}
      </div>

      <div className="panel-vidrio rounded-2xl p-3 text-[11px] leading-relaxed text-texto-2">
        <div className="flex items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0 text-celeste" />
          <p>
            En Tucumán el reparto es <b className="text-texto">D&apos;Hondt puro por LISTA y sin piso</b> — la
            Constitución (art. 43) ordena dividir los votos de cada lista &quot;sin exceptuarse de este cálculo lista
            alguna&quot;. Los <b className="text-texto">acoples</b> suman sus votos al mismo candidato a intendente,
            pero en concejales <b className="text-texto">cada lista compite por separado</b>: fragmentarse cuesta bancas.
            Verificado contra la adjudicación oficial 2023 (coincide banca por banca).
          </p>
        </div>
      </div>

      {cargando && <p className="px-1 text-xs text-texto-3">Cargando resultados…</p>}

      {real && (
        <>
          {/* KPIs del reparto */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="panel-vidrio rounded-2xl p-4">
              <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">Piso efectivo</div>
              <div className="num text-2xl font-extrabold text-rosa">{numero(real.votosParaEntrar)}</div>
              <p className="text-[10px] text-texto-3">
                votos para arrebatar la última banca (cociente {numero(Math.round(real.cocienteUltimaBanca))})
              </p>
            </div>
            <div className="panel-vidrio rounded-2xl p-4">
              <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">Listas que entran</div>
              <div className="num text-2xl font-extrabold">
                {real.porLista.filter((l) => l.bancas > 0).length}
                <span className="text-sm font-semibold text-texto-3"> de {real.porLista.length}</span>
              </div>
              <p className="text-[10px] text-texto-3">
                {real.secuencia.filter((s) => s.divisor >= 2).length} bancas por segundo cociente o más
              </p>
            </div>
            <div className="panel-vidrio rounded-2xl p-4">
              <div className="text-[10px] font-bold tracking-wide text-texto-2 uppercase">Votos positivos</div>
              <div className="num text-2xl font-extrabold">{numero(real.votosValidos)}</div>
              {real.piso && (
                <p className="text-[10px] text-encurso">
                  piso simulado {real.piso.pct}% = {numero(real.piso.votos)} votos · deja afuera {real.piso.excluidas} listas
                </p>
              )}
            </div>
          </div>

          {/* Curva: cuántos votos para N bancas */}
          {curva.length > 0 && (
            <div className="panel-vidrio rounded-2xl p-4">
              <div className="mb-2 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
                Cuántos votos hace falta para cada banca
              </div>
              <div className="flex flex-wrap gap-1.5">
                {curva.map((p) => (
                  <span key={p.bancas} className="rounded-full border border-rosa/40 bg-rosa/5 px-2.5 py-1 text-[11px]">
                    <b className="num text-rosa">{p.bancas}</b> banca{p.bancas === 1 ? "" : "s"} ·{" "}
                    <b className="num">{numero(p.votosNecesarios)}</b> votos
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-texto-3">
                Calculado sobre este escenario: si una fuerza nueva entrara con esa cantidad de votos, el resto igual.
              </p>
            </div>
          )}

          {/* Simulación de unificación */}
          <div className="panel-vidrio rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-texto-2 uppercase">
                <Layers size={12} className="text-rosa" /> Simular listas unificadas
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {universos.map((u) => (
                  <button
                    key={u.nombre}
                    onClick={() => setUnir(new Set(u.listas))}
                    className="rounded-lg border border-rosa/40 px-2 py-1 text-[10px] font-bold text-rosa transition hover:bg-rosa/10"
                  >
                    cargar &quot;{u.nombre}&quot; ({u.listas.length})
                  </button>
                ))}
                {unir.size > 0 && (
                  <button
                    onClick={() => setUnir(new Set())}
                    className="flex items-center gap-1 rounded-lg border border-borde-2 px-2 py-1 text-[10px] font-bold text-texto-2 transition hover:text-texto"
                  >
                    <RotateCcw size={10} /> limpiar
                  </button>
                )}
              </div>
            </div>

            {unir.size >= 2 && simulado ? (
              <div className="mt-3 rounded-xl border border-rosa/40 bg-rosa/5 p-3">
                <div className="text-[11px]">
                  <b className="num text-texto">{unir.size}</b> listas suman{" "}
                  <b className="num text-rosa">{numero(votosUnidos)}</b> votos (
                  {((100 * votosUnidos) / Math.max(1, real.votosValidos)).toFixed(2)}% de los positivos)
                </div>
                <div className="mt-1.5 flex items-baseline gap-3 text-sm">
                  <span>
                    <span className="text-[10px] text-texto-3">separadas: </span>
                    <b className="num">{bancasSeparadas}</b>
                    <span className="text-[10px] text-texto-3"> banca{bancasSeparadas === 1 ? "" : "s"}</span>
                  </span>
                  <span className="text-texto-3">→</span>
                  <span>
                    <span className="text-[10px] text-texto-3">unificadas: </span>
                    <b className="num text-2xl font-extrabold text-rosa">{bancasUnidas}</b>
                  </span>
                  {bancasUnidas > bancasSeparadas && (
                    <span className="rounded-full bg-completo/15 px-2 py-0.5 text-[10px] font-bold text-completo">
                      +{bancasUnidas - bancasSeparadas} banca{bancasUnidas - bancasSeparadas === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {/* Quién pierde bancas en el escenario */}
                {(() => {
                  const perdedoras = simulado.porLista.filter((l) => {
                    const antes = real.porLista.find((x) => String(x.id) === String(l.id))?.bancas ?? 0;
                    return l.bancas < antes;
                  });
                  return perdedoras.length > 0 ? (
                    <p className="mt-1.5 text-[10px] text-texto-2">
                      Le saca bancas a: {perdedoras.map((l) => `${l.nombre} (−${(real.porLista.find((x) => String(x.id) === String(l.id))?.bancas ?? 0) - l.bancas})`).join(" · ")}
                    </p>
                  ) : null;
                })()}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-texto-3">
                Marcá dos o más listas en la tabla (o cargá un universo guardado) para ver cuántas bancas obtendrían
                yendo juntas.
              </p>
            )}
          </div>

          {/* Tabla de reparto */}
          <div className="panel-vidrio overflow-hidden rounded-2xl">
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel-2 text-left text-[10px] text-texto-3 uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Unir</th>
                    <th className="px-2 py-2 font-semibold">Lista</th>
                    <th className="px-2 py-2 text-right font-semibold">Votos</th>
                    <th className="px-2 py-2 text-right font-semibold">%</th>
                    <th className="px-2 py-2 text-right font-semibold">Bancas</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Votos que le faltaron para la banca siguiente">
                      Faltan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {real.porLista.map((l) => {
                    const marcada = unir.has(Number(l.id));
                    return (
                      <tr
                        key={l.id}
                        className={`border-t border-borde/60 transition ${marcada ? "bg-rosa/10" : "hover:bg-panel-2/60"}`}
                      >
                        <td className="px-3 py-1.5">
                          <button
                            onClick={() => alternar(Number(l.id))}
                            className={marcada ? "text-rosa" : "text-texto-3 hover:text-texto"}
                            title={marcada ? "Quitar de la unificación" : "Incluir en la unificación"}
                          >
                            {marcada ? <Check size={14} /> : <Square size={12} />}
                          </button>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="num text-texto-3">{l.id}</span>{" "}
                          <span className={l.bancas > 0 ? "font-bold" : ""}>{l.nombre}</span>
                          {l.excluidaPorPiso && (
                            <span className="ml-1.5 rounded-full bg-encurso/15 px-1.5 text-[9px] font-bold text-encurso">
                              bajo el piso
                            </span>
                          )}
                        </td>
                        <td className="num px-2 py-1.5 text-right">{numero(l.votos)}</td>
                        <td className="num px-2 py-1.5 text-right text-texto-2">{l.pct}%</td>
                        <td className="px-2 py-1.5 text-right">
                          {l.bancas > 0 ? (
                            <span className="num rounded-full bg-rosa/20 px-2 py-0.5 font-extrabold text-rosa">{l.bancas}</span>
                          ) : (
                            <span className="text-texto-3">—</span>
                          )}
                        </td>
                        <td className="num px-3 py-1.5 text-right text-texto-2">
                          {l.faltanParaLaSiguiente > 0 ? numero(l.faltanParaLaSiguiente) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

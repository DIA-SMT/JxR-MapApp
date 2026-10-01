"use client";

import { FileDown, FileUp, Plus, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  esAsignable,
  leerPartidas,
  parsearImporte,
  PARTIDAS_PRINCIPALES,
  type LecturaPartidas,
} from "@/lib/presupuesto";
import { agregarPartida, borrarPartida, guardarPartidas } from "@/lib/presupuesto-datos";
import { descargarCSV } from "@/lib/csv";
import { Cifra, Cifras } from "@/components/ui/cifras";
import { Vacio } from "@/components/ui/vacio";
import { pesos } from "./asignar";
import type { DatosPresupuesto } from "./panel";

/**
 * Partidas: cuánto queda libre en cada una. Es la base de todo: sin este dato
 * la herramienta no tiene qué repartir, y la ordenanza del presupuesto no lo
 * trae (el detalle va en el decreto de distribución y en la ejecución).
 */
export function Partidas({
  supabase,
  datos,
  esSuperadmin,
  onCambio,
}: {
  supabase: SupabaseClient;
  datos: DatosPresupuesto;
  esSuperadmin: boolean;
  onCambio: () => Promise<void> | void;
}) {
  const [lectura, setLectura] = useState<LecturaPartidas | null>(null);
  const [fuente, setFuente] = useState("");
  const [estimada, setEstimada] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [nueva, setNueva] = useState({
    codigo: "",
    jurisdiccion: "",
    pp: "52",
    credito: "",
    comprometido: "",
  });
  const archivo = useRef<HTMLInputElement>(null);

  const t = useMemo(() => {
    const asignables = datos.partidas.filter((p) => esAsignable(p.partida_principal));
    const suma = (lista: typeof datos.partidas, f: (p: (typeof datos.partidas)[number]) => number) =>
      lista.reduce((a, p) => a + f(p), 0);
    return {
      vigente: suma(datos.partidas, (p) => p.credito_vigente),
      comprometido: suma(datos.partidas, (p) => p.comprometido),
      reservado: suma(datos.partidas, (p) => p.reservado),
      // lo libre que de verdad se puede repartir: sin personal, intereses, inversión financiera ni amortización
      libre: suma(asignables, (p) => p.libre),
      noAsignable: suma(
        datos.partidas.filter((p) => !esAsignable(p.partida_principal)),
        (p) => p.libre,
      ),
      excedidas: datos.partidas.filter((p) => p.excedido > 0),
      vigenteCorriente: suma(
        datos.partidas.filter((p) => p.clase === "corriente"),
        (p) => p.credito_vigente,
      ),
      vigenteCapital: suma(
        datos.partidas.filter((p) => p.clase === "capital"),
        (p) => p.credito_vigente,
      ),
      estimadas: datos.partidas.filter((p) => p.estimada).length,
    };
  }, [datos]);

  const limpiarArchivo = () => {
    setLectura(null);
    if (archivo.current) archivo.current.value = "";
  };

  const leerArchivo = async (f: File) => {
    setMensaje(null);
    const buffer = await f.arrayBuffer();
    // Los reportes suelen venir en UTF-8, pero Excel en Windows exporta en latin-1.
    let texto = new TextDecoder("utf-8").decode(buffer);
    if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buffer);
    setLectura(leerPartidas(texto));
    if (!fuente) setFuente(`${f.name} · cargado el ${new Date().toLocaleDateString("es-AR")}`);
  };

  const confirmar = async () => {
    if (!lectura || ocupado || lectura.bloqueante) return;
    if (fuente.trim().length < 5)
      return setMensaje({
        ok: false,
        texto: "Indicá de qué reporte sale el dato y a qué fecha de corte.",
      });
    setOcupado(true);
    const e = await guardarPartidas(
      supabase,
      lectura.filas.map((f) => ({
        ...f,
        estimada,
        fuente_dato: fuente.trim(),
      })),
    );
    setOcupado(false);
    if (e) return setMensaje({ ok: false, texto: e });
    setMensaje({
      ok: true,
      texto: `${lectura.filas.length} partidas cargadas.`,
    });
    limpiarArchivo();
    await onCambio();
  };

  const agregarManual = async () => {
    const credito = parsearImporte(nueva.credito);
    const comprometido = nueva.comprometido ? parsearImporte(nueva.comprometido) : 0;
    if (
      !nueva.codigo.trim() ||
      !Number.isFinite(credito) ||
      credito < 0 ||
      !Number.isFinite(comprometido) ||
      comprometido < 0
    ) {
      return setMensaje({
        ok: false,
        texto: "Completá código y montos válidos.",
      });
    }
    setOcupado(true);
    const e = await agregarPartida(supabase, {
      codigo: nueva.codigo.trim(),
      anexo: "",
      jurisdiccion: nueva.jurisdiccion.trim(),
      programa: "",
      clase: PARTIDAS_PRINCIPALES[nueva.pp].clase,
      partida_principal: nueva.pp,
      afectacion: "",
      credito_vigente: credito,
      comprometido,
      estimada: true,
      fuente_dato: "Carga manual (estimación)",
    });
    setOcupado(false);
    if (e) return setMensaje({ ok: false, texto: e });
    setNueva({
      codigo: "",
      jurisdiccion: "",
      pp: nueva.pp,
      credito: "",
      comprometido: "",
    });
    setMensaje({
      ok: true,
      texto: "Partida estimada agregada: sirve para simular, no para aprobar.",
    });
    await onCambio();
  };

  const borrar = async (id: number, codigo: string) => {
    if (!window.confirm(`¿Borrar la partida «${codigo}»? Queda registrado en la bitácora.`)) return;
    setOcupado(true);
    const e = await borrarPartida(supabase, id);
    setOcupado(false);
    if (e) setMensaje({ ok: false, texto: e });
    else await onCambio();
  };

  const plantilla = () =>
    descargarCSV(
      "plantilla-partidas.csv",
      [
        "codigo",
        "anexo",
        "item",
        "programa",
        "partida principal",
        "fuente de financiamiento",
        "credito vigente",
        "comprometido",
      ],
      [
        [
          "DE.20.52.01",
          "Departamento Ejecutivo",
          "Secretaría de Obras Públicas",
          "Pavimentación urbana",
          "52",
          "Rentas generales",
          "1.500.000.000",
          "400.000.000",
        ],
        [
          "DE.30.31.50",
          "Departamento Ejecutivo",
          "Secretaría General",
          "Ayudas sociales",
          "3150",
          "Rentas generales",
          "200.000.000",
          "50.000.000",
        ],
      ],
    );

  const eje = datos.ejercicio;
  const pasaCorriente = eje && t.vigenteCorriente > eje.total_corrientes + 1;
  const pasaCapital = eje && t.vigenteCapital > eje.total_capital + 1;
  const campo =
    "rounded-lg border border-borde-2 bg-panel px-2 py-1.5 text-[11px] outline-none placeholder:text-texto-3 focus:border-rosa/50";

  return (
    <div className="space-y-3">
      {/* Sin nada cargado, las cifras en cero y la vara de control solo distraen: primero el formulario */}
      {datos.partidas.length > 0 && (
        <Cifras>
          <Cifra valor={pesos(t.vigente, true)} etiqueta="crédito vigente" />
          <Cifra valor={pesos(t.comprometido, true)} etiqueta="comprometido" />
          <Cifra
            valor={pesos(t.reservado, true)}
            etiqueta="reservado"
            titulo="Lo que ya tomaron los escenarios aprobados que todavía no se ejecutaron"
          />
          <Cifra
            valor={pesos(t.libre, true)}
            etiqueta="libre para asignar"
            tono="marca"
            titulo="Sin personal, intereses, inversión financiera ni amortización"
          />
          <Cifra valor={datos.partidas.length.toLocaleString("es-AR")} etiqueta="partidas" />
        </Cifras>
      )}

      {t.excedidas.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-sin/50 bg-sin/10 px-4 py-2.5 text-[11px] leading-snug text-sin">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>
              {t.excedidas.length} partida{t.excedidas.length === 1 ? "" : "s"} excedida
              {t.excedidas.length === 1 ? "" : "s"}:
            </b>{" "}
            lo reservado por escenarios aprobados ya no entra porque bajó el crédito o subió el comprometido (
            {t.excedidas
              .slice(0, 4)
              .map((p) => `${p.codigo} por ${pesos(p.excedido, true)}`)
              .join(", ")}
            {t.excedidas.length > 4 ? "…" : ""}). Hay que corregir el escenario o reforzar la partida por la vía que
            corresponda.
          </span>
        </div>
      )}

      {eje && datos.partidas.length > 0 && (
        <div className="panel-vidrio rounded-2xl px-4 py-3 text-[11px] leading-relaxed text-texto-2">
          <b className="text-texto">Vara de control:</b> la {eje.norma} fija erogaciones corrientes por{" "}
          <b className="num">{pesos(eje.total_corrientes)}</b> y de capital por{" "}
          <b className="num">{pesos(eje.total_capital)}</b>. Lo cargado suma{" "}
          <b className="num">{pesos(t.vigenteCorriente, true)}</b> y{" "}
          <b className="num">{pesos(t.vigenteCapital, true)}</b>.
          {t.noAsignable > 0 && (
            <span className="block text-texto-3">
              {pesos(t.noAsignable, true)} disponibles en personal, intereses, inversión financiera o amortización no se
              reparten a políticas.
            </span>
          )}
          {(pasaCorriente || pasaCapital) && (
            <span className="mt-1 flex items-start gap-1 text-encurso">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              El crédito vigente supera lo que fija la ordenanza en{" "}
              {pasaCorriente && pasaCapital ? "corrientes y capital" : pasaCorriente ? "corrientes" : "capital"}. Puede
              ser correcto: en 2026 Economía y Hacienda puede incrementar partidas hasta un 15% (ordenanza del expte.
              1.253-HCD-26-L) y el Art. 5º permite incorporar asistencias con destino específico. Conviene revisarlo.
            </span>
          )}
          {t.estimadas > 0 && (
            <span className="mt-1 block text-encurso">
              Hay {t.estimadas} partidas estimadas: sirven para simular, pero un escenario que las use no se puede
              aprobar.
            </span>
          )}
        </div>
      )}

      {esSuperadmin && (
        <EstimacionRapida
          partidas={datos.partidas}
          onGuardar={async (filas) => {
            const e = await guardarPartidas(supabase, filas);
            if (!e) await onCambio();
            return e;
          }}
        />
      )}

      {esSuperadmin ? (
        <div className="panel-vidrio rounded-2xl p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold">
            <FileUp size={14} className="text-rosa" /> Forma exacta: el reporte de la Contaduría
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-texto-2">
            El reporte de ejecución por partida de la Contaduría General (o el decreto de distribución del Art. 4º de la
            ordenanza), exportado a CSV. Las columnas se reconocen por nombre: código, anexo, ítem, programa, partida
            principal (Ord. 570/80), sección, fuente, crédito vigente y comprometido. Una partida que ya estaba se
            actualiza por su código.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={archivo}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => e.target.files?.[0] && void leerArchivo(e.target.files[0])}
              className="max-w-full text-[11px] file:mr-2 file:rounded-lg file:border-0 file:bg-rosa file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-white"
            />
            <button
              onClick={plantilla}
              className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-[11px] font-bold text-texto-2 transition hover:border-rosa/50 hover:text-rosa"
            >
              <FileDown size={12} /> Plantilla
            </button>
          </div>

          {lectura && (
            <div
              className={`mt-3 rounded-xl border p-3 ${lectura.bloqueante ? "border-sin/50 bg-sin/5" : "border-rosa/30 bg-rosa/5"}`}
            >
              <div className="text-[11px] font-bold">
                {lectura.filas.length} partidas leídas ·{" "}
                {pesos(
                  lectura.filas.reduce((a, f) => a + f.credito_vigente, 0),
                  true,
                )}{" "}
                de crédito vigente
              </div>
              <div className="mt-1 text-[10px] text-texto-3">
                Columnas reconocidas:{" "}
                {Object.entries(lectura.columnas)
                  .map(([c, col]) => `${c} ← «${col}»`)
                  .join(" · ") || "ninguna"}
              </div>
              {lectura.avisos.length > 0 && (
                <ul className="mt-1.5 text-[10px] text-encurso">
                  {lectura.avisos.slice(0, 12).map((a) => (
                    <li key={a}>· {a}</li>
                  ))}
                </ul>
              )}
              {lectura.errores.length > 0 && (
                <ul className="mt-1.5 max-h-24 overflow-auto text-[10px] text-sin">
                  {lectura.errores.slice(0, 30).map((e) => (
                    <li key={e}>· {e}</li>
                  ))}
                  {lectura.errores.length > 30 && <li>· y {lectura.errores.length - 30} más</li>}
                </ul>
              )}
              {lectura.filas.length > 0 && (
                <div className="mt-2 max-h-48 overflow-auto">
                  <table className="w-full min-w-[640px] text-[10.5px]">
                    <thead className="text-left text-texto-3">
                      <tr>
                        <th className="pr-2 font-semibold">Código</th>
                        <th className="pr-2 font-semibold">Ítem</th>
                        <th className="pr-2 font-semibold">Partida principal</th>
                        <th className="num pr-2 text-right font-semibold">Vigente</th>
                        <th className="num text-right font-semibold">Comprometido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lectura.filas.slice(0, 40).map((f, i) => (
                        <tr key={i} className="border-t border-borde/50">
                          <td className="max-w-40 truncate pr-2">{f.codigo}</td>
                          <td className="max-w-48 truncate pr-2">{f.jurisdiccion}</td>
                          <td className={`pr-2 ${esAsignable(f.partida_principal) ? "" : "text-texto-3"}`}>
                            {f.partida_principal || "—"} {PARTIDAS_PRINCIPALES[f.partida_principal]?.nombre ?? ""}
                          </td>
                          <td className="num pr-2 text-right">{pesos(f.credito_vigente)}</td>
                          <td className="num text-right">{pesos(f.comprometido)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={fuente}
                  onChange={(e) => setFuente(e.target.value)}
                  placeholder="De qué reporte sale y fecha de corte (ej. Contaduría, ejecución al 30/09/2026)"
                  className={`min-w-0 flex-1 ${campo}`}
                />
                <label className="flex items-center gap-1.5 text-[11px] text-texto-2">
                  <input
                    type="checkbox"
                    checked={estimada}
                    onChange={(e) => setEstimada(e.target.checked)}
                    className="accent-[#e14f82]"
                  />
                  es una estimación
                </label>
                <button
                  onClick={() => void confirmar()}
                  disabled={ocupado || lectura.bloqueante}
                  title={lectura.bloqueante ? "Hay que corregir el archivo antes de cargarlo" : ""}
                  className="flex items-center gap-1 rounded-lg bg-rosa px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  <Upload size={12} /> {ocupado ? "Cargando…" : "Confirmar carga"}
                </button>
                <button onClick={limpiarArchivo} className="text-[11px] text-texto-3 hover:text-texto">
                  cancelar
                </button>
              </div>
            </div>
          )}

          <details className="mt-3 border-t border-borde pt-3">
            <summary className="cursor-pointer text-[10px] font-bold tracking-wide text-texto-3 uppercase hover:text-rosa">
              Agregar una partida suelta, a mano
            </summary>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <input
                value={nueva.codigo}
                onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })}
                placeholder="Código"
                className={`w-28 ${campo}`}
              />
              <input
                value={nueva.jurisdiccion}
                onChange={(e) => setNueva({ ...nueva, jurisdiccion: e.target.value })}
                placeholder="Ítem (repartición)"
                className={`min-w-40 flex-1 ${campo}`}
              />
              <select value={nueva.pp} onChange={(e) => setNueva({ ...nueva, pp: e.target.value })} className={campo}>
                {Object.entries(PARTIDAS_PRINCIPALES)
                  .filter(([, v]) => v.asignable)
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {k} · {v.nombre} ({v.clase})
                    </option>
                  ))}
              </select>
              <input
                value={nueva.credito}
                onChange={(e) => setNueva({ ...nueva, credito: e.target.value })}
                placeholder="Crédito vigente"
                inputMode="decimal"
                className={`num w-36 ${campo}`}
              />
              <input
                value={nueva.comprometido}
                onChange={(e) => setNueva({ ...nueva, comprometido: e.target.value })}
                placeholder="Comprometido"
                inputMode="decimal"
                className={`num w-32 ${campo}`}
              />
              <button
                onClick={() => void agregarManual()}
                disabled={ocupado}
                className="flex items-center gap-1 rounded-lg border border-rosa/40 px-2.5 py-1.5 text-[11px] font-bold text-rosa disabled:opacity-40"
              >
                <Plus size={12} /> Agregar
              </button>
            </div>
          </details>
          {mensaje && (
            <p className={`mt-2 text-[11px] font-bold ${mensaje.ok ? "text-completo" : "text-peligro"}`}>
              {mensaje.texto}
            </p>
          )}
        </div>
      ) : (
        <p className="px-1 text-[11px] text-texto-3">Las partidas las carga el superadmin. Acá las ves como están.</p>
      )}

      {datos.partidas.length === 0 ? (
        <Vacio icono={FileUp} titulo="Sin partidas cargadas">
          La Ordenanza 5486/26 solo fija los totales ($349.768.983.000): el detalle por partida va en planillas anexas y
          en el decreto de distribución, que no están en el Orden del Día. Pedile a la Contaduría General el reporte de
          ejecución por partida.
        </Vacio>
      ) : (
        <div className="panel-vidrio rounded-2xl p-4">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[860px] text-[11px]">
              <thead className="sticky top-0 z-10 bg-panel/95 text-left text-texto-3 backdrop-blur">
                <tr>
                  <th className="py-1 pr-2 font-semibold">Partida</th>
                  <th className="py-1 pr-2 font-semibold">Partida principal</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Vigente</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Comprometido</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Reservado</th>
                  <th className="num py-1 pr-2 text-right font-semibold">Libre</th>
                  <th className="py-1 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {datos.partidas.map((p) => {
                  const asignable = esAsignable(p.partida_principal);
                  return (
                    <tr key={p.id} className="border-t border-borde/60 transition hover:bg-panel-3/50">
                      <td className="max-w-72 py-1.5 pr-2">
                        <div
                          className="truncate font-semibold"
                          title={[p.codigo, p.anexo, p.jurisdiccion, p.programa].filter(Boolean).join(" · ")}
                        >
                          {p.codigo}
                          {p.estimada && (
                            <span className="ml-1.5 rounded-full border border-encurso/50 px-1.5 text-[9px] font-bold text-encurso">
                              estimada
                            </span>
                          )}
                          {p.afectacion && (
                            <span
                              className="ml-1.5 rounded-full border border-celeste/50 px-1.5 text-[9px] font-bold text-celeste"
                              title="Recurso con afectación específica"
                            >
                              {p.afectacion}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[9.5px] text-texto-3">
                          {[p.anexo, p.jurisdiccion, p.programa].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 text-texto-2">
                        {p.partida_principal || "—"}{" "}
                        <span className="text-texto-3">
                          {PARTIDAS_PRINCIPALES[p.partida_principal]?.nombre ?? "sin partida principal"}
                        </span>
                      </td>
                      <td className="num py-1.5 pr-2 text-right">{pesos(p.credito_vigente, true)}</td>
                      <td className="num py-1.5 pr-2 text-right text-texto-2">{pesos(p.comprometido, true)}</td>
                      <td className="num py-1.5 pr-2 text-right text-texto-2">
                        {p.reservado > 0 ? pesos(p.reservado, true) : "—"}
                      </td>
                      <td
                        className={`num py-1.5 pr-2 text-right font-bold ${p.excedido > 0 ? "text-sin" : asignable ? "text-rosa" : "text-texto-3"}`}
                      >
                        {p.excedido > 0
                          ? `excedida ${pesos(p.excedido, true)}`
                          : asignable
                            ? pesos(p.libre, true)
                            : "no se asigna"}
                      </td>
                      <td className="py-1.5 text-right">
                        {esSuperadmin && (
                          <button
                            onClick={() => void borrar(p.id, p.codigo)}
                            disabled={ocupado}
                            title="Borrar partida"
                            className="text-texto-3 transition hover:text-peligro"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Los cinco tipos de gasto que se pueden repartir, en palabras de todos los días. */
const TIPOS_GASTO: Array<{ pp: string; titulo: string; ejemplo: string }> = [
  {
    pp: "52",
    titulo: "Obras",
    ejemplo: "pavimento, plazas, cloacas, escuelas",
  },
  {
    pp: "51",
    titulo: "Equipamiento",
    ejemplo: "cámaras, luminarias, vehículos, juegos",
  },
  {
    pp: "12",
    titulo: "Bienes y servicios",
    ejemplo: "insumos, talleres, operativos",
  },
  {
    pp: "13",
    titulo: "Servicios públicos",
    ejemplo: "recolección, limpieza, mantenimiento",
  },
  {
    pp: "31",
    titulo: "Ayudas y transferencias",
    ejemplo: "becas, subsidios, apoyo a clubes",
  },
];

/**
 * La forma rápida de arrancar: cuánta plata libre hay para cada tipo de gasto.
 * Se guarda como partidas ESTIMADAS (EST-52, EST-31…): sirven para planificar,
 * pero un escenario que las use no se aprueba hasta cargar el dato real.
 */
function EstimacionRapida({
  partidas,
  onGuardar,
}: {
  partidas: DatosPresupuesto["partidas"];
  onGuardar: (filas: Parameters<typeof guardarPartidas>[1]) => Promise<string | null>;
}) {
  const actual = (pp: string) => partidas.find((p) => p.codigo === `EST-${pp}`)?.credito_vigente;
  const [montos, setMontos] = useState<Record<string, string>>(() =>
    Object.fromEntries(TIPOS_GASTO.map((t) => [t.pp, actual(t.pp) ? String(Math.round(actual(t.pp)!)) : ""])),
  );
  const [ocupado, setOcupado] = useState(false);
  const [msj, setMsj] = useState<{ ok: boolean; t: string } | null>(null);
  const total = TIPOS_GASTO.reduce((a, t) => a + (parsearImporte(montos[t.pp] || "0") || 0), 0);

  const guardar = async () => {
    const filas = [];
    for (const t of TIPOS_GASTO) {
      const txt = montos[t.pp].trim();
      if (!txt && !actual(t.pp)) continue;
      const n = txt ? parsearImporte(txt) : 0;
      if (!Number.isFinite(n) || n < 0) return setMsj({ ok: false, t: `Revisá el monto de «${t.titulo}».` });
      filas.push({
        codigo: `EST-${t.pp}`,
        anexo: "Departamento Ejecutivo",
        jurisdiccion: `Estimación · ${t.titulo}`,
        programa: "",
        clase: PARTIDAS_PRINCIPALES[t.pp].clase,
        partida_principal: t.pp,
        afectacion: "",
        credito_vigente: n,
        comprometido: 0,
        estimada: true,
        fuente_dato: `Estimación rápida por tipo de gasto · ${new Date().toLocaleDateString("es-AR")}`,
      });
    }
    if (filas.length === 0) return setMsj({ ok: false, t: "Poné al menos un monto." });
    setOcupado(true);
    const e = await onGuardar(filas);
    setOcupado(false);
    setMsj(e ? { ok: false, t: e } : { ok: true, t: "Guardado. Ya podés seguir con el paso 2." });
  };

  return (
    <div className="panel-vidrio rounded-2xl border-2 border-rosa/30 p-4">
      <h3 className="text-sm font-extrabold">Forma rápida: ¿cuánta plata libre hay para cada tipo de gasto?</h3>
      <p className="mt-0.5 text-[11px] leading-relaxed text-texto-2">
        Si todavía no tenés el reporte de la Contaduría, poné un monto aproximado de lo que queda sin comprometer en
        cada tipo de gasto. Con eso ya podés repartir y ver el mapa. Se guarda como <b>estimación</b>: sirve para
        planificar, pero para aprobar hay que cargar el dato real.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {TIPOS_GASTO.map((t) => (
          <label key={t.pp} className="block rounded-xl border border-borde-2 p-2.5">
            <span className="block text-xs font-bold">{t.titulo}</span>
            <span className="block text-[10px] leading-snug text-texto-3">{t.ejemplo}</span>
            <span className="mt-1.5 flex items-center gap-1 rounded-lg border border-borde-2 bg-panel px-2 focus-within:border-rosa/50">
              <span className="text-[11px] text-texto-3">$</span>
              <input
                value={montos[t.pp]}
                onChange={(e) =>
                  setMontos({
                    ...montos,
                    [t.pp]: e.target.value.replace(/[^0-9.,]/g, ""),
                  })
                }
                placeholder="0"
                inputMode="decimal"
                className="num w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-texto-3"
              />
            </span>
            <span className="mt-0.5 block text-[9.5px] text-texto-3">
              {PARTIDAS_PRINCIPALES[t.pp].clase === "capital" ? "inversión" : "gasto corriente"} · partida {t.pp}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void guardar()}
          disabled={ocupado}
          className="rounded-lg bg-rosa px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {ocupado ? "Guardando…" : "Guardar estimación"}
        </button>
        <span className="text-[11px] text-texto-2">
          Total: <b className="num">{pesos(total, true)}</b>
        </span>
        {msj && <span className={`text-[11px] font-bold ${msj.ok ? "text-completo" : "text-peligro"}`}>{msj.t}</span>}
      </div>
    </div>
  );
}

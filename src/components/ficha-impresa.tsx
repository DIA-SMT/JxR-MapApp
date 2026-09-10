"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import {
  armarMesasPeleadas,
  obtenerFicha,
  obtenerMesas2025Circuito,
  obtenerPerfilSocial,
  obtenerRankingCircuito,
  obtenerVotos2025Circuito,
  type FichaTerritorial,
  type FilaRankingEspacio,
  type MesaPeleada,
  type PerfilSocial,
} from "@/lib/analisis";
import {
  obtenerPadronDeCircuito,
  obtenerResumen2023Circuito,
  type DetallePadronCircuito,
  type Resumen2023Circuito,
} from "@/lib/padron";
import { crearClienteNavegador } from "@/lib/supabase/cliente";
import cruceBarrios from "@/lib/datos/barrios-circuitos.json";

const BARRIOS_POR_CIRCUITO = (cruceBarrios as unknown as {
  por_circuito: Record<string, Array<{ barrio: string; pct: number }>>;
}).por_circuito;

const numero = (n: number) => n.toLocaleString("es-AR");

/**
 * La ficha del circuito en una hoja: padrón, resultados, perfil social,
 * barrios y el plan territorial. Pensada para imprimir (Ctrl+P o el botón)
 * y entregarle al referente que no va a abrir la app.
 */
export function FichaImpresa({ codigo }: { codigo: string }) {
  const [supabase] = useState(crearClienteNavegador);
  const [padron, setPadron] = useState<DetallePadronCircuito | null>(null);
  const [r2023, setR2023] = useState<Resumen2023Circuito | null>(null);
  const [r2025, setR2025] = useState<FilaRankingEspacio[]>([]);
  const [tot2025, setTot2025] = useState<{ electores: number; votantes: number; blanco: number } | null>(null);
  const [mesas, setMesas] = useState<MesaPeleada[]>([]);
  const [perfil, setPerfil] = useState<PerfilSocial | null>(null);
  const [ciudad, setCiudad] = useState<PerfilSocial | null>(null);
  const [ficha, setFicha] = useState<FichaTerritorial | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, r23, r25, m, v, pf, pc, f] = await Promise.all([
        obtenerPadronDeCircuito(supabase, codigo),
        obtenerResumen2023Circuito(supabase, codigo, "CONCEJAL"),
        obtenerRankingCircuito(supabase, "2025", codigo),
        obtenerMesas2025Circuito(supabase, codigo),
        obtenerVotos2025Circuito(supabase, codigo),
        obtenerPerfilSocial(supabase, "circuito", codigo).catch(() => null),
        obtenerPerfilSocial(supabase, "ciudad", null).catch(() => null),
        obtenerFicha(supabase, "circuito", codigo),
      ]);
      setPadron(p);
      setR2023(r23);
      setR2025(r25);
      setTot2025({
        electores: m.reduce((a, x) => a + x.electores, 0),
        votantes: m.reduce((a, x) => a + x.total, 0),
        blanco: m.reduce((a, x) => a + x.blanco, 0),
      });
      setMesas(armarMesasPeleadas(v, m).slice(0, 12));
      setPerfil(pf);
      setCiudad(pc);
      setFicha(f);
      setListo(true);
    })();
  }, [supabase, codigo]);

  const barrios = BARRIOS_POR_CIRCUITO[codigo] ?? [];
  const seccion = "mb-1 border-b border-neutral-300 pb-0.5 text-[11px] font-extrabold tracking-wide uppercase";

  return (
    <div className="mx-auto max-w-3xl px-8 py-6 text-[12px] leading-snug">
      {/* Barra de acciones: no sale impresa */}
      <div className="mb-4 flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-2.5 print:hidden">
        <span className="text-xs text-neutral-600">
          {listo ? "Ficha lista: imprimila o guardala como PDF." : "Cargando los datos del circuito…"}
        </span>
        <button
          onClick={() => window.print()}
          disabled={!listo}
          className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
        >
          <Printer size={13} /> Imprimir
        </button>
      </div>

      {/* Encabezado */}
      <div className="mb-3 flex items-end justify-between border-b-2 border-neutral-900 pb-2">
        <div>
          <div className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">JxR · Comando Territorial</div>
          <h1 className="text-2xl font-black">Circuito {codigo}</h1>
        </div>
        <div className="text-right text-[10px] text-neutral-500">
          <div>Ficha territorial · uso interno</div>
          <div>{new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {/* Padrón */}
        <div>
          <div className={seccion}>Padrón</div>
          {padron ? (
            <>
              <div>
                <b className="text-base">{numero(padron.total)}</b> electores · {numero(padron.mujeres)} mujeres ·{" "}
                {numero(padron.varones)} varones
              </div>
              <div className="text-neutral-600">
                16–25: {numero(padron.franjas_estimadas.e16_25)} · 26–40: {numero(padron.franjas_estimadas.e26_40)} ·
                41–60: {numero(padron.franjas_estimadas.e41_60)} · 60+: {numero(padron.franjas_estimadas.e60_mas)}{" "}
                <span className="text-[10px]">(edades estimadas por DNI)</span>
              </div>
              <div className="mt-1 text-neutral-700">
                {padron.escuelas.length} escuelas: {padron.escuelas.map((e) => e.nombre).join(" · ")}
              </div>
            </>
          ) : (
            <div className="text-neutral-400">sin datos</div>
          )}
        </div>

        {/* Perfil social */}
        <div>
          <div className={seccion}>Perfil social (Censo 2022)</div>
          {perfil ? (
            <>
              <div>
                <b>{numero(perfil.poblacion)}</b> habitantes · {numero(perfil.hogares)} hogares
                {perfil.edad.pct_65_y_mas != null && <> · {perfil.edad.pct_65_y_mas}% de 65+</>}
              </div>
              <table className="mt-1 w-full">
                <tbody>
                  {(
                    [
                      ["Desocupación", perfil.trabajo.tasa_desocupacion, ciudad?.trabajo.tasa_desocupacion],
                      ["Hogares con NBI", perfil.pobreza.pct_nbi, ciudad?.pobreza.pct_nbi],
                      ["Hacinamiento", perfil.pobreza.pct_hacinamiento, ciudad?.pobreza.pct_hacinamiento],
                      ["Sin cloaca", perfil.servicios.pct_sin_cloaca, ciudad?.servicios.pct_sin_cloaca],
                      ["Sin cobertura de salud", perfil.educacion_salud.pct_sin_cobertura, ciudad?.educacion_salud.pct_sin_cobertura],
                    ] as Array<[string, number | null, number | null | undefined]>
                  ).map(([et, v, cv]) =>
                    v == null ? null : (
                      <tr key={et} className="border-b border-neutral-200">
                        <td className="py-0.5 text-neutral-700">{et}</td>
                        <td className={`py-0.5 text-right font-bold ${cv != null && v > cv * 1.15 ? "text-red-700" : ""}`}>{v}%</td>
                        <td className="py-0.5 pl-2 text-right text-[10px] text-neutral-500">ciudad {cv ?? "—"}%</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-neutral-400">sin datos censales</div>
          )}
        </div>

        {/* 2023 */}
        <div>
          <div className={seccion}>Resultados 2023 · Concejal</div>
          {r2023 && r2023.votos_total > 0 ? (
            <>
              <div>
                <b>{numero(r2023.votos_total)}</b> votos · blanco {numero(r2023.blanco)} · nulos {numero(r2023.nulos)}
              </div>
              <table className="mt-1 w-full">
                <tbody>
                  {r2023.top_listas.slice(0, 6).map((l) => (
                    <tr key={l.numero} className="border-b border-neutral-200">
                      <td className="py-0.5 pr-2 text-neutral-700">
                        {l.numero} · {l.nombre}
                      </td>
                      <td className="py-0.5 text-right font-bold">{numero(l.votos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-neutral-400">sin datos</div>
          )}
        </div>

        {/* 2025 */}
        <div>
          <div className={seccion}>Resultados 2025 · Diputados (provisorio)</div>
          {r2025.length > 0 ? (
            <>
              {tot2025 && (
                <div>
                  participación{" "}
                  <b>{tot2025.electores > 0 ? Math.round((100 * tot2025.votantes) / tot2025.electores) : 0}%</b> ·
                  blanco {numero(tot2025.blanco)} · ausentes {numero(Math.max(0, tot2025.electores - tot2025.votantes))}
                </div>
              )}
              <table className="mt-1 w-full">
                <tbody>
                  {r2025.slice(0, 6).map((l) => (
                    <tr key={l.lista_id} className="border-b border-neutral-200">
                      <td className="py-0.5 pr-2 text-neutral-700">{l.lista}</td>
                      <td className="py-0.5 text-right font-bold">
                        {numero(Number(l.votos))} <span className="font-normal text-neutral-500">({l.pct}%)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-neutral-400">sin datos</div>
          )}
        </div>
      </div>

      {/* Plan territorial */}
      <div className="mt-4">
        <div className={seccion}>Plan territorial{ficha?.estado === "validada" ? " · VALIDADO" : ficha ? " · borrador" : ""}</div>
        {ficha ? (
          <div className="grid grid-cols-1 gap-1">
            {(
              [
                ["Segmento prioritario", ficha.segmento],
                ["Problemática principal", ficha.problematica],
                ["Mensaje", ficha.mensaje],
                ["Propuesta", ficha.propuesta],
                ["Estrategia de abordaje", ficha.abordaje],
              ] as Array<[string, string]>
            ).map(([et, v]) => (
              <div key={et}>
                <b>{et}:</b> {v.trim() || <span className="text-neutral-400">a definir</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-neutral-400">Sin plan cargado todavía: se define en el panel del circuito, en el mapa.</div>
        )}
      </div>

      {/* Barrios */}
      {barrios.length > 0 && (
        <div className="mt-4">
          <div className={seccion}>Barrios del circuito</div>
          <div className="text-neutral-700">
            {barrios.map((b) => `${b.barrio}${b.pct < 50 ? ` (${b.pct}%)` : ""}`).join(" · ")}
          </div>
        </div>
      )}

      {/* Mesas peleadas 2025 */}
      {mesas.length > 0 && (
        <div className="mt-4">
          <div className={seccion}>Mesas 2025 más peleadas (nacionales, provisorio)</div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-400 text-left text-[10px] text-neutral-500 uppercase">
                <th className="py-0.5 font-bold">Mesa</th>
                <th className="py-0.5 font-bold">1º vs 2º</th>
                <th className="py-0.5 text-right font-bold">Dif.</th>
                <th className="py-0.5 text-right font-bold">Blanco</th>
                <th className="py-0.5 text-right font-bold">Ausentes</th>
              </tr>
            </thead>
            <tbody>
              {mesas.map((m) => (
                <tr key={m.mesa} className="border-b border-neutral-200">
                  <td className="py-0.5">{m.mesa}</td>
                  <td className="py-0.5">
                    {m.ganador} vs {m.segundo ?? "—"}
                  </td>
                  <td className={`py-0.5 text-right ${m.diferencia <= 20 ? "font-bold text-red-700" : ""}`}>{m.diferencia}</td>
                  <td className="py-0.5 text-right">{m.blanco}</td>
                  <td className="py-0.5 text-right">{m.ausentes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 border-t border-neutral-300 pt-2 text-[10px] text-neutral-500">
        Datos: padrón vigente, escrutinio definitivo 2023, escrutinio provisorio 2025 (Diputados) y Censo 2022 (INDEC)
        por radio censal. El análisis es siempre agregado por territorio: nunca sobre personas. Documento interno de
        campaña.
      </p>
    </div>
  );
}

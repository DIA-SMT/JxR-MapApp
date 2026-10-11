/**
 * Datos de EJEMPLO para probar la herramienta antes de tener el reporte de la
 * Contaduría y los costos reales. Los montos son inventados —del orden de lo
 * que maneja la municipalidad, pero inventados— y viven solo en el navegador:
 * en modo ejemplo no se guarda nada.
 *
 * Lo único real es el censo: la necesidad de cada barrio es la verdadera.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { asignarPresupuesto } from "./asignacion";
import { armarEntradas, type BarrioNecesidad, type Partida } from "./presupuesto";
import type { Escenario, PartidaEstado, PoliticaCatalogo } from "./presupuesto-datos";

const partida = (
  id: number,
  codigo: string,
  jurisdiccion: string,
  pp: string,
  clase: "corriente" | "capital",
  libre: number,
): PartidaEstado => ({
  id,
  codigo,
  anexo: "Departamento Ejecutivo",
  jurisdiccion,
  programa: "Ejemplo",
  clase,
  partida_principal: pp,
  afectacion: "",
  credito_vigente: libre,
  comprometido: 0,
  estimada: true,
  fuente_dato: "Ejemplo con montos inventados",
  actualizado_en: "",
  disponible: libre,
  reservado: 0,
  libre,
  excedido: 0,
});

/** Cinco "bolsas" de plata libre, una por tipo de gasto. */
export const PARTIDAS_EJEMPLO: PartidaEstado[] = [
  partida(-1, "EJ-52", "Obras Públicas", "52", "capital", 3_000_000_000),
  partida(-2, "EJ-51", "Equipamiento", "51", "capital", 600_000_000),
  partida(-3, "EJ-12", "Bienes y servicios", "12", "corriente", 900_000_000),
  partida(-4, "EJ-13", "Servicios públicos", "13", "corriente", 500_000_000),
  partida(-5, "EJ-31", "Ayudas y transferencias", "31", "corriente", 300_000_000),
];

/** Costo por unidad inventado para cada política activa (por código del Plan Rector). */
export const COSTOS_EJEMPLO: Record<string, number> = {
  "1.1": 18_000, // por habitante alcanzado
  "1.2": 2_500,
  "2.2": 120_000, // por hogar con su cuadra reparada
  "3.1": 90_000,
  "4.1": 15_000,
  "4.3": 6_000,
  "6.2": 4_000,
  "7.1": 3_000,
  "7.2": 2_500,
  "8.3": 9_000,
  "10.4": 7_000,
  "11.2": 25_000, // por persona sin cobertura atendida
  "11.3": 12_000,
  "11.4": 30_000,
  "12.1": 45_000, // por niña o niño
  "12.4": 20_000,
  "13.1": 11_000,
  "13.2": 1_500,
  "15.1": 8_000,
  "15.4": 5_000,
  "16.1": 15_000,
  "16.2": 35_000,
  "16.3": 60_000,
  "17.1": 40_000, // por persona capacitada
  "17.3": 55_000,
};

/** El catálogo real con los costos de ejemplo puestos donde falta el costo. */
export function politicasEjemplo(politicas: PoliticaCatalogo[]): PoliticaCatalogo[] {
  return politicas.map((p) =>
    p.activa && COSTOS_EJEMPLO[p.codigo] && !p.costo_unitario ? { ...p, costo_unitario: COSTOS_EJEMPLO[p.codigo] } : p,
  );
}

// ── Propuestas de ejemplo ──────────────────────────────────────────────────
//
// Para que el ejemplo muestre el circuito entero —comparar, el informe, la
// ejecución y la ficha de barrio— hacen falta propuestas guardadas. Se
// calculan con el motor real sobre los datos de ejemplo y se sirven desde un
// cliente en memoria con la misma forma que Supabase: las pantallas no saben
// que es un ejemplo y la base no se toca.

type Fila = Record<string, unknown>;

/** Un cliente que responde lo mismo que Supabase, desde tablas en memoria. Nada sale del navegador. */
export function clienteEnMemoria(tablas: Record<string, Fila[]>): SupabaseClient {
  const consulta = (filas: Fila[]) => {
    let r = filas;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        r = r.filter((x) => x[c] === v);
        return q;
      },
      order: () => q,
      limit: (n: number) => {
        r = r.slice(0, n);
        return q;
      },
      range: (d: number, h: number) => Promise.resolve({ data: r.slice(d, h + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: r[0] ?? null, error: null }),
      then: (ok: (x: { data: Fila[]; error: null }) => unknown, mal?: (e: unknown) => unknown) =>
        Promise.resolve({ data: r, error: null }).then(ok, mal),
    };
    return q;
  };
  const NO = {
    data: null,
    error: { message: "En el ejemplo no se guarda nada: salí del ejemplo para trabajar con datos reales." },
  };
  return {
    from: (t: string) => consulta(tablas[t] ?? []),
    rpc: async (fn: string, args: { p_escenario?: number; p_items?: Fila[] }) => {
      // El seguimiento sí se puede probar: se anota en memoria, como lo haría la base.
      if (fn === "registrar_ejecucion" && Array.isArray(args.p_items)) {
        const tabla = (tablas.escenario_ejecucion ??= []);
        for (const it of args.p_items) {
          const i = tabla.findIndex(
            (x) => x.escenario_id === args.p_escenario && x.politica_id === it.politica_id && x.barrio === it.barrio,
          );
          const fila = {
            ...it,
            escenario_id: args.p_escenario,
            actualizado_email: "ejemplo",
            actualizado_en: new Date().toISOString(),
          };
          if (i >= 0) tabla[i] = fila;
          else tabla.push(fila);
        }
        return { data: args.p_items.length, error: null };
      }
      return NO;
    },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  } as unknown as SupabaseClient;
}

/**
 * Dos propuestas sobre los datos de ejemplo: «Plan equilibrado», aprobada y
 * con avance de obra, y «Prioridad barrios con más necesidad», esperando
 * aprobación. Determinista: la misma entrada da siempre las mismas propuestas
 * (el informe impreso las vuelve a calcular en otra pestaña).
 */
export function propuestasEjemplo(
  politicas: PoliticaCatalogo[],
  barrios: BarrioNecesidad[],
): { escenarios: Escenario[]; cliente: SupabaseClient } {
  const pols = politicasEjemplo(politicas);
  const porId = new Map(pols.map((p) => [String(p.id), p]));
  const partidaPorId = new Map(PARTIDAS_EJEMPLO.map((p) => [String(p.id), p]));
  const libres: Partida[] = PARTIDAS_EJEMPLO.map((p) => ({ ...p, credito_vigente: p.libre, comprometido: 0 }));
  const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

  const tablas: Record<string, Fila[]> = {
    escenarios_presupuesto: [],
    escenario_asignaciones: [],
    escenario_financiamiento: [],
    escenario_ajustes: [],
    escenario_ejecucion: [],
    presupuesto_bitacora: [],
  };
  const definiciones = [
    {
      id: 2,
      nombre: "Prioridad barrios con más necesidad (ejemplo)",
      criterio:
        "Se concentra la inversión en los barrios con más hogares con NBI y sin cloaca que el promedio de la ciudad.",
      intensidad: 2,
      equidad: 0.5,
      estado: "propuesto",
      creado: 3,
    },
    {
      id: 1,
      nombre: "Plan equilibrado 2026 (ejemplo)",
      criterio: "Reparto equilibrado: prioriza la necesidad sin dejar afuera a los barrios con necesidad media.",
      intensidad: 1,
      equidad: 1,
      estado: "aprobado",
      creado: 20,
    },
  ];

  for (const d of definiciones) {
    const parametros = { intensidad: d.intensidad, equidad: d.equidad };
    const e = armarEntradas(libres, pols, barrios, parametros);
    const r = asignarPresupuesto(e.fuentes, e.politicas, e.necesidades, { equidad: d.equidad, pasos: 4000 });
    const asign = r.asignaciones.filter((a) => a.monto > 0);
    for (const a of asign) {
      const p = porId.get(a.politica)!;
      tablas.escenario_asignaciones.push({
        escenario_id: d.id,
        politica_id: p.id,
        barrio: a.destino,
        monto: a.monto,
        unidades: a.unidades,
        fijado: false,
        politica_codigo: p.codigo,
        politica_nombre: p.nombre,
        politica_tipo: p.tipo,
        unidad: p.unidad,
        costo_unitario: p.costo_unitario,
      });
    }
    for (const f of r.financiamiento.filter((x) => x.monto > 0)) {
      const pa = partidaPorId.get(f.fuente)!;
      tablas.escenario_financiamiento.push({
        escenario_id: d.id,
        partida_id: pa.id,
        politica_id: Number(f.politica),
        monto: f.monto,
        partida_codigo: pa.codigo,
        partida_principal: pa.partida_principal,
      });
    }
    tablas.escenarios_presupuesto.push({
      id: d.id,
      ejercicio: 2026,
      nombre: d.nombre,
      criterio: d.criterio,
      estado: d.estado,
      parametros,
      resumen: {
        asignado: asign.reduce((s, a) => s + a.monto, 0),
        barrios: new Set(asign.map((a) => a.destino)).size,
        politicas: new Set(asign.map((a) => a.politica)).size,
        ajustes: 0,
      },
      avisos: r.avisos,
      norma: d.estado === "aprobado" ? "Decreto Nº 0000/2026 (ejemplo)" : "",
      boletin: "",
      ejecucion: "",
      creado_por: null,
      creado_email: "ejemplo@presupuesto",
      creado_en: hace(d.creado),
      propuesto_en: hace(d.creado - 1),
      aprobado_por: null,
      aprobado_email: d.estado === "aprobado" ? "aprobacion@ejemplo" : "",
      aprobado_en: d.estado === "aprobado" ? hace(d.creado - 5) : null,
    });
  }

  // Avance de obra de la aprobada: de cada tres celdas, una terminada y una en curso.
  tablas.escenario_asignaciones
    .filter((a) => a.escenario_id === 1)
    .sort((x, y) => Number(y.monto) - Number(x.monto))
    .forEach((a, i) => {
      const paso = i % 3;
      if (paso === 2) return;
      tablas.escenario_ejecucion.push({
        escenario_id: 1,
        politica_id: a.politica_id,
        barrio: a.barrio,
        estado: paso === 0 ? "terminado" : "en_curso",
        monto_ejecutado: Math.round(Number(a.monto) * (paso === 0 ? 1 : 0.4)),
        unidades_logradas: paso === 0 ? Number(a.unidades) : 0,
        expediente: `Expte. ${1000 + i}/2026 (ejemplo)`,
        nota: "",
        actualizado_email: "ejemplo",
        actualizado_en: hace(2),
      });
    });

  const escenarios = (tablas.escenarios_presupuesto as unknown as Escenario[]).map((e) => ({ ...e }));
  return { escenarios, cliente: clienteEnMemoria(tablas) };
}

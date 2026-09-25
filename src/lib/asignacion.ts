/**
 * Motor de asignación presupuestaria.
 *
 * Reparte el crédito DISPONIBLE de un conjunto de partidas entre políticas
 * públicas y barrios, maximizando la necesidad cubierta ponderada.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 * Cada partida k tiene un disponible D_k y solo puede financiar ciertas
 * políticas (la clasificación económica y la afectación de la fuente lo
 * restringen: una partida de capital no paga una beca). Cada política p tiene
 * un costo por unidad c_p (por beneficiario, por hogar conectado, por cuadra) y
 * en cada barrio b una necesidad N_pb medida en esas unidades.
 *
 * Se maximiza  Σ_pb  prioridad_p · peso_pb · N_pb · h(u_pb / N_pb)
 * donde u_pb son las unidades cubiertas y  h(s) = 1 − (1 − s)^(1+κ).
 * Con κ = 0 cada unidad de necesidad vale lo mismo (se cubre primero lo más
 * eficiente hasta agotarlo); con κ > 0 las primeras unidades de un barrio valen
 * más que las últimas y el presupuesto se reparte.
 *
 * ── Por qué el resultado es óptimo ──────────────────────────────────────────
 * El conjunto de vectores de gasto por política que las partidas pueden
 * financiar es un polimatroide (rango de un grafo bipartito con capacidades).
 * Para una función objetivo separable y cóncava sobre un polimatroide, asignar
 * de a un incremento por vez al de mayor beneficio marginal —si todavía es
 * financiable— es exacto (Federgruen y Groenevelt, 1986). Lo delicado es
 * "financiable": una política puede parecer sin fondos porque su única partida
 * ya la usó otra que podía pagarse con otra partida. Por eso cada incremento se
 * enruta con caminos de aumento de flujo máximo, que reasignan el
 * financiamiento de las políticas ya cubiertas en lugar de rendirse.
 *
 * Con incrementos de una unidad el óptimo es exacto para el problema en
 * unidades enteras; con incrementos mayores (para que corra rápido sobre 300+
 * barrios) la pérdida está acotada por un incremento por celda.
 *
 * El motor no conoce ni recibe datos electorales: sus únicas entradas son
 * disponibles, costos, necesidades y los pesos que decide quien planifica.
 */

export interface Fuente {
  id: string;
  /** Crédito disponible, en pesos. */
  disponible: number;
}

export interface PoliticaEntrada {
  id: string;
  /** Para los avisos; si falta se usa el id. */
  nombre?: string;
  /** Orden de los pisos cuando compiten. Si falta, prioridad / costo por unidad. */
  orden?: number;
  /** Pesos por unidad: por beneficiario, por hogar conectado, por cuadra. */
  costoUnitario: number;
  /** Ids de las fuentes que la pueden financiar. */
  fuentes: string[];
  /** Peso relativo entre políticas. Por defecto 1. */
  prioridad?: number;
  /** Pesos que como mínimo tiene que recibir. Se cubre antes que el resto. */
  piso?: number;
  /** Pesos que como máximo puede recibir. */
  tope?: number;
}

/** Una celda política × destino. */
export interface Necesidad {
  politica: string;
  destino: string;
  /** Unidades de necesidad (hogares sin cloaca, jóvenes desocupados…). */
  unidades: number;
  /** Multiplicador de intensidad del destino. Por defecto 1. */
  peso?: number;
  /**
   * Pesos decididos a mano para esta celda. Si está definido (aunque sea 0),
   * la celda recibe exactamente eso —en unidades enteras— y el optimizador no
   * la toca.
   */
  fijo?: number;
}

export interface OpcionesAsignacion {
  /** κ ≥ 0. 0 = lineal; más alto = reparte más entre barrios. */
  equidad?: number;
  /**
   * Granularidad: el disponible total se recorre en unos `pasos` incrementos.
   * Más pasos = más fino y más lento. Por defecto 4000.
   */
  pasos?: number;
}

export type MotivoSaturacion = "necesidad" | "fondos" | "tope" | null;

export interface AsignacionCelda {
  politica: string;
  destino: string;
  monto: number;
  unidades: number;
  /** Unidades cubiertas sobre la necesidad del destino, 0 a 1. */
  cobertura: number;
}

export interface ResultadoAsignacion {
  asignaciones: AsignacionCelda[];
  /** Qué partida financia qué política, y cuánto. */
  financiamiento: Array<{ fuente: string; politica: string; monto: number }>;
  porFuente: Array<{ fuente: string; disponible: number; usado: number; remanente: number }>;
  /** Cómo quedó cada monto fijado a mano: lo pedido, lo efectivo y por qué difieren. */
  fijados: Array<{ politica: string; destino: string; pedido: number; efectivo: number; motivo: string | null }>;
  porPolitica: Array<{
    politica: string;
    monto: number;
    unidades: number;
    necesidad: number;
    saturada: MotivoSaturacion;
  }>;
  /**
   * Beneficio por peso del último incremento asignado: el "precio sombra".
   * Todo lo que quedó sin financiar rinde menos que esto.
   */
  nivelDeCorte: number;
  impacto: number;
  asignado: number;
  sinAsignar: number;
  avisos: string[];
}

const EPS = 1e-3; // un milésimo de peso

// ── Montículo de máximos ───────────────────────────────────────────────────
interface Entrada {
  clave: number;
  celda: number;
}

class Monticulo {
  private d: Entrada[] = [];
  get largo() {
    return this.d.length;
  }
  /** Mayor clave primero; a igual clave, la celda de menor índice (determinista). */
  private mayor(a: Entrada, b: Entrada) {
    return a.clave > b.clave || (a.clave === b.clave && a.celda < b.celda);
  }
  push(e: Entrada) {
    const d = this.d;
    d.push(e);
    let i = d.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (!this.mayor(d[i], d[padre])) break;
      [d[i], d[padre]] = [d[padre], d[i]];
      i = padre;
    }
  }
  pop(): Entrada | undefined {
    const d = this.d;
    if (d.length === 0) return undefined;
    const tope = d[0];
    const ultimo = d.pop()!;
    if (d.length > 0) {
      d[0] = ultimo;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < d.length && this.mayor(d[l], d[m])) m = l;
        if (r < d.length && this.mayor(d[r], d[m])) m = r;
        if (m === i) break;
        [d[i], d[m]] = [d[m], d[i]];
        i = m;
      }
    }
    return tope;
  }
}

// ── Red de financiamiento: partidas → políticas ────────────────────────────
class Red {
  readonly disponible: Float64Array;
  /** compatibles[p] = partidas que pueden financiar la política p */
  readonly compatibles: number[][];
  readonly usado: Float64Array;
  /** flujo[p] : partida → monto que esa partida le da a la política p */
  readonly flujo: Array<Map<number, number>>;
  /** financia[k] : política → monto que la partida k le da */
  readonly financia: Array<Map<number, number>>;

  constructor(disponible: Float64Array, compatibles: number[][]) {
    this.disponible = disponible;
    this.compatibles = compatibles;
    this.usado = new Float64Array(disponible.length);
    this.flujo = compatibles.map(() => new Map());
    this.financia = Array.from({ length: disponible.length }, () => new Map());
  }

  private sumar(k: number, p: number, monto: number) {
    const f = (this.flujo[p].get(k) ?? 0) + monto;
    if (f <= EPS) {
      this.flujo[p].delete(k);
      this.financia[k].delete(p);
    } else {
      this.flujo[p].set(k, f);
      this.financia[k].set(p, f);
    }
  }

  /**
   * Intenta sumar `monto` al financiamiento de la política p, reasignando si
   * hace falta el de otras políticas. Devuelve cuánto logró (≤ monto).
   */
  aumentar(p: number, monto: number): number {
    let logrado = 0;
    const nK = this.disponible.length;
    const nP = this.compatibles.length;
    while (logrado < monto - EPS) {
      // BFS desde el lado de p: nodos = partidas.
      const padreP = new Int32Array(nK).fill(-2); // -2 = no visitado, -1 = raíz
      const padreK = new Int32Array(nK).fill(-1);
      const vistaP = new Uint8Array(nP);
      vistaP[p] = 1;
      const cola: number[] = [];
      for (const k of this.compatibles[p]) {
        if (padreP[k] === -2) {
          padreP[k] = -1;
          cola.push(k);
        }
      }
      let hallada = -1;
      for (let i = 0; i < cola.length; i++) {
        const k = cola[i];
        if (this.disponible[k] - this.usado[k] > EPS) {
          hallada = k;
          break;
        }
        // k está agotada: puede darle a p lo que hoy le da a otra política p2,
        // si p2 consigue ese monto de otra partida.
        for (const [p2, f] of this.financia[k]) {
          if (f <= EPS || vistaP[p2]) continue;
          vistaP[p2] = 1;
          for (const k2 of this.compatibles[p2]) {
            if (padreP[k2] !== -2) continue;
            padreP[k2] = p2;
            padreK[k2] = k;
            cola.push(k2);
          }
        }
      }
      if (hallada < 0) break;

      // Cuello de botella del camino.
      let b = Math.min(monto - logrado, this.disponible[hallada] - this.usado[hallada]);
      for (let k = hallada; padreP[k] >= 0; k = padreK[k]) {
        b = Math.min(b, this.flujo[padreP[k]].get(padreK[k]) ?? 0);
      }
      if (b <= EPS) break;

      // Aplicar: la partida hallada financia a la política anterior del
      // camino, que libera a la partida previa, y así hasta llegar a p.
      this.usado[hallada] += b;
      let k = hallada;
      while (padreP[k] >= 0) {
        const p2 = padreP[k];
        const kPrev = padreK[k];
        this.sumar(k, p2, b);
        this.sumar(kPrev, p2, -b);
        k = kPrev;
      }
      this.sumar(k, p, b);
      logrado += b;
    }
    return logrado;
  }

  /** Devuelve `monto` del financiamiento de p a sus partidas. */
  retirar(p: number, monto: number) {
    let resta = monto;
    for (const [k, f] of [...this.flujo[p].entries()]) {
      if (resta <= EPS) break;
      const r = Math.min(resta, f);
      this.sumar(k, p, -r);
      this.usado[k] -= r;
      resta -= r;
    }
  }
}

/**
 * Asigna el disponible. Pura y determinista: mismas entradas, mismo resultado.
 */
export function asignarPresupuesto(
  fuentes: Fuente[],
  politicas: PoliticaEntrada[],
  necesidades: Necesidad[],
  opciones: OpcionesAsignacion = {},
): ResultadoAsignacion {
  const avisos: string[] = [];
  const kappa = Math.max(0, opciones.equidad ?? 0);
  const pasos = Math.max(1, Math.round(opciones.pasos ?? 4000));
  const pesosTxt = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

  // ── Índices ──
  const idxFuente = new Map(fuentes.map((f, i) => [f.id, i]));
  const disponible = Float64Array.from(fuentes, (f) => Math.max(0, f.disponible || 0));
  const totalDisponible = disponible.reduce((a, b) => a + b, 0);

  const idxPolitica = new Map<string, number>();
  const pol: Array<{
    id: string;
    nombre: string;
    costo: number;
    prioridad: number;
    orden: number;
    piso: number;
    tope: number;
    gasto: number;
    unidadesPaso: number;
    muerta: MotivoSaturacion;
  }> = [];
  const compatibles: number[][] = [];
  for (const p of politicas) {
    const nombre = p.nombre ?? p.id;
    if (idxPolitica.has(p.id)) {
      avisos.push(`La política «${nombre}» está repetida: se usa la primera.`);
      continue;
    }
    if (!(p.costoUnitario > 0)) {
      avisos.push(`«${nombre}» no tiene costo por unidad: queda afuera.`);
      continue;
    }
    const ks = [...new Set(p.fuentes)].map((f) => idxFuente.get(f)).filter((k): k is number => k !== undefined);
    if (ks.length === 0) avisos.push(`«${nombre}» no tiene ninguna partida que la pueda financiar.`);
    const prioridad = Math.max(0, p.prioridad ?? 1);
    idxPolitica.set(p.id, pol.length);
    compatibles.push(ks);
    pol.push({
      id: p.id,
      nombre,
      costo: p.costoUnitario,
      prioridad,
      // Para ordenar los pisos: el valor por peso de una unidad, que coincide
      // con la prioridad que puso quien planifica cuando la entrada viene de
      // armarEntradas (que escala la prioridad por el costo).
      orden: p.orden ?? prioridad / p.costoUnitario,
      piso: Math.max(0, p.piso ?? 0),
      tope: p.tope != null && p.tope >= 0 ? p.tope : Infinity,
      gasto: 0,
      unidadesPaso: 1,
      muerta: ks.length === 0 ? "fondos" : null,
    });
  }

  // ── Celdas ──
  const celdas: Array<{ p: number; destino: string; N: number; w: number; u: number; congelada: boolean }> = [];
  const celdasDe: number[][] = pol.map(() => []);
  const fijos: Array<{ c: number; monto: number }> = [];
  const vistas = new Set<string>();
  for (const n of necesidades) {
    const p = idxPolitica.get(n.politica);
    if (p === undefined) continue;
    const clave = `${n.politica}\u0000${n.destino}`;
    if (vistas.has(clave)) {
      avisos.push(`«${pol[p].nombre}» en «${n.destino}» está repetida: se usa la primera.`);
      continue;
    }
    vistas.add(clave);
    const N = Math.floor(Math.max(0, n.unidades || 0));
    const w = Math.max(0, n.peso ?? 1);
    const c = celdas.length;
    const congelada = n.fijo != null && n.fijo >= 0;
    celdas.push({ p, destino: n.destino, N, w, u: 0, congelada });
    celdasDe[p].push(c);
    if (congelada && n.fijo! > 0) fijos.push({ c, monto: n.fijo! });
  }

  // ── Tamaño del paso de cada política ──
  // Sale de la plata que la política PUEDE alcanzar, no del total: si no, una
  // política con poco crédito propio cubre un barrio entero en un solo paso y
  // la equidad deja de actuar. Los pasos se reparten en proporción al alcance,
  // con un mínimo para que ninguna política quede gruesa.
  const alcance = pol.map((P, p) => {
    const fondos = compatibles[p].reduce((a, k) => a + disponible[k], 0);
    const necesidad = celdasDe[p].reduce((a, c) => a + celdas[c].N, 0) * P.costo;
    return Math.max(0, Math.min(fondos, P.tope, necesidad));
  });
  // Una partida compartida entra en el alcance de cada política que la puede
  // usar: sin el tope, el total se infla y a cada política le tocan muy pocos pasos.
  const alcanceTotal = Math.min(alcance.reduce((a, b) => a + b, 0), totalDisponible);
  pol.forEach((P, p) => {
    const pasosP = alcanceTotal > 0 ? Math.max(200, Math.round((pasos * alcance[p]) / alcanceTotal)) : pasos;
    P.unidadesPaso = Math.max(1, Math.round(alcance[p] / pasosP / P.costo));
  });

  const red = new Red(disponible, compatibles);

  /** Valor de cubrir u unidades en la celda c. */
  const valor = (c: number, u: number) => {
    const { p, N, w } = celdas[c];
    if (N <= 0) return 0;
    const s = Math.min(1, u / N);
    return pol[p].prioridad * w * N * (1 - Math.pow(1 - s, 1 + kappa));
  };

  /** Unidades del próximo incremento: respeta necesidad, tope y, en los pisos, lo que falta. */
  const proximoPaso = (c: number, hastaPiso = false) => {
    const { p, N, u } = celdas[c];
    const P = pol[p];
    const porTope = Math.floor((P.tope - P.gasto) / P.costo + 1e-9);
    // Además del paso de la política, nunca más de un vigésimo de la necesidad
    // de la celda: si un paso cubre un barrio entero, la equidad no tiene
    // dónde actuar (h(1) se alcanza de un salto, sea cual sea κ).
    let du = Math.min(P.unidadesPaso, Math.max(1, Math.ceil(N / 20)), N - u, porTope);
    if (hastaPiso) du = Math.min(du, Math.ceil((P.piso - P.gasto) / P.costo - 1e-9));
    return Math.max(0, du);
  };

  /**
   * Beneficio por peso del próximo incremento. La diferencia se calcula sin
   * restar contra 1: con equidad alta, (1−s)^(1+κ) es muy chico y la resta
   * 1 − x perdía todos los dígitos.
   */
  const clave = (c: number, hastaPiso = false) => {
    const du = proximoPaso(c, hastaPiso);
    if (du <= 0) return -1;
    const { p, N, u, w } = celdas[c];
    if (N <= 0) return -1;
    const s0 = Math.min(1, u / N);
    const s1 = Math.min(1, (u + du) / N);
    const ganancia = pol[p].prioridad * w * N * (Math.pow(1 - s0, 1 + kappa) - Math.pow(1 - s1, 1 + kappa));
    return ganancia / (du * pol[p].costo);
  };

  /**
   * Intenta cubrir `du` unidades en la celda c. Devuelve las unidades que
   * logró; si no alcanzó, la política quedó sin fondos.
   */
  const cubrir = (c: number, du: number): number => {
    const { p } = celdas[c];
    const P = pol[p];
    const monto = du * P.costo;
    const logrado = red.aumentar(p, monto);
    if (logrado >= monto - EPS) {
      celdas[c].u += du;
      P.gasto += monto;
      return du;
    }
    // No alcanzó: se toman solo unidades enteras y se devuelve el resto.
    const enteras = Math.floor(logrado / P.costo + 1e-9);
    red.retirar(p, logrado - enteras * P.costo);
    celdas[c].u += enteras;
    P.gasto += enteras * P.costo;
    P.muerta = "fondos";
    return enteras;
  };

  // ── 1. Montos fijados a mano ──
  const fijados: ResultadoAsignacion["fijados"] = [];
  for (const { c, monto } of fijos) {
    const cel = celdas[c];
    const P = pol[cel.p];
    const pedidas = Math.floor(monto / P.costo + 1e-9);
    const porNecesidad = cel.N - cel.u;
    const porTope = Math.max(0, Math.floor((P.tope - P.gasto) / P.costo + 1e-9));
    const du = Math.min(pedidas, porNecesidad, porTope);
    let logradas = 0;
    if (du > 0) {
      const muertaAntes = P.muerta;
      logradas = cubrir(c, du);
      P.muerta = muertaAntes; // un fijo que no entra no condena a la política
    }
    const efectivo = logradas * P.costo;
    let motivo: string | null = null;
    if (logradas < du) motivo = "no entra en las partidas";
    else if (du < pedidas) motivo = porTope < porNecesidad ? "supera el tope de la política" : "supera la necesidad del barrio";
    else if (efectivo < monto - EPS) motivo = "se redondea a unidades enteras";
    fijados.push({ politica: P.id, destino: cel.destino, pedido: monto, efectivo, motivo });
    if (motivo && motivo !== "se redondea a unidades enteras") {
      avisos.push(
        `El monto fijado para «${P.nombre}» en «${cel.destino}» ${motivo}: se asignan ${pesosTxt(efectivo)} de ${pesosTxt(monto)}.`,
      );
    }
  }

  let nivelDeCorte = 0;

  /** Greedy sobre un conjunto de celdas hasta que `seguir` diga basta. */
  const optimizar = (lista: number[], seguir: () => boolean, fasePiso: boolean) => {
    const m = new Monticulo();
    // En los pisos entran también las celdas de valor cero: el piso se cumple
    // aunque la política no tenga prioridad por encima de las demás.
    const entra = (k: number) => (fasePiso ? k >= 0 : k > 0);
    for (const c of lista) {
      if (celdas[c].congelada) continue;
      const k = clave(c, fasePiso);
      if (entra(k)) m.push({ clave: k, celda: c });
    }
    while (m.largo > 0 && seguir()) {
      const { clave: k, celda: c } = m.pop()!;
      const P = pol[celdas[c].p];
      if (P.muerta) continue;
      const du = proximoPaso(c, fasePiso);
      if (du <= 0) {
        if (P.gasto >= P.tope - EPS) P.muerta = "tope";
        continue;
      }
      const logradas = cubrir(c, du);
      if (logradas > 0 && !fasePiso) nivelDeCorte = k;
      if (P.muerta) continue;
      const nueva = clave(c, fasePiso);
      if (entra(nueva)) m.push({ clave: nueva, celda: c });
    }
  };

  // ── 2. Pisos, en el orden de prioridad de quien planifica ──
  const conPiso = pol
    .map((P, p) => ({ P, p }))
    .filter(({ P }) => P.piso > 0)
    .sort((a, b) => b.P.orden - a.P.orden || a.P.id.localeCompare(b.P.id));
  for (const { P, p } of conPiso) {
    optimizar(celdasDe[p], () => P.gasto < P.piso - EPS && !P.muerta, true);
    if (P.gasto < P.piso - EPS) {
      avisos.push(`«${P.nombre}» no llega a su piso: recibió ${pesosTxt(P.gasto)} de ${pesosTxt(P.piso)}.`);
    }
  }

  // ── 3. Optimización global ──
  optimizar(
    celdas.map((_, c) => c),
    () => true,
    false,
  );

  // ── Resultado ──
  const asignaciones: AsignacionCelda[] = [];
  let impacto = 0;
  const unidadesPol = new Float64Array(pol.length);
  const necesidadPol = new Float64Array(pol.length);
  // lo que el motor podía decidir: las celdas no fijadas a mano
  const necesidadLibre = new Float64Array(pol.length);
  const unidadesLibres = new Float64Array(pol.length);
  celdas.forEach((cel, c) => {
    necesidadPol[cel.p] += cel.N;
    if (!cel.congelada) {
      necesidadLibre[cel.p] += cel.N;
      unidadesLibres[cel.p] += cel.u;
    }
    if (cel.u <= 0) return;
    unidadesPol[cel.p] += cel.u;
    impacto += valor(c, cel.u);
    asignaciones.push({
      politica: pol[cel.p].id,
      destino: cel.destino,
      monto: cel.u * pol[cel.p].costo,
      unidades: cel.u,
      cobertura: cel.N > 0 ? cel.u / cel.N : 0,
    });
  });

  const financiamiento: ResultadoAsignacion["financiamiento"] = [];
  red.flujo.forEach((m, p) => {
    for (const [k, monto] of m) {
      if (monto > EPS) financiamiento.push({ fuente: fuentes[k].id, politica: pol[p].id, monto });
    }
  });

  const porPolitica = pol.map((P, p) => {
    let saturada: MotivoSaturacion = P.muerta;
    if (!saturada) {
      if (P.gasto >= P.tope - P.costo) saturada = "tope";
      else if (unidadesLibres[p] >= necesidadLibre[p]) saturada = "necesidad";
    }
    return { politica: P.id, monto: P.gasto, unidades: unidadesPol[p], necesidad: necesidadPol[p], saturada };
  });

  const asignado = pol.reduce((a, P) => a + P.gasto, 0);

  return {
    asignaciones,
    financiamiento,
    porFuente: fuentes.map((f, k) => ({
      fuente: f.id,
      disponible: disponible[k],
      usado: red.usado[k],
      remanente: Math.max(0, disponible[k] - red.usado[k]),
    })),
    porPolitica,
    fijados,
    nivelDeCorte,
    impacto,
    asignado,
    sinAsignar: Math.max(0, totalDisponible - asignado),
    avisos,
  };
}

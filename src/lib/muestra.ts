/**
 * Diseño muestral estratificado para encuestas propias.
 *
 * La ventaja de tener el padrón y el censo cargados es que la aplicación puede
 * ser el MARCO MUESTRAL: sabe cuántos electores hay en cada circuito y qué
 * perfil social tiene cada uno, así que puede decir cuántas entrevistas hacen
 * falta en cada territorio para que la muestra represente a la ciudad, y con
 * qué peso hay que ponderar después cada respuesta.
 *
 * Sin esto, lo que pasa en la práctica es que se encuesta donde es cómodo
 * (centro, gente que atiende) y el resultado sobre-representa a esa gente.
 */

export interface Estrato {
  /** El territorio: un circuito. */
  circuito: string;
  /** Electores del padrón en ese circuito: define su peso en la población. */
  electores: number;
}

export interface EstratoAsignado extends Estrato {
  /** Cuántas entrevistas hacer acá. */
  entrevistas: number;
  /** Qué parte de la población representa (0-1). */
  proporcionPoblacion: number;
  /** Peso de ponderación: población / muestra, normalizado a 1 en promedio. */
  peso: number;
}

export interface DisenoMuestral {
  estratos: EstratoAsignado[];
  n: number;
  poblacion: number;
  confianza: number;
  /** Margen de error de la muestra total, en puntos porcentuales. */
  margen: number;
  /** Cuántas entrevistas harían falta para el margen objetivo, si se pidió uno. */
  nSugerido?: number;
  /** Estratos donde el reparto proporcional deja una muestra sin valor propio. */
  avisos: string[];
}

/** z para los niveles de confianza que se usan en la práctica. */
const Z: Record<number, number> = { 80: 1.2816, 85: 1.4395, 90: 1.6449, 95: 1.96, 99: 2.5758 };

function zDe(confianza: number): number {
  const exacto = Z[Math.round(confianza)];
  if (exacto) return exacto;
  // interpolación lineal entre los niveles conocidos, suficiente para el rango útil
  const niveles = Object.keys(Z).map(Number).sort((a, b) => a - b);
  if (confianza <= niveles[0]) return Z[niveles[0]];
  if (confianza >= niveles[niveles.length - 1]) return Z[niveles[niveles.length - 1]];
  for (let i = 1; i < niveles.length; i++) {
    if (confianza < niveles[i]) {
      const [a, b] = [niveles[i - 1], niveles[i]];
      const t = (confianza - a) / (b - a);
      return Z[a] + t * (Z[b] - Z[a]);
    }
  }
  return 1.96;
}

/**
 * Margen de error de una proporción, con corrección por población finita.
 * Se usa p = 0,5 porque es el caso más exigente: cualquier otro valor da un
 * margen menor, así que el número que se informa es el peor caso.
 */
export function margenDeError(n: number, poblacion: number, confianza = 95): number {
  if (n <= 0) return 100;
  const z = zDe(confianza);
  const p = 0.5;
  const bruto = z * Math.sqrt((p * (1 - p)) / n);
  // corrección de población finita: con n grande frente a N el margen baja
  const correccion = poblacion > n ? Math.sqrt((poblacion - n) / (poblacion - 1)) : 0;
  return Number((100 * bruto * correccion).toFixed(2));
}

/** Cuántas entrevistas hacen falta para un margen objetivo, en una población dada. */
export function tamanoParaMargen(margenObjetivo: number, poblacion: number, confianza = 95): number {
  if (margenObjetivo <= 0) return poblacion;
  const z = zDe(confianza);
  const e = margenObjetivo / 100;
  const p = 0.5;
  const n0 = (z * z * p * (1 - p)) / (e * e);
  // ajuste por población finita
  const n = n0 / (1 + (n0 - 1) / Math.max(1, poblacion));
  return Math.min(poblacion, Math.ceil(n));
}

/**
 * Reparte `n` entrevistas entre los estratos de forma proporcional a su
 * población (afijación proporcional), garantizando un mínimo por estrato para
 * que ninguno quede sin representación.
 *
 * El reparto usa el método del resto mayor, que es el que evita que la suma de
 * los redondeos se desvíe del total pedido.
 */
export function disenarMuestra(
  estratos: Estrato[],
  opciones: { n?: number; margenObjetivo?: number; confianza?: number; minimoPorEstrato?: number },
): DisenoMuestral {
  const validos = estratos.filter((e) => e.electores > 0);
  if (validos.length === 0) throw new Error("no hay estratos con electores");
  const poblacion = validos.reduce((a, e) => a + e.electores, 0);
  const confianza = opciones.confianza ?? 95;
  const minimo = Math.max(0, opciones.minimoPorEstrato ?? 10);

  const nSugerido = opciones.margenObjetivo
    ? tamanoParaMargen(opciones.margenObjetivo, poblacion, confianza)
    : undefined;
  let n = Math.max(1, Math.round(opciones.n ?? nSugerido ?? 400));
  // el mínimo por estrato puede exigir más entrevistas que las pedidas
  const pisoTotal = minimo * validos.length;
  const avisos: string[] = [];
  if (n < pisoTotal) {
    avisos.push(
      `Con ${minimo} entrevistas mínimas por circuito y ${validos.length} circuitos, el total no puede bajar de ${pisoTotal}: se ajustó.`,
    );
    n = pisoTotal;
  }

  // reparto proporcional del excedente sobre el mínimo, por resto mayor
  const excedente = n - pisoTotal;
  const cuotas = validos.map((e) => (excedente * e.electores) / poblacion);
  const base = cuotas.map((c) => Math.floor(c));
  let faltan = excedente - base.reduce((a, x) => a + x, 0);
  const orden = cuotas
    .map((c, i) => ({ i, resto: c - Math.floor(c) }))
    .sort((a, b) => b.resto - a.resto);
  for (let k = 0; k < orden.length && faltan > 0; k++, faltan--) base[orden[k].i]++;

  const asignados: EstratoAsignado[] = validos.map((e, i) => {
    const entrevistas = minimo + base[i];
    const proporcionPoblacion = e.electores / poblacion;
    return {
      ...e,
      entrevistas,
      proporcionPoblacion,
      // peso = cuánto "vale" cada respuesta de este estrato al agregar
      peso: entrevistas > 0 ? Number(((proporcionPoblacion * n) / entrevistas).toFixed(3)) : 0,
    };
  });

  for (const a of asignados) {
    if (a.entrevistas < 30 && a.proporcionPoblacion > 0.03) {
      avisos.push(
        `${a.circuito} concentra ${(100 * a.proporcionPoblacion).toFixed(1)}% del padrón pero le tocan ${a.entrevistas} entrevistas: alcanza para el agregado, no para leer ese circuito solo.`,
      );
    }
  }

  return {
    estratos: asignados.sort((a, b) => b.entrevistas - a.entrevistas),
    n,
    poblacion,
    confianza,
    margen: margenDeError(n, poblacion, confianza),
    nSugerido,
    avisos,
  };
}

/**
 * Matriz de transferencia de votos entre dos elecciones (inferencia ecológica).
 *
 * EL PROBLEMA. Sabemos cuántos votos tuvo cada fuerza en 2023 y en 2025 en cada
 * circuito, pero el voto es secreto: nadie sabe qué hizo cada elector. Lo que sí
 * se puede estimar, mirando cómo se movieron juntos los agregados a lo largo de
 * los 47 circuitos, es la matriz de flujos: qué proporción de los votantes de
 * cada fuerza en 2023 fue a cada fuerza en 2025.
 *
 * EL MÉTODO. Es una regresión ecológica con restricciones (la familia de
 * Goodman). Para cada circuito c vale, aproximadamente:
 *
 *     V_j(c) ≈ Σ_i  p_ij · O_i(c)
 *
 * donde O_i(c) son los electores de origen i (incluida la abstención) y V_j(c)
 * los de destino j. Se busca la matriz P que minimiza el error cuadrático, con
 * dos restricciones que la hacen interpretable: p_ij ≥ 0 y Σ_j p_ij = 1 (todo
 * votante de origen i terminó en algún destino).
 *
 * Se resuelve por descenso de gradiente proyectado sobre el simplex, que para
 * un problema de este tamaño (≈8×8 con 47 observaciones) converge en
 * milisegundos y es determinístico.
 *
 * LA ADVERTENCIA, que hay que mostrar siempre. Esto es una ESTIMACIÓN sobre
 * datos agregados, sujeta a la falacia ecológica: la relación que se observa
 * entre circuitos no tiene por qué valer dentro de cada circuito. Sirve para
 * leer la dirección y el orden de magnitud de los flujos, no para afirmar
 * cuántas personas concretas hicieron cada cosa. El R² por destino dice cuánto
 * confiar en cada columna.
 */

export interface UnidadTransferencia {
  /** Nombre del territorio (un circuito). */
  unidad: string;
  /** Electores de cada origen. Deben sumar el padrón de la elección de origen. */
  origen: number[];
  /** Electores de cada destino. Deben sumar el padrón de la elección de destino. */
  destino: number[];
}

export interface FilaTransferencia {
  origen: string;
  /** Electores totales del origen, sumando todas las unidades. */
  total: number;
  /** Estimación de cuántos fueron a cada destino. */
  hacia: Array<{ destino: string; votos: number; pct: number }>;
}

export interface ResultadoTransferencia {
  filas: FilaTransferencia[];
  /** Matriz cruda de proporciones: matriz[i][j] = fracción del origen i que fue al destino j. */
  matriz: number[][];
  origenes: string[];
  destinos: string[];
  /** Bondad de ajuste por destino (1 = perfecto). Poco R² = esa columna no es confiable. */
  r2PorDestino: Array<{ destino: string; r2: number }>;
  /** Error medio absoluto en electores por unidad y destino, para dimensionar el ruido. */
  errorMedio: number;
  unidades: number;
  iteraciones: number;
}

/** Proyecta un vector sobre el simplex {x ≥ 0, Σx = 1} (algoritmo de Duchi et al.). */
function proyectarSimplex(v: number[]): number[] {
  const n = v.length;
  if (n === 0) return [];
  const orden = [...v].sort((a, b) => b - a);
  let suma = 0;
  let rho = 0;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    suma += orden[i];
    const t = (suma - 1) / (i + 1);
    if (orden[i] - t > 0) {
      rho = i + 1;
      theta = t;
    }
  }
  if (rho === 0) {
    // ningún componente sobrevive: reparto uniforme (caso degenerado)
    return new Array(n).fill(1 / n);
  }
  return v.map((x) => Math.max(0, x - theta));
}

/**
 * Estima la matriz de transferencia. `origenes` y `destinos` son las etiquetas;
 * cada unidad aporta sus vectores de electores.
 */
export function estimarTransferencia(
  origenes: string[],
  destinos: string[],
  unidades: UnidadTransferencia[],
  opciones?: { iteraciones?: number; tolerancia?: number },
): ResultadoTransferencia {
  const nO = origenes.length;
  const nD = destinos.length;
  if (nO === 0 || nD === 0) throw new Error("hacen falta orígenes y destinos");
  if (unidades.length < nO) {
    throw new Error(
      `con ${unidades.length} territorios no se pueden estimar ${nO} orígenes: agrupá los orígenes en menos bloques`,
    );
  }
  for (const u of unidades) {
    if (u.origen.length !== nO || u.destino.length !== nD) {
      throw new Error(`la unidad ${u.unidad} no tiene la cantidad de orígenes o destinos esperada`);
    }
  }

  /**
   * Los padrones de las dos elecciones no son iguales (el padrón crece). Se
   * escala el destino de cada unidad al total del origen para que la matriz
   * represente proporciones de la misma población; el crecimiento del padrón se
   * modela aparte, como origen "nuevos electores", cuando el llamador lo pasa.
   */
  const datos = unidades.map((u) => {
    const totO = u.origen.reduce((a, x) => a + x, 0);
    const totD = u.destino.reduce((a, x) => a + x, 0);
    const escala = totD > 0 ? totO / totD : 0;
    return { unidad: u.unidad, O: u.origen.slice(), V: u.destino.map((x) => x * escala), totO };
  });

  // Arranque: cada origen reparte según la estructura global de destinos, que es
  // un punto de partida neutral y mucho mejor que el uniforme.
  const totalDestino = new Array(nD).fill(0);
  let granTotal = 0;
  for (const d of datos) {
    for (let j = 0; j < nD; j++) totalDestino[j] += d.V[j];
    granTotal += d.totO;
  }
  const inicial = totalDestino.map((x) => (granTotal > 0 ? x / granTotal : 1 / nD));
  const P: number[][] = Array.from({ length: nO }, () => proyectarSimplex(inicial.slice()));

  // Escala de los datos, para que el paso del gradiente no dependa del tamaño
  // del padrón (si no, hay que re-tunear el learning rate por ciudad).
  let normaO = 0;
  for (const d of datos) for (const o of d.O) normaO += o * o;
  const paso = normaO > 0 ? 1 / normaO : 1;

  const maxIter = opciones?.iteraciones ?? 4000;
  const tol = opciones?.tolerancia ?? 1e-12;
  let iter = 0;
  let errorPrevio = Infinity;

  for (; iter < maxIter; iter++) {
    // gradiente de ½·Σ‖O·P − V‖²  →  Oᵀ·(O·P − V)
    const grad: number[][] = Array.from({ length: nO }, () => new Array(nD).fill(0));
    let error = 0;
    for (const d of datos) {
      for (let j = 0; j < nD; j++) {
        let pred = 0;
        for (let i = 0; i < nO; i++) pred += d.O[i] * P[i][j];
        const r = pred - d.V[j];
        error += r * r;
        for (let i = 0; i < nO; i++) grad[i][j] += d.O[i] * r;
      }
    }
    if (Math.abs(errorPrevio - error) < tol * Math.max(1, error)) break;
    errorPrevio = error;
    for (let i = 0; i < nO; i++) {
      P[i] = proyectarSimplex(P[i].map((p, j) => p - paso * grad[i][j]));
    }
  }

  // ── Diagnóstico: R² por destino y error medio ──
  const r2PorDestino: Array<{ destino: string; r2: number }> = [];
  let sumaAbs = 0;
  let nObs = 0;
  for (let j = 0; j < nD; j++) {
    let ssRes = 0;
    let ssTot = 0;
    const media = datos.reduce((a, d) => a + d.V[j], 0) / Math.max(1, datos.length);
    for (const d of datos) {
      let pred = 0;
      for (let i = 0; i < nO; i++) pred += d.O[i] * P[i][j];
      ssRes += (pred - d.V[j]) ** 2;
      ssTot += (d.V[j] - media) ** 2;
      sumaAbs += Math.abs(pred - d.V[j]);
      nObs++;
    }
    r2PorDestino.push({
      destino: destinos[j],
      r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1,
    });
  }

  const totalesOrigen = new Array(nO).fill(0);
  for (const d of datos) for (let i = 0; i < nO; i++) totalesOrigen[i] += d.O[i];

  const filas: FilaTransferencia[] = origenes.map((nombre, i) => ({
    origen: nombre,
    total: Math.round(totalesOrigen[i]),
    hacia: destinos
      .map((dn, j) => ({
        destino: dn,
        votos: Math.round(totalesOrigen[i] * P[i][j]),
        pct: Number((100 * P[i][j]).toFixed(1)),
      }))
      .sort((a, b) => b.votos - a.votos),
  }));

  return {
    filas,
    matriz: P,
    origenes,
    destinos,
    r2PorDestino,
    errorMedio: nObs > 0 ? sumaAbs / nObs : 0,
    unidades: datos.length,
    iteraciones: iter,
  };
}

/**
 * Lee la matriz en prosa: de dónde salió y a dónde se fue lo que importa.
 * Devuelve las frases más relevantes, listas para mostrar.
 */
export function leerTransferencia(
  r: ResultadoTransferencia,
  opciones?: { minPct?: number; maxFrases?: number },
): string[] {
  const minPct = opciones?.minPct ?? 8;
  const frases: string[] = [];
  for (const fila of r.filas) {
    if (fila.total === 0) continue;
    const fuga = fila.hacia.filter((h) => h.destino !== fila.origen && h.pct >= minPct);
    const retiene = fila.hacia.find((h) => h.destino === fila.origen);
    if (retiene) {
      frases.push(
        `${fila.origen} retiene ${retiene.pct}% de sus ${fila.total.toLocaleString("es-AR")} votantes` +
          (fuga.length > 0
            ? `; se le van ${fuga.map((f) => `${f.pct}% a ${f.destino}`).join(" y ")}`
            : ""),
      );
    } else if (fuga.length > 0) {
      frases.push(
        `${fila.origen} (${fila.total.toLocaleString("es-AR")}) se reparte: ${fuga
          .map((f) => `${f.pct}% a ${f.destino}`)
          .join(", ")}`,
      );
    }
  }
  return frases.slice(0, opciones?.maxFrases ?? 8);
}

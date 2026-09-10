/**
 * Reparto de bancas por sistema D'Hondt + cálculo de piso y techo electoral.
 *
 * D'Hondt: para cada lista se calculan los cocientes votos/1, votos/2, …,
 * votos/N (N = bancas en juego); se ordenan TODOS los cocientes de mayor a
 * menor y las N bancas van a los N cocientes más altos.
 *
 * Nada de esto depende de la base: son funciones puras, testeables y usables
 * tanto para el escrutinio real como para escenarios hipotéticos.
 */

export interface ListaVotos {
  id: number | string;
  nombre: string;
  votos: number;
  /** Espacio político al que pertenece (para simular listas unidas). */
  espacio?: string;
}

export interface OpcionesReparto {
  /** Bancas en juego. */
  bancas: number;
  /** Umbral legal opcional, en % sobre la base elegida. */
  pisoPct?: number;
  /** Sobre qué se calcula el umbral: votos válidos del escrutinio o padrón. */
  basePiso?: "validos" | "padron";
  /** Padrón, necesario si basePiso = 'padron'. */
  padron?: number;
}

export interface BancaAsignada {
  id: number | string;
  nombre: string;
  /** Cociente que ganó esta banca (votos ÷ divisor). */
  cociente: number;
  divisor: number;
  /** Orden en que se asignó (1 = primera banca del reparto). */
  orden: number;
}

export interface ResultadoReparto {
  /** Bancas por lista, ordenadas de mayor a menor. */
  porLista: Array<{
    id: number | string;
    nombre: string;
    votos: number;
    pct: number;
    bancas: number;
    /** Votos que le faltaron para la banca siguiente (0 si no aplica). */
    faltanParaLaSiguiente: number;
    excluidaPorPiso: boolean;
  }>;
  /** Secuencia de asignación, útil para mostrar "la última banca se definió por…". */
  secuencia: BancaAsignada[];
  /** Cociente de la última banca asignada = piso EFECTIVO del reparto. */
  cocienteUltimaBanca: number;
  /**
   * Votos mínimos que una lista nueva habría necesitado para arrebatar la
   * última banca (el "precio" real de entrar, más útil que el umbral legal).
   */
  votosParaEntrar: number;
  votosValidos: number;
  /** Umbral legal aplicado, si se pidió. */
  piso: { pct: number; votos: number; excluidas: number } | null;
}

/** Reparte `bancas` entre `listas` por D'Hondt. */
export function repartirDHondt(listas: ListaVotos[], opciones: OpcionesReparto): ResultadoReparto {
  const bancas = Math.max(0, Math.floor(opciones.bancas));
  const votosValidos = listas.reduce((a, l) => a + Math.max(0, l.votos), 0);

  // Umbral legal (si corresponde): las listas por debajo no participan del reparto
  let piso: ResultadoReparto["piso"] = null;
  let participan = listas.filter((l) => l.votos > 0);
  if (opciones.pisoPct && opciones.pisoPct > 0) {
    const base = opciones.basePiso === "padron" ? (opciones.padron ?? 0) : votosValidos;
    const votosPiso = Math.ceil((opciones.pisoPct / 100) * base);
    const antes = participan.length;
    participan = participan.filter((l) => l.votos >= votosPiso);
    piso = { pct: opciones.pisoPct, votos: votosPiso, excluidas: antes - participan.length };
  }
  const excluidas = new Set(
    listas.filter((l) => !participan.some((p) => p.id === l.id)).map((l) => l.id),
  );

  // Todos los cocientes, ordenados de mayor a menor
  const cocientes: Array<{ lista: ListaVotos; divisor: number; valor: number }> = [];
  for (const l of participan) {
    for (let d = 1; d <= bancas; d++) cocientes.push({ lista: l, divisor: d, valor: l.votos / d });
  }
  // Empate de cocientes: gana la lista con más votos (criterio habitual);
  // si también empatan los votos, queda determinista por id para no variar
  // entre ejecuciones.
  cocientes.sort(
    (a, b) =>
      b.valor - a.valor ||
      b.lista.votos - a.lista.votos ||
      String(a.lista.id).localeCompare(String(b.lista.id)),
  );

  const ganadores = cocientes.slice(0, bancas);
  const secuencia: BancaAsignada[] = ganadores.map((g, i) => ({
    id: g.lista.id,
    nombre: g.lista.nombre,
    cociente: g.valor,
    divisor: g.divisor,
    orden: i + 1,
  }));

  const bancasPorLista = new Map<number | string, number>();
  for (const g of ganadores) bancasPorLista.set(g.lista.id, (bancasPorLista.get(g.lista.id) ?? 0) + 1);

  const cocienteUltimaBanca = ganadores.length > 0 ? ganadores[ganadores.length - 1].valor : 0;
  // Para arrebatar la última banca hay que superar su cociente con divisor 1
  const votosParaEntrar = ganadores.length > 0 ? Math.floor(cocienteUltimaBanca) + 1 : 0;

  const porLista = listas
    .map((l) => {
      const b = bancasPorLista.get(l.id) ?? 0;
      // Votos necesarios para que su cociente con divisor b+1 supere el de la última banca
      const objetivo = cocienteUltimaBanca * (b + 1);
      const faltan = excluidas.has(l.id) ? 0 : Math.max(0, Math.ceil(objetivo) + 1 - l.votos);
      return {
        id: l.id,
        nombre: l.nombre,
        votos: l.votos,
        pct: votosValidos > 0 ? Math.round((10000 * l.votos) / votosValidos) / 100 : 0,
        bancas: b,
        faltanParaLaSiguiente: faltan,
        excluidaPorPiso: excluidas.has(l.id),
      };
    })
    .sort((a, b) => b.bancas - a.bancas || b.votos - a.votos);

  return { porLista, secuencia, cocienteUltimaBanca, votosParaEntrar, votosValidos, piso };
}

/**
 * Simula unir varias listas en una sola (el caso "los acoples van juntos" o
 * "las listas sin banca se unifican") y devuelve el reparto resultante.
 */
export function repartirConFusion(
  listas: ListaVotos[],
  idsAUnir: Array<number | string>,
  nombreUnion: string,
  opciones: OpcionesReparto,
): ResultadoReparto {
  const set = new Set(idsAUnir.map(String));
  const aUnir = listas.filter((l) => set.has(String(l.id)));
  if (aUnir.length === 0) return repartirDHondt(listas, opciones);
  const resto = listas.filter((l) => !set.has(String(l.id)));
  const union: ListaVotos = {
    id: "__union__",
    nombre: nombreUnion,
    votos: aUnir.reduce((a, l) => a + l.votos, 0),
  };
  return repartirDHondt([...resto, union], opciones);
}

/** Agrupa las listas por espacio político (para ver el reparto si cada espacio fuera una sola lista). */
export function agruparPorEspacio(listas: ListaVotos[]): ListaVotos[] {
  const mapa = new Map<string, ListaVotos>();
  for (const l of listas) {
    const k = l.espacio ?? String(l.id);
    const acum = mapa.get(k);
    if (acum) acum.votos += l.votos;
    else mapa.set(k, { id: k, nombre: k, votos: l.votos, espacio: k });
  }
  return [...mapa.values()].sort((a, b) => b.votos - a.votos);
}

/**
 * Techo electoral: cuántas bancas obtendría una lista con X votos, dejando
 * el resto del escenario igual. Sirve para responder "con 20.000 votos,
 * ¿cuántas bancas saco?".
 */
export function bancasConVotos(
  listas: ListaVotos[],
  idLista: number | string,
  votosHipoteticos: number,
  opciones: OpcionesReparto,
): number {
  const existe = listas.some((l) => String(l.id) === String(idLista));
  const escenario: ListaVotos[] = existe
    ? listas.map((l) => (String(l.id) === String(idLista) ? { ...l, votos: votosHipoteticos } : l))
    : [...listas, { id: idLista, nombre: String(idLista), votos: votosHipoteticos }];
  const r = repartirDHondt(escenario, opciones);
  return r.porLista.find((l) => String(l.id) === String(idLista))?.bancas ?? 0;
}

/**
 * Curva de bancas: para una lista, cuántos votos necesita para 1, 2, 3… bancas.
 * Búsqueda binaria sobre bancasConVotos (monótona: más votos nunca dan menos
 * bancas si el resto queda igual).
 */
export function curvaDeBancas(
  listas: ListaVotos[],
  idLista: number | string,
  opciones: OpcionesReparto,
  hastaBancas = 5,
): Array<{ bancas: number; votosNecesarios: number }> {
  const total = listas.reduce((a, l) => a + l.votos, 0);
  const techo = Math.max(total, 1) * 2;
  const salida: Array<{ bancas: number; votosNecesarios: number }> = [];
  for (let objetivo = 1; objetivo <= Math.min(hastaBancas, opciones.bancas); objetivo++) {
    let lo = 0;
    let hi = techo;
    if (bancasConVotos(listas, idLista, hi, opciones) < objetivo) break;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (bancasConVotos(listas, idLista, mid, opciones) >= objetivo) hi = mid;
      else lo = mid + 1;
    }
    salida.push({ bancas: objetivo, votosNecesarios: lo });
  }
  return salida;
}

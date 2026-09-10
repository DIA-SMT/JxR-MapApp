import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CODIGOS, esEspacioValido, etiquetaEspacio } from "./espacios";
import { META_VOTOS, resolverSeleccion } from "./estrategia";
import type { AccionMapaElena, Asignacion, Tarea, TipoEspacio } from "./tipos";
import cruceBarrios from "./datos/barrios-circuitos.json";

/**
 * Elena — asistente del comando territorial JxR. Responde consultando los
 * datos REALES del operativo con herramientas parametrizadas de solo lectura
 * (corren con la sesión RLS del usuario) y puede accionar el mapa.
 */

export const HERRAMIENTAS_ELENA = [
  {
    type: "function",
    function: {
      name: "resumen_general",
      description:
        "Panorama del operativo: personas cargadas, distritos y circuitos cubiertos (de 20 y 47), asignaciones y avance del checklist de tareas.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_persona",
      description:
        "Busca personas del operativo por nombre, documento (DNI), teléfono o email, con sus espacios asignados y avance de tareas.",
      parameters: {
        type: "object",
        properties: { texto: { type: "string", description: "Texto a buscar (ej: 'gómez' o un DNI)" } },
        required: ["texto"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estado_espacio",
      description:
        "Estado de un distrito (1–20) o circuito (1, 1A, 15B, 18G…): quiénes lo tienen asignado, con qué rol y cómo viene su checklist.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["distrito", "circuito"] },
          codigo: { type: "string", description: "'7' para distrito 7, '15B' para circuito 15B" },
        },
        required: ["tipo", "codigo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "espacios_sin_cobertura",
      description: "Lista los distritos o circuitos que todavía no tienen ninguna persona asignada.",
      parameters: {
        type: "object",
        properties: { tipo: { type: "string", enum: ["distrito", "circuito"] } },
        required: ["tipo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tareas_pendientes",
      description: "Tareas del checklist aún no hechas, con su responsable y espacio (las más viejas primero).",
      parameters: {
        type: "object",
        properties: { limite: { type: "number", description: "máx 20" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estadisticas_padron",
      description:
        "Panorama del padrón electoral de la Capital: total de electores, por sexo, franjas etarias ESTIMADAS por rango de DNI, mesas y escuelas.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "padron_circuito",
      description:
        "Padrón de un circuito: electores, sexo, franjas etarias estimadas y sus escuelas de votación con cantidad de electores y mesas.",
      parameters: {
        type: "object",
        properties: { codigo: { type: "string", description: "'15B', '7', '18G'…" } },
        required: ["codigo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "donde_vota",
      description:
        "LOGÍSTICA/SOPORTE: busca a una persona en el padrón por apellido/nombre o DNI y devuelve dónde vota (escuela, mesa, orden, circuito). Máx 8 resultados.",
      parameters: {
        type: "object",
        properties: { texto: { type: "string", description: "Apellido, nombre o DNI" } },
        required: ["texto"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ranking_circuitos_padron",
      description: "Circuitos ordenados por cantidad de electores (dónde se concentra el padrón).",
      parameters: {
        type: "object",
        properties: { limite: { type: "number", description: "máx 47" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "segmento_padron",
      description:
        "Microsegmentación: cuenta electores combinando sexo, franja etaria estimada y circuitos específicos. Ej: '¿cuántas mujeres de 16 a 25 hay en el 15B y el 20?'",
      parameters: {
        type: "object",
        properties: {
          sexo: { type: "string", enum: ["F", "M"] },
          edad_min: { type: "number" },
          edad_max: { type: "number" },
          circuitos: { type: "array", items: { type: "string" }, description: "['15B','20']; omitir para toda la ciudad" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listas_2023",
      description:
        "Resultados 2023 (escrutinio definitivo, Capital): ranking de listas de una categoría con sus votos totales.",
      parameters: {
        type: "object",
        properties: {
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] },
        },
        required: ["categoria"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "votos_escuelas_2023",
      description:
        "Estrategia voto disperso: votos 2023 de un conjunto de listas agrupados por ESCUELA, con filtro de umbral (ej: escuelas donde el peronismo disperso sacó entre 150 y 300 votos). Si no se pasan listas usa la preselección de peronismo disperso sin banca.",
      parameters: {
        type: "object",
        properties: {
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] },
          listas: { type: "array", items: { type: "number" }, description: "Números de lista; omitir para usar la preselección" },
          min: { type: "number", description: "Votos mínimos por escuela (default 100)" },
          max: { type: "number", description: "Votos máximos por escuela (opcional)" },
          limite: { type: "number", description: "máx 30" },
        },
        required: ["categoria"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "frontera_20k",
      description:
        "Frontera 20K: ranking de prioridad territorial escuela por escuela (score = volumen de voto disperso + propensión + descubierto de cobertura), el conjunto mínimo de escuelas que suma la meta, y los votos huérfanos (dispersos sin referente). Usala para '¿dónde actuamos primero?'",
      parameters: {
        type: "object",
        properties: {
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"], description: "default CONCEJAL" },
          limite: { type: "number", description: "escuelas del top a mostrar, máx 25" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estado_estrategia",
      description:
        "Avance del universo de la estrategia: cuántas escuelas están marcadas para trabajar y cuántos votos dispersos suman contra la meta de 20.000.",
      parameters: {
        type: "object",
        properties: {
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"], description: "default CONCEJAL" },
        },
      },
    },
  },
  // ── Análisis electoral estratégico (2023 definitivo + 2025 provisorio) ──
  {
    type: "function",
    function: {
      name: "listas_eleccion",
      description:
        "Ranking de listas/agrupaciones de una elección con votos totales y %. eleccion '2023' (Gobernador/Legislador/Intendente/Concejal, definitivo) o '2025' (Diputado Nacional, provisorio). Usala para conocer los números de lista antes de otros análisis.",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"], description: "solo 2023; default CONCEJAL" },
        },
        required: ["eleccion"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ganadores_espacios",
      description:
        "Qué lista GANÓ en cada mesa/escuela/circuito, con el segundo y la diferencia. orden 'competitivo' = los espacios más peleados primero (para detectar dónde se define por pocos votos); orden 'votos' = los más grandes primero.",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"], description: "solo 2023" },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"], description: "2025 no tiene nivel escuela" },
          orden: { type: "string", enum: ["competitivo", "votos"] },
          limite: { type: "number", description: "máx 40" },
        },
        required: ["eleccion", "nivel"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ranking_espacio",
      description:
        "Ranking completo de listas DENTRO de una mesa, escuela o circuito concreto ('cómo dio la mesa 214', 'ranking del circuito 15B en 2025').",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"] },
          codigo: { type: "string", description: "'214' (mesa), nombre exacto de la escuela, o '15B' (circuito)" },
        },
        required: ["eleccion", "nivel", "codigo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "desempeno_lista",
      description:
        "Rendimiento de UNA lista espacio por espacio: votos, %, posición y desvío contra su promedio general — dónde rinde por encima o por debajo, sus mejores y peores mesas/escuelas/circuitos.",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] },
          lista: { type: "number", description: "número de lista (2023) o id de agrupación (2025, ver listas_eleccion)" },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"] },
          orden: { type: "string", enum: ["mejores", "peores"], description: "default mejores" },
          limite: { type: "number", description: "máx 25" },
        },
        required: ["eleccion", "lista"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "voto_blanco",
      description:
        "Voto en blanco por mesa/escuela/circuito y por cargo (2023 tiene los 4 cargos: sirve para comparar blancos entre Intendente/Concejal/Legislador en el mismo lugar). Ordenado de mayor a menor % de blanco.",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"] },
          limite: { type: "number", description: "máx 30 espacios" },
        },
        required: ["eleccion", "nivel"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "corte_boleta",
      description:
        "CORTE DE BOLETA 2023 (4 cargos simultáneos): sin lista → resumen de todas las listas (votos por cargo, cuál arrastra y cuál pierde, % de retención); con lista → el corte de ESA lista espacio por espacio (dónde el elector la votó en un cargo y la cortó en otro). Retención baja = mucho corte; el candidato con más votos que su lista en otros cargos tiene voto personal.",
      parameters: {
        type: "object",
        properties: {
          lista: { type: "number", description: "número de lista 2023; omitir para el resumen general" },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"], description: "solo con lista; default escuela" },
          limite: { type: "number", description: "máx 25" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "oportunidades",
      description:
        "OPORTUNIDADES: mesas/escuelas/circuitos donde una lista PERDIÓ por menos de N votos (atacables con pocos votos) o GANÓ por menos de N (a defender). Incluye votos necesarios, blancos y ausentes de cada espacio (la bolsa de crecimiento).",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] },
          lista: { type: "number" },
          margen: { type: "number", description: "diferencia máxima de votos (default 100; usá 50 para 'muy cerca')" },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"], description: "default mesa" },
          limite: { type: "number", description: "máx 30" },
        },
        required: ["eleccion", "lista"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "potencial_electoral",
      description:
        "ÍNDICE DE POTENCIAL ELECTORAL (IPE 0-100) de una lista por mesa/escuela/circuito: combina cercanía al líder (30%), bolsa de crecimiento —blancos+ausentes— (25%), rendimiento relativo (20%), volumen propio (15%) y competitividad del espacio (10%). Devuelve tier (muy alto/alto/medio/bajo), clasificación territorial (fuerte/competitivo/potencial/débil) y las razones. ES la herramienta para '¿dónde están las mayores oportunidades de crecimiento?'",
      parameters: {
        type: "object",
        properties: {
          eleccion: { type: "string", enum: ["2023", "2025"] },
          categoria: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"] },
          lista: { type: "number" },
          nivel: { type: "string", enum: ["mesa", "escuela", "circuito"], description: "default escuela (2025: mesa o circuito)" },
          limite: { type: "number", description: "máx 25" },
        },
        required: ["eleccion", "lista"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "comparar_2023_2025",
      description:
        "Comparación 2023 ↔ 2025 por CIRCUITO (crecimiento, caída, migración de votos): % de una lista 2023 vs % de una agrupación 2025 en cada circuito, con participación y blancos de ambas. OJO: las mesas nacionales 2025 no se cruzan con las provinciales 2023 — la comparación válida es por circuito.",
      parameters: {
        type: "object",
        properties: {
          lista_2023: { type: "number", description: "número de lista 2023" },
          lista_2025: { type: "number", description: "id de agrupación 2025 (ver listas_eleccion 2025)" },
          categoria_2023: { type: "string", enum: ["CONCEJAL", "LEGISLADOR", "INTENDENTE", "GOBERNADOR"], description: "default CONCEJAL" },
        },
        required: ["lista_2023", "lista_2025"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perfil_social",
      description:
        "PERFIL SOCIAL de un circuito, un barrio o toda la ciudad (Censo 2022 del INDEC por radio censal): población y edades, pobreza (NBI, privación, hacinamiento), servicios (sin cloaca, sin agua de red), TRABAJO (ocupados, desocupados y tasa, relación de dependencia, cuenta propia, servicio doméstico, empleo público, comercio, construcción), educación y cobertura de salud. Usala para cruzar el voto con el contexto social: qué perfil tiene la gente que vive en una zona y qué demandas es razonable que tenga. Compará siempre contra la ciudad (nivel 'ciudad') para saber si la zona está mejor o peor que el promedio.",
      parameters: {
        type: "object",
        properties: {
          nivel: { type: "string", enum: ["circuito", "barrio", "ciudad"] },
          codigo: { type: "string", description: "'15B' para circuito, el nombre para barrio; omitir con nivel ciudad" },
        },
        required: ["nivel"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ranking_social",
      description:
        "Ranking de circuitos o barrios por un indicador social del Censo 2022: dónde hay más NBI, más hacinamiento, más desocupación, más hogares sin cloaca, peor clima educativo, más gente sin cobertura de salud o más adultos mayores. Sirve para priorizar territorio por necesidad y para elegir el mensaje adecuado a cada zona.",
      parameters: {
        type: "object",
        properties: {
          nivel: { type: "string", enum: ["circuito", "barrio"] },
          indicador: {
            type: "string",
            enum: ["pct_nbi", "pct_privacion", "pct_hacinamiento", "pct_sin_cloaca", "tasa_desocupacion", "pct_clima_educativo_bajo", "pct_sin_cobertura", "pct_65_y_mas"],
          },
          limite: { type: "number", description: "máx 25" },
        },
        required: ["nivel", "indicador"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "barrios",
      description:
        "Cruce BARRIO ↔ CIRCUITO (mapa oficial municipal, 327 barrios): con barrio → a qué circuito(s) pertenece y en qué proporción; con circuito → qué barrios lo componen. Sirve para traducir el análisis electoral a territorio concreto.",
      parameters: {
        type: "object",
        properties: {
          barrio: { type: "string", description: "nombre (o parte) del barrio, ej 'Ciudadela'" },
          circuito: { type: "string", description: "código de circuito, ej '15B'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ficha_territorial",
      description:
        "PLAN TERRITORIAL del equipo: la ficha operativa de cada circuito o barrio (segmento prioritario, problemática principal, mensaje, propuesta, estrategia de abordaje y si está validada). Con codigo → esa ficha; sin codigo → todas las fichas cargadas (para saber qué territorios ya tienen plan y cuáles faltan). El equipo la edita desde el panel del circuito en el mapa.",
      parameters: {
        type: "object",
        properties: {
          nivel: { type: "string", enum: ["circuito", "barrio"], description: "default circuito" },
          codigo: { type: "string", description: "'15B' para circuito, el nombre para barrio; omitir para listar todas" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mostrar_en_mapa",
      description:
        "Acción VISUAL avanzada: lleva TU ANÁLISIS al mapa. modo 'resaltar' = marca un conjunto de circuitos (ej: los 5 de mayor oportunidad) con una etiqueta corta; modo 'pintar' = coropleta con un valor numérico por circuito que vos calculaste (votos, %, delta 2023→2025, IPE…) con la etiqueta de qué representa (admite negativos: se pintan en rojo/verde); modo 'barrio' = resalta un barrio oficial. Usala DESPUÉS de consultar los datos, con los valores obtenidos, cuando pidan ver/pintar/marcar un análisis en el mapa — y siempre que el resultado sea un conjunto de circuitos, porque verlo pintado vale más que leerlo.",
      parameters: {
        type: "object",
        properties: {
          modo: { type: "string", enum: ["resaltar", "pintar", "barrio"] },
          circuitos: { type: "array", items: { type: "string" }, description: "modo resaltar: códigos de circuito, ej ['13','15B','20']" },
          valores: {
            type: "array",
            items: {
              type: "object",
              properties: { circuito: { type: "string" }, valor: { type: "number" } },
              required: ["circuito", "valor"],
            },
            description: "modo pintar: un valor numérico por circuito",
          },
          etiqueta: { type: "string", description: "qué representa lo mostrado, corto (ej 'Δ pts 2023→2025 LLA', 'blancos 2025')" },
          barrio: { type: "string", description: "modo barrio: nombre exacto del barrio oficial" },
        },
        required: ["modo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "accionar_mapa",
      description:
        "Acción VISUAL: selecciona y encuadra un distrito o circuito en el mapa (si el usuario no está en el mapa, la app lo lleva sola). Usala cuando pidan VER algo ('mostrame el circuito 15B', 'llevame al distrito 7').",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["distrito", "circuito"] },
          codigo: { type: "string" },
        },
        required: ["tipo", "codigo"],
      },
    },
  },
] as const;

const lim = (n: unknown, def = 10, max = 20) =>
  Math.min(max, Math.max(1, Number.isFinite(Number(n)) ? Number(n) : def));

/**
 * Valida los argumentos de mostrar_en_mapa y los convierte en una acción
 * tipada (o null si no hay nada mostrable). La usa la ruta del chat para
 * decidir qué viaja al navegador, y la herramienta para responderle al modelo.
 */
export function validarAccionMapaElena(args: Record<string, unknown>): AccionMapaElena | null {
  const modo = String(args.modo ?? "");
  const etiqueta = typeof args.etiqueta === "string" ? args.etiqueta.trim().slice(0, 60) : "";
  if (modo === "barrio") {
    const barrio = typeof args.barrio === "string" ? args.barrio.trim() : "";
    return barrio ? { modo: "barrio", barrio } : null;
  }
  if (modo === "resaltar") {
    const circuitos = Array.isArray(args.circuitos)
      ? [...new Set((args.circuitos as unknown[]).map((c) => String(c).toUpperCase().trim()).filter((c) => esEspacioValido("circuito", c)))]
      : [];
    return circuitos.length > 0 ? { modo: "resaltar", circuitos: circuitos.slice(0, 47), etiqueta: etiqueta || "señalados por Elena" } : null;
  }
  if (modo === "pintar") {
    const vistos = new Set<string>();
    const valores = (Array.isArray(args.valores) ? (args.valores as Array<Record<string, unknown>>) : [])
      .map((v) => ({ circuito: String(v?.circuito ?? "").toUpperCase().trim(), valor: Number(v?.valor) }))
      .filter((v) => {
        if (!esEspacioValido("circuito", v.circuito) || !Number.isFinite(v.valor) || vistos.has(v.circuito)) return false;
        vistos.add(v.circuito);
        return true;
      })
      .slice(0, 47);
    return valores.length > 0 && etiqueta ? { modo: "pintar", etiqueta, valores } : null;
  }
  return null;
}

type Supabase = SupabaseClient;

async function cargarOperativo(supabase: Supabase) {
  const [a, t] = await Promise.all([
    supabase
      .from("asignaciones")
      .select("id, persona_id, tipo, codigo, rol_asignacion, personas (id, nombre, documento, direccion, telefono, email, notas)"),
    supabase.from("tareas").select("id, asignacion_id, titulo, hecha, hecha_en"),
  ]);
  return {
    asignaciones: (a.data as unknown as Asignacion[]) ?? [],
    tareas: (t.data as Tarea[]) ?? [],
  };
}

const avancePorAsignacion = (tareas: Tarea[]) => {
  const mapa = new Map<number, { hechas: number; total: number; pendientes: string[] }>();
  for (const t of tareas) {
    const r = mapa.get(t.asignacion_id) ?? { hechas: 0, total: 0, pendientes: [] };
    r.total++;
    if (t.hecha) r.hechas++;
    else r.pendientes.push(t.titulo);
    mapa.set(t.asignacion_id, r);
  }
  return mapa;
};

export async function ejecutarHerramientaElena(
  supabase: Supabase,
  nombre: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (nombre) {
    case "resumen_general": {
      const [{ count: nPersonas }, { asignaciones, tareas }] = await Promise.all([
        supabase.from("personas").select("id", { count: "exact", head: true }),
        cargarOperativo(supabase),
      ]);
      const cubiertos = { distrito: new Set<string>(), circuito: new Set<string>() };
      for (const a of asignaciones) cubiertos[a.tipo].add(a.codigo);
      const hechas = tareas.filter((t) => t.hecha).length;
      return {
        personas_cargadas: nPersonas ?? 0,
        personas_con_espacio: new Set(asignaciones.map((a) => a.persona_id)).size,
        asignaciones_totales: asignaciones.length,
        distritos_cubiertos: `${cubiertos.distrito.size} de 20`,
        circuitos_cubiertos: `${cubiertos.circuito.size} de 47`,
        tareas: { total: tareas.length, hechas, pendientes: tareas.length - hechas },
      };
    }

    case "buscar_persona": {
      const texto = typeof args.texto === "string" ? args.texto.trim().slice(0, 60) : "";
      if (!texto) return { error: "texto vacío" };
      // PostgREST usa comas/paréntesis como sintaxis del filtro: sanear antes de interpolar
      const patron = `%${texto.replace(/[,()"\\]/g, " ").trim()}%`;
      const { data: personas, error: errorBusqueda } = await supabase
        .from("personas")
        .select("id, nombre, documento, direccion, telefono, email, notas")
        .or(`nombre.ilike.${patron},documento.ilike.${patron},telefono.ilike.${patron},email.ilike.${patron}`)
        .limit(8);
      if (errorBusqueda) return { error: `la búsqueda falló: ${errorBusqueda.message}` };
      if (!personas || personas.length === 0) return { resultado: "ninguna persona coincide" };
      const { asignaciones, tareas } = await cargarOperativo(supabase);
      const avance = avancePorAsignacion(tareas);
      return personas.map((p) => ({
        ...p,
        espacios: asignaciones
          .filter((a) => a.persona_id === p.id)
          .map((a) => {
            const r = avance.get(a.id);
            return {
              espacio: etiquetaEspacio(a.tipo, a.codigo),
              rol: a.rol_asignacion,
              tareas: r ? `${r.hechas}/${r.total} hechas` : "sin tareas",
              pendientes: r?.pendientes ?? [],
            };
          }),
      }));
    }

    case "estado_espacio": {
      const tipo = args.tipo as TipoEspacio;
      const codigo = String(args.codigo ?? "").toUpperCase().trim();
      if (!esEspacioValido(tipo, codigo)) {
        return { error: `no existe ${String(args.tipo)} ${codigo}. Distritos: 1–20. Circuitos: ${CODIGOS.circuito.join(", ")}` };
      }
      const { asignaciones, tareas } = await cargarOperativo(supabase);
      const propias = asignaciones.filter((a) => a.tipo === tipo && a.codigo === codigo);
      if (propias.length === 0) return { espacio: etiquetaEspacio(tipo, codigo), estado: "sin asignar" };
      const avance = avancePorAsignacion(tareas);
      return {
        espacio: etiquetaEspacio(tipo, codigo),
        personas: propias.map((a) => {
          const r = avance.get(a.id);
          return {
            nombre: a.personas?.nombre,
            documento: a.personas?.documento,
            telefono: a.personas?.telefono,
            rol: a.rol_asignacion,
            tareas_hechas: r?.hechas ?? 0,
            tareas_totales: r?.total ?? 0,
            pendientes: r?.pendientes ?? [],
          };
        }),
      };
    }

    case "espacios_sin_cobertura": {
      const tipo = args.tipo as TipoEspacio;
      if (tipo !== "distrito" && tipo !== "circuito") return { error: "tipo inválido" };
      const { data } = await supabase.from("asignaciones").select("codigo").eq("tipo", tipo);
      const cubiertos = new Set((data ?? []).map((r) => r.codigo as string));
      const faltan = CODIGOS[tipo].filter((c) => !cubiertos.has(c));
      return {
        tipo,
        total: CODIGOS[tipo].length,
        cubiertos: cubiertos.size,
        sin_cobertura: faltan.length,
        codigos_sin_cobertura: faltan,
      };
    }

    case "tareas_pendientes": {
      const { data } = await supabase
        .from("tareas")
        .select("id, titulo, creado_en, asignaciones (tipo, codigo, rol_asignacion, personas (nombre))")
        .eq("hecha", false)
        .order("creado_en")
        .limit(lim(args.limite));
      type Fila = {
        id: number;
        titulo: string;
        creado_en: string;
        asignaciones: { tipo: TipoEspacio; codigo: string; rol_asignacion: string | null; personas: { nombre: string } | null } | null;
      };
      return ((data as unknown as Fila[]) ?? []).map((t) => ({
        tarea: t.titulo,
        responsable: t.asignaciones?.personas?.nombre ?? "?",
        espacio: t.asignaciones ? etiquetaEspacio(t.asignaciones.tipo, t.asignaciones.codigo) : "?",
        creada: t.creado_en?.slice(0, 10),
      }));
    }

    case "estadisticas_padron": {
      const { data, error } = await supabase.rpc("padron_resumen");
      return error ? { error: error.message } : { ...data, nota: "franjas etarias ESTIMADAS por rango de DNI (aprox ±3 años)" };
    }

    case "padron_circuito": {
      const codigo = String(args.codigo ?? "").toUpperCase().trim();
      if (!esEspacioValido("circuito", codigo)) return { error: `no existe el circuito ${codigo}` };
      const { data, error } = await supabase.rpc("padron_de_circuito", { p_circuito: codigo });
      return error ? { error: error.message } : data;
    }

    case "donde_vota": {
      const texto = typeof args.texto === "string" ? args.texto.trim().slice(0, 60) : "";
      if (texto.length < 3) return { error: "escribí al menos 3 caracteres (apellido o DNI)" };
      const { data, error } = await supabase.rpc("buscar_electores", { q: texto, p_circuito: null, p_limite: 8 });
      if (error) return { error: error.message };
      const filas = (data as Array<Record<string, unknown>>) ?? [];
      return filas.length === 0
        ? { resultado: "no aparece en el padrón de la Capital con ese texto" }
        : filas.map((f) => ({
            elector: f.apellido_nombre,
            dni: f.dni,
            circuito: f.circuito,
            escuela: f.establecimiento,
            mesa: f.mesa ?? "sin mesa asignada",
            orden: f.orden_mesa,
          }));
    }

    case "ranking_circuitos_padron": {
      const { data, error } = await supabase.rpc("padron_por_circuito", { p_sexo: null, p_edad_min: null, p_edad_max: null });
      if (error) return { error: error.message };
      const filas = ((data as Array<{ circuito: string | null; total: number }>) ?? [])
        .filter((f) => f.circuito)
        .sort((a, b) => b.total - a.total)
        .slice(0, lim(args.limite, 10, 47));
      return filas.map((f, i) => ({ puesto: i + 1, circuito: f.circuito, electores: f.total }));
    }

    case "segmento_padron": {
      let circuitosPedidos: string[] | null = null;
      if (Array.isArray(args.circuitos)) {
        const crudos = (args.circuitos as unknown[]).map((x) => String(x).toUpperCase().trim()).filter(Boolean);
        const invalidos = crudos.filter((x) => !esEspacioValido("circuito", x));
        // JAMÁS degradar en silencio a "toda la ciudad": si pidieron circuitos
        // y alguno no existe, se corta acá con el detalle.
        if (invalidos.length > 0) {
          return { error: `circuitos inexistentes: ${invalidos.join(", ")} (válidos: 1–22 con letras, ej 15B)` };
        }
        if (crudos.length > 0) circuitosPedidos = crudos;
      }
      const { data, error } = await supabase.rpc("padron_segmento", {
        p_sexo: args.sexo === "F" || args.sexo === "M" ? args.sexo : null,
        p_edad_min: Number.isFinite(Number(args.edad_min)) ? Number(args.edad_min) : null,
        p_edad_max: Number.isFinite(Number(args.edad_max)) ? Number(args.edad_max) : null,
        p_circuitos: circuitosPedidos,
        p_con_mesa: null,
      });
      if (error) return { error: error.message };
      const r = data as { por_circuito: Array<{ circuito: string; total: number }> } & Record<string, unknown>;
      return {
        ...r,
        por_circuito: (r.por_circuito ?? []).slice(0, 15),
        circuitos_consultados: circuitosPedidos ?? "toda la ciudad",
        nota: "edades ESTIMADAS por rango de DNI (±3 años)",
      };
    }

    case "listas_2023": {
      const { data, error } = await supabase.rpc("listas_2023", { p_categoria: String(args.categoria ?? "CONCEJAL") });
      return error ? { error: error.message } : data;
    }

    case "votos_escuelas_2023": {
      const categoria = String(args.categoria ?? "CONCEJAL");
      // coerción explícita: los tool-calls suelen mandar números como strings
      let listas = Array.isArray(args.listas)
        ? (args.listas as unknown[]).map(Number).filter(Number.isInteger)
        : [];
      let notaSeleccion: string | null = null;
      if (listas.length === 0) {
        listas = await resolverSeleccion(supabase, categoria);
        notaSeleccion = `selección de listas del equipo (${listas.length} listas, la misma que muestra la pantalla Estrategia)`;
      }
      if (listas.length === 0) return { error: "no hay listas para analizar" };
      const { data, error } = await supabase.rpc("votos_por_escuela_2023", { p_categoria: categoria, p_listas: listas });
      if (error) return { error: error.message };
      const min = Number.isFinite(Number(args.min)) ? Number(args.min) : 100;
      const max = Number.isFinite(Number(args.max)) ? Number(args.max) : null;
      const enUmbral = ((data as Array<{ escuela: string; circuito: string | null; votos: number; mesas: number; electores: number }>) ?? [])
        .filter((f) => f.votos >= min && (max == null || f.votos <= max));
      const filas = enUmbral.slice(0, lim(args.limite, 15, 30));
      return {
        listas_analizadas: listas,
        ...(notaSeleccion ? { nota: notaSeleccion } : {}),
        umbral: { min, max },
        escuelas_en_umbral: enUmbral.length,
        mostradas: filas.length,
        ...(enUmbral.length > filas.length ? { aviso: `hay ${enUmbral.length} escuelas en el umbral; se muestran las ${filas.length} de más votos` } : {}),
        escuelas: filas,
      };
    }

    case "estado_estrategia": {
      const categoria = String(args.categoria ?? "CONCEJAL");
      const listas = await resolverSeleccion(supabase, categoria);
      if (listas.length === 0) return { error: "sin datos 2023 cargados" };
      const { data, error } = await supabase.rpc("estrategia_resumen", { p_categoria: categoria, p_listas: listas, p_meta: META_VOTOS });
      if (error) return { error: error.message };
      const r = data as { meta: number; escuelas_incluidas: number; votos_incluidos: number };
      return {
        ...r,
        avance_pct: r.meta > 0 ? Math.round((100 * r.votos_incluidos) / r.meta) : 0,
        nota: `votos según la selección de listas del equipo (categoría ${categoria}, la misma de la pantalla Estrategia)`,
      };
    }

    case "frontera_20k": {
      const categoria = String(args.categoria ?? "CONCEJAL");
      const listas = await resolverSeleccion(supabase, categoria);
      if (listas.length === 0) return { error: "sin listas seleccionadas" };
      const { data, error } = await supabase.rpc("prioridad_escuelas", {
        p_categoria: categoria,
        p_listas: listas,
        p_meta: META_VOTOS,
      });
      if (error) return { error: error.message };
      type Fila = { escuela: string; circuito: string; votos_dispersos: number; pct_disperso: number | null; referentes: number; incluida: boolean; score: number; tier: string; en_frontera: boolean };
      const filas = (data as Fila[]) ?? [];
      const frontera = filas.filter((f) => f.en_frontera);
      const huerfanos = filas.filter((f) => f.referentes === 0).reduce((a, f) => a + Number(f.votos_dispersos), 0);
      return {
        meta: META_VOTOS,
        escuelas_analizadas: filas.length,
        frontera: { escuelas: frontera.length, votos: frontera.reduce((a, f) => a + Number(f.votos_dispersos), 0) },
        votos_huerfanos: huerfanos,
        nota: "huérfanos = votos dispersos 2023 en circuitos SIN referente asignado; score = 50% volumen + 30% propensión + 20% descubierto",
        top: filas.slice(0, lim(args.limite, 12, 25)).map((f) => ({
          tier: f.tier,
          escuela: f.escuela,
          circuito: f.circuito,
          votos: f.votos_dispersos,
          pct_disperso: f.pct_disperso,
          referentes: f.referentes,
          en_estrategia: f.incluida,
          score: f.score,
        })),
      };
    }

    // ── Análisis electoral estratégico ──
    case "listas_eleccion": {
      const { data, error } = await supabase.rpc("listas_eleccion", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_categoria: args.categoria ? String(args.categoria) : null,
      });
      if (error) return { error: error.message };
      return {
        eleccion: args.eleccion,
        nota: args.eleccion === "2025" ? "Diputado Nacional 2025, escrutinio PROVISORIO (Capital)" : "escrutinio definitivo 2023",
        listas: data,
      };
    }

    case "ganadores_espacios": {
      const { data, error } = await supabase.rpc("ganadores_espacios", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_categoria: String(args.categoria ?? "CONCEJAL"),
        p_nivel: String(args.nivel ?? "escuela"),
        p_orden: args.orden === "votos" ? "votos" : "competitivo",
        // nivel circuito: los 47 completos (para pintar el mapa sin huecos)
        p_limite: String(args.nivel ?? "escuela") === "circuito" ? 60 : lim(args.limite, 20, 40),
      });
      if (error) return { error: error.message };
      return {
        orden: args.orden === "votos" ? "espacios más grandes primero" : "espacios más peleados primero (menor diferencia 1º-2º)",
        espacios: data,
      };
    }

    case "ranking_espacio": {
      const { data, error } = await supabase.rpc("ranking_en_espacio", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_categoria: String(args.categoria ?? "CONCEJAL"),
        p_nivel: String(args.nivel ?? "circuito"),
        p_codigo: String(args.codigo ?? ""),
      });
      if (error) return { error: error.message };
      const filas = (data as unknown[]) ?? [];
      return filas.length === 0 ? { resultado: "sin datos para ese espacio (revisá el código exacto)" } : filas;
    }

    case "desempeno_lista": {
      const { data, error } = await supabase.rpc("desempeno_lista", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_categoria: String(args.categoria ?? "CONCEJAL"),
        p_lista: Number(args.lista),
        p_nivel: String(args.nivel ?? "escuela"),
      });
      if (error) return { error: error.message };
      type Fila = { espacio: string; pct: number };
      const filas = (data as Fila[]) ?? [];
      const n = lim(args.limite, 12, 25);
      const peores = args.orden === "peores";
      return {
        espacios_donde_compite: filas.length,
        pct_promedio_lista: filas[0] ? (filas[0] as Fila & { pct_promedio_lista: number }).pct_promedio_lista : null,
        mostrando: peores ? "los peores (menor %)" : "los mejores (mayor %)",
        espacios: peores ? filas.slice(-n).reverse() : filas.slice(0, n),
      };
    }

    case "voto_blanco": {
      const { data, error } = await supabase.rpc("voto_blanco", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_nivel: String(args.nivel ?? "escuela"),
      });
      if (error) return { error: error.message };
      const filas = (data as unknown[]) ?? [];
      // A nivel circuito hay 47 espacios: se devuelven todos, así Elena puede
      // pintar el mapa completo sin inventar los que no vería en un top corto.
      const tope = String(args.nivel ?? "escuela") === "circuito" ? 200 : lim(args.limite, 15, 30);
      return {
        nota: "ordenado por % de voto en blanco descendente; en 2023 hay una fila por cargo (comparables entre sí)",
        total_filas: filas.length,
        ...(filas.length > tope ? { aviso: `se muestran ${tope} de ${filas.length} espacios` } : {}),
        top: filas.slice(0, tope),
      };
    }

    case "corte_boleta": {
      if (args.lista == null) {
        const { data, error } = await supabase.rpc("corte_boleta_listas");
        if (error) return { error: error.message };
        return {
          nota: "2023, toda la Capital. retencion_pct = peor cargo / mejor cargo (bajo = mucho corte). El cargo con más votos es el que arrastra.",
          listas: data,
        };
      }
      const { data, error } = await supabase.rpc("corte_boleta_espacios", {
        p_lista: Number(args.lista),
        p_nivel: String(args.nivel ?? "escuela"),
      });
      if (error) return { error: error.message };
      const filas = (data as unknown[]) ?? [];
      return {
        nota: "espacios ordenados por corte (diferencia entre su mejor y peor cargo) descendente",
        total_espacios: filas.length,
        top: filas.slice(0, lim(args.limite, 12, 25)),
      };
    }

    case "oportunidades": {
      const { data, error } = await supabase.rpc("oportunidades_lista", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_categoria: String(args.categoria ?? "CONCEJAL"),
        p_lista: Number(args.lista),
        p_margen: Math.max(1, Math.min(2000, Number(args.margen) || 100)),
        p_nivel: String(args.nivel ?? "mesa"),
      });
      if (error) return { error: error.message };
      const filas = (data as Array<{ situacion: string }>) ?? [];
      return {
        margen: Number(args.margen) || 100,
        atacar: filas.filter((f) => f.situacion.startsWith("pierde")).slice(0, lim(args.limite, 15, 30)),
        defender: filas.filter((f) => f.situacion.startsWith("gana")).slice(0, lim(args.limite, 15, 30)),
        nota: "ausentes = electores que no votaron; junto a los blancos son la bolsa de crecimiento de cada espacio",
      };
    }

    case "potencial_electoral": {
      const { data, error } = await supabase.rpc("potencial_electoral", {
        p_eleccion: String(args.eleccion ?? "2023"),
        p_categoria: String(args.categoria ?? "CONCEJAL"),
        p_lista: Number(args.lista),
        p_nivel: String(args.nivel ?? (args.eleccion === "2025" ? "circuito" : "escuela")),
      });
      if (error) return { error: error.message };
      type Fila = { tier: string; clasificacion: string };
      const filas = (data as Fila[]) ?? [];
      const porTier = (t: string) => filas.filter((f) => f.tier === t).length;
      return {
        formula: "IPE = 30% cercanía al líder + 25% bolsa (blancos+ausentes) + 20% rendimiento relativo + 15% volumen + 10% competitividad",
        resumen_tiers: { muy_alto: porTier("muy alto"), alto: porTier("alto"), medio: porTier("medio"), bajo: porTier("bajo") },
        resumen_clasificacion: {
          fuerte: filas.filter((f) => f.clasificacion === "fuerte").length,
          competitivo: filas.filter((f) => f.clasificacion === "competitivo").length,
          potencial: filas.filter((f) => f.clasificacion === "potencial").length,
          debil: filas.filter((f) => f.clasificacion === "débil").length,
        },
        top: filas.slice(0, String(args.nivel ?? "") === "circuito" ? 60 : lim(args.limite, 12, 25)),
      };
    }

    case "comparar_2023_2025": {
      const { data, error } = await supabase.rpc("comparar_elecciones", {
        p_lista_2023: Number(args.lista_2023),
        p_lista_2025: Number(args.lista_2025),
        p_categoria_2023: String(args.categoria_2023 ?? "CONCEJAL"),
      });
      if (error) return { error: error.message };
      return {
        nota: "delta_pct = puntos que la agrupación 2025 saca por encima (o debajo) de la lista 2023 en ese circuito. 2025 es provisorio y de otra elección: leer como tendencia, no como equivalencia.",
        circuitos: data,
      };
    }

    case "perfil_social": {
      const nivel = String(args.nivel ?? "circuito");
      const codigo = args.codigo ? String(args.codigo).trim() : null;
      if (nivel === "circuito" && codigo && !esEspacioValido("circuito", codigo.toUpperCase())) {
        return { error: `no existe el circuito ${codigo}` };
      }
      const { data, error } = await supabase.rpc("perfil_social", {
        p_nivel: nivel,
        p_codigo: nivel === "ciudad" ? null : codigo,
      });
      if (error) return { error: error.message };
      const r = data as { poblacion: number } | null;
      if (!r || !r.poblacion) {
        return { error: `sin datos censales para ${nivel} ${codigo ?? ""} (revisá el nombre exacto)` };
      }
      return {
        ...data,
        nota: "Censo 2022 (INDEC), agregado por radio censal: describe el CONTEXTO SOCIAL de la zona, no a personas concretas ni su voto",
      };
    }

    case "ranking_social": {
      const { data, error } = await supabase.rpc("ranking_social", {
        p_nivel: String(args.nivel ?? "circuito"),
        p_indicador: String(args.indicador ?? "pct_nbi"),
        p_limite: lim(args.limite, 12, 25),
      });
      if (error) return { error: error.message };
      return {
        indicador: args.indicador,
        nivel: args.nivel,
        nota: "ordenado de mayor a menor; fuente Censo 2022 por radio censal",
        top: data,
      };
    }

    case "barrios": {
      const datos = cruceBarrios as {
        barrios: Array<{ nombre: string; circuitos: Array<{ circuito: string; pct: number }> }>;
        por_circuito: Record<string, Array<{ barrio: string; pct: number }>>;
      };
      if (args.barrio) {
        const q = String(args.barrio).toLowerCase();
        const hallados = datos.barrios.filter((b) => b.nombre.toLowerCase().includes(q)).slice(0, 8);
        if (hallados.length === 0) return { resultado: "ningún barrio del mapa oficial coincide con ese nombre" };
        return hallados.map((b) => ({
          barrio: b.nombre,
          circuitos: b.circuitos.map((c) => `${c.circuito} (${c.pct}%)`),
        }));
      }
      if (args.circuito) {
        const codigo = String(args.circuito).toUpperCase().trim();
        if (!esEspacioValido("circuito", codigo)) return { error: `no existe el circuito ${codigo}` };
        const filas = datos.por_circuito[codigo] ?? [];
        return {
          circuito: codigo,
          barrios: filas.map((f) => `${f.barrio} (${f.pct}% del barrio cae en este circuito)`),
          nota: "cruce estimado por superposición geográfica del mapa oficial de barrios con los circuitos",
        };
      }
      return { error: "pasá un barrio o un circuito" };
    }

    case "ficha_territorial": {
      const nivel = args.nivel === "barrio" ? "barrio" : "circuito";
      const codigo = args.codigo ? String(args.codigo).trim() : null;
      let consulta = supabase
        .from("fichas_territoriales")
        .select("nivel, codigo, segmento, problematica, mensaje, propuesta, abordaje, estado, actualizado_en")
        .order("nivel")
        .order("codigo");
      if (codigo) consulta = consulta.eq("nivel", nivel).ilike("codigo", codigo);
      const { data, error } = await consulta.limit(60);
      if (error) return { error: error.message };
      const filas = (data as Array<Record<string, unknown>>) ?? [];
      if (filas.length === 0) {
        return codigo
          ? { resultado: `todavía no hay ficha para ${nivel} ${codigo}: proponé una (segmento, problemática, mensaje, propuesta, abordaje) con los datos electorales y el perfil social, y avisá que se guarda desde el panel del circuito en el mapa` }
          : { resultado: "todavía no hay ninguna ficha territorial cargada" };
      }
      return { fichas: filas, nota: "el equipo edita estas fichas desde el panel del circuito en el mapa" };
    }

    case "mostrar_en_mapa": {
      const accion = validarAccionMapaElena(args);
      if (!accion) {
        return {
          error:
            "nada mostrable: revisá modo ('resaltar' pide circuitos válidos; 'pintar' pide valores [{circuito, valor}] Y etiqueta; 'barrio' pide barrio)",
        };
      }
      const detalle =
        accion.modo === "barrio"
          ? `el barrio ${accion.barrio}`
          : accion.modo === "resaltar"
            ? `${accion.circuitos.length} circuitos resaltados (${accion.etiqueta})`
            : `una coropleta de ${accion.valores.length} circuitos (${accion.etiqueta})`;
      return {
        ok: true,
        nota: `El mapa va a mostrar ${detalle}. Si el usuario no estaba en el mapa, la app lo lleva sola. Contale en una frase qué está viendo y cómo leerlo.`,
      };
    }

    case "accionar_mapa": {
      const tipo = args.tipo as TipoEspacio;
      const codigo = String(args.codigo ?? "").toUpperCase().trim();
      if (!esEspacioValido(tipo, codigo)) {
        return { error: `no existe ${String(args.tipo)} ${codigo}` };
      }
      return {
        ok: true,
        nota: `El mapa va a seleccionar y encuadrar ${etiquetaEspacio(tipo, codigo)}. Si el usuario no estaba en el mapa, la app lo lleva sola. Contale en una frase qué va a ver.`,
      };
    }

    default:
      return { error: `herramienta desconocida: ${nombre}` };
  }
}

export const SISTEMA_ELENA = `Sos Elena, la asistente del comando territorial de JxR en San Miguel de Tucumán. Sos la experta en el operativo electoral: qué persona tiene asignado cada distrito y cada circuito, y cómo viene el checklist de tareas de cada asignación.

Personalidad: cercana, tucumana, profesional. Hablás en español rioplatense (vos/tenés) y de vos misma en femenino. Respondés claro y al grano, con los números exactos que te dan las herramientas.

Contexto del territorio:
- La ciudad se divide en 20 DISTRITOS oficiales (1 a 20) y 47 CIRCUITOS electorales (1, 1A, 2, 2A… hasta 22; hay letras como 15B o 18G).
- Una PERSONA es alguien real e identificable del territorio (nombre, DNI, dirección, teléfono) — NO es un usuario del sistema. Puede tener asignados uno o más espacios (distritos o circuitos), con un rol opcional (referente, fiscal, coordinador…).
- Cada asignación tiene un CHECKLIST de tareas que los administradores marcan como hechas.
- Cobertura: un espacio está "sin asignar" (nadie a cargo), "en curso" (con gente asignada) o "completo" (checklist 100% hecho).

Datos electorales que manejás:
- PADRÓN de la Capital: ~459 mil electores con sexo, domicilio, circuito, escuela, mesa y orden. Las franjas etarias son ESTIMADAS por rango de DNI (±3 años): aclaralo cuando las uses. La herramienta donde_vota es para dar soporte logístico (decirle a alguien dónde vota).
- RESULTADOS 2023 (escrutinio definitivo, mesa a mesa): votos por lista en GOBERNADOR, LEGISLADOR, INTENDENTE y CONCEJAL, cruzados con las escuelas del padrón. Es la elección con 4 cargos simultáneos: acá se analiza el CORTE DE BOLETA.
- RESULTADOS 2025 (Diputado Nacional, escrutinio PROVISORIO, mesa a mesa, Capital): 1.350 mesas, 464.795 electores. OJO: la numeración de mesas nacionales NO es la del padrón provincial — 2025 se analiza por mesa y circuito, sin cruce a escuela; la comparación con 2023 es por CIRCUITO (los 47 códigos coinciden).
- BARRIOS: mapa oficial municipal (327 barrios) cruzado con los circuitos (herramienta barrios).
- PERFIL SOCIAL (Censo 2022 del INDEC, 671 radios censales de la Capital): población y edades, NBI, hacinamiento, servicios (cloaca, agua), situación laboral (ocupados, desocupados y tasa, relación de dependencia, cuenta propia, servicio doméstico, empleo público, comercio, construcción), clima educativo y cobertura de salud — por circuito, por barrio y de toda la ciudad. Referencias de la ciudad para comparar: NBI 7,7% · hacinamiento 14,6% · sin cloaca 14,1% · desocupación 10,7% · sin cobertura de salud 29,9%.
- ESTRATEGIA "voto disperso": identificar escuelas donde las listas peronistas chicas sin banca sumaron votos (típicamente ~100–300 por escuela) y marcar esas escuelas para trabajarlas con referentes, hasta construir un universo de ${META_VOTOS.toLocaleString("es-AR")} votos. La preselección de listas es editable en la pantalla Estrategia.

Sos un ANALISTA ESTRATÉGICO, no solo un buscador de resultados. Método de trabajo:
- "¿Dónde estamos?" → listas_eleccion + desempeno_lista. "¿Dónde ganamos/perdemos?" → ganadores_espacios. "¿Dónde crecer?" → potencial_electoral (el IPE ordena TODO: cercanía al líder, blancos+ausentes, rendimiento, volumen, competitividad) y oportunidades (perdidas por menos de N votos). "¿Quién arrastra y quién corta?" → corte_boleta. "¿Cómo evolucionamos?" → comparar_2023_2025.
- SIMULACIONES: hacelas con aritmética explícita sobre los datos de las herramientas y mostrá la cuenta. Ej: "si captamos el 30% de los 3.594 blancos de Capital serían ~1.078 votos"; "mejorar 5% en estas 8 escuelas (X votos actuales) suma ~X*0,05". Nunca inventes las bases: consultalas primero.
- Cuando te pidan un plan territorial, combiná: potencial_electoral (prioridades) + oportunidades (metas concretas de votos) + estado del operativo (dónde falta referente/fiscal) + barrios (para nombrar el territorio como lo conoce la gente) + perfil_social (qué perfil tiene la gente de esa zona). Cerrá siempre con acciones: dónde poner estructura, cuántos votos se buscan ahí y por qué.
- FICHAS TERRITORIALES: el plan por territorio (segmento, problemática, mensaje, propuesta, abordaje) vive en ficha_territorial. Consultala antes de proponer un plan (para no pisar lo definido) y cuando te pidan un BORRADOR de ficha, armalo con esa estructura exacta de 5 campos, cada uno en una línea con el nombre en negrita, listo para copiar en el panel del circuito.
- VOTO + PERFIL SOCIAL: cuando cruces ambos, el perfil social sirve para elegir el MENSAJE y la PROPUESTA de cada territorio, no para predecir el voto de nadie. Ej: una zona con desocupación muy por encima del 10,7% de la ciudad y clima educativo bajo pide agenda de trabajo y oficios; una con muchos adultos mayores pide salud y previsión; una con hogares sin cloaca pide infraestructura. Siempre comparás el dato de la zona contra el de la ciudad para decir si está mejor o peor, y decís de qué indicador surge la conclusión.
- Lo que el censo NO dice: cómo vota una persona, ni su problemática individual. Si te piden ese cruce a nivel individuo, explicá que el análisis es por zona y ofrecé el agregado.
- Los análisis por mesa son los más finos pero devuelven muchos espacios: arrancá por circuito o escuela y bajá a mesa cuando haga falta puntería.
- Si preguntan por una MESA puntual sin aclarar la elección, asumí 2025 (los paneles de la app muestran las mesas nacionales 2025) y aclaralo en una frase; ofrecé el 2023 como opción solo después de responder. «Dar vuelta» una mesa o circuito = que el 2º supere al 1º: respondé quién gana, quién está segundo y cuántos votos le faltan (diferencia + 1), más blancos y ausentes como bolsa — SIN pedir que te aclaren la agrupación. Regla general: ante ambigüedad, elegí el supuesto más razonable, respondé, y al final aclarás qué asumiste — NUNCA frenes el análisis para repreguntar.
- Aclarar SIEMPRE que 2025 es provisorio cuando lo uses.

Privacidad y límites (IMPORTANTES):
- El padrón se usa para logística y soporte (dónde vota la gente, cuántos son, dónde se concentran). NUNCA especules ni permitas inferir la orientación política, religiosa o social de una persona individual: el voto es secreto y el análisis político es SIEMPRE agregado (por escuela, circuito o cohorte).
- No inventes datos: si una herramienta no lo devuelve, no existe.

Acción sobre el mapa:
- Si el usuario pide VER algo ("mostrame el circuito 15B", "llevame al distrito 7", "dónde está el 18G"), usá accionar_mapa: el mapa lo selecciona y lo encuadra; si no estaba en el mapa, la app lo lleva sola.
- SOS QUIEN MANEJA EL MAPA: cuando un análisis produce un CONJUNTO de circuitos o un valor por circuito, mostralo con mostrar_en_mapa además de contarlo. "¿Dónde perdimos por poco?" → consultás oportunidades y RESALTÁS esos circuitos; "pintame el crecimiento de X" → consultás comparar_2023_2025 y PINTÁS el delta_pct por circuito; "¿dónde hay más blancos/desocupación/NBI?" → consultás y pintás el valor. Primero las herramientas de datos, después mostrar_en_mapa con los valores obtenidos (pintar exige TODOS los circuitos con dato, no solo el top). La etiqueta dice qué es y su unidad, corta.
- mostrar_en_mapa trabaja por CIRCUITO (el nivel del mapa): si el análisis fue por mesa o escuela, resaltá los circuitos donde caen y aclaralo.
- NUNCA rellenes valores que no tenés: en modo pintar, cada valor sale de una herramienta. Si una consulta te devolvió solo parte de los circuitos, pintá ESOS y decilo — un 0 inventado dibuja un circuito vacío que no existe. Para pintar por circuito pedí el nivel 'circuito', que te devuelve los 47.
- Podés combinar: consultar datos (para responder con números) y además accionar el mapa (para que lo vea).

Reglas:
- SIEMPRE consultá las herramientas antes de dar números: nunca inventes datos ni respondas de memoria.
- Si una pregunta no es sobre el operativo territorial (asignaciones, personas, tareas, distritos, circuitos, padrón, resultados 2023, estrategia), decí amablemente que solo manejás ese tema.
- Tratá los datos de contacto con cuidado: compartilos solo cuando el administrador los pida explícitamente.
- Formato: texto con guiones para listas y **negrita** para resaltar lo importante. Nada más de markdown: NUNCA títulos con #, ni tablas, ni separadores --- — tampoco en los análisis largos (usá una línea en negrita como encabezado de sección). Los análisis estratégicos pueden extenderse hasta ~350 palabras; el resto, ~150.`;

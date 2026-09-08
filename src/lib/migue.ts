import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CODIGOS, esEspacioValido, etiquetaEspacio } from "./espacios";
import { META_VOTOS, presetPeronismoDisperso } from "./estrategia";
import type { Lista2023 } from "./padron";
import type { Asignacion, Tarea, TipoEspacio } from "./tipos";

/**
 * Migue — asistente del comando territorial JxR. Responde consultando los
 * datos REALES del operativo con herramientas parametrizadas de solo lectura
 * (corren con la sesión RLS del usuario) y puede accionar el mapa.
 */

export const HERRAMIENTAS_MIGUE = [
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

export async function ejecutarHerramientaMigue(
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
      const patron = `%${texto}%`;
      const { data: personas } = await supabase
        .from("personas")
        .select("id, nombre, documento, direccion, telefono, email, notas")
        .or(`nombre.ilike.${patron},documento.ilike.${patron},telefono.ilike.${patron},email.ilike.${patron}`)
        .limit(8);
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
      const circuitosCrudos = Array.isArray(args.circuitos)
        ? (args.circuitos as unknown[]).map((x) => String(x).toUpperCase().trim()).filter((x) => esEspacioValido("circuito", x))
        : null;
      const { data, error } = await supabase.rpc("padron_segmento", {
        p_sexo: args.sexo === "F" || args.sexo === "M" ? args.sexo : null,
        p_edad_min: Number.isFinite(Number(args.edad_min)) ? Number(args.edad_min) : null,
        p_edad_max: Number.isFinite(Number(args.edad_max)) ? Number(args.edad_max) : null,
        p_circuitos: circuitosCrudos && circuitosCrudos.length > 0 ? circuitosCrudos : null,
        p_con_mesa: null,
      });
      if (error) return { error: error.message };
      const r = data as { por_circuito: Array<{ circuito: string; total: number }> } & Record<string, unknown>;
      return { ...r, por_circuito: (r.por_circuito ?? []).slice(0, 15), nota: "edades ESTIMADAS por rango de DNI (±3 años)" };
    }

    case "listas_2023": {
      const { data, error } = await supabase.rpc("listas_2023", { p_categoria: String(args.categoria ?? "CONCEJAL") });
      return error ? { error: error.message } : data;
    }

    case "votos_escuelas_2023": {
      const categoria = String(args.categoria ?? "CONCEJAL");
      let listas = Array.isArray(args.listas) ? (args.listas as number[]).filter(Number.isInteger) : [];
      let notaPreset: string | null = null;
      if (listas.length === 0) {
        const { data: todas } = await supabase.rpc("listas_2023", { p_categoria: categoria });
        listas = presetPeronismoDisperso((todas as Lista2023[]) ?? []);
        notaPreset = `preselección peronismo disperso (${listas.length} listas, editable en Estrategia)`;
      }
      if (listas.length === 0) return { error: "no hay listas para analizar" };
      const { data, error } = await supabase.rpc("votos_por_escuela_2023", { p_categoria: categoria, p_listas: listas });
      if (error) return { error: error.message };
      const min = Number.isFinite(Number(args.min)) ? Number(args.min) : 100;
      const max = Number.isFinite(Number(args.max)) ? Number(args.max) : null;
      const filas = ((data as Array<{ escuela: string; circuito: string | null; votos: number; mesas: number; electores: number }>) ?? [])
        .filter((f) => f.votos >= min && (max == null || f.votos <= max))
        .slice(0, lim(args.limite, 15, 30));
      return { listas_analizadas: listas, ...(notaPreset ? { nota: notaPreset } : {}), umbral: { min, max }, escuelas: filas };
    }

    case "estado_estrategia": {
      const categoria = String(args.categoria ?? "CONCEJAL");
      const { data: todas } = await supabase.rpc("listas_2023", { p_categoria: categoria });
      const listas = presetPeronismoDisperso((todas as Lista2023[]) ?? []);
      if (listas.length === 0) return { error: "sin datos 2023 cargados" };
      const { data, error } = await supabase.rpc("estrategia_resumen", { p_categoria: categoria, p_listas: listas, p_meta: META_VOTOS });
      if (error) return { error: error.message };
      const r = data as { meta: number; escuelas_incluidas: number; votos_incluidos: number };
      return { ...r, avance_pct: r.meta > 0 ? Math.round((100 * r.votos_incluidos) / r.meta) : 0, nota: "votos según preselección peronismo disperso (categoría " + categoria + ")" };
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

export const SISTEMA_MIGUE = `Sos Migue, el asistente del comando territorial de JxR en San Miguel de Tucumán. Sos el experto en el operativo electoral: qué persona tiene asignado cada distrito y cada circuito, y cómo viene el checklist de tareas de cada asignación.

Personalidad: cercano, tucumano, profesional. Hablás en español rioplatense (vos/tenés). Respondés claro y al grano, con los números exactos que te dan las herramientas.

Contexto del territorio:
- La ciudad se divide en 20 DISTRITOS oficiales (1 a 20) y 47 CIRCUITOS electorales (1, 1A, 2, 2A… hasta 22; hay letras como 15B o 18G).
- Una PERSONA es alguien real e identificable del territorio (nombre, DNI, dirección, teléfono) — NO es un usuario del sistema. Puede tener asignados uno o más espacios (distritos o circuitos), con un rol opcional (referente, fiscal, coordinador…).
- Cada asignación tiene un CHECKLIST de tareas que los administradores marcan como hechas.
- Cobertura: un espacio está "sin asignar" (nadie a cargo), "en curso" (con gente asignada) o "completo" (checklist 100% hecho).

Datos electorales que manejás:
- PADRÓN de la Capital: ~459 mil electores con sexo, domicilio, circuito, escuela, mesa y orden. Las franjas etarias son ESTIMADAS por rango de DNI (±3 años): aclaralo cuando las uses. La herramienta donde_vota es para dar soporte logístico (decirle a alguien dónde vota).
- RESULTADOS 2023 (escrutinio definitivo, mesa a mesa): votos por lista en GOBERNADOR, LEGISLADOR, INTENDENTE y CONCEJAL, cruzados con las escuelas del padrón.
- ESTRATEGIA "voto disperso": identificar escuelas donde las listas peronistas chicas sin banca sumaron votos (típicamente ~100–300 por escuela) y marcar esas escuelas para trabajarlas con referentes, hasta construir un universo de ${META_VOTOS.toLocaleString("es-AR")} votos. La preselección de listas es editable en la pantalla Estrategia.

Privacidad y límites (IMPORTANTES):
- El padrón se usa para logística y soporte (dónde vota la gente, cuántos son, dónde se concentran). NUNCA especules ni permitas inferir la orientación política, religiosa o social de una persona individual: el voto es secreto y el análisis político es SIEMPRE agregado (por escuela, circuito o cohorte).
- No inventes datos: si una herramienta no lo devuelve, no existe.

Acción sobre el mapa:
- Si el usuario pide VER algo ("mostrame el circuito 15B", "llevame al distrito 7", "dónde está el 18G"), usá accionar_mapa: el mapa lo selecciona y lo encuadra; si no estaba en el mapa, la app lo lleva sola.
- Podés combinar: consultar datos (para responder con números) y además accionar_mapa (para que lo vea).

Reglas:
- SIEMPRE consultá las herramientas antes de dar números: nunca inventes datos ni respondas de memoria.
- Si una pregunta no es sobre el operativo territorial (asignaciones, personas, tareas, distritos, circuitos, padrón, resultados 2023, estrategia), decí amablemente que solo manejás ese tema.
- Tratá los datos de contacto con cuidado: compartilos solo cuando el administrador los pida explícitamente.
- Formato: texto con guiones para listas y **negrita** para resaltar lo importante. Nada más de markdown (sin títulos #, sin tablas). Máximo ~150 palabras salvo que pidan detalle.`;

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CODIGOS, esEspacioValido, etiquetaEspacio } from "./espacios";
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

Acción sobre el mapa:
- Si el usuario pide VER algo ("mostrame el circuito 15B", "llevame al distrito 7", "dónde está el 18G"), usá accionar_mapa: el mapa lo selecciona y lo encuadra; si no estaba en el mapa, la app lo lleva sola.
- Podés combinar: consultar datos (para responder con números) y además accionar_mapa (para que lo vea).

Reglas:
- SIEMPRE consultá las herramientas antes de dar números: nunca inventes datos ni respondas de memoria.
- Si una pregunta no es sobre el operativo territorial (asignaciones, personas, tareas, distritos, circuitos), decí amablemente que solo manejás ese tema.
- Tratá los datos de contacto con cuidado: compartilos solo cuando el administrador los pida explícitamente.
- Formato: texto con guiones para listas y **negrita** para resaltar lo importante. Nada más de markdown (sin títulos #, sin tablas). Máximo ~150 palabras salvo que pidan detalle.`;

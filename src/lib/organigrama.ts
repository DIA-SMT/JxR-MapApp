/**
 * Organigrama de la Municipalidad de San Miguel de Tucumán (gabinete,
 * versión recibida en octubre de 2026) y qué áreas intervienen en cada línea
 * del Plan Rector.
 *
 * Sirve para la gestión: saber qué dirección lidera una política, cuáles
 * participan y, a partir de la necesidad de un barrio, a quién hay que
 * coordinar en el territorio. NO se cruza con datos electorales (ver la
 * regla de la herramienta de presupuesto).
 *
 * `confirmar`: la dependencia no se lee con certeza en el diagrama original.
 * La asignación de áreas a políticas es una PROPUESTA de trabajo para validar
 * con cada secretaría.
 */

export type TipoArea = "secretaria" | "subsecretaria" | "direccion" | "organismo";

export interface Area {
  id: string;
  nombre: string;
  tipo: TipoArea;
  /** Área de la que depende (null = secretaría, depende del Intendente). */
  depende: string | null;
  responsable?: string;
  /** La dependencia no está clara en el organigrama recibido. */
  confirmar?: boolean;
}

const a = (
  id: string,
  nombre: string,
  tipo: TipoArea,
  depende: string | null,
  responsable?: string,
  confirmar?: boolean,
): Area => ({
  id,
  nombre,
  tipo,
  depende,
  ...(responsable ? { responsable } : {}),
  ...(confirmar ? { confirmar } : {}),
});

export const ORGANIGRAMA: Area[] = [
  // ── Secretaría General ──
  a("sec-general", "Secretaría General", "secretaria", null, "Dr. Rodrigo Gómez Tortosa"),
  a("gen-despacho", "Dirección de Despacho", "direccion", "sec-general", "Dr. P. Pérez Ledesma"),
  a(
    "sub-prensa",
    "Subsecretaría de Prensa y Comunicación Institucional",
    "subsecretaria",
    "sec-general",
    "Lic. P. Haro Rodríguez",
  ),
  a("dir-comunicacion", "Dirección de Comunicación", "direccion", "sub-prensa", "Sr. Sebastián Zazzali"),
  a("dir-comunicacion-digital", "Dirección de Comunicación Digital", "direccion", "sub-prensa", "Lic. M. Gómez Palma"),
  a(
    "dir-comunicacion-no-trad",
    "Dirección de Comunicación No Tradicional",
    "direccion",
    "sub-prensa",
    "Sr. Gabriel Lemme",
  ),
  a("dir-radio", "Dirección Radio Municipal", "direccion", "sub-prensa", "Sr. Rodrigo Rodríguez"),
  a(
    "sub-gestion-estrategica",
    "Subsecretaría de Gestión Estratégica y Documentación",
    "subsecretaria",
    "sec-general",
    "Lic. H. Ponce de León",
  ),
  a(
    "dir-planificacion-estrategica",
    "Dirección de Planificación Estratégica",
    "direccion",
    "sub-gestion-estrategica",
    "Lic. Juan Pablo Pinna",
  ),
  a(
    "dir-informacion-estrategica",
    "Dirección de Información Estratégica",
    "direccion",
    "sub-gestion-estrategica",
    "Dr. Luis Colmenares",
  ),
  a(
    "dir-documentacion-estrategica",
    "Dirección de Documentación Estratégica",
    "direccion",
    "sub-gestion-estrategica",
    "Lic. Silvana Firpo",
  ),
  a(
    "dir-centros-vecinales",
    "Dirección de Centros Vecinales",
    "direccion",
    "sub-gestion-estrategica",
    "Lic. Bruno R. Medina",
  ),
  a(
    "dir-respuesta-rapida",
    "Dirección Respuesta Rápida",
    "direccion",
    "sub-gestion-estrategica",
    "Sra. Pereyra Colombano",
  ),
  a("dir-gerencia-datos", "Dirección Gerencia de Datos", "direccion", "sub-gestion-estrategica", "Ing. Marcelo Dulci"),
  a(
    "sub-desarrollo-humano",
    "Subsecretaría de Desarrollo Humano",
    "subsecretaria",
    "sec-general",
    "Dra. Graciela Trejo",
  ),
  a("dir-salud", "Dirección de Salud", "direccion", "sub-desarrollo-humano", "Dr. Alejandro Bonari"),
  a("dir-educacion", "Dirección de Educación", "direccion", "sub-desarrollo-humano", "Lic. Isabel Amate Pérez"),
  a(
    "dir-ninez-juventud",
    "Dirección de Niñez y Juventud",
    "direccion",
    "sub-desarrollo-humano",
    "Dra. Vanesa R. Castro",
  ),
  a("dir-adulto-mayor", "Dirección de Adulto Mayor", "direccion", "sub-desarrollo-humano", "Dr. Luis E. Ramírez"),
  a(
    "dir-genero",
    "Dirección de Inclusión, Género y Diversidad",
    "direccion",
    "sub-desarrollo-humano",
    "Sra. Ana C. Peralta",
  ),
  a(
    "dir-poblacion-animal",
    "Dirección de Población Animal",
    "direccion",
    "sub-desarrollo-humano",
    "Sra. María M. Dabul",
  ),
  a(
    "dir-asistencia-publica",
    "Dirección de Asistencia Pública",
    "direccion",
    "sub-desarrollo-humano",
    "Dra. Karina M. Faccioli",
  ),
  a(
    "dir-tartamudez",
    "Dirección Centro de Tartamudez Municipal",
    "direccion",
    "sub-desarrollo-humano",
    "Lic. Lina M. Almazán",
  ),
  a(
    "dir-casa-azul",
    "Dirección de Abordaje Integral del Espectro Autista (Casa Azul)",
    "direccion",
    "sub-desarrollo-humano",
    "Lic. Laura Judit Trejo",
  ),
  a("sub-cultura", "Subsecretaría de Cultura", "subsecretaria", "sec-general", "Sra. Ana Lía Carbonell"),
  a("dir-gestion-cultural", "Dirección de Gestión Cultural", "direccion", "sub-cultura", "Sr. Emiliano Alonso"),
  a("dir-eventos", "Dirección de Promoción de Eventos", "direccion", "sub-cultura", "Sra. Natalia Zanotta"),
  a(
    "dir-museos-teatros",
    "Dirección General de Museos y Teatros",
    "direccion",
    "sub-cultura",
    "Lic. M. C. Guerra Orozco",
  ),
  a("dir-turismo", "Dirección de Turismo", "direccion", "sub-cultura", "Sr. Pablo Gerstenfeld"),

  // ── Secretaría de Gobierno ──
  a("sec-gobierno", "Secretaría de Gobierno", "secretaria", null, "Mg. Camila Giuliano"),
  a("gob-despacho", "Dirección de Despacho", "direccion", "sec-gobierno", "Dra. F. López Roig"),
  a(
    "tribunal-faltas",
    "Tribunal Municipal de Faltas",
    "organismo",
    "sec-gobierno",
    "Dr. G. Poliche Iturbe (presidente)",
  ),
  a(
    "dir-deportes",
    "Dirección de Deportes y Recreación",
    "direccion",
    "sec-gobierno",
    "Lic. Francisco J. Japaze",
    true,
  ),
  a("sub-gobierno", "Subsecretaría de Gobierno", "subsecretaria", "sec-gobierno", "Dr. Alejandro Sangenis"),
  a("dir-moviles", "Dirección Operativa de Móviles", "direccion", "sub-gobierno", "Roque Alberto Giménez"),
  a("dir-capital-humano", "Dirección de Capital Humano", "direccion", "sub-gobierno", "Dra. María L. Radrizzani"),
  a(
    "dir-relaciones-inst",
    "Dirección de Relaciones Internacionales e Institucionales",
    "direccion",
    "sub-gobierno",
    "Carolina Oliver",
  ),
  a("dir-empleo", "Dirección de Empleo y Emprendimientos", "direccion", "sub-gobierno", "Sr. Osvaldo L. Chalin"),
  a("sub-seguridad", "Subsecretaría de Seguridad Ciudadana", "subsecretaria", "sec-gobierno", "Dra. Mariela Cortez"),
  a("centro-monitoreo", "Centro de Monitoreo Municipal", "direccion", "sub-seguridad", "María Lourdes Alderete"),
  a("dir-defensa-civil", "Dirección de Defensa Civil", "direccion", "sub-seguridad"),
  a("patrulla", "Patrulla de Protección Ciudadana", "direccion", "sub-seguridad"),
  a("dir-via-publica", "Dirección de Vía Pública", "direccion", "sub-seguridad", "Juan Roberto Rojas"),

  // ── Secretaría de Atención al Ciudadano ──
  a("sec-atencion", "Secretaría de Atención al Ciudadano", "secretaria", null, "Dra. M. S. Prado Budeguer"),
  a("ate-despacho", "Dirección de Despacho", "direccion", "sec-atencion", "Sr. José F. Senrra"),
  a(
    "sub-desarrollo-social",
    "Subsecretaría de Desarrollo Social y Programas Sociales",
    "subsecretaria",
    "sec-atencion",
  ),
  a(
    "dir-programas-sociales",
    "Dirección de Programas Sociales",
    "direccion",
    "sub-desarrollo-social",
    "Sra. M. F. Prado Budeguer",
  ),
  a("dir-familia", "Dirección de Familia", "direccion", "sub-desarrollo-social", "Sra. Elizabeth Rodríguez"),

  // ── Secretaría de Obras Públicas ──
  a("sec-obras", "Secretaría de Obras Públicas", "secretaria", null, "Ing. Claudio Bravo"),
  a("obr-despacho", "Dirección de Despacho", "direccion", "sec-obras", "Dra. Luisa Intile"),
  a("sub-obras", "Subsecretaría de Obras Públicas", "subsecretaria", "sec-obras", "Ing. Leonardo Miguez"),
  a("dir-obras-viales", "Dirección de Obras Viales", "direccion", "sub-obras", "Ing. Darío Vera Antonelli"),
  a("dir-alumbrado", "Dirección de Alumbrado y Semáforos", "direccion", "sub-obras", "Ing. Sergio Gao"),
  a("dir-proyectos", "Dirección de Proyectos", "direccion", "sub-obras", "Arq. C. Zarrabeitía", true),
  a(
    "sub-planificacion-urbana",
    "Subsecretaría de Planificación Urbana",
    "subsecretaria",
    "sec-obras",
    "Ing. Hebe Espinoza Rojas",
  ),
  a(
    "dir-planificacion-urbanistica",
    "Dirección de Planificación Urbanística",
    "direccion",
    "sub-planificacion-urbana",
    "María G. Rearte",
  ),
  a(
    "dir-catastro",
    "Dirección de Catastro y Edificación",
    "direccion",
    "sub-planificacion-urbana",
    "Arq. Nora Elvira Belloni",
  ),

  // ── Secretaría de Servicios Públicos ──
  a("sec-servicios", "Secretaría de Servicios Públicos", "secretaria", null, "Sr. Tulio Chincarini"),
  a("ser-despacho", "Dirección de Despacho", "direccion", "sec-servicios", "Dra. Mercedes Koch"),
  a("sub-servicios", "Subsecretaría de Servicios Públicos", "subsecretaria", "sec-servicios", "Dra. Lorena Málaga"),
  a("dir-espacios-verdes", "Dirección de Espacios Verdes", "direccion", "sub-servicios", "Ing. Álvaro M. Costilla"),
  a("dir-limpieza", "Dirección de Limpieza Urbana", "direccion", "sub-servicios", "Sr. Carlos Montoya"),
  a("dir-cementerios", "Dirección de Cementerios", "direccion", "sub-servicios", "Arq. Humberto Salazar"),
  a("dir-arbolado", "Dirección de Arbolado", "direccion", "sub-servicios", "Ing. Guillermo Olivera"),
  a("dir-parque", "Dirección del Parque 9 de Julio", "direccion", "sub-servicios"),

  // ── Secretaría de Ambiente y Desarrollo Sustentable ──
  a("sec-ambiente", "Secretaría de Ambiente y Desarrollo Sustentable", "secretaria", null, "Ing. J. Migliavacca"),
  a("amb-despacho", "Dirección de Despacho", "direccion", "sec-ambiente", "Dra. Aguilar Bianchi"),
  a("sub-residuos", "Subsecretaría de Gestión Integral de Residuos", "subsecretaria", "sec-ambiente"),
  a("dir-salud-ambiental", "Dirección de Salud Ambiental", "direccion", "sub-residuos", "Sra. Clara Saslaver", true),
  a("dir-ambiente", "Dirección de Ambiente", "direccion", "sub-residuos", "Sr. Fortuna Kiyoshi", true),
  a("dir-bromatologia", "Dirección de Bromatología", "direccion", "sub-residuos", "Sra. María E. Cruz", true),

  // ── Secretaría de Movilidad Urbana ──
  a("sec-movilidad", "Secretaría de Movilidad Urbana", "secretaria", null, "Sr. Carlos R. Arnedo"),
  a("mov-despacho", "Dirección de Despacho", "direccion", "sec-movilidad", "Dr. Raúl González Iturbe"),
  a("sub-movilidad", "Subsecretaría de Movilidad Urbana", "subsecretaria", "sec-movilidad"),
  a("dir-transito-adm", "Dirección Administrativa de Tránsito", "direccion", "sub-movilidad", "Sr. Eduardo P. Mosconi"),
  a("dir-transito-op", "Dirección Operativa de Tránsito", "direccion", "sub-movilidad", "Sr. Sergio W. Suárez"),
  a("dir-sutrapa", "Dirección SUTRAPA", "direccion", "sub-movilidad", "Sra. Nilda Valeria Amaya", true),
  a("dir-transporte", "Dirección de Transporte", "direccion", "sub-movilidad", "Dr. Máximo Stenvers", true),
  a(
    "sub-seguridad-vial",
    "Subsecretaría de Seguridad Vial y Licencias de Conducir",
    "subsecretaria",
    "sec-movilidad",
    "Dr. Benjamín Nieva",
  ),
  a("dir-licencias", "Dirección de Licencias de Conducir", "direccion", "sub-seguridad-vial", "Sra. Viviana Tirone"),
  a(
    "dir-monitoreo-movilidad",
    "Dirección Centro de Monitoreo de Movilidad Urbana",
    "direccion",
    "sub-seguridad-vial",
    "Dra. Mariela Cortez",
    true,
  ),

  // ── Secretaría de Innovación Tecnológica ──
  a("sec-innovacion", "Secretaría de Innovación Tecnológica", "secretaria", null, "Ing. Omar Abraham"),
  a("inn-despacho", "Dirección de Despacho", "direccion", "sec-innovacion", "CPN Florencia Borsotto"),
  a("dir-innovacion", "Dirección de Innovación Tecnológica", "direccion", "sec-innovacion", "Ing. Silvia A. Calabró"),
  a("dir-ia", "Dirección de Inteligencia Artificial", "direccion", "sec-innovacion", "Dr. Marco Rossi"),

  // ── Secretaría de Economía y Hacienda ──
  a("sec-hacienda", "Secretaría de Economía y Hacienda", "secretaria", null, "Cr. S. Ruiz Toscano"),
  a("hac-despacho", "Dirección de Despacho", "direccion", "sec-hacienda", "Dr. Esteban Buriek"),
  a("sub-hacienda", "Subsecretaría de Economía y Hacienda", "subsecretaria", "sec-hacienda", "Cra. Nora Liz Rabini"),
  a("contaduria", "Contaduría General", "organismo", "sub-hacienda", "Cr. M. Albaca Petersen"),
  a("tesoreria", "Tesorería General", "organismo", "sub-hacienda", "Cra. Silvina Usandivaras"),
  a(
    "dir-presupuesto",
    "Dirección de Planeamiento y Presupuesto",
    "direccion",
    "sub-hacienda",
    "Cra. M. del Pilar Varela",
  ),
  a("dir-compras", "Dirección General de Compras y Contrataciones", "direccion", "sub-hacienda", "Cra. Silvia Otero"),

  // ── Secretaría de Ingresos Municipales ──
  a("sec-ingresos", "Secretaría de Ingresos Municipales", "secretaria", null, "Cr. M. Fernanda Herrera"),
  a("ing-despacho", "Dirección de Despacho", "direccion", "sec-ingresos", "Dr. Gonzalo de León"),
  a("sub-ingresos", "Subsecretaría de Ingresos Municipales", "subsecretaria", "sec-ingresos"),
  a("dir-ingresos", "Dirección de Ingresos Municipales", "direccion", "sub-ingresos", "Cr. Julio César Mazziotti"),
  a(
    "dir-informatica-tributaria",
    "Dirección de Informática Tributaria",
    "direccion",
    "sub-ingresos",
    "Ing. Gabriel Trevisán",
  ),
  a("sub-planificacion-financiera", "Subsecretaría de Planificación Financiera", "subsecretaria", "sec-ingresos"),
  a("credito-publico", "Oficina de Crédito Público", "organismo", "sub-planificacion-financiera", "Cr. Jorge Martínez"),
  a(
    "dir-politica-fiscal",
    "Dirección de Política Fiscal",
    "direccion",
    "sub-planificacion-financiera",
    "Ing. E. Barrionuevo",
  ),
];

export const AREA = new Map(ORGANIGRAMA.map((x) => [x.id, x]));

/** La cadena de mando de un área, de la secretaría hacia abajo. */
export function cadena(id: string): Area[] {
  const out: Area[] = [];
  for (let x = AREA.get(id); x; x = x.depende ? AREA.get(x.depende) : undefined) out.unshift(x);
  return out;
}

/** La secretaría de la que cuelga un área. */
export const secretariaDe = (id: string): Area | undefined => cadena(id)[0];

/** Las áreas que dependen de otra, directa o indirectamente. */
export const hijos = (id: string) => ORGANIGRAMA.filter((x) => x.depende === id);

/**
 * Qué área lidera cada línea del Plan Rector y cuáles participan. Es una
 * propuesta para validar: el organigrama no trae esta asignación.
 */
export const AREAS_POLITICA: Record<string, { lidera: string; participan: string[] }> = {
  // A1 · Ordenada y sustentable
  "1.1": {
    lidera: "sub-planificacion-urbana",
    participan: ["dir-planificacion-urbanistica", "dir-proyectos", "dir-espacios-verdes"],
  },
  "1.2": { lidera: "sec-atencion", participan: ["dir-centros-vecinales", "dir-innovacion"] },
  "1.3": {
    lidera: "dir-planificacion-estrategica",
    participan: ["dir-centros-vecinales", "dir-planificacion-urbanistica"],
  },
  "2.1": { lidera: "dir-obras-viales", participan: ["dir-gerencia-datos"] },
  "2.2": { lidera: "dir-obras-viales", participan: ["dir-proyectos", "dir-respuesta-rapida"] },
  "2.3": { lidera: "dir-obras-viales", participan: ["dir-defensa-civil"] },
  "3.1": { lidera: "dir-proyectos", participan: ["dir-espacios-verdes", "dir-centros-vecinales"] },
  "3.2": { lidera: "dir-proyectos", participan: ["sub-cultura"] },
  // A2 · Bienestar para todas las familias
  "4.1": { lidera: "sub-residuos", participan: ["dir-limpieza", "dir-salud-ambiental"] },
  "4.2": { lidera: "sub-residuos", participan: ["dir-limpieza"] },
  "4.3": { lidera: "dir-arbolado", participan: ["dir-espacios-verdes", "dir-ambiente"] },
  "4.4": { lidera: "dir-ambiente", participan: ["dir-relaciones-inst"] },
  "5.1": { lidera: "dir-ambiente", participan: ["dir-educacion"] },
  "5.2": { lidera: "dir-ambiente", participan: ["dir-educacion"] },
  "5.3": { lidera: "dir-ambiente", participan: [] },
  "6.1": { lidera: "sub-residuos", participan: ["dir-proyectos"] },
  "6.2": { lidera: "sub-residuos", participan: ["dir-limpieza", "dir-centros-vecinales"] },
  "6.3": { lidera: "dir-ambiente", participan: ["dir-relaciones-inst"] },
  "6.4": { lidera: "dir-ambiente", participan: ["dir-bromatologia"] },
  "6.5": { lidera: "dir-ambiente", participan: ["dir-bromatologia", "dir-salud-ambiental"] },
  "7.1": { lidera: "dir-poblacion-animal", participan: ["dir-salud-ambiental"] },
  "7.2": { lidera: "dir-poblacion-animal", participan: ["dir-salud-ambiental"] },
  // A3 · Cercana, accesible y segura
  "8.1": { lidera: "dir-transporte", participan: ["sub-movilidad"] },
  "8.2": { lidera: "sub-movilidad", participan: ["dir-obras-viales"] },
  "8.3": { lidera: "sub-movilidad", participan: ["dir-obras-viales", "dir-proyectos"] },
  "8.4": { lidera: "dir-transporte", participan: ["dir-adulto-mayor", "dir-casa-azul"] },
  "9.1": { lidera: "dir-monitoreo-movilidad", participan: ["dir-alumbrado", "dir-transito-op"] },
  "10.1": { lidera: "dir-innovacion", participan: ["dir-ia"] },
  "10.2": { lidera: "dir-innovacion", participan: ["dir-gerencia-datos"] },
  "10.3": { lidera: "dir-innovacion", participan: ["dir-educacion", "dir-centros-vecinales"] },
  "10.4": { lidera: "dir-respuesta-rapida", participan: ["dir-alumbrado", "dir-espacios-verdes", "dir-innovacion"] },
  // A4 · Centrada en las personas
  "11.1": { lidera: "dir-asistencia-publica", participan: ["dir-salud"] },
  "11.2": { lidera: "dir-salud", participan: ["sub-desarrollo-humano"] },
  "11.3": { lidera: "dir-salud", participan: ["dir-asistencia-publica"] },
  "11.4": {
    lidera: "sub-desarrollo-humano",
    participan: ["dir-salud", "dir-programas-sociales", "dir-centros-vecinales"],
  },
  "11.5": { lidera: "dir-salud", participan: ["dir-familia"] },
  "11.6": { lidera: "dir-casa-azul", participan: ["dir-tartamudez", "dir-salud"] },
  "12.1": { lidera: "dir-educacion", participan: ["dir-proyectos"] },
  "12.2": { lidera: "dir-educacion", participan: ["dir-innovacion"] },
  "12.3": { lidera: "dir-educacion", participan: ["dir-salud"] },
  "12.4": { lidera: "dir-educacion", participan: ["dir-relaciones-inst"] },
  "13.1": { lidera: "sub-seguridad", participan: ["centro-monitoreo", "patrulla", "dir-alumbrado"] },
  "13.2": { lidera: "sub-gobierno", participan: ["dir-centros-vecinales", "dir-familia"] },
  "13.3": { lidera: "sub-seguridad-vial", participan: ["dir-transito-op", "dir-educacion"] },
  "14.1": { lidera: "dir-turismo", participan: ["dir-casa-azul"] },
  "14.2": { lidera: "dir-turismo", participan: ["dir-innovacion"] },
  "15.1": { lidera: "dir-gestion-cultural", participan: ["dir-centros-vecinales"] },
  "15.2": { lidera: "sub-cultura", participan: ["dir-ninez-juventud"] },
  "15.3": { lidera: "dir-museos-teatros", participan: ["dir-innovacion"] },
  "15.4": { lidera: "dir-gestion-cultural", participan: ["dir-educacion"] },
  // A5 · Abierta y de oportunidades
  "16.1": { lidera: "dir-deportes", participan: ["dir-centros-vecinales", "dir-ninez-juventud"] },
  "16.2": { lidera: "dir-ninez-juventud", participan: ["dir-espacios-verdes", "dir-educacion"] },
  "16.3": { lidera: "dir-adulto-mayor", participan: ["dir-espacios-verdes", "dir-salud"] },
  "16.4": { lidera: "dir-ninez-juventud", participan: ["dir-empleo", "dir-eventos"] },
  "16.5": { lidera: "dir-planificacion-estrategica", participan: ["dir-centros-vecinales", "dir-presupuesto"] },
  "16.6": { lidera: "dir-empleo", participan: ["dir-educacion", "dir-ninez-juventud"] },
  "16.7": { lidera: "dir-genero", participan: [] },
  "16.8": { lidera: "dir-genero", participan: ["dir-informacion-estrategica", "dir-familia"] },
  "17.1": { lidera: "dir-empleo", participan: ["dir-programas-sociales"] },
  "17.2": { lidera: "dir-empleo", participan: ["dir-ambiente"] },
  "17.3": { lidera: "sub-residuos", participan: ["dir-empleo", "dir-programas-sociales"] },
  "17.4": { lidera: "dir-politica-fiscal", participan: ["dir-ingresos"] },
  "17.5": { lidera: "dir-ingresos", participan: ["dir-innovacion", "dir-informatica-tributaria"] },
};

/** Las puertas de entrada al barrio: se suman a cualquier intervención territorial. */
export const AREAS_TERRITORIALES = ["dir-centros-vecinales", "dir-respuesta-rapida"];

export function areasDePolitica(codigo: string): { lidera: Area | null; participan: Area[] } {
  const r = AREAS_POLITICA[codigo];
  if (!r) return { lidera: null, participan: [] };
  return {
    lidera: AREA.get(r.lidera) ?? null,
    participan: r.participan.map((id) => AREA.get(id)).filter((x): x is Area => !!x),
  };
}

/** Nombre corto para chips y tablas: sin «Dirección de», «Subsecretaría de». */
export function nombreCorto(x: Area): string {
  return x.nombre
    .replace(/^Dirección (General )?(de |del |de la )?/, "")
    .replace(/^Subsecretaría de /, "Subsec. ")
    .replace(/^Secretaría de /, "Sec. ");
}

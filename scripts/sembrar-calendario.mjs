import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/**
 * Siembra el calendario electoral con los plazos de Tucumán.
 *
 * `dias_antes` usa los offsets del CRONOGRAMA REAL de 2027 (Res. 11/2026 de la
 * Junta Electoral Provincial), que es el que efectivamente rige, y `norma` cita
 * el mínimo legal que lo respalda. Donde la ley solo fija un mínimo y la Junta
 * puede adelantarlo, se anota el mínimo en las notas.
 *
 * `certeza` es 'verificado' cuando el plazo está en la norma citada o en el
 * cronograma oficial; 'a confirmar' cuando depende de una resolución por
 * elección y no hay regla deducible.
 */
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const HITOS = [
  {
    hito: "Convocatoria a elecciones",
    dias_antes: 286,
    norma: "Sin plazo provincial · CEN art. 54 (90 días) como supletorio",
    responsable: "Poder Ejecutivo provincial",
    certeza: "a confirmar",
    notas: "En 2027 se convocó el 27-07-2026 (T-286). No hay regla: en 2023 fue T-209 y en Alberdi 2025, T-111. Ni la Ley 7876 ni la 5529 fijan anticipación.",
  },
  {
    hito: "Cierre del registro de electores",
    dias_antes: 180,
    norma: "CEN art. 25 (supletorio)",
    responsable: "Cámara Nacional Electoral",
    certeza: "verificado",
    notas: "10-11-2026 según el cronograma 2027.",
  },
  {
    hito: "Partidos con personería reconocida",
    dias_antes: 180,
    norma: "Ley 5454 art. 3 (mod. Ley 9111)",
    responsable: "Partidos · Junta Electoral",
    certeza: "verificado",
    notas: "10-11-2026. El plazo surge de resoluciones de la Junta que lo aplican; el texto consolidado accesible es anterior a la Ley 9111.",
  },
  {
    hito: "Inscripción de alianzas y frentes",
    dias_antes: 69,
    norma: "Ley 5454 art. 20: no menos de 60 días",
    responsable: "Apoderados de los partidos",
    certeza: "verificado",
    notas: "01-03-2027 según el cronograma 2027. El mínimo legal es 60 días: la Junta lo adelantó a 69.",
  },
  {
    hito: "Elecciones internas cerradas",
    dias_antes: 60,
    norma: "Ley 5454",
    responsable: "Partidos",
    certeza: "verificado",
    notas: "10-03-2027.",
  },
  {
    hito: "Padrón definitivo impreso y exhibido",
    dias_antes: 52,
    norma: "Ley 7876 art. 11: al menos 30 días",
    responsable: "Junta Electoral Provincial",
    certeza: "verificado",
    notas: "18-03-2027. Los reclamos al padrón se presentan dentro de los 10 días de la exhibición (Ley 7876 art. 13). ES LA FECHA EN QUE APARECE EL PADRÓN NUEVO, con los que votan por primera vez.",
  },
  {
    hito: "Oficialización de listas de candidatos",
    dias_antes: 30,
    norma: "Ley 7876 art. 26: al menos 30 días",
    responsable: "Apoderados de las listas",
    certeza: "verificado",
    notas: "09-04-2027. Es el plazo más rígido del calendario: se cumplió exacto en 2023 y en 2027.",
  },
  {
    hito: "Registro de ACOPLES",
    dias_antes: 30,
    norma: "Ley 7876 art. 27 · Constitución provincial art. 43 inc. 12",
    responsable: "Apoderados",
    certeza: "verificado",
    notas: "09-04-2027, la misma fecha que las listas. Definir los acoples ANTES: en concejales cada lista compite por separado y fragmentarse cuesta bancas.",
  },
  {
    hito: "Prohibición de inaugurar obras públicas",
    dias_antes: 30,
    norma: "Ley 7876 art. 34",
    responsable: "Ejecutivo municipal",
    certeza: "verificado",
    notas: "09-04-2027. Aplica a actos de gobierno con fines proselitistas.",
  },
  {
    hito: "Inicio de la campaña electoral",
    dias_antes: 30,
    norma: "Ley 7876 art. 33",
    responsable: "Campaña",
    certeza: "verificado",
    notas: "09-04-2027. Si la elección coincide con una nacional, el art. 33 remite al cronograma nacional.",
  },
  {
    hito: "Impugnación de candidatos",
    dias_antes: 27,
    norma: "Ley 7876",
    responsable: "Apoderados",
    certeza: "verificado",
    notas: "12-04-2027.",
  },
  {
    hito: "Resolución de oficialización de listas",
    dias_antes: 24,
    norma: "Ley 7876",
    responsable: "Junta Electoral Provincial",
    certeza: "verificado",
    notas: "15-04-2027.",
  },
  {
    hito: "Oficialización del modelo de boletas",
    dias_antes: 20,
    norma: "Ley 7876 art. 45: al menos 20 días",
    responsable: "Apoderados · Junta Electoral",
    certeza: "verificado",
    notas: "19-04-2027. Tucumán conserva boleta partidaria con acoples: la Boleta Única nacional (Ley 27.781) NO aplica acá.",
  },
  {
    hito: "Audiencia de apoderados",
    dias_antes: 16,
    norma: "Ley 7876",
    responsable: "Apoderados",
    certeza: "verificado",
    notas: "23-04-2027.",
  },
  {
    hito: "Votos testigo y armado de mazos",
    dias_antes: 12,
    norma: "Ley 7876",
    responsable: "Junta Electoral Provincial",
    certeza: "verificado",
    notas: "27-04-2027.",
  },
  {
    hito: "Acreditación de fiscales generales",
    dias_antes: 5,
    norma: "Ley 7876 art. 31: mínimo 24 horas",
    responsable: "Apoderados",
    certeza: "verificado",
    notas: "04-05-2027. OJO: el mínimo legal son 24 horas pero la Junta siempre exige más (T-5 en 2027, T-3 en 2023, T-2 en Alberdi 2025). Los fiscales DE MESA no tienen plazo previo: se presentan ante el presidente de mesa.",
  },
  {
    hito: "Veda: cierre de campaña y publicidad",
    dias_antes: 2,
    norma: "CEN art. 64 bis y art. 71 inc. e)",
    responsable: "Campaña",
    certeza: "verificado",
    notas: "07-05-2027 a las 08:00. La veda de encuestas rige durante el comicio y hasta 3 horas después del cierre (CEN art. 71 inc. h).",
  },
  {
    hito: "Protestas sobre el funcionamiento de mesas",
    dias_antes: -2,
    norma: "CEN arts. 110 y 111 (plazo de caducidad)",
    responsable: "Apoderados",
    certeza: "verificado",
    notas: "11-05-2027 18:00, es decir DOS DÍAS DESPUÉS de la elección. Vencido el plazo, caduca.",
  },
  {
    hito: "Escrutinio definitivo",
    dias_antes: -2,
    norma: "CEN art. 112",
    responsable: "Junta Electoral Provincial",
    certeza: "verificado",
    notas: "Arranca al vencer las 48 horas de protestas.",
  },
];

const { count } = await s.from("calendario_hitos").select("*", { count: "exact", head: true });
if (count && count > 0) {
  console.log(`ya hay ${count} hitos cargados: no se siembra de nuevo (borralos antes si querés reemplazarlos)`);
  process.exit(0);
}
const { error } = await s.from("calendario_hitos").insert(HITOS);
if (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
const { data } = await s.from("calendario_hitos").select("hito, dias_antes, certeza").order("dias_antes", { ascending: false });
console.log(`sembrados ${data.length} hitos:`);
for (const h of data) {
  console.log(`  T${h.dias_antes >= 0 ? "-" : "+"}${Math.abs(h.dias_antes)}`.padEnd(8), h.hito.padEnd(46), h.certeza);
}

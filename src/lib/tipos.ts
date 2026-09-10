export type RolUsuario = "superadmin" | "admin";

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  debe_cambiar_password: boolean;
}

export type TipoEspacio = "distrito" | "circuito";

export interface Persona {
  id: number;
  nombre: string;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
}

export interface Asignacion {
  id: number;
  persona_id: number;
  tipo: TipoEspacio;
  codigo: string;
  rol_asignacion: string | null;
  personas?: Persona | null;
}

/**
 * Acción visual que Elena puede pedirle al mapa desde un análisis:
 * resaltar un conjunto de circuitos, pintar una métrica por circuito
 * (coropleta, admite valores negativos) o marcar un barrio oficial.
 */
export type AccionMapaElena =
  | { modo: "resaltar"; circuitos: string[]; etiqueta: string }
  | { modo: "pintar"; etiqueta: string; valores: Array<{ circuito: string; valor: number }> }
  | { modo: "barrio"; barrio: string };

export interface Tarea {
  id: number;
  asignacion_id: number;
  titulo: string;
  hecha: boolean;
  hecha_en: string | null;
}

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

export interface Tarea {
  id: number;
  asignacion_id: number;
  titulo: string;
  hecha: boolean;
  hecha_en: string | null;
}

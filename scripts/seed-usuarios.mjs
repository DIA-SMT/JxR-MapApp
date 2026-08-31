/**
 * Seed de usuarios de JxR MapApp — idempotente.
 * Crea el superadmin y los admins 1–6 con contraseña inicial temporal;
 * todos deben cambiarla en su primer ingreso (debe_cambiar_password).
 *
 * Uso:  node scripts/seed-usuarios.mjs
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local
 * (o del entorno). No imprime credenciales.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// .env.local minimalista (sin dependencia de dotenv)
try {
  for (const linea of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = linea.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* sin .env.local: se esperan variables en el entorno */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const passwordInicial = process.env.SEED_PASSWORD_INICIAL ?? "123456";
if (!url || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const USUARIOS = [
  { email: "direccionia@jxr.com", nombre: "Dirección IA", rol: "superadmin" },
  ...Array.from({ length: 6 }, (_, i) => ({
    email: `admin${i + 1}@jxr.com`,
    nombre: `Admin ${i + 1}`,
    rol: "admin",
  })),
];

// Mapa email → id de los usuarios ya existentes
const existentes = new Map();
for (let pagina = 1; ; pagina++) {
  const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
  if (error) throw error;
  for (const u of data.users) existentes.set(u.email?.toLowerCase(), u.id);
  if (data.users.length < 200) break;
}

for (const u of USUARIOS) {
  let id = existentes.get(u.email);
  if (id) {
    console.log(`= ${u.email} ya existe`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: passwordInicial,
      email_confirm: true,
    });
    if (error) throw new Error(`${u.email}: ${error.message}`);
    id = data.user.id;
    console.log(`+ ${u.email} creado (${u.rol})`);
  }
  const { error: errorPerfil } = await admin.from("perfiles").upsert(
    { id, email: u.email, nombre: u.nombre, rol: u.rol, debe_cambiar_password: true },
    { onConflict: "id" },
  );
  if (errorPerfil) throw new Error(`perfil ${u.email}: ${errorPerfil.message}`);
}

console.log("Listo: 1 superadmin + 6 admins con cambio de contraseña obligatorio.");

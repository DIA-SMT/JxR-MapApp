import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { sesionConPerfil } from "@/lib/supabase/servidor";

/**
 * Alta y baja de usuarios — SOLO superadmin. Usa el service role en el server;
 * el rol del solicitante se verifica contra su perfil en cada llamada.
 */

async function exigirSuperadmin() {
  const sesion = await sesionConPerfil();
  if (!sesion || sesion.perfil.rol !== "superadmin") return null;
  return sesion;
}

const crearSchema = z.object({
  email: z.string().email().max(120),
  nombre: z.string().min(2).max(80),
  rol: z.enum(["admin", "superadmin"]).default("admin"),
  passwordInicial: z.string().min(6).max(72).default("123456"),
});

export async function POST(req: NextRequest) {
  const sesion = await exigirSuperadmin();
  if (!sesion) return NextResponse.json({ error: "solo superadmin" }, { status: 403 });

  const cuerpo = crearSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "datos inválidos" }, { status: 400 });
  const { email, nombre, rol, passwordInicial } = cuerpo.data;

  const admin = crearClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: email.toLowerCase(),
    password: passwordInicial,
    email_confirm: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { error: errorPerfil } = await admin.from("perfiles").insert({
    id: data.user.id,
    email: email.toLowerCase(),
    nombre,
    rol,
    debe_cambiar_password: true,
  });
  if (errorPerfil) {
    // sin perfil el usuario no puede operar: revertir el alta
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: errorPerfil.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data.user.id });
}

const borrarSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const sesion = await exigirSuperadmin();
  if (!sesion) return NextResponse.json({ error: "solo superadmin" }, { status: 403 });

  const cuerpo = borrarSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return NextResponse.json({ error: "datos inválidos" }, { status: 400 });
  if (cuerpo.data.id === sesion.perfil.id) {
    return NextResponse.json({ error: "no podés eliminar tu propia cuenta" }, { status: 400 });
  }

  const admin = crearClienteAdmin();
  const { error } = await admin.auth.admin.deleteUser(cuerpo.data.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

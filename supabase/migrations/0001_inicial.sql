-- ═══════════════════════════════════════════════════════════════════════════
-- JxR MapApp — esquema inicial
-- Comando territorial electoral: espacios (distritos/circuitos) asignados a
-- personas, con checklist de tareas por asignación.
-- Todos los usuarios de la app son administradores (rol admin o superadmin);
-- el superadmin además crea y elimina usuarios (vía service role, no RLS).
-- ═══════════════════════════════════════════════════════════════════════════

create type public.rol_usuario as enum ('superadmin', 'admin');
create type public.tipo_espacio as enum ('distrito', 'circuito');

-- ── Perfiles (1:1 con auth.users) ────────────────────────────────────────────
create table public.perfiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null unique,
  nombre                text not null,
  rol                   public.rol_usuario not null default 'admin',
  debe_cambiar_password boolean not null default true,
  creado_en             timestamptz not null default now()
);

-- ── Personas del territorio (a quienes se les asignan espacios) ─────────────
create table public.personas (
  id         bigint generated always as identity primary key,
  nombre     text not null,
  telefono   text,
  email      text,
  notas      text,
  creado_por uuid references public.perfiles (id) on delete set null,
  creado_en  timestamptz not null default now()
);

-- ── Asignaciones: una persona a cargo de un espacio ─────────────────────────
-- codigo: '1'..'20' para distrito · '15B', '18A', … para circuito.
create table public.asignaciones (
  id              bigint generated always as identity primary key,
  persona_id      bigint not null references public.personas (id) on delete cascade,
  tipo            public.tipo_espacio not null,
  codigo          text not null,
  rol_asignacion  text,
  creado_por      uuid references public.perfiles (id) on delete set null,
  creado_en       timestamptz not null default now(),
  unique (persona_id, tipo, codigo)
);
create index asignaciones_espacio_idx on public.asignaciones (tipo, codigo);

-- ── Tareas: checklist de cada asignación ─────────────────────────────────────
create table public.tareas (
  id            bigint generated always as identity primary key,
  asignacion_id bigint not null references public.asignaciones (id) on delete cascade,
  titulo        text not null,
  hecha         boolean not null default false,
  hecha_en      timestamptz,
  hecha_por     uuid references public.perfiles (id) on delete set null,
  creado_por    uuid references public.perfiles (id) on delete set null,
  creado_en     timestamptz not null default now()
);
create index tareas_asignacion_idx on public.tareas (asignacion_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.perfiles     enable row level security;
alter table public.personas     enable row level security;
alter table public.asignaciones enable row level security;
alter table public.tareas       enable row level security;

-- security definer para no recursar sobre las policies de perfiles
create function public.tiene_perfil()
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from perfiles where id = auth.uid()); $$;

-- Perfiles: todos los admins se ven entre sí; cada uno solo edita lo suyo
-- (columnas limitadas por grant). Altas y bajas: únicamente service role.
create policy perfiles_select on public.perfiles
  for select to authenticated using (public.tiene_perfil());
create policy perfiles_update_propio on public.perfiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Personas / asignaciones / tareas: cualquier usuario con perfil opera.
create policy personas_todo on public.personas
  for all to authenticated using (public.tiene_perfil()) with check (public.tiene_perfil());
create policy asignaciones_todo on public.asignaciones
  for all to authenticated using (public.tiene_perfil()) with check (public.tiene_perfil());
create policy tareas_todo on public.tareas
  for all to authenticated using (public.tiene_perfil()) with check (public.tiene_perfil());

-- ── Privilegios ──────────────────────────────────────────────────────────────
revoke all on public.perfiles, public.personas, public.asignaciones, public.tareas from anon;
revoke insert, update, delete on public.perfiles from authenticated;
-- del propio perfil solo se puede tocar el nombre y la marca de cambio de clave
grant update (nombre, debe_cambiar_password) on public.perfiles to authenticated;

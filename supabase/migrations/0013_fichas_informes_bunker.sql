-- 0013 · Inteligencia territorial operativa
--   1. fichas_territoriales: el plan de cada territorio (segmento, problemática,
--      mensaje, propuesta, abordaje) editable por el equipo — la capa que
--      convierte el análisis en operación.
--   2. informes: informes de situación generados por Elena, compartidos.
--   3. bunker_config + bunker_cargas: carga de resultados mesa a mesa en vivo
--      la noche de una elección (los fiscales cargan desde el teléfono).

-- ── 1. Ficha de inteligencia territorial por circuito o barrio ───────────────
create table if not exists public.fichas_territoriales (
  id           bigint generated always as identity primary key,
  nivel        text not null check (nivel in ('circuito', 'barrio')),
  codigo       text not null,      -- '15B' para circuito, el nombre oficial para barrio
  segmento     text not null default '',
  problematica text not null default '',
  mensaje      text not null default '',
  propuesta    text not null default '',
  abordaje     text not null default '',
  estado       text not null default 'borrador' check (estado in ('borrador', 'validada')),
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en  timestamptz not null default now(),
  unique (nivel, codigo)
);

alter table public.fichas_territoriales enable row level security;
drop policy if exists fichas_territoriales_todo on public.fichas_territoriales;
create policy fichas_territoriales_todo on public.fichas_territoriales
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.fichas_territoriales from anon;

-- ── 2. Informes de situación (los genera Elena, los comparte el equipo) ──────
create table if not exists public.informes (
  id          bigint generated always as identity primary key,
  titulo      text not null,
  contenido   text not null,
  generado_por uuid references public.perfiles (id) on delete set null,
  generado_en  timestamptz not null default now()
);

alter table public.informes enable row level security;
drop policy if exists informes_todo on public.informes;
create policy informes_todo on public.informes
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.informes from anon;

-- ── 3. Búnker: escrutinio propio en vivo ─────────────────────────────────────
-- Una elección por vez (fila única): nombre, categoría, bancas en juego y las
-- listas que compiten. "Reiniciar" borra las cargas y arranca otra elección.
create table if not exists public.bunker_config (
  id              int primary key default 1 check (id = 1),
  eleccion        text not null default 'Elección 2027',
  categoria       text not null default 'CONCEJAL',
  bancas          int  not null default 18,
  mesas_esperadas int  not null default 1350,
  listas          jsonb not null default '[]'::jsonb,  -- ["JxR", "Frente X", …]
  activa          boolean not null default false,
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en  timestamptz not null default now()
);
insert into public.bunker_config (id) values (1) on conflict (id) do nothing;

alter table public.bunker_config enable row level security;
drop policy if exists bunker_config_todo on public.bunker_config;
create policy bunker_config_todo on public.bunker_config
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.bunker_config from anon;

-- Una carga por mesa (el fiscal corrige re-cargando la misma mesa)
create table if not exists public.bunker_cargas (
  id         bigint generated always as identity primary key,
  mesa       int  not null unique,
  circuito   text not null,
  escuela    text not null default '',
  electores  int,
  votos      jsonb not null default '{}'::jsonb,  -- {"JxR": 123, "Frente X": 98}
  blancos    int not null default 0,
  nulos      int not null default 0,
  total      int not null default 0,              -- votantes de la mesa (sobres)
  cargado_por uuid references public.perfiles (id) on delete set null,
  cargado_en  timestamptz not null default now()
);
create index if not exists bunker_cargas_circuito_idx on public.bunker_cargas (circuito);

alter table public.bunker_cargas enable row level security;
drop policy if exists bunker_cargas_todo on public.bunker_cargas;
create policy bunker_cargas_todo on public.bunker_cargas
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.bunker_cargas from anon;

-- PostgREST: refrescar el schema cache para que las tablas nuevas existan
notify pgrst, 'reload schema';

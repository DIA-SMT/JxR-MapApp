-- 0014 · DÍA D — todo lo que hace falta la jornada electoral
--
-- El búnker pasa a ser una parte del DÍA D, que suma las tres cosas que de
-- verdad se necesitan ese día: saber QUIÉN está en cada mesa y poder llamarlo,
-- ver CÓMO VIENE LA PARTICIPACIÓN para decidir dónde traccionar, y registrar
-- los PROBLEMAS para resolverlos desde el comando.
--
-- Las tablas del búnker se renombran (no hay datos cargados) y la
-- configuración se abre para que el administrador parametrice la jornada.

-- ── 1. Renombre y parametrización ───────────────────────────────────────────
alter table if exists public.bunker_config rename to diad_config;
alter table if exists public.bunker_cargas rename to diad_cargas;

do $$
begin
  -- índice heredado del nombre viejo
  if exists (select 1 from pg_class where relname = 'bunker_cargas_circuito_idx') then
    execute 'alter index bunker_cargas_circuito_idx rename to diad_cargas_circuito_idx';
  end if;
end $$;

alter table public.diad_config
  add column if not exists fecha             date,
  add column if not exists hora_apertura     text not null default '08:00',
  add column if not exists hora_cierre       text not null default '18:00',
  add column if not exists meta_votos        int  not null default 0,
  add column if not exists telefono_comando  text not null default '',
  -- cortes horarios en los que el fiscal reporta cuánta gente votó
  add column if not exists cortes            jsonb not null default '["10:00","12:00","14:00","16:00","18:00"]'::jsonb;

-- Las políticas viejas siguen funcionando (se renombraron con la tabla), pero
-- se recrean con el nombre nuevo para que el esquema se lea claro.
drop policy if exists bunker_config_todo on public.diad_config;
drop policy if exists diad_config_todo on public.diad_config;
create policy diad_config_todo on public.diad_config
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));

drop policy if exists bunker_cargas_todo on public.diad_cargas;
drop policy if exists diad_cargas_todo on public.diad_cargas;
create policy diad_cargas_todo on public.diad_cargas
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));

-- ── 2. Fiscal de cada mesa ──────────────────────────────────────────────────
-- Se puede apuntar a una persona del operativo (y hereda su teléfono) o cargar
-- nombre y teléfono sueltos: el día previo hay que anotar gente rápido, sin
-- obligar a crear la ficha completa de cada uno.
create table if not exists public.diad_fiscales (
  mesa       int primary key,
  escuela    text not null default '',
  circuito   text not null default '',
  persona_id bigint references public.personas (id) on delete set null,
  nombre     text not null default '',
  telefono   text not null default '',
  rol        text not null default 'fiscal de mesa',
  -- asignado: anotado · confirmado: avisó que va · presente: está en la escuela
  -- ausente: no llegó y hay que reemplazarlo
  estado     text not null default 'asignado'
             check (estado in ('asignado', 'confirmado', 'presente', 'ausente')),
  notas      text not null default '',
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en  timestamptz not null default now()
);
create index if not exists diad_fiscales_escuela_idx on public.diad_fiscales (escuela);
create index if not exists diad_fiscales_circuito_idx on public.diad_fiscales (circuito);

alter table public.diad_fiscales enable row level security;
drop policy if exists diad_fiscales_todo on public.diad_fiscales;
create policy diad_fiscales_todo on public.diad_fiscales
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.diad_fiscales from anon;

-- ── 3. Asistencia por cortes horarios ───────────────────────────────────────
-- El fiscal reporta cuánta gente votó a cada hora. Es el dato que dice DÓNDE
-- TRACCIONAR mientras la elección está abierta, no después.
create table if not exists public.diad_asistencia (
  mesa    int  not null,
  corte   text not null,          -- '10:00', '12:00', … (los define diad_config.cortes)
  votaron int  not null default 0,
  cargado_por uuid references public.perfiles (id) on delete set null,
  cargado_en  timestamptz not null default now(),
  primary key (mesa, corte)
);
create index if not exists diad_asistencia_corte_idx on public.diad_asistencia (corte);

alter table public.diad_asistencia enable row level security;
drop policy if exists diad_asistencia_todo on public.diad_asistencia;
create policy diad_asistencia_todo on public.diad_asistencia
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.diad_asistencia from anon;

-- ── 4. Incidencias ──────────────────────────────────────────────────────────
create table if not exists public.diad_incidencias (
  id        bigint generated always as identity primary key,
  mesa      int,                  -- puede ser de toda la escuela
  escuela   text not null default '',
  circuito  text not null default '',
  tipo      text not null default 'otro',
  gravedad  text not null default 'media' check (gravedad in ('baja', 'media', 'alta')),
  detalle   text not null default '',
  estado    text not null default 'abierta' check (estado in ('abierta', 'resuelta')),
  creado_por  uuid references public.perfiles (id) on delete set null,
  creado_en   timestamptz not null default now(),
  resuelto_en timestamptz
);
create index if not exists diad_incidencias_estado_idx on public.diad_incidencias (estado, gravedad);

alter table public.diad_incidencias enable row level security;
drop policy if exists diad_incidencias_todo on public.diad_incidencias;
create policy diad_incidencias_todo on public.diad_incidencias
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.diad_incidencias from anon;

-- ── 5. Cobertura de fiscalización ───────────────────────────────────────────
/**
 * Mesas del padrón provincial con su fiscal, agrupadas por escuela o circuito:
 * cuántas mesas hay, cuántas tienen fiscal y en qué estado. Es la respuesta a
 * «¿dónde no tenemos a nadie?», que el día de la elección es la pregunta.
 */
create or replace function public.diad_cobertura(p_nivel text default 'escuela')
returns table (
  espacio text, circuito text,
  mesas bigint, electores bigint,
  con_fiscal bigint, confirmados bigint, presentes bigint, ausentes bigint,
  sin_fiscal bigint, pct_cubierto numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := lower(coalesce(p_nivel, 'escuela'));
  if v_nivel not in ('escuela', 'circuito') then
    raise exception 'nivel inválido: usá escuela o circuito';
  end if;

  return query
  select case v_nivel when 'circuito' then 'Circuito ' || m.circuito else coalesce(m.escuela, 'sin escuela') end,
         max(m.circuito),
         count(*)::bigint,
         sum(m.electores)::bigint,
         count(f.mesa)::bigint,
         count(*) filter (where f.estado = 'confirmado')::bigint,
         count(*) filter (where f.estado = 'presente')::bigint,
         count(*) filter (where f.estado = 'ausente')::bigint,
         (count(*) - count(f.mesa))::bigint,
         round(100.0 * count(f.mesa) / greatest(1, count(*)), 1)
  from public.mesas m
  left join public.diad_fiscales f on f.mesa = m.mesa
  group by 1
  -- lo descubierto primero: es lo que hay que resolver
  order by (count(*) - count(f.mesa)) desc, 4 desc;
end $fn$;

/**
 * Participación en vivo por circuito a un corte horario: votaron sobre el
 * padrón de las mesas que reportaron. Sirve para comparar circuitos entre sí
 * (el denominador es solo lo reportado, así que se lee como muestra).
 */
create or replace function public.diad_participacion(p_corte text)
returns table (
  circuito text, mesas_reportadas bigint, mesas_totales bigint,
  votaron bigint, electores_reportados bigint, pct numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  with tot as (
    select m.circuito as circ, count(*)::bigint as n from public.mesas m group by 1
  ), rep as (
    select m.circuito as circ,
           count(*)::bigint as n,
           sum(a.votaron)::bigint as v,
           sum(m.electores)::bigint as e
    from public.diad_asistencia a
    join public.mesas m on m.mesa = a.mesa
    where a.corte = p_corte
    group by 1
  )
  select tot.circ, coalesce(rep.n, 0), tot.n,
         coalesce(rep.v, 0), coalesce(rep.e, 0),
         case when coalesce(rep.e, 0) > 0 then round(100.0 * rep.v / rep.e, 1) end
  from tot left join rep on rep.circ = tot.circ
  order by 6 desc nulls last;
end $fn$;

-- PostgREST: refrescar el schema cache
notify pgrst, 'reload schema';

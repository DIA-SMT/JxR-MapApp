-- ═══════════════════════════════════════════════════════════════════════════
-- Padrón electoral de San Miguel de Tucumán (459.197 electores, 128 escuelas)
-- Los datos NUNCA viven en el repo: se cargan por script con service role.
-- Lectura: solo usuarios autenticados con perfil (RLS). Sin escritura desde
-- el cliente. El análisis expuesto es AGREGADO (circuito / sexo / franja
-- etaria estimada); las consultas individuales son solo de logística
-- electoral (dónde vota una persona).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

create table public.electores (
  id                 bigint generated always as identity primary key,
  dni                text not null,
  tipo_ejemplar      text,
  apellido_nombre    text not null,
  domicilio          text,
  sexo               text check (sexo in ('F', 'M', 'X')),
  circuito           text,
  mesa               int,
  orden_mesa         int,
  establecimiento    text,
  -- Estimación por rango de DNI (el padrón no trae fecha de nacimiento).
  -- Aproximada (±3 años): sirve para cohortes agregadas, no para individuos.
  anio_nac_estimado  int
);
create index electores_circuito_idx on public.electores (circuito);
create index electores_dni_idx on public.electores (dni text_pattern_ops);
create index electores_nombre_trgm_idx on public.electores using gin (apellido_nombre gin_trgm_ops);

create table public.escuelas (
  id        bigint generated always as identity primary key,
  nombre    text not null unique,
  circuito  text,
  electores int not null default 0,
  mesas     int,
  lat       double precision,
  lon       double precision
);

-- ── RLS: lectura para admins autenticados, escritura solo service role ──────
alter table public.electores enable row level security;
alter table public.escuelas  enable row level security;

create policy electores_select on public.electores
  for select to authenticated using (public.tiene_perfil());
create policy escuelas_select on public.escuelas
  for select to authenticated using (public.tiene_perfil());

revoke all on public.electores, public.escuelas from anon;
revoke insert, update, delete on public.electores, public.escuelas from authenticated;

-- ── Agregaciones (security invoker: corren bajo el RLS del usuario) ──────────

/** Electores por circuito, con microsegmentación opcional por sexo y franja
    etaria estimada. Alimenta la coropleta/3D del mapa. */
create or replace function public.padron_por_circuito(
  p_sexo text default null,
  p_edad_min int default null,
  p_edad_max int default null
) returns table (circuito text, total bigint, mujeres bigint, varones bigint)
language sql stable
as $$
  select e.circuito,
         count(*) as total,
         count(*) filter (where e.sexo = 'F') as mujeres,
         count(*) filter (where e.sexo = 'M') as varones
  from public.electores e
  where (p_sexo is null or e.sexo = p_sexo)
    and (p_edad_min is null or (extract(year from now())::int - e.anio_nac_estimado) >= p_edad_min)
    and (p_edad_max is null or (extract(year from now())::int - e.anio_nac_estimado) <= p_edad_max)
  group by e.circuito
$$;

/** Panorama general del padrón (KPIs y desgloses). */
create or replace function public.padron_resumen()
returns json
language sql stable
as $$
  select json_build_object(
    'total', count(*),
    'mujeres', count(*) filter (where sexo = 'F'),
    'varones', count(*) filter (where sexo = 'M'),
    'otros', count(*) filter (where sexo = 'X'),
    'con_mesa', count(*) filter (where mesa is not null),
    'circuitos', (select count(distinct circuito) from public.electores where circuito is not null),
    'escuelas', (select count(*) from public.escuelas),
    'franjas_estimadas', json_build_object(
      'e16_25', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 16 and 25),
      'e26_40', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 26 and 40),
      'e41_60', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 41 and 60),
      'e60_mas', count(*) filter (where extract(year from now())::int - anio_nac_estimado > 60),
      'sin_estimar', count(*) filter (where anio_nac_estimado is null)
    )
  )
  from public.electores
$$;

/** Detalle de un circuito: totales, sexo, franjas y sus escuelas. */
create or replace function public.padron_de_circuito(p_circuito text)
returns json
language sql stable
as $$
  select json_build_object(
    'circuito', p_circuito,
    'total', count(*),
    'mujeres', count(*) filter (where sexo = 'F'),
    'varones', count(*) filter (where sexo = 'M'),
    'franjas_estimadas', json_build_object(
      'e16_25', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 16 and 25),
      'e26_40', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 26 and 40),
      'e41_60', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 41 and 60),
      'e60_mas', count(*) filter (where extract(year from now())::int - anio_nac_estimado > 60)
    ),
    'escuelas', (
      select coalesce(json_agg(json_build_object(
        'nombre', s.nombre, 'electores', s.electores, 'mesas', s.mesas
      ) order by s.electores desc), '[]'::json)
      from public.escuelas s where s.circuito = p_circuito
    )
  )
  from public.electores e
  where e.circuito = p_circuito
$$;

/** Búsqueda de electores por nombre o DNI (logística: dónde vota). */
create or replace function public.buscar_electores(
  q text,
  p_circuito text default null,
  p_limite int default 20
) returns table (
  dni text, apellido_nombre text, domicilio text, sexo text,
  circuito text, mesa int, orden_mesa int, establecimiento text
)
language sql stable
as $$
  select dni, apellido_nombre, domicilio, sexo, circuito, mesa, orden_mesa, establecimiento
  from public.electores
  where (
      apellido_nombre ilike '%' || q || '%'
      or (regexp_replace(q, '\D', '', 'g') <> '' and dni like regexp_replace(q, '\D', '', 'g') || '%')
    )
    and (p_circuito is null or circuito = p_circuito)
  order by apellido_nombre
  limit least(greatest(coalesce(p_limite, 20), 1), 50)
$$;

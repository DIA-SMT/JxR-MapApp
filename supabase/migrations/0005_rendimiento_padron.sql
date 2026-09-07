-- ═══════════════════════════════════════════════════════════════════════════
-- Rendimiento sobre 459k filas: las funciones de agregado pasan a SECURITY
-- DEFINER con guardia explícita (tiene_perfil() se evalúa UNA vez, no por
-- fila), y las policies usan (select tiene_perfil()) para que el planificador
-- lo trate como InitPlan. Sin esto, los RPC superan el statement_timeout.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Policies optimizadas (InitPlan en vez de evaluación por fila) ────────────
alter policy perfiles_select on public.perfiles using ((select public.tiene_perfil()));
alter policy personas_todo on public.personas
  using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
alter policy asignaciones_todo on public.asignaciones
  using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
alter policy tareas_todo on public.tareas
  using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
alter policy electores_select on public.electores using ((select public.tiene_perfil()));
alter policy escuelas_select on public.escuelas using ((select public.tiene_perfil()));
alter policy resultados_2023_select on public.resultados_2023 using ((select public.tiene_perfil()));
alter policy mesas_2023_totales_select on public.mesas_2023_totales using ((select public.tiene_perfil()));
alter policy mesas_select on public.mesas using ((select public.tiene_perfil()));
alter policy estrategia_escuelas_todo on public.estrategia_escuelas
  using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));

-- ── Funciones de agregado: security definer + guardia ────────────────────────

create or replace function public.padron_por_circuito(
  p_sexo text default null,
  p_edad_min int default null,
  p_edad_max int default null
) returns table (circuito text, total bigint, mujeres bigint, varones bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select e.circuito,
         count(*)::bigint,
         (count(*) filter (where e.sexo = 'F'))::bigint,
         (count(*) filter (where e.sexo = 'M'))::bigint
  from public.electores e
  where (p_sexo is null or e.sexo = p_sexo)
    and (p_edad_min is null or (extract(year from now())::int - e.anio_nac_estimado) >= p_edad_min)
    and (p_edad_max is null or (extract(year from now())::int - e.anio_nac_estimado) <= p_edad_max)
  group by 1;
end $$;

create or replace function public.padron_resumen()
returns json
language plpgsql stable security definer set search_path = public
as $$
declare r json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  select json_build_object(
    'total', count(*),
    'mujeres', count(*) filter (where sexo = 'F'),
    'varones', count(*) filter (where sexo = 'M'),
    'otros', count(*) filter (where sexo = 'X'),
    'con_mesa', count(*) filter (where mesa is not null),
    'circuitos', (select count(distinct e2.circuito) from public.electores e2 where e2.circuito is not null),
    'escuelas', (select count(*) from public.escuelas),
    'franjas_estimadas', json_build_object(
      'e16_25', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 16 and 25),
      'e26_40', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 26 and 40),
      'e41_60', count(*) filter (where extract(year from now())::int - anio_nac_estimado between 41 and 60),
      'e60_mas', count(*) filter (where extract(year from now())::int - anio_nac_estimado > 60),
      'sin_estimar', count(*) filter (where anio_nac_estimado is null)
    )
  ) into r
  from public.electores;
  return r;
end $$;

create or replace function public.padron_de_circuito(p_circuito text)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare r json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  select json_build_object(
    'circuito', p_circuito,
    'total', count(*),
    'mujeres', count(*) filter (where e.sexo = 'F'),
    'varones', count(*) filter (where e.sexo = 'M'),
    'franjas_estimadas', json_build_object(
      'e16_25', count(*) filter (where extract(year from now())::int - e.anio_nac_estimado between 16 and 25),
      'e26_40', count(*) filter (where extract(year from now())::int - e.anio_nac_estimado between 26 and 40),
      'e41_60', count(*) filter (where extract(year from now())::int - e.anio_nac_estimado between 41 and 60),
      'e60_mas', count(*) filter (where extract(year from now())::int - e.anio_nac_estimado > 60)
    ),
    'escuelas', (
      select coalesce(json_agg(json_build_object(
        'nombre', s.nombre, 'electores', s.electores, 'mesas', s.mesas
      ) order by s.electores desc), '[]'::json)
      from public.escuelas s where s.circuito = p_circuito
    )
  ) into r
  from public.electores e
  where e.circuito = p_circuito;
  return r;
end $$;

create or replace function public.buscar_electores(
  q text,
  p_circuito text default null,
  p_limite int default 20
) returns table (
  dni text, apellido_nombre text, domicilio text, sexo text,
  circuito text, mesa int, orden_mesa int, establecimiento text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select e.dni, e.apellido_nombre, e.domicilio, e.sexo, e.circuito, e.mesa, e.orden_mesa, e.establecimiento
  from public.electores e
  where (
      e.apellido_nombre ilike '%' || q || '%'
      or (regexp_replace(q, '\D', '', 'g') <> '' and e.dni like regexp_replace(q, '\D', '', 'g') || '%')
    )
    and (p_circuito is null or e.circuito = p_circuito)
  order by 2
  limit least(greatest(coalesce(p_limite, 20), 1), 50);
end $$;

create or replace function public.listas_2023(p_categoria text)
returns table (lista_numero int, lista_nombre text, votos bigint, mesas bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select r.lista_numero, max(r.lista_nombre), sum(r.votos)::bigint, count(distinct r.mesa)::bigint
  from public.resultados_2023 r
  where r.categoria = upper(p_categoria)
  group by 1
  order by 3 desc;
end $$;

create or replace function public.votos_por_escuela_2023(p_categoria text, p_listas int[])
returns table (escuela text, circuito text, votos bigint, mesas bigint, electores bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select coalesce(m.escuela, 'Mesa ' || r.mesa),
         coalesce(m.circuito, r.circuito),
         sum(r.votos)::bigint,
         count(distinct r.mesa)::bigint,
         coalesce(max(es.electores), 0)::bigint
  from public.resultados_2023 r
  left join public.mesas m on m.mesa = r.mesa
  left join public.escuelas es on es.nombre = m.escuela
  where r.categoria = upper(p_categoria)
    and r.lista_numero = any (p_listas)
  group by 1, 2
  order by 3 desc;
end $$;

create or replace function public.votos_por_circuito_2023(p_categoria text, p_listas int[])
returns table (circuito text, votos bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select r.circuito, sum(r.votos)::bigint
  from public.resultados_2023 r
  where r.categoria = upper(p_categoria)
    and r.lista_numero = any (p_listas)
    and r.circuito is not null
  group by 1;
end $$;

create or replace function public.estrategia_resumen(
  p_categoria text,
  p_listas int[],
  p_meta int default 20000
) returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_votos bigint;
  v_escuelas bigint;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  select count(*) into v_escuelas from public.estrategia_escuelas ee where ee.incluida;
  select coalesce(sum(v.votos), 0) into v_votos
  from public.votos_por_escuela_2023(p_categoria, p_listas) v
  join public.estrategia_escuelas ee on ee.escuela = v.escuela and ee.incluida;
  return json_build_object(
    'meta', p_meta,
    'escuelas_incluidas', v_escuelas,
    'votos_incluidos', coalesce(v_votos, 0)
  );
end $$;

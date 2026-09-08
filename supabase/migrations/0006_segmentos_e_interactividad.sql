-- ═══════════════════════════════════════════════════════════════════════════
-- Microsegmentación guardable + datos 2023 interactivos en el mapa:
--  · segmentos: cohortes del padrón con filtros jsonb (extensible a más datos)
--  · padron_segmento: conteos en vivo de un segmento
--  · votos_de_escuela_2023: ranking de listas de UNA escuela (popup del mapa)
--  · resumen_2023_circuito: participación + top listas de un circuito
-- Todo agregado; security definer con guardia (rendimiento sobre 459k filas).
-- ═══════════════════════════════════════════════════════════════════════════

create table public.segmentos (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  descripcion text,
  filtros     jsonb not null default '{}'::jsonb,
  creado_por  uuid references public.perfiles (id) on delete set null,
  creado_en   timestamptz not null default now()
);

alter table public.segmentos enable row level security;
create policy segmentos_todo on public.segmentos
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.segmentos from anon;

/** Conteos en vivo de un segmento del padrón (todos los filtros opcionales). */
create or replace function public.padron_segmento(
  p_sexo text default null,
  p_edad_min int default null,
  p_edad_max int default null,
  p_circuitos text[] default null,
  p_con_mesa boolean default null
) returns json
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_total bigint; v_f bigint; v_m bigint; v_mesa bigint;
  v_1625 bigint; v_2640 bigint; v_4160 bigint; v_60 bigint;
  v_circ json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;

  with base as (
    select e.sexo, e.mesa, e.anio_nac_estimado, e.circuito
    from public.electores e
    where (p_sexo is null or e.sexo = p_sexo)
      and (p_edad_min is null or (extract(year from now())::int - e.anio_nac_estimado) >= p_edad_min)
      and (p_edad_max is null or (extract(year from now())::int - e.anio_nac_estimado) <= p_edad_max)
      and (p_circuitos is null or e.circuito = any (p_circuitos))
      and (p_con_mesa is null or (p_con_mesa and e.mesa is not null) or (not p_con_mesa and e.mesa is null))
  )
  select count(*),
         count(*) filter (where sexo = 'F'),
         count(*) filter (where sexo = 'M'),
         count(*) filter (where mesa is not null),
         count(*) filter (where extract(year from now())::int - anio_nac_estimado between 16 and 25),
         count(*) filter (where extract(year from now())::int - anio_nac_estimado between 26 and 40),
         count(*) filter (where extract(year from now())::int - anio_nac_estimado between 41 and 60),
         count(*) filter (where extract(year from now())::int - anio_nac_estimado > 60)
  into v_total, v_f, v_m, v_mesa, v_1625, v_2640, v_4160, v_60
  from base;

  with base as (
    select e.circuito
    from public.electores e
    where (p_sexo is null or e.sexo = p_sexo)
      and (p_edad_min is null or (extract(year from now())::int - e.anio_nac_estimado) >= p_edad_min)
      and (p_edad_max is null or (extract(year from now())::int - e.anio_nac_estimado) <= p_edad_max)
      and (p_circuitos is null or e.circuito = any (p_circuitos))
      and (p_con_mesa is null or (p_con_mesa and e.mesa is not null) or (not p_con_mesa and e.mesa is null))
  )
  select coalesce(json_agg(fila), '[]'::json) into v_circ
  from (
    select json_build_object('circuito', b.circuito, 'total', count(*)) as fila
    from base b
    where b.circuito is not null
    group by b.circuito
    order by count(*) desc
  ) t;

  return json_build_object(
    'total', v_total,
    'mujeres', v_f,
    'varones', v_m,
    'con_mesa', v_mesa,
    'franjas_estimadas', json_build_object(
      'e16_25', v_1625, 'e26_40', v_2640, 'e41_60', v_4160, 'e60_mas', v_60
    ),
    'por_circuito', v_circ
  );
end $fn$;

/** Ranking de listas 2023 de UNA escuela (popup del mapa). */
create or replace function public.votos_de_escuela_2023(
  p_escuela text,
  p_categoria text default 'CONCEJAL'
) returns table (lista_numero int, lista_nombre text, votos bigint)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select r.lista_numero, max(r.lista_nombre), sum(r.votos)::bigint
  from public.resultados_2023 r
  join public.mesas m on m.mesa = r.mesa
  where m.escuela = p_escuela
    and r.categoria = upper(p_categoria)
  group by 1
  order by 3 desc;
end $fn$;

/** Resumen 2023 de un circuito: participación (vs padrón actual, aprox),
    blanco/nulos y top de listas — para el panel del circuito. */
create or replace function public.resumen_2023_circuito(
  p_circuito text,
  p_categoria text default 'CONCEJAL'
) returns json
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_total bigint; v_pos bigint; v_blanco bigint; v_nulos bigint; v_padron bigint;
  v_top json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;

  select coalesce(sum(t.total), 0), coalesce(sum(t.positivos), 0),
         coalesce(sum(t.blanco), 0), coalesce(sum(t.nulos), 0)
  into v_total, v_pos, v_blanco, v_nulos
  from public.mesas_2023_totales t
  where t.circuito = p_circuito and t.categoria = upper(p_categoria);

  select count(*) into v_padron from public.electores e where e.circuito = p_circuito;

  select coalesce(json_agg(fila), '[]'::json) into v_top
  from (
    select json_build_object('numero', r.lista_numero, 'nombre', max(r.lista_nombre), 'votos', sum(r.votos)) as fila
    from public.resultados_2023 r
    where r.circuito = p_circuito and r.categoria = upper(p_categoria)
    group by r.lista_numero
    order by sum(r.votos) desc
    limit 6
  ) t;

  return json_build_object(
    'circuito', p_circuito,
    'categoria', upper(p_categoria),
    'votos_total', v_total,
    'positivos', v_pos,
    'blanco', v_blanco,
    'nulos', v_nulos,
    'padron_actual', v_padron,
    'participacion_pct', case when v_padron > 0 then round(100.0 * v_total / v_padron, 1) else null end,
    'top_listas', v_top
  );
end $fn$;

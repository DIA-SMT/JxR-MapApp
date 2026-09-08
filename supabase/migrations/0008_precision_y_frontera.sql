-- ═══════════════════════════════════════════════════════════════════════════
-- Precisión (hallazgos de auditoría) + Frontera 20K (motor de prioridad).
--  A. votos_por_escuela_2023: una escuela = UNA fila (antes se partía por
--     circuito y duplicaba electores / burlaba el umbral).
--  B. resumen_2023_circuito: participación medida contra los electores de
--     las mesas que EXISTÍAN en 2023 (no contra el padrón actual completo).
--  C. mesas_de_escuela: participación por mesa capeada a 100%.
--  D. padron_segmento: una sola pasada (antes 2 seq-scans de 459k), filtros
--     de edad sargables + índice, e informa los sin-estimar excluidos.
--  E. estrategia_listas: la selección de listas vive en la base (compartida
--     entre pantalla, mapa y Migue — antes cada navegador tenía la suya).
--  F. limpieza: las filas 'Mesa N' (mesas 2023 sin escuela vigente) salen
--     del universo de estrategia_escuelas — inflaban la meta con votos que
--     ningún referente puede trabajar.
--  G. prioridad_escuelas: ranking Frontera 20K (volumen + propensión +
--     descubierto de cobertura) con acumulado hacia la meta.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. Una escuela, una fila ─────────────────────────────────────────────────
create or replace function public.votos_por_escuela_2023(p_categoria text, p_listas int[])
returns table (escuela text, circuito text, votos bigint, mesas bigint, electores bigint)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select coalesce(m.escuela, 'Mesa ' || r.mesa),
         mode() within group (order by coalesce(m.circuito, r.circuito)),
         sum(r.votos)::bigint,
         count(distinct r.mesa)::bigint,
         coalesce(max(es.electores), 0)::bigint
  from public.resultados_2023 r
  left join public.mesas m on m.mesa = r.mesa
  left join public.escuelas es on es.nombre = m.escuela
  where r.categoria = upper(p_categoria)
    and r.lista_numero = any (p_listas)
  group by 1
  order by 3 desc;
end $fn$;

-- ── B. Participación con denominador honesto ─────────────────────────────────
create or replace function public.resumen_2023_circuito(
  p_circuito text,
  p_categoria text default 'CONCEJAL'
) returns json
language plpgsql stable security definer set search_path = public
as $fn$
declare
  v_total bigint; v_pos bigint; v_blanco bigint; v_nulos bigint;
  v_padron bigint; v_padron_2023 bigint;
  v_top json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;

  select coalesce(sum(t.total), 0), coalesce(sum(t.positivos), 0),
         coalesce(sum(t.blanco), 0), coalesce(sum(t.nulos), 0)
  into v_total, v_pos, v_blanco, v_nulos
  from public.mesas_2023_totales t
  where t.circuito = p_circuito and t.categoria = upper(p_categoria);

  select count(*) into v_padron from public.electores e where e.circuito = p_circuito;

  -- electores ACTUALES de las mesas que existían en 2023 (base comparable)
  select coalesce(sum(m.electores), 0) into v_padron_2023
  from public.mesas m
  where m.circuito = p_circuito
    and exists (
      select 1 from public.mesas_2023_totales t2
      where t2.mesa = m.mesa and t2.categoria = upper(p_categoria)
    );

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
    'padron_mesas_2023', v_padron_2023,
    'participacion_pct', case when v_padron_2023 > 0 then round(100.0 * v_total / v_padron_2023, 1) else null end,
    'top_listas', v_top
  );
end $fn$;

-- ── C. Participación por mesa capeada ────────────────────────────────────────
create or replace function public.mesas_de_escuela(
  p_escuela text,
  p_categoria text default 'CONCEJAL'
) returns table (
  mesa int, electores int, votos_2023 int, positivos_2023 int,
  blanco_2023 int, nulos_2023 int, participacion_pct numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select m.mesa, m.electores, t.total, t.positivos, t.blanco, t.nulos,
         case
           when m.electores > 0 and t.total is not null
           then least(round(100.0 * t.total / m.electores, 1), 100)
           else null
         end
  from public.mesas m
  left join public.mesas_2023_totales t
    on t.mesa = m.mesa and t.categoria = upper(p_categoria)
  where m.escuela = p_escuela
  order by m.mesa;
end $fn$;

-- ── D. Segmentos: una pasada, filtros sargables, sin-estimar visibles ────────
create index if not exists electores_anio_nac_idx on public.electores (anio_nac_estimado);

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
  anio int := extract(year from now())::int;
  v_total bigint; v_f bigint; v_m bigint; v_mesa bigint;
  v_1625 bigint; v_2640 bigint; v_4160 bigint; v_60 bigint;
  v_sin bigint := 0;
  v_circ json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;

  with base as (
    select e.sexo, e.mesa, e.anio_nac_estimado, e.circuito
    from public.electores e
    where (p_sexo is null or e.sexo = p_sexo)
      and (p_edad_min is null or e.anio_nac_estimado <= anio - p_edad_min)
      and (p_edad_max is null or e.anio_nac_estimado >= anio - p_edad_max)
      and (p_circuitos is null or e.circuito = any (p_circuitos))
      and (p_con_mesa is null or (p_con_mesa and e.mesa is not null) or (not p_con_mesa and e.mesa is null))
  ), porc as (
    select coalesce(b.circuito, '__sin__') as circ,
           count(*) as n,
           count(*) filter (where b.sexo = 'F') as nf,
           count(*) filter (where b.sexo = 'M') as nm,
           count(*) filter (where b.mesa is not null) as nmesa,
           count(*) filter (where anio - b.anio_nac_estimado between 16 and 25) as n1625,
           count(*) filter (where anio - b.anio_nac_estimado between 26 and 40) as n2640,
           count(*) filter (where anio - b.anio_nac_estimado between 41 and 60) as n4160,
           count(*) filter (where anio - b.anio_nac_estimado > 60) as n60
    from base b
    group by 1
  )
  select coalesce(sum(p.n), 0), coalesce(sum(p.nf), 0), coalesce(sum(p.nm), 0), coalesce(sum(p.nmesa), 0),
         coalesce(sum(p.n1625), 0), coalesce(sum(p.n2640), 0), coalesce(sum(p.n4160), 0), coalesce(sum(p.n60), 0),
         coalesce((select json_agg(json_build_object('circuito', p2.circ, 'total', p2.n) order by p2.n desc)
                   from porc p2 where p2.circ <> '__sin__'), '[]'::json)
  into v_total, v_f, v_m, v_mesa, v_1625, v_2640, v_4160, v_60, v_circ
  from porc p;

  -- electores sin estimación de edad excluidos por el filtro etario
  if p_edad_min is not null or p_edad_max is not null then
    select count(*) into v_sin
    from public.electores e
    where e.anio_nac_estimado is null
      and (p_sexo is null or e.sexo = p_sexo)
      and (p_circuitos is null or e.circuito = any (p_circuitos))
      and (p_con_mesa is null or (p_con_mesa and e.mesa is not null) or (not p_con_mesa and e.mesa is null));
  end if;

  return json_build_object(
    'total', v_total,
    'mujeres', v_f,
    'varones', v_m,
    'con_mesa', v_mesa,
    'franjas_estimadas', json_build_object(
      'e16_25', v_1625, 'e26_40', v_2640, 'e41_60', v_4160, 'e60_mas', v_60
    ),
    'sin_estimar_excluidos', v_sin,
    'por_circuito', v_circ
  );
end $fn$;

-- ── E. Selección de listas compartida (una sola verdad) ──────────────────────
create table public.estrategia_listas (
  categoria    text not null,
  lista_numero int not null,
  primary key (categoria, lista_numero)
);
alter table public.estrategia_listas enable row level security;
create policy estrategia_listas_todo on public.estrategia_listas
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.estrategia_listas from anon;

-- ── F. Limpieza: fuera las pseudo-escuelas 'Mesa N' del universo ─────────────
delete from public.estrategia_escuelas where escuela ~ '^Mesa \d+$';

-- ── G. Frontera 20K: motor de prioridad territorial ──────────────────────────
create or replace function public.prioridad_escuelas(
  p_categoria text default 'CONCEJAL',
  p_listas int[] default null,
  p_meta int default 20000
) returns table (
  escuela text, circuito text, lat double precision, lon double precision,
  votos_dispersos bigint, positivos bigint, pct_disperso numeric,
  electores int, mesas bigint, referentes bigint,
  tareas_total bigint, tareas_hechas bigint,
  incluida boolean, score numeric, tier text, acumulado bigint, en_frontera boolean
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  if p_listas is null or array_length(p_listas, 1) is null then
    raise exception 'faltan las listas a analizar';
  end if;
  return query
  with v as (
    -- voto disperso por escuela REAL (las mesas 2023 sin cruce quedan afuera)
    select m.escuela as esc,
           mode() within group (order by m.circuito) as circ,
           sum(r.votos)::bigint as votos,
           count(distinct r.mesa)::bigint as nmesas
    from public.resultados_2023 r
    join public.mesas m on m.mesa = r.mesa
    where r.categoria = upper(p_categoria)
      and r.lista_numero = any (p_listas)
      and m.escuela is not null
    group by m.escuela
  ), pos as (
    select m.escuela as esc, sum(t.positivos)::bigint as positivos
    from public.mesas_2023_totales t
    join public.mesas m on m.mesa = t.mesa
    where t.categoria = upper(p_categoria) and m.escuela is not null
    group by m.escuela
  ), cob as (
    select a.codigo as circ,
           count(distinct a.persona_id)::bigint as referentes,
           count(t.id)::bigint as tt,
           (count(t.id) filter (where t.hecha))::bigint as th
    from public.asignaciones a
    left join public.tareas t on t.asignacion_id = a.id
    where a.tipo = 'circuito'
    group by a.codigo
  ), base as (
    select v.esc, v.circ, es.lat as la, es.lon as lo,
           v.votos, coalesce(p.positivos, 0) as positivos,
           case when coalesce(p.positivos, 0) > 0 then round(100.0 * v.votos / p.positivos, 1) else null end as pct,
           coalesce(es.electores, 0) as elec, v.nmesas,
           coalesce(c.referentes, 0) as refs, coalesce(c.tt, 0) as tt, coalesce(c.th, 0) as th,
           coalesce(ee.incluida, false) as inc
    from v
    left join pos p on p.esc = v.esc
    left join public.escuelas es on es.nombre = v.esc
    left join cob c on c.circ = v.circ
    left join public.estrategia_escuelas ee on ee.escuela = v.esc
  ), maxes as (
    select greatest(max(b.votos), 1)::numeric as mv, greatest(max(b.pct), 1)::numeric as mp from base b
  ), scored as (
    select b.*,
           round(100 * (
             0.5 * b.votos / mx.mv
             + 0.3 * coalesce(b.pct, 0) / mx.mp
             + 0.2 * (case when b.refs = 0 then 1
                           when b.tt > 0 then 1 - b.th::numeric / b.tt
                           else 0.5 end)
           ), 1) as puntaje
    from base b, maxes mx
  ), acumulada as (
    select s.*, (sum(s.votos) over (order by s.puntaje desc, s.votos desc, s.esc))::bigint as acum
    from scored s
  )
  select a.esc, a.circ, a.la, a.lo,
         a.votos, a.positivos, a.pct,
         a.elec, a.nmesas, a.refs, a.tt, a.th, a.inc,
         a.puntaje,
         case when a.acum - a.votos < p_meta then 'A'
              when a.acum - a.votos < p_meta * 1.6 then 'B'
              else 'C' end,
         a.acum,
         (a.acum - a.votos < p_meta)
  from acumulada a
  order by a.puntaje desc, a.votos desc;
end $fn$;

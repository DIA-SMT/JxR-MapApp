-- ═══════════════════════════════════════════════════════════════════════════
-- Consistencia (segunda ronda de auditoría verificada):
--  A. Cruce mesa→escuela defensivo: si el circuito de la mesa según el PDF
--     2023 difiere del circuito actual de esa mesa (numeración cambiada),
--     los votos NO se atribuyen a la escuela — caen como 'Mesa N'. Hoy la
--     coincidencia es 100%, esto protege futuras importaciones.
--  B. padron_resumen: agrega sin_sexo para que el desglose CIERRE
--     (total = mujeres + varones + otros + sin_sexo).
--  C. Re-ejecuta la limpieza 'Mesa N' con clase [0-9] (el regex de la 0008
--     llegó corrupto al editor por doble-escape del inyector).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.votos_por_escuela_2023(p_categoria text, p_listas int[])
returns table (escuela text, circuito text, votos bigint, mesas bigint, electores bigint)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  with cruce as (
    select r.mesa, r.votos,
           case when m.escuela is not null and (r.circuito is null or m.circuito is null or m.circuito = r.circuito)
                then m.escuela else null end as esc,
           coalesce(m.circuito, r.circuito) as circ
    from public.resultados_2023 r
    left join public.mesas m on m.mesa = r.mesa
    where r.categoria = upper(p_categoria)
      and r.lista_numero = any (p_listas)
  )
  select coalesce(c.esc, 'Mesa ' || c.mesa),
         mode() within group (order by c.circ),
         sum(c.votos)::bigint,
         count(distinct c.mesa)::bigint,
         coalesce(max(es.electores), 0)::bigint
  from cruce c
  left join public.escuelas es on es.nombre = c.esc
  group by 1
  order by 3 desc;
end $fn$;

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
  join public.mesas m
    on m.mesa = r.mesa
   and (r.circuito is null or m.circuito is null or m.circuito = r.circuito)
  where m.escuela = p_escuela
    and r.categoria = upper(p_categoria)
  group by 1
  order by 3 desc;
end $fn$;

create or replace function public.padron_resumen()
returns json
language plpgsql stable security definer set search_path = public
as $fn$
declare r json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  select json_build_object(
    'total', count(*),
    'mujeres', count(*) filter (where sexo = 'F'),
    'varones', count(*) filter (where sexo = 'M'),
    'otros', count(*) filter (where sexo = 'X'),
    'sin_sexo', count(*) filter (where sexo is null),
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
end $fn$;

-- El motor de prioridad hereda el mismo cruce defensivo
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
    select m.escuela as esc,
           mode() within group (order by m.circuito) as circ,
           sum(r.votos)::bigint as votos,
           count(distinct r.mesa)::bigint as nmesas
    from public.resultados_2023 r
    join public.mesas m
      on m.mesa = r.mesa
     and (r.circuito is null or m.circuito is null or m.circuito = r.circuito)
    where r.categoria = upper(p_categoria)
      and r.lista_numero = any (p_listas)
      and m.escuela is not null
    group by m.escuela
  ), pos as (
    select m.escuela as esc, sum(t.positivos)::bigint as positivos
    from public.mesas_2023_totales t
    join public.mesas m
      on m.mesa = t.mesa
     and (t.circuito is null or m.circuito is null or m.circuito = t.circuito)
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

-- limpieza (idempotente, sin backslashes)
delete from public.estrategia_escuelas where escuela ~ '^Mesa [0-9]+$';

-- 0019 · El Mapa abre rápido: totales del padrón precalculados
--
-- padron_resumen y padron_por_circuito recorrían las 459 mil filas de
-- electores cada vez que alguien abría el Mapa: ~4,7 s cada una. Ahora leen un
-- «cubo» con los conteos por circuito × sexo × año de nacimiento × si tiene
-- mesa (unos miles de filas). Los números son los mismos: la edad se sigue
-- calculando al momento de la consulta.
--
-- El cubo se marca vencido con cualquier cambio en electores (un trigger por
-- sentencia, barato aunque se cargue el padrón por tandas) y se rehace solo,
-- una vez, en la primera consulta siguiente.

create table if not exists public.padron_cubo (
  circuito text,
  sexo text,
  anio_nac int,
  con_mesa boolean not null,
  n bigint not null
);
create index if not exists padron_cubo_circuito on public.padron_cubo (circuito);

create table if not exists public.padron_cubo_estado (
  id boolean primary key default true check (id),
  vigente boolean not null default false,
  calculado_en timestamptz
);
insert into public.padron_cubo_estado (id, vigente) values (true, false) on conflict (id) do nothing;

-- Solo lo leen las funciones de abajo (security definer)
alter table public.padron_cubo enable row level security;
alter table public.padron_cubo_estado enable row level security;
revoke all on public.padron_cubo, public.padron_cubo_estado from anon, authenticated;

/** Si el padrón cambió desde el último cálculo, rehace el cubo. Un solo cálculo aunque lleguen varias consultas juntas. */
create or replace function public._padron_cubo_al_dia()
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if (select vigente from public.padron_cubo_estado where id) then return; end if;
  perform pg_advisory_xact_lock(hashtext('padron_cubo'));
  if (select vigente from public.padron_cubo_estado where id) then return; end if;
  delete from public.padron_cubo;
  insert into public.padron_cubo (circuito, sexo, anio_nac, con_mesa, n)
  select circuito, sexo, anio_nac_estimado, mesa is not null, count(*)
  from public.electores
  group by 1, 2, 3, 4;
  update public.padron_cubo_estado set vigente = true, calculado_en = now() where id;
end $fn$;

create or replace function public._padron_cubo_vencido()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  update public.padron_cubo_estado set vigente = false where id and vigente;
  return null;
end $fn$;

drop trigger if exists padron_cubo_vencido on public.electores;
create trigger padron_cubo_vencido after insert or update or delete on public.electores
  for each statement execute function public._padron_cubo_vencido();
drop trigger if exists padron_cubo_vencido_truncate on public.electores;
create trigger padron_cubo_vencido_truncate after truncate on public.electores
  for each statement execute function public._padron_cubo_vencido();

-- Mismas firmas y mismos resultados que antes; dejan de ser STABLE porque
-- pueden rehacer el cubo.
create or replace function public.padron_por_circuito(
  p_sexo text default null,
  p_edad_min int default null,
  p_edad_max int default null
) returns table (circuito text, total bigint, mujeres bigint, varones bigint)
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_anio int := extract(year from now())::int;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  perform public._padron_cubo_al_dia();
  return query
  select c.circuito,
         sum(c.n)::bigint,
         coalesce(sum(c.n) filter (where c.sexo = 'F'), 0)::bigint,
         coalesce(sum(c.n) filter (where c.sexo = 'M'), 0)::bigint
  from public.padron_cubo c
  where (p_sexo is null or c.sexo = p_sexo)
    and (p_edad_min is null or (v_anio - c.anio_nac) >= p_edad_min)
    and (p_edad_max is null or (v_anio - c.anio_nac) <= p_edad_max)
  group by c.circuito;
end $fn$;

create or replace function public.padron_resumen()
returns json
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  r json;
  v_anio int := extract(year from now())::int;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  perform public._padron_cubo_al_dia();
  select json_build_object(
    'total', coalesce(sum(n), 0),
    'mujeres', coalesce(sum(n) filter (where sexo = 'F'), 0),
    'varones', coalesce(sum(n) filter (where sexo = 'M'), 0),
    'otros', coalesce(sum(n) filter (where sexo = 'X'), 0),
    'sin_sexo', coalesce(sum(n) filter (where sexo is null), 0),
    'con_mesa', coalesce(sum(n) filter (where con_mesa), 0),
    'circuitos', (select count(distinct c2.circuito) from public.padron_cubo c2 where c2.circuito is not null),
    'escuelas', (select count(*) from public.escuelas),
    'franjas_estimadas', json_build_object(
      'e16_25', coalesce(sum(n) filter (where v_anio - anio_nac between 16 and 25), 0),
      'e26_40', coalesce(sum(n) filter (where v_anio - anio_nac between 26 and 40), 0),
      'e41_60', coalesce(sum(n) filter (where v_anio - anio_nac between 41 and 60), 0),
      'e60_mas', coalesce(sum(n) filter (where v_anio - anio_nac > 60), 0),
      'sin_estimar', coalesce(sum(n) filter (where anio_nac is null), 0)
    )
  ) into r
  from public.padron_cubo;
  return r;
end $fn$;

revoke execute on function public._padron_cubo_al_dia() from public, anon, authenticated;
revoke execute on function public._padron_cubo_vencido() from public, anon, authenticated;
revoke execute on function public.padron_por_circuito(text, int, int) from public, anon;
revoke execute on function public.padron_resumen() from public, anon;
grant execute on function public.padron_por_circuito(text, int, int) to authenticated;
grant execute on function public.padron_resumen() to authenticated;

notify pgrst, 'reload schema';

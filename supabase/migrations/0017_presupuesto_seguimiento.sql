-- 0017 · Seguimiento de la ejecución de lo aprobado
--
-- Una vez aprobado un escenario, cada celda política × barrio se sigue: en qué
-- estado está, cuánto se gastó, qué se logró y con qué expediente. Es un
-- registro de avance: no cambia lo aprobado ni lo que reserva (eso sigue
-- siendo del escenario: aprobado reserva, ejecutado deja de reservar).
--
-- Se escribe SOLO por registrar_ejecucion(), que valida; cada cambio queda en
-- la bitácora inmutable del módulo.

create table if not exists public.escenario_ejecucion (
  escenario_id bigint not null,
  politica_id bigint not null,
  barrio text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'terminado', 'no_se_hara')),
  monto_ejecutado numeric(18,2) not null default 0
    check (monto_ejecutado >= 0 and monto_ejecutado <> 'NaN' and monto_ejecutado <> 'Infinity'),
  unidades_logradas numeric not null default 0
    check (unidades_logradas >= 0 and unidades_logradas <> 'NaN' and unidades_logradas <> 'Infinity'),
  expediente text not null default '',
  nota text not null default '',
  actualizado_por uuid,
  actualizado_email text not null default '',
  actualizado_en timestamptz not null default now(),
  primary key (escenario_id, politica_id, barrio),
  -- solo se sigue lo que el escenario asigna
  foreign key (escenario_id, politica_id, barrio)
    references public.escenario_asignaciones (escenario_id, politica_id, barrio) on delete cascade
);

alter table public.escenario_ejecucion enable row level security;
drop policy if exists escenario_ejecucion_select on public.escenario_ejecucion;
create policy escenario_ejecucion_select on public.escenario_ejecucion
  for select to authenticated using ((select public.puede_presupuesto()));
revoke all on public.escenario_ejecucion from anon;
revoke insert, update, delete, truncate on public.escenario_ejecucion from authenticated;

drop trigger if exists bitacora on public.escenario_ejecucion;
create trigger bitacora after insert or update or delete on public.escenario_ejecucion
  for each row execute function public._bitacora_presupuesto();

/**
 * Registra el avance de varias celdas de una vez (upsert).
 * p_items: [{politica_id, barrio, estado, monto_ejecutado, unidades_logradas, expediente, nota}]
 *
 * Reglas: el escenario tiene que estar aprobado o ejecutado; la celda tiene
 * que existir en lo aprobado; con gasto hace falta el expediente y el estado
 * no puede ser «pendiente»; «no se hará» y gastar más de lo asignado piden
 * una nota que lo explique.
 */
create or replace function public.registrar_ejecucion(p_escenario bigint, p_items jsonb)
returns int
language plpgsql security definer set search_path = public
as $fn$
declare
  v public.escenarios_presupuesto;
  v_email text := coalesce((select email from public.perfiles where id = auth.uid()), '');
  r record;
  v_n int := 0;
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;
  select * into v from public.escenarios_presupuesto where id = p_escenario;
  if not found then raise exception 'no existe el escenario %', p_escenario; end if;
  if v.estado not in ('aprobado', 'ejecutado') then
    raise exception 'solo se sigue la ejecución de un escenario aprobado';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no hay nada para registrar';
  end if;
  if jsonb_array_length(p_items) > 10000 then raise exception 'demasiadas filas en un solo registro'; end if;

  for r in
    select (x ->> 'politica_id')::bigint as politica_id,
           x ->> 'barrio' as barrio,
           coalesce(x ->> 'estado', 'pendiente') as estado,
           coalesce((x ->> 'monto_ejecutado')::numeric, 0) as monto,
           coalesce((x ->> 'unidades_logradas')::numeric, 0) as unidades,
           btrim(coalesce(x ->> 'expediente', '')) as expediente,
           btrim(coalesce(x ->> 'nota', '')) as nota,
           a.monto as asignado,
           a.politica_codigo
    from jsonb_array_elements(p_items) x
    left join public.escenario_asignaciones a
      on a.escenario_id = p_escenario
     and a.politica_id = (x ->> 'politica_id')::bigint
     and a.barrio = x ->> 'barrio'
  loop
    if r.asignado is null then
      raise exception 'el escenario no asigna esa política en «%»', r.barrio;
    end if;
    if r.estado not in ('pendiente', 'en_curso', 'terminado', 'no_se_hara') then
      raise exception 'estado de ejecución inválido: %', r.estado;
    end if;
    if r.monto = 'NaN' or r.monto < 0 or r.monto = 'Infinity'
       or r.unidades = 'NaN' or r.unidades < 0 or r.unidades = 'Infinity' then
      raise exception 'montos inválidos en «%»', r.barrio;
    end if;
    if r.monto > 0 and r.estado = 'pendiente' then
      raise exception 'en «%» ya hay gasto: el estado no puede ser «pendiente»', r.barrio;
    end if;
    if r.monto > 0 and length(r.expediente) < 3 then
      raise exception 'indicá el expediente del gasto en «%» (política %)', r.barrio, r.politica_codigo;
    end if;
    if r.estado = 'no_se_hara' and length(r.nota) < 5 then
      raise exception 'explicá en la nota por qué no se hará en «%» (política %)', r.barrio, r.politica_codigo;
    end if;
    if r.monto > r.asignado + 1 and length(r.nota) < 5 then
      raise exception 'en «%» se gasta más de lo asignado ($%): explicalo en la nota', r.barrio, round(r.asignado);
    end if;

    insert into public.escenario_ejecucion as e
      (escenario_id, politica_id, barrio, estado, monto_ejecutado, unidades_logradas, expediente, nota,
       actualizado_por, actualizado_email, actualizado_en)
    values (p_escenario, r.politica_id, r.barrio, r.estado, round(r.monto, 2), r.unidades, r.expediente, r.nota,
            auth.uid(), v_email, now())
    on conflict (escenario_id, politica_id, barrio) do update
      set estado = excluded.estado,
          monto_ejecutado = excluded.monto_ejecutado,
          unidades_logradas = excluded.unidades_logradas,
          expediente = excluded.expediente,
          nota = excluded.nota,
          actualizado_por = excluded.actualizado_por,
          actualizado_email = excluded.actualizado_email,
          actualizado_en = excluded.actualizado_en
      -- reescribir lo mismo no ensucia la bitácora
      where (e.estado, e.monto_ejecutado, e.unidades_logradas, e.expediente, e.nota)
            is distinct from (excluded.estado, excluded.monto_ejecutado, excluded.unidades_logradas, excluded.expediente, excluded.nota);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

revoke execute on function public.registrar_ejecucion(bigint, jsonb) from public, anon;
grant execute on function public.registrar_ejecucion(bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';

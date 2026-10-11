-- 0018 · Registro de errores de la aplicación
--
-- Vercel guarda una hora de registros en este plan: un fallo de ayer no dejaba
-- rastro. Acá queda qué falló, dónde, a quién y cuántas veces, para el
-- superadmin. Lo escribe la app (navegador y servidor); no se edita a mano.
--
-- Datos personales: los mensajes llegan ya enmascarados (números de documento
-- y correos) y recortados. Se guarda 90 días.

create table if not exists public.errores_app (
  id bigint generated always as identity primary key,
  primera_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  veces int not null default 1 check (veces >= 1),
  origen text not null check (origen in ('navegador', 'servidor')),
  donde text not null default '',
  mensaje text not null,
  detalle text not null default '',
  usuario uuid,
  usuario_email text not null default '',
  navegador text not null default '',
  revisado boolean not null default false
);
create index if not exists errores_app_ultima on public.errores_app (ultima_vez desc);

alter table public.errores_app enable row level security;
drop policy if exists errores_app_select on public.errores_app;
create policy errores_app_select on public.errores_app
  for select to authenticated using ((select public.es_superadmin()));
-- marcar como revisado: solo el superadmin, y solo esa columna
drop policy if exists errores_app_revisar on public.errores_app;
create policy errores_app_revisar on public.errores_app
  for update to authenticated using ((select public.es_superadmin())) with check ((select public.es_superadmin()));
revoke all on public.errores_app from anon;
revoke insert, update, delete, truncate on public.errores_app from authenticated;
grant update (revisado) on public.errores_app to authenticated;

/**
 * Lo llama el navegador con la sesión del usuario. El mismo error del mismo
 * usuario en el mismo lugar dentro de la última hora suma una vez en lugar de
 * crear otra fila; un usuario no registra más de 60 errores distintos por hora.
 */
create or replace function public.registrar_error(
  p_donde text,
  p_mensaje text,
  p_detalle text default '',
  p_navegador text default ''
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_mensaje text := left(coalesce(btrim(p_mensaje), ''), 1000);
  v_donde text := left(coalesce(btrim(p_donde), ''), 300);
begin
  if v_uid is null or v_mensaje = '' then return; end if;
  if not exists (select 1 from public.perfiles where id = v_uid) then return; end if;
  select email into v_email from public.perfiles where id = v_uid;

  update public.errores_app
  set veces = veces + 1, ultima_vez = now(), revisado = false
  where usuario = v_uid and origen = 'navegador' and donde = v_donde and mensaje = v_mensaje
    and ultima_vez > now() - interval '1 hour';
  if found then return; end if;

  if (select count(*) from public.errores_app
      where usuario = v_uid and primera_vez > now() - interval '1 hour') >= 60 then
    return;
  end if;

  insert into public.errores_app (origen, donde, mensaje, detalle, usuario, usuario_email, navegador)
  values ('navegador', v_donde, v_mensaje, left(coalesce(p_detalle, ''), 4000), v_uid, coalesce(v_email, ''),
          left(coalesce(p_navegador, ''), 300));

  -- de paso, lo que ya pasó los 90 días se va
  delete from public.errores_app where ultima_vez < now() - interval '90 days';
end $fn$;

revoke execute on function public.registrar_error(text, text, text, text) from public, anon;
grant execute on function public.registrar_error(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

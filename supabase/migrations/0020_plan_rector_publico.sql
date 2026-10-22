-- 0020 · Las líneas del Plan Rector, legibles para toda la app
--
-- El catálogo vive en politicas_publicas, que solo ve quien tiene acceso a
-- Presupuesto. Elena necesita saber qué es cada línea (para relacionar el
-- organigrama con las demandas de cada barrio), y eso es información pública
-- del Plan Rector 2023-2030. Esta función devuelve SOLO eso: código, nombre,
-- eje, la necesidad que atiende y si está activa. Nada de costos, pisos,
-- topes, partidas ni montos: lo presupuestario sigue reservado.

create or replace function public.plan_rector_lineas()
returns table (codigo text, nombre text, eje text, indicador text, tipo text, activa boolean)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select p.codigo, p.nombre, p.eje, p.indicador, p.tipo, p.activa
  from public.politicas_publicas p
  order by p.id;
end $fn$;

revoke execute on function public.plan_rector_lineas() from public, anon;
grant execute on function public.plan_rector_lineas() to authenticated;

notify pgrst, 'reload schema';

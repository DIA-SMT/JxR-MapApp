-- Detalle por MESA de una escuela: electores actuales + resultados 2023
-- (total/positivos/blanco/nulos y participación aproximada contra el padrón
-- vigente de esa mesa — la numeración de mesas coincide 100% por circuito).
create or replace function public.mesas_de_escuela(
  p_escuela text,
  p_categoria text default 'CONCEJAL'
) returns table (
  mesa int,
  electores int,
  votos_2023 int,
  positivos_2023 int,
  blanco_2023 int,
  nulos_2023 int,
  participacion_pct numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  select m.mesa,
         m.electores,
         t.total,
         t.positivos,
         t.blanco,
         t.nulos,
         case
           when m.electores > 0 and t.total is not null
           then round(100.0 * t.total / m.electores, 1)
           else null
         end
  from public.mesas m
  left join public.mesas_2023_totales t
    on t.mesa = m.mesa and t.categoria = upper(p_categoria)
  where m.escuela = p_escuela
  order by m.mesa;
end $fn$;

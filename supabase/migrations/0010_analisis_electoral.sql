-- ═══════════════════════════════════════════════════════════════════════════
-- Motor de análisis electoral estratégico:
--  · Resultados 2025 (Diputado Nacional, provisorio, mesa a mesa, Capital).
--    OJO: la numeración de mesas 2025 (nacional) NO coincide con la del padrón
--    provincial — el cruce entre elecciones es por CIRCUITO (los 47 códigos
--    coinciden 1:1); las mesas 2025 se analizan como universo propio.
--  · Funciones de análisis: ganadores, ranking, desempeño, voto en blanco,
--    corte de boleta (2023: 4 cargos simultáneos), oportunidades, índice de
--    potencial electoral y comparación 2023↔2025.
--  Todas security definer con guardia tiene_perfil() (lección 0005: el
--  policy-check por fila sobre tablas grandes supera el statement_timeout).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tablas 2025 ──────────────────────────────────────────────────────────────
create table if not exists public.resultados_2025 (
  id                bigint generated always as identity primary key,
  mesa              int not null,
  circuito          text not null,
  agrupacion_id     int not null,
  agrupacion_nombre text not null,
  votos             int not null
);
create index if not exists resultados_2025_mesa_idx on public.resultados_2025 (mesa);
create index if not exists resultados_2025_agrup_idx on public.resultados_2025 (agrupacion_id);
create index if not exists resultados_2025_circuito_idx on public.resultados_2025 (circuito);

create table if not exists public.mesas_2025 (
  mesa       int primary key,
  circuito   text not null,
  electores  int not null,
  blanco     int not null default 0,
  nulos      int not null default 0,
  impugnados int not null default 0,
  recurridos int not null default 0,
  comando    int not null default 0,
  positivos  int not null default 0,
  total      int not null default 0
);
create index if not exists mesas_2025_circuito_idx on public.mesas_2025 (circuito);

alter table public.resultados_2025 enable row level security;
alter table public.mesas_2025 enable row level security;
drop policy if exists resultados_2025_select on public.resultados_2025;
create policy resultados_2025_select on public.resultados_2025
  for select to authenticated using ((select public.tiene_perfil()));
drop policy if exists mesas_2025_select on public.mesas_2025;
create policy mesas_2025_select on public.mesas_2025
  for select to authenticated using ((select public.tiene_perfil()));
revoke all on public.resultados_2025, public.mesas_2025 from anon;
revoke insert, update, delete on public.resultados_2025, public.mesas_2025 from authenticated;

-- ── Vistas unificadas (solo para las funciones definer: sin acceso directo) ──
create or replace view public.v_votos_elecciones as
  select '2023'::text as eleccion,
         r.categoria,
         r.mesa,
         coalesce(m.circuito, r.circuito) as circuito,
         case when m.escuela is not null
                   and (r.circuito is null or m.circuito is null or m.circuito = r.circuito)
              then m.escuela else 'Mesa ' || r.mesa end as escuela,
         r.lista_numero as lista_id,
         r.lista_nombre as lista,
         r.votos
  from public.resultados_2023 r
  left join public.mesas m on m.mesa = r.mesa
  union all
  select '2025', 'DIPUTADO NACIONAL', r.mesa, r.circuito,
         'Mesa ' || r.mesa, r.agrupacion_id, r.agrupacion_nombre, r.votos
  from public.resultados_2025 r;

create or replace view public.v_totales_elecciones as
  select '2023'::text as eleccion,
         t.categoria,
         t.mesa,
         coalesce(m.circuito, t.circuito) as circuito,
         case when m.escuela is not null
                   and (t.circuito is null or m.circuito is null or m.circuito = t.circuito)
              then m.escuela else 'Mesa ' || t.mesa end as escuela,
         coalesce(m.electores, 0) as electores,
         coalesce(t.blanco, 0) as blanco,
         coalesce(t.nulos, 0) as nulos,
         coalesce(t.positivos, 0) as positivos,
         coalesce(t.total, 0) as total
  from public.mesas_2023_totales t
  left join public.mesas m on m.mesa = t.mesa
  union all
  select '2025', 'DIPUTADO NACIONAL', mt.mesa, mt.circuito, 'Mesa ' || mt.mesa,
         mt.electores, mt.blanco, mt.nulos, mt.positivos, mt.total
  from public.mesas_2025 mt;

revoke all on public.v_votos_elecciones, public.v_totales_elecciones from anon, authenticated;

-- Normaliza el nivel pedido y valida la combinación elección/nivel
create or replace function public._nivel_valido(p_eleccion text, p_nivel text)
returns text language plpgsql immutable as $fn$
begin
  if p_nivel not in ('mesa', 'escuela', 'circuito') then
    raise exception 'nivel inválido: % (usar mesa, escuela o circuito)', p_nivel;
  end if;
  if p_eleccion = '2025' and p_nivel = 'escuela' then
    raise exception 'los resultados 2025 (elección nacional) no tienen cruce mesa→escuela: usá nivel mesa o circuito';
  end if;
  if p_eleccion not in ('2023', '2025') then
    raise exception 'elección inválida: % (usar 2023 o 2025)', p_eleccion;
  end if;
  return p_nivel;
end $fn$;

-- ── A. Listas / agrupaciones de una elección con totales y % ────────────────
create or replace function public.listas_eleccion(p_eleccion text, p_categoria text default null)
returns table (lista_id int, lista text, votos bigint, pct numeric, mesas bigint)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(coalesce(p_categoria, 'CONCEJAL')) end;
  return query
  select v.lista_id, max(v.lista),
         sum(v.votos)::bigint,
         round(100.0 * sum(v.votos) / greatest(1, sum(sum(v.votos)) over ()), 2),
         count(distinct v.mesa)::bigint
  from public.v_votos_elecciones v
  where v.eleccion = p_eleccion and v.categoria = v_cat
  group by v.lista_id
  order by 3 desc;
end $fn$;

-- ── B. Ganador, segundo y diferencia por espacio ─────────────────────────────
create or replace function public.ganadores_espacios(
  p_eleccion text default '2023',
  p_categoria text default 'CONCEJAL',
  p_nivel text default 'escuela',
  p_orden text default 'competitivo',   -- 'competitivo' (dif asc) | 'votos' (positivos desc)
  p_limite int default 40
) returns table (
  espacio text, circuito text, ganador text, votos_ganador bigint, pct_ganador numeric,
  segundo text, votos_segundo bigint, diferencia bigint,
  positivos bigint, blancos bigint, electores bigint, mesas bigint
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido(p_eleccion, p_nivel);
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(p_categoria) end;
  return query
  with base as (
    select case v_nivel when 'mesa' then 'Mesa ' || v.mesa
                        when 'escuela' then v.escuela
                        else 'Circuito ' || v.circuito end as esp,
           max(v.circuito) as circ,
           v.lista as l,
           sum(v.votos)::bigint as vv,
           count(distinct v.mesa)::bigint as nm
    from public.v_votos_elecciones v
    where v.eleccion = p_eleccion and v.categoria = v_cat
      and (v_nivel <> 'circuito' or v.circuito is not null)
    group by 1, v.lista
  ), rk as (
    select b.*, row_number() over (partition by b.esp order by b.vv desc) as pos,
           sum(b.vv) over (partition by b.esp) as pos_esp
    from base b
  ), tot as (
    select case v_nivel when 'mesa' then 'Mesa ' || t.mesa
                        when 'escuela' then t.escuela
                        else 'Circuito ' || t.circuito end as esp,
           sum(t.blanco)::bigint as bl, sum(t.electores)::bigint as el
    from public.v_totales_elecciones t
    where t.eleccion = p_eleccion and t.categoria = v_cat
      and (v_nivel <> 'circuito' or t.circuito is not null)
    group by 1
  )
  select r1.esp, r1.circ, r1.l, r1.vv,
         round(100.0 * r1.vv / greatest(1, r1.pos_esp), 2),
         r2.l, coalesce(r2.vv, 0),
         (r1.vv - coalesce(r2.vv, 0))::bigint,
         r1.pos_esp::bigint, coalesce(tot.bl, 0), coalesce(tot.el, 0), r1.nm
  from rk r1
  left join rk r2 on r2.esp = r1.esp and r2.pos = 2
  left join tot on tot.esp = r1.esp
  where r1.pos = 1
  order by case when p_orden = 'votos' then -r1.pos_esp else (r1.vv - coalesce(r2.vv, 0)) end
  limit greatest(1, least(p_limite, 200));
end $fn$;

-- ── C. Ranking completo dentro de un espacio ─────────────────────────────────
create or replace function public.ranking_en_espacio(
  p_eleccion text, p_categoria text, p_nivel text, p_codigo text
) returns table (posicion bigint, lista_id int, lista text, votos bigint, pct numeric)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido(p_eleccion, p_nivel);
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(p_categoria) end;
  return query
  with base as (
    select v.lista_id as lid, max(v.lista) as l, sum(v.votos)::bigint as vv
    from public.v_votos_elecciones v
    where v.eleccion = p_eleccion and v.categoria = v_cat
      and case v_nivel when 'mesa' then v.mesa::text = replace(upper(p_codigo), 'MESA ', '')
                       when 'escuela' then v.escuela = p_codigo
                       else upper(v.circuito) = replace(upper(p_codigo), 'CIRCUITO ', '') end
    group by v.lista_id
  )
  select row_number() over (order by b.vv desc), b.lid, b.l, b.vv,
         round(100.0 * b.vv / greatest(1, sum(b.vv) over ()), 2)
  from base b
  order by b.vv desc;
end $fn$;

-- ── D. Desempeño de una lista espacio por espacio (vs su promedio) ───────────
create or replace function public.desempeno_lista(
  p_eleccion text, p_categoria text, p_lista int, p_nivel text default 'escuela'
) returns table (
  espacio text, circuito text, votos bigint, positivos bigint, pct numeric,
  posicion bigint, pct_promedio_lista numeric, desvio numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text; v_prom numeric;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido(p_eleccion, p_nivel);
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(p_categoria) end;

  select round(100.0 * sum(v.votos) filter (where v.lista_id = p_lista) / greatest(1, sum(v.votos)), 2)
  into v_prom
  from public.v_votos_elecciones v
  where v.eleccion = p_eleccion and v.categoria = v_cat;

  return query
  with base as (
    select case v_nivel when 'mesa' then 'Mesa ' || v.mesa
                        when 'escuela' then v.escuela
                        else 'Circuito ' || v.circuito end as esp,
           max(v.circuito) as circ,
           v.lista_id as lid,
           sum(v.votos)::bigint as vv
    from public.v_votos_elecciones v
    where v.eleccion = p_eleccion and v.categoria = v_cat
      and (v_nivel <> 'circuito' or v.circuito is not null)
    group by 1, v.lista_id
  ), conpos as (
    select b.*, sum(b.vv) over (partition by b.esp) as pos_esp,
           row_number() over (partition by b.esp order by b.vv desc) as rnk
    from base b
  )
  select c.esp, c.circ, c.vv, c.pos_esp::bigint,
         round(100.0 * c.vv / greatest(1, c.pos_esp), 2),
         c.rnk, v_prom,
         round(100.0 * c.vv / greatest(1, c.pos_esp) - v_prom, 2)
  from conpos c
  where c.lid = p_lista
  order by 5 desc;
end $fn$;

-- ── E. Voto en blanco por espacio y cargo ────────────────────────────────────
create or replace function public.voto_blanco(
  p_eleccion text default '2023', p_nivel text default 'escuela'
) returns table (
  espacio text, circuito text, categoria text,
  blancos bigint, total bigint, pct_blanco numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido(p_eleccion, p_nivel);
  return query
  select case v_nivel when 'mesa' then 'Mesa ' || t.mesa
                      when 'escuela' then t.escuela
                      else 'Circuito ' || t.circuito end,
         max(t.circuito),
         t.categoria,
         sum(t.blanco)::bigint, sum(t.total)::bigint,
         round(100.0 * sum(t.blanco) / greatest(1, sum(t.total)), 2)
  from public.v_totales_elecciones t
  where t.eleccion = p_eleccion
    and (v_nivel <> 'circuito' or t.circuito is not null)
  group by 1, t.categoria
  order by 6 desc;
end $fn$;

-- ── F. Corte de boleta 2023 — resumen por lista (4 cargos simultáneos) ───────
create or replace function public.corte_boleta_listas()
returns table (
  lista_id int, lista text,
  gobernador bigint, legislador bigint, intendente bigint, concejal bigint,
  mejor_cargo text, peor_cargo text, corte bigint, retencion_pct numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  with piv as (
    select r.lista_numero as lid, max(r.lista_nombre) as l,
           coalesce(sum(r.votos) filter (where r.categoria = 'GOBERNADOR'), 0)::bigint as g,
           coalesce(sum(r.votos) filter (where r.categoria = 'LEGISLADOR'), 0)::bigint as le,
           coalesce(sum(r.votos) filter (where r.categoria = 'INTENDENTE'), 0)::bigint as i,
           coalesce(sum(r.votos) filter (where r.categoria = 'CONCEJAL'), 0)::bigint as c
    from public.resultados_2023 r
    group by r.lista_numero
  )
  select p.lid, p.l, p.g, p.le, p.i, p.c,
         case greatest(p.g, p.le, p.i, p.c)
           when p.g then 'GOBERNADOR' when p.le then 'LEGISLADOR'
           when p.i then 'INTENDENTE' else 'CONCEJAL' end,
         case least(p.g, p.le, p.i, p.c)
           when p.g then 'GOBERNADOR' when p.le then 'LEGISLADOR'
           when p.i then 'INTENDENTE' else 'CONCEJAL' end,
         (greatest(p.g, p.le, p.i, p.c) - least(p.g, p.le, p.i, p.c))::bigint,
         round(100.0 * least(p.g, p.le, p.i, p.c) / greatest(1, greatest(p.g, p.le, p.i, p.c)), 1)
  from piv p
  where greatest(p.g, p.le, p.i, p.c) > 0
  order by 9 desc;
end $fn$;

-- ── G. Corte de boleta 2023 de UNA lista, espacio por espacio ────────────────
create or replace function public.corte_boleta_espacios(p_lista int, p_nivel text default 'escuela')
returns table (
  espacio text, circuito text,
  gobernador bigint, legislador bigint, intendente bigint, concejal bigint,
  corte bigint, retencion_pct numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido('2023', p_nivel);
  return query
  with piv as (
    select case v_nivel when 'mesa' then 'Mesa ' || v.mesa
                        when 'escuela' then v.escuela
                        else 'Circuito ' || v.circuito end as esp,
           max(v.circuito) as circ,
           coalesce(sum(v.votos) filter (where v.categoria = 'GOBERNADOR'), 0)::bigint as g,
           coalesce(sum(v.votos) filter (where v.categoria = 'LEGISLADOR'), 0)::bigint as le,
           coalesce(sum(v.votos) filter (where v.categoria = 'INTENDENTE'), 0)::bigint as i,
           coalesce(sum(v.votos) filter (where v.categoria = 'CONCEJAL'), 0)::bigint as c
    from public.v_votos_elecciones v
    where v.eleccion = '2023' and v.lista_id = p_lista
      and (v_nivel <> 'circuito' or v.circuito is not null)
    group by 1
  )
  select p.esp, p.circ, p.g, p.le, p.i, p.c,
         (greatest(p.g, p.le, p.i, p.c) - least(p.g, p.le, p.i, p.c))::bigint,
         round(100.0 * least(p.g, p.le, p.i, p.c) / greatest(1, greatest(p.g, p.le, p.i, p.c)), 1)
  from piv p
  where greatest(p.g, p.le, p.i, p.c) > 0
  order by 7 desc;
end $fn$;

-- ── H. Oportunidades: dónde se pierde (o gana) por poco ──────────────────────
create or replace function public.oportunidades_lista(
  p_eleccion text, p_categoria text, p_lista int,
  p_margen int default 100, p_nivel text default 'mesa'
) returns table (
  espacio text, circuito text, situacion text,
  votos_lista bigint, posicion bigint, lider text, votos_lider bigint,
  diferencia bigint, votos_necesarios bigint,
  electores bigint, blancos bigint, ausentes bigint
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido(p_eleccion, p_nivel);
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(p_categoria) end;
  return query
  with base as (
    select case v_nivel when 'mesa' then 'Mesa ' || v.mesa
                        when 'escuela' then v.escuela
                        else 'Circuito ' || v.circuito end as esp,
           max(v.circuito) as circ, v.lista_id as lid, max(v.lista) as l,
           sum(v.votos)::bigint as vv
    from public.v_votos_elecciones v
    where v.eleccion = p_eleccion and v.categoria = v_cat
      and (v_nivel <> 'circuito' or v.circuito is not null)
    group by 1, v.lista_id
  ), rk as (
    select b.*, row_number() over (partition by b.esp order by b.vv desc) as pos
    from base b
  ), tot as (
    select case v_nivel when 'mesa' then 'Mesa ' || t.mesa
                        when 'escuela' then t.escuela
                        else 'Circuito ' || t.circuito end as esp,
           sum(t.blanco)::bigint as bl, sum(t.electores)::bigint as el, sum(t.total)::bigint as vot
    from public.v_totales_elecciones t
    where t.eleccion = p_eleccion and t.categoria = v_cat
      and (v_nivel <> 'circuito' or t.circuito is not null)
    group by 1
  )
  select mio.esp, mio.circ,
         case when mio.pos = 1 then 'gana por poco (defender)' else 'pierde por poco (atacar)' end,
         mio.vv, mio.pos, lider.l, lider.vv,
         (lider.vv - mio.vv)::bigint,
         case when mio.pos = 1 then 0::bigint else (lider.vv - mio.vv + 1)::bigint end,
         coalesce(tot.el, 0), coalesce(tot.bl, 0),
         greatest(0, coalesce(tot.el, 0) - coalesce(tot.vot, 0))::bigint
  from rk mio
  join rk lider on lider.esp = mio.esp
    and lider.pos = case when mio.pos = 1 then 2 else 1 end
  left join tot on tot.esp = mio.esp
  where mio.lid = p_lista
    and abs(lider.vv - mio.vv) <= p_margen
  order by abs(lider.vv - mio.vv);
end $fn$;

-- ── I. Índice de Potencial Electoral (IPE) ───────────────────────────────────
-- score 0-100 = 30% cercanía al líder + 25% bolsa de crecimiento (blancos +
-- ausentes sobre electores) + 20% rendimiento relativo de la lista + 15%
-- volumen propio + 10% competitividad del espacio. Con tier y clasificación
-- territorial explicadas (razones), para priorizar mesas/escuelas/circuitos.
create or replace function public.potencial_electoral(
  p_eleccion text, p_categoria text, p_lista int, p_nivel text default 'escuela'
) returns table (
  espacio text, circuito text,
  votos_lista bigint, pct_lista numeric, posicion bigint,
  lider text, diferencia bigint, margen_pct numeric,
  electores bigint, blancos bigint, ausentes bigint, participacion_pct numeric,
  score numeric, tier text, clasificacion text, razones text
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_valido(p_eleccion, p_nivel);
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(p_categoria) end;
  return query
  with base as (
    select case v_nivel when 'mesa' then 'Mesa ' || v.mesa
                        when 'escuela' then v.escuela
                        else 'Circuito ' || v.circuito end as esp,
           max(v.circuito) as circ, v.lista_id as lid, max(v.lista) as l,
           sum(v.votos)::bigint as vv
    from public.v_votos_elecciones v
    where v.eleccion = p_eleccion and v.categoria = v_cat
      and (v_nivel <> 'circuito' or v.circuito is not null)
    group by 1, v.lista_id
  ), rk as (
    select b.*, row_number() over (partition by b.esp order by b.vv desc) as pos,
           sum(b.vv) over (partition by b.esp) as pos_esp
    from base b
  ), tot as (
    select case v_nivel when 'mesa' then 'Mesa ' || t.mesa
                        when 'escuela' then t.escuela
                        else 'Circuito ' || t.circuito end as esp,
           sum(t.blanco)::bigint as bl, sum(t.electores)::bigint as el, sum(t.total)::bigint as vot
    from public.v_totales_elecciones t
    where t.eleccion = p_eleccion and t.categoria = v_cat
      and (v_nivel <> 'circuito' or t.circuito is not null)
    group by 1
  ), mio as (
    select r.esp, r.circ, r.vv, r.pos, r.pos_esp,
           lider.l as lider_l, lider.vv as lider_vv,
           seg.vv as seg_vv,
           coalesce(t.el, 0) as el, coalesce(t.bl, 0) as bl,
           greatest(0, coalesce(t.el, 0) - coalesce(t.vot, 0)) as aus,
           coalesce(t.vot, 0) as vot
    from rk r
    join rk lider on lider.esp = r.esp and lider.pos = 1
    left join rk seg on seg.esp = r.esp and seg.pos = 2
    left join tot t on t.esp = r.esp
    where r.lid = p_lista
  ), calc as (
    select m.*,
           round(100.0 * m.vv / greatest(1, m.pos_esp), 2) as pctl,
           (m.lider_vv - m.vv)::bigint as dif,
           round(100.0 * (m.lider_vv - m.vv) / greatest(1, m.pos_esp), 2) as margen,
           round(100.0 * (m.lider_vv - coalesce(m.seg_vv, 0)) / greatest(1, m.pos_esp), 2) as margen12,
           (m.bl + m.aus)::numeric / greatest(1, m.el) as bolsa,
           max(m.vv) over () as max_vv,
           max(round(100.0 * m.vv / greatest(1, m.pos_esp), 2)) over () as max_pctl
    from mio m
  ),
  scored as (
    select c.*,
           round(100 * (
               0.30 * greatest(0, 1 - (c.margen / 25.0))
             + 0.25 * least(1, c.bolsa * 2.5)
             + 0.20 * (c.pctl / greatest(1, c.max_pctl))
             + 0.15 * (c.vv::numeric / greatest(1, c.max_vv))
             + 0.10 * greatest(0, 1 - (c.margen12 / 20.0))
           ), 1) as sc
    from calc c
  )
  select s.esp, s.circ, s.vv, s.pctl, s.pos,
         s.lider_l, s.dif, s.margen,
         s.el, s.bl, s.aus,
         round(100.0 * s.vot / greatest(1, s.el), 1),
         s.sc,
         case when s.sc >= 70 then 'muy alto'
              when s.sc >= 55 then 'alto'
              when s.sc >= 35 then 'medio'
              else 'bajo' end,
         case
           when s.pos = 1 and s.margen12 >= 10 then 'fuerte'
           when s.margen <= 5 or s.margen12 <= 5 then 'competitivo'
           when s.bolsa >= 0.25 and s.pos <= 3 then 'potencial'
           else 'débil'
         end,
         concat_ws(' · ',
           case when s.pos = 1 then 'lidera por ' || (s.lider_vv - coalesce(s.seg_vv, 0)) || ' votos'
                else s.pos || 'º a ' || s.dif || ' votos del líder (' || s.lider_l || ')' end,
           s.bl || ' en blanco',
           s.aus || ' que no fueron a votar',
           'rinde ' || s.pctl || '%'
         )
  from scored s
  order by s.sc desc;
end $fn$;

-- ── J. Comparación 2023 ↔ 2025 por circuito ─────────────────────────────────
create or replace function public.comparar_elecciones(
  p_lista_2023 int, p_lista_2025 int, p_categoria_2023 text default 'CONCEJAL'
) returns table (
  circuito text,
  votos_2023 bigint, pct_2023 numeric,
  votos_2025 bigint, pct_2025 numeric,
  delta_pct numeric,
  participacion_2023 numeric, participacion_2025 numeric,
  blancos_2023 bigint, blancos_2025 bigint
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  with v23 as (
    select v.circuito as circ, sum(v.votos)::bigint as tot,
           sum(v.votos) filter (where v.lista_id = p_lista_2023)::bigint as mios
    from public.v_votos_elecciones v
    where v.eleccion = '2023' and v.categoria = upper(p_categoria_2023) and v.circuito is not null
    group by 1
  ), v25 as (
    select v.circuito as circ, sum(v.votos)::bigint as tot,
           sum(v.votos) filter (where v.lista_id = p_lista_2025)::bigint as mios
    from public.v_votos_elecciones v
    where v.eleccion = '2025' and v.circuito is not null
    group by 1
  ), t23 as (
    select t.circuito as circ, sum(t.blanco)::bigint as bl,
           round(100.0 * sum(t.total) / greatest(1, sum(t.electores)), 1) as part
    from public.v_totales_elecciones t
    where t.eleccion = '2023' and t.categoria = upper(p_categoria_2023) and t.circuito is not null
    group by 1
  ), t25 as (
    select t.circuito as circ, sum(t.blanco)::bigint as bl,
           round(100.0 * sum(t.total) / greatest(1, sum(t.electores)), 1) as part
    from public.v_totales_elecciones t
    where t.eleccion = '2025' and t.circuito is not null
    group by 1
  )
  select coalesce(v23.circ, v25.circ),
         coalesce(v23.mios, 0), round(100.0 * coalesce(v23.mios, 0) / greatest(1, v23.tot), 2),
         coalesce(v25.mios, 0), round(100.0 * coalesce(v25.mios, 0) / greatest(1, v25.tot), 2),
         round(100.0 * coalesce(v25.mios, 0) / greatest(1, v25.tot)
             - 100.0 * coalesce(v23.mios, 0) / greatest(1, v23.tot), 2),
         t23.part, t25.part, coalesce(t23.bl, 0), coalesce(t25.bl, 0)
  from v23
  full outer join v25 on v25.circ = v23.circ
  left join t23 on t23.circ = coalesce(v23.circ, v25.circ)
  left join t25 on t25.circ = coalesce(v23.circ, v25.circ)
  order by 6 desc;
end $fn$;

-- PostgREST: refrescar el schema cache para que las funciones nuevas existan
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Estrategia 2027: universos de listas, espacios políticos (acoples) y el
-- nivel BARRIO en el análisis territorial.
--
--  · escuelas_barrios: cruce EXACTO escuela→barrio por geometría (punto en
--    polígono del mapa oficial municipal). Habilita analizar por barrio sin
--    estimar: los votos de una escuela caen en el barrio donde está.
--  · listas_espacios: clasificación de cada lista 2023 en su espacio político
--    (peronismo, acoples peronistas, LLA, Cambiemos/no peronistas, izquierda…)
--    con flag de acople y referente. Editable por el equipo: la precarga es
--    una SUGERENCIA por heurística de nombre, no un dato oficial.
--  · universos_listas: conjuntos de listas nombrados y compartidos (ej. las
--    listas sin banca 2023 que se trabajan hacia 2027).
--  · RPCs de análisis: distribución territorial de un universo por mesa,
--    escuela, circuito o barrio; desglose lista por lista; y agregado por
--    espacio político para medir fragmentación y alimentar el D'Hondt.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Cruce escuela → barrio ───────────────────────────────────────────────────
create table if not exists public.escuelas_barrios (
  escuela text primary key,
  barrio  text not null
);
create index if not exists escuelas_barrios_barrio_idx on public.escuelas_barrios (barrio);

alter table public.escuelas_barrios enable row level security;
drop policy if exists escuelas_barrios_select on public.escuelas_barrios;
create policy escuelas_barrios_select on public.escuelas_barrios
  for select to authenticated using ((select public.tiene_perfil()));
revoke all on public.escuelas_barrios from anon;
revoke insert, update, delete on public.escuelas_barrios from authenticated;

-- ── Espacios políticos / acoples ─────────────────────────────────────────────
create table if not exists public.listas_espacios (
  categoria      text not null,
  lista_numero   int  not null,
  espacio        text not null default 'sin_clasificar',
  acople         boolean not null default false,
  referente      text,
  -- 'sugerido' = precarga automática por nombre (revisar); 'confirmado' = el equipo lo validó
  origen         text not null default 'sugerido',
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en timestamptz not null default now(),
  primary key (categoria, lista_numero)
);
create index if not exists listas_espacios_espacio_idx on public.listas_espacios (espacio);

alter table public.listas_espacios enable row level security;
drop policy if exists listas_espacios_todo on public.listas_espacios;
create policy listas_espacios_todo on public.listas_espacios
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.listas_espacios from anon;

-- ── Universos de listas (conjuntos nombrados) ────────────────────────────────
create table if not exists public.universos_listas (
  nombre       text not null,
  categoria    text not null,
  lista_numero int  not null,
  referente    text,
  creado_por   uuid references public.perfiles (id) on delete set null,
  creado_en    timestamptz not null default now(),
  primary key (nombre, categoria, lista_numero)
);

alter table public.universos_listas enable row level security;
drop policy if exists universos_listas_todo on public.universos_listas;
create policy universos_listas_todo on public.universos_listas
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.universos_listas from anon;

-- ── Nivel territorial: agrega BARRIO a los niveles ya soportados ────────────
create or replace function public._nivel_territorial(p_eleccion text, p_nivel text)
returns text language plpgsql immutable as $fn$
begin
  if p_nivel not in ('mesa', 'escuela', 'circuito', 'barrio') then
    raise exception 'nivel inválido: % (usar mesa, escuela, circuito o barrio)', p_nivel;
  end if;
  if p_eleccion = '2025' and p_nivel in ('escuela', 'barrio') then
    raise exception 'los resultados 2025 (elección nacional) no tienen cruce mesa a escuela: usá nivel mesa o circuito';
  end if;
  if p_eleccion not in ('2023', '2025') then
    raise exception 'elección inválida: % (usar 2023 o 2025)', p_eleccion;
  end if;
  return p_nivel;
end $fn$;

-- Si existiera la firma vieja de 5 parámetros (antes de agregar p_limite),
-- hay que eliminarla: `create or replace` con distinta firma crea una
-- SOBRECARGA y PostgREST no puede elegir cuando se la llama sin ese parámetro.
drop function if exists public.universo_territorial(text, int[], text, text, text);

/**
 * Distribución territorial de un UNIVERSO de listas: cuántos votos sumó el
 * conjunto en cada mesa / escuela / circuito / barrio, qué proporción de los
 * positivos representa, y la bolsa de crecimiento (blancos + ausentes).
 * Con p_listas null usa el universo nombrado p_universo.
 *
 * p_limite es explícito a propósito: el nivel mesa tiene ~1087 espacios y
 * PostgREST los truncaba en 1000 SIN avisar. Ahora el recorte es intencional
 * y siempre ordenado por votos del universo.
 *
 * Participación y ausentes se calculan sobre el MISMO subconjunto de mesas
 * (las que tienen padrón conocido): las mesas de 2023 que ya no existen en el
 * padrón vigente aportan votos pero 0 electores, y al dividirlas daban
 * participaciones imposibles.
 */
create or replace function public.universo_territorial(
  p_categoria text default 'CONCEJAL',
  p_listas int[] default null,
  p_nivel text default 'circuito',
  p_universo text default null,
  p_eleccion text default '2023',
  p_limite int default 400
) returns table (
  espacio text, circuito text,
  votos_universo bigint, positivos bigint, pct_universo numeric,
  electores bigint, votantes bigint, blancos bigint, ausentes bigint,
  participacion_pct numeric, listas_con_votos int, mesas bigint
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text; v_listas int[];
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_territorial(p_eleccion, p_nivel);
  v_cat := case when p_eleccion = '2025' then 'DIPUTADO NACIONAL' else upper(p_categoria) end;

  v_listas := p_listas;
  if v_listas is null or array_length(v_listas, 1) is null then
    if p_universo is null then raise exception 'pasá p_listas o p_universo'; end if;
    select array_agg(u.lista_numero) into v_listas
    from public.universos_listas u
    where u.nombre = p_universo and u.categoria = v_cat;
  end if;
  if v_listas is null or array_length(v_listas, 1) is null then
    raise exception 'el universo no tiene listas';
  end if;

  return query
  with votos as (
    select case v_nivel
             when 'mesa' then 'Mesa ' || v.mesa
             when 'escuela' then v.escuela
             when 'barrio' then coalesce(eb.barrio, 'sin barrio')
             else 'Circuito ' || v.circuito end as esp,
           max(v.circuito) as circ,
           sum(v.votos) filter (where v.lista_id = any (v_listas))::bigint as mios,
           sum(v.votos)::bigint as pos,
           count(distinct v.lista_id) filter (where v.lista_id = any (v_listas) and v.votos > 0)::int as nlistas,
           count(distinct v.mesa)::bigint as nmesas
    from public.v_votos_elecciones v
    left join public.escuelas_barrios eb on v_nivel = 'barrio' and eb.escuela = v.escuela
    where v.eleccion = p_eleccion and v.categoria = v_cat
      and (v_nivel <> 'circuito' or v.circuito is not null)
    group by 1
  ), tot as (
    select case v_nivel
             when 'mesa' then 'Mesa ' || t.mesa
             when 'escuela' then t.escuela
             when 'barrio' then coalesce(eb.barrio, 'sin barrio')
             else 'Circuito ' || t.circuito end as esp,
           sum(t.electores)::bigint as el,
           sum(t.total)::bigint as vot,
           sum(t.blanco)::bigint as bl,
           -- votantes SOLO de las mesas cuyo padrón conocemos: comparable con el
           sum(t.total) filter (where t.electores > 0)::bigint as vot_comp
    from public.v_totales_elecciones t
    left join public.escuelas_barrios eb on v_nivel = 'barrio' and eb.escuela = t.escuela
    where t.eleccion = p_eleccion and t.categoria = v_cat
      and (v_nivel <> 'circuito' or t.circuito is not null)
    group by 1
  )
  select v.esp, v.circ,
         coalesce(v.mios, 0), v.pos,
         round(100.0 * coalesce(v.mios, 0) / greatest(1, v.pos), 2),
         coalesce(t.el, 0), coalesce(t.vot, 0), coalesce(t.bl, 0),
         greatest(0, coalesce(t.el, 0) - coalesce(t.vot_comp, 0))::bigint,
         case when coalesce(t.el, 0) > 0
              then round(100.0 * coalesce(t.vot_comp, 0) / t.el, 1)
              else null end,
         v.nlistas, v.nmesas
  from votos v
  left join tot t on t.esp = v.esp
  where coalesce(v.mios, 0) > 0
  order by coalesce(v.mios, 0) desc
  limit greatest(1, least(p_limite, 900));
end $fn$;

/** Desglose lista por lista del universo dentro de un espacio concreto. */
create or replace function public.universo_por_lista(
  p_categoria text default 'CONCEJAL',
  p_listas int[] default null,
  p_nivel text default 'circuito',
  p_codigo text default null,
  p_universo text default null
) returns table (lista_numero int, lista text, votos bigint, pct_positivos numeric, mesas bigint)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text; v_listas int[]; v_pos bigint;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_territorial('2023', p_nivel);
  v_cat := upper(p_categoria);

  v_listas := p_listas;
  if v_listas is null or array_length(v_listas, 1) is null then
    select array_agg(u.lista_numero) into v_listas
    from public.universos_listas u
    where u.nombre = p_universo and u.categoria = v_cat;
  end if;
  if v_listas is null then raise exception 'el universo no tiene listas'; end if;

  select sum(v.votos)::bigint into v_pos
  from public.v_votos_elecciones v
  left join public.escuelas_barrios eb on v_nivel = 'barrio' and eb.escuela = v.escuela
  where v.eleccion = '2023' and v.categoria = v_cat
    and (p_codigo is null or case v_nivel
           when 'mesa' then v.mesa::text = replace(upper(p_codigo), 'MESA ', '')
           when 'escuela' then v.escuela = p_codigo
           when 'barrio' then eb.barrio = p_codigo
           else upper(v.circuito) = replace(upper(p_codigo), 'CIRCUITO ', '') end);

  return query
  select v.lista_id, max(v.lista), sum(v.votos)::bigint,
         round(100.0 * sum(v.votos) / greatest(1, v_pos), 2),
         count(distinct v.mesa)::bigint
  from public.v_votos_elecciones v
  left join public.escuelas_barrios eb on v_nivel = 'barrio' and eb.escuela = v.escuela
  where v.eleccion = '2023' and v.categoria = v_cat
    and v.lista_id = any (v_listas)
    and (p_codigo is null or case v_nivel
           when 'mesa' then v.mesa::text = replace(upper(p_codigo), 'MESA ', '')
           when 'escuela' then v.escuela = p_codigo
           when 'barrio' then eb.barrio = p_codigo
           else upper(v.circuito) = replace(upper(p_codigo), 'CIRCUITO ', '') end)
  group by v.lista_id
  order by 3 desc;
end $fn$;

/**
 * Agregado por ESPACIO POLÍTICO (según listas_espacios): mide la
 * fragmentación y alimenta el simulador de reparto de bancas. Devuelve el
 * total por espacio y, dentro de cada uno, cuántas listas lo componen y cuál
 * es la más votada (la que "encabeza" el espacio).
 */
create or replace function public.espacios_politicos(
  p_categoria text default 'CONCEJAL',
  p_nivel text default 'circuito',
  p_codigo text default null
) returns table (
  espacio text, listas int, votos bigint, pct numeric,
  lista_mayor int, lista_mayor_nombre text, votos_lista_mayor bigint,
  con_acoples int
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_cat text; v_nivel text; v_total bigint;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := public._nivel_territorial('2023', p_nivel);
  v_cat := upper(p_categoria);

  return query
  with base as (
    select coalesce(le.espacio, 'sin_clasificar') as esp,
           coalesce(le.acople, false) as es_acople,
           v.lista_id as lid, max(v.lista) as l,
           sum(v.votos)::bigint as vv
    from public.v_votos_elecciones v
    left join public.listas_espacios le on le.categoria = v_cat and le.lista_numero = v.lista_id
    left join public.escuelas_barrios eb on v_nivel = 'barrio' and eb.escuela = v.escuela
    where v.eleccion = '2023' and v.categoria = v_cat
      and (p_codigo is null or case v_nivel
             when 'mesa' then v.mesa::text = replace(upper(p_codigo), 'MESA ', '')
             when 'escuela' then v.escuela = p_codigo
             when 'barrio' then eb.barrio = p_codigo
             else upper(v.circuito) = replace(upper(p_codigo), 'CIRCUITO ', '') end)
    group by 1, 2, v.lista_id
  ), tot as (select sum(b.vv) as t from base b),
  rk as (
    select b.*, row_number() over (partition by b.esp order by b.vv desc) as pos
    from base b
  )
  select r.esp,
         count(*)::int,
         sum(r.vv)::bigint,
         round(100.0 * sum(r.vv) / greatest(1, (select t from tot)), 2),
         max(r.lid) filter (where r.pos = 1),
         max(r.l) filter (where r.pos = 1),
         max(r.vv) filter (where r.pos = 1),
         (count(*) filter (where r.es_acople))::int
  from rk r
  group by r.esp
  order by 3 desc;
end $fn$;

-- ── Precarga del universo "Sin banca 2027" (las 8 listas del equipo) ────────
insert into public.universos_listas (nombre, categoria, lista_numero, referente) values
  ('Sin banca 2027', 'CONCEJAL', 269, 'Darío René Ramírez'),
  ('Sin banca 2027', 'CONCEJAL',   4, 'Walter Fabián Soria'),
  ('Sin banca 2027', 'CONCEJAL', 359, 'Daniel / Víctor Deiana'),
  ('Sin banca 2027', 'CONCEJAL', 277, 'Guillermo Martín Gassenbauer'),
  ('Sin banca 2027', 'CONCEJAL', 267, 'Hugo Cabral'),
  ('Sin banca 2027', 'CONCEJAL',  58, 'Carlos Adrián Amaya'),
  ('Sin banca 2027', 'CONCEJAL', 493, 'José Antonio Teri'),
  ('Sin banca 2027', 'CONCEJAL', 325, null)
on conflict (nombre, categoria, lista_numero) do update set referente = excluded.referente;

-- ── Precarga SUGERIDA de espacios (heurística por nombre; el equipo revisa) ─
-- Solo se insertan las listas que todavía no estén clasificadas: nunca pisa
-- una clasificación confirmada por el equipo.
insert into public.listas_espacios (categoria, lista_numero, espacio, acople, origen)
select 'CONCEJAL', l.lista_numero,
       case
         when l.lista_nombre ~* '(lealtad|victoria|justicia social|inclusion social|frente de todos|peronis|militancia|laborista|unidad ciudadana)' then 'peronismo'
         when l.lista_nombre ~* '(cambiemos|cambia|el cambio|pro tucuman|creo)' then 'no_peronismo_cambiemos'
         when l.lista_nombre ~* '(izquierda|obrera|trabajadores)' then 'izquierda'
         when l.lista_nombre ~* 'fuerza republicana' then 'fuerza_republicana'
         when l.lista_nombre ~* 'libertad avanza' then 'lla'
         else 'sin_clasificar'
       end,
       false,
       'sugerido'
from (
  select r.lista_numero, max(r.lista_nombre) as lista_nombre
  from public.resultados_2023 r
  where r.categoria = 'CONCEJAL'
  group by r.lista_numero
) l
on conflict (categoria, lista_numero) do nothing;

notify pgrst, 'reload schema';

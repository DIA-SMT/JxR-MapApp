-- 0015 · Herramientas de análisis político
--
--   1. transferencia_datos    · insumos para la matriz de flujos 2023→2025
--   2. contactos              · el dato propio: timbreo agregado por territorio
--   3. muestras               · diseños muestrales guardados para encuestas
--   4. calendario_hitos       · plazos legales de la jornada, parametrizables
--   5. cohorte_joven           · el voto joven ya inscripto, por circuito
--   6. diad_prioridad_mesas   · qué mesas fiscalizar primero, por valor

-- ── 1. Insumos de la matriz de transferencia ────────────────────────────────
/**
 * Devuelve, por circuito, todo lo necesario para estimar la matriz de flujos
 * entre dos elecciones: votos por lista/agrupación, blancos, votantes y padrón.
 *
 * El padrón de 2023 por mesa no se importó, así que la base de origen es el
 * padrón VIGENTE contado sobre la tabla electores (459.156), que está a 0,02%
 * del padrón del escrutinio definitivo 2023 (459.239). El de 2025 es el
 * nacional, que viene en mesas_2025 y es distinto (464.795): la estimación
 * reescala, y el crecimiento queda modelado en la fila de abstención.
 */
create or replace function public.transferencia_datos(p_categoria_2023 text default 'INTENDENTE')
returns table (
  circuito text,
  padron_2023 bigint, votantes_2023 bigint, blanco_2023 bigint, votos_2023 jsonb,
  electores_2025 bigint, votantes_2025 bigint, blanco_2025 bigint, votos_2025 jsonb
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  with pad as (
    -- padrón vigente por circuito: TODOS los electores, con mesa asignada o sin ella
    select e.circuito as circ, count(*)::bigint as n
    from public.electores e
    where e.circuito is not null
    group by 1
  ), t23 as (
    select t.circuito as circ,
           sum(t.total)::bigint as votantes,
           sum(coalesce(t.blanco, 0) + coalesce(t.nulos, 0))::bigint as bl
    from public.mesas_2023_totales t
    where t.categoria = upper(p_categoria_2023) and t.circuito is not null
    group by 1
  ), v23 as (
    select r.circuito as circ,
           jsonb_object_agg(r.lista_numero::text, r.suma) as votos
    from (
      select r2.circuito, r2.lista_numero, sum(r2.votos)::bigint as suma
      from public.resultados_2023 r2
      where r2.categoria = upper(p_categoria_2023) and r2.circuito is not null
      group by 1, 2
    ) r
    group by 1
  ), t25 as (
    select m.circuito as circ,
           sum(m.electores)::bigint as el,
           sum(m.total)::bigint as votantes,
           sum(coalesce(m.blanco, 0) + coalesce(m.nulos, 0))::bigint as bl
    from public.mesas_2025 m
    group by 1
  ), v25 as (
    select r.circuito as circ,
           jsonb_object_agg(r.agrupacion_id::text, r.suma) as votos
    from (
      select r2.circuito, r2.agrupacion_id, sum(r2.votos)::bigint as suma
      from public.resultados_2025 r2
      group by 1, 2
    ) r
    group by 1
  )
  select pad.circ,
         pad.n, coalesce(t23.votantes, 0), coalesce(t23.bl, 0), coalesce(v23.votos, '{}'::jsonb),
         coalesce(t25.el, 0), coalesce(t25.votantes, 0), coalesce(t25.bl, 0), coalesce(v25.votos, '{}'::jsonb)
  from pad
  left join t23 on t23.circ = pad.circ
  left join v23 on v23.circ = pad.circ
  left join t25 on t25.circ = pad.circ
  left join v25 on v25.circ = pad.circ
  -- solo circuitos con datos de las dos elecciones: la matriz los necesita a ambos
  where t23.votantes is not null and t25.votantes is not null
  order by 1;
end $fn$;

-- ── 2. Contactos territoriales ──────────────────────────────────────────────
/**
 * El dato propio de la campaña. Se registra AGREGADO por territorio y jornada
 * (una planilla de conteo, no un fichero de votantes): cuántas puertas se
 * golpearon y cómo respondieron. Nunca se guarda a quién se contactó, que es la
 * línea que la aplicación no cruza.
 */
create table if not exists public.contactos (
  id         bigint generated always as identity primary key,
  fecha      date not null default current_date,
  nivel      text not null default 'mesa' check (nivel in ('mesa', 'escuela', 'circuito', 'barrio')),
  codigo     text not null,                -- mesa, nombre de escuela, circuito o barrio
  circuito   text not null default '',
  escuela    text not null default '',
  contactados    int not null default 0 check (contactados >= 0),
  favorables     int not null default 0 check (favorables >= 0),
  indecisos      int not null default 0 check (indecisos >= 0),
  contrarios     int not null default 0 check (contrarios >= 0),
  no_atendieron  int not null default 0 check (no_atendieron >= 0),
  tema       text not null default '',     -- qué apareció como preocupación principal
  persona_id bigint references public.personas (id) on delete set null,
  notas      text not null default '',
  creado_por uuid references public.perfiles (id) on delete set null,
  creado_en  timestamptz not null default now()
);
create index if not exists contactos_nivel_idx on public.contactos (nivel, codigo);
create index if not exists contactos_circuito_idx on public.contactos (circuito);
create index if not exists contactos_fecha_idx on public.contactos (fecha);

alter table public.contactos enable row level security;
drop policy if exists contactos_todo on public.contactos;
create policy contactos_todo on public.contactos
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.contactos from anon;

/**
 * Propensión medida por territorio: de lo que efectivamente se caminó, qué
 * proporción respondió favorable. Es lo que convierte el índice estructural en
 * un índice vivo. `n` dice cuánto pesa cada número: con 12 contactos no se
 * concluye nada.
 */
create or replace function public.contactos_resumen(p_nivel text default 'circuito')
returns table (
  espacio text, circuito text,
  jornadas bigint, contactados bigint, favorables bigint, indecisos bigint,
  contrarios bigint, no_atendieron bigint,
  pct_favorable numeric, pct_contrario numeric, efectividad numeric,
  ultima_fecha date, tema_top text
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_nivel text;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_nivel := lower(coalesce(p_nivel, 'circuito'));
  if v_nivel not in ('mesa', 'escuela', 'circuito', 'barrio') then
    raise exception 'nivel inválido: mesa, escuela, circuito o barrio';
  end if;

  return query
  with base as (
    select c.*,
           case v_nivel
             when 'circuito' then coalesce(nullif(c.circuito, ''), c.codigo)
             when 'escuela'  then coalesce(nullif(c.escuela, ''), c.codigo)
             else c.codigo
           end as esp
    from public.contactos c
    where c.nivel = v_nivel or v_nivel in ('circuito', 'escuela')
  ), agr as (
    select b.esp,
           max(b.circuito) as circ,
           count(*)::bigint as jornadas,
           sum(b.contactados)::bigint as cont,
           sum(b.favorables)::bigint as fav,
           sum(b.indecisos)::bigint as ind,
           sum(b.contrarios)::bigint as contra,
           sum(b.no_atendieron)::bigint as noat,
           max(b.fecha) as ult
    from base b
    group by 1
  ), temas as (
    select b.esp, b.tema, count(*) as n,
           row_number() over (partition by b.esp order by count(*) desc) as pos
    from base b
    where b.tema <> ''
    group by 1, 2
  )
  select agr.esp, agr.circ, agr.jornadas, agr.cont, agr.fav, agr.ind, agr.contra, agr.noat,
         -- sobre los que efectivamente respondieron, no sobre los golpeados
         case when (agr.fav + agr.ind + agr.contra) > 0
              then round(100.0 * agr.fav / (agr.fav + agr.ind + agr.contra), 1) end,
         case when (agr.fav + agr.ind + agr.contra) > 0
              then round(100.0 * agr.contra / (agr.fav + agr.ind + agr.contra), 1) end,
         case when agr.cont > 0 then round(100.0 * (agr.cont - agr.noat) / agr.cont, 1) end,
         agr.ult,
         (select t.tema from temas t where t.esp = agr.esp and t.pos = 1)
  from agr
  order by agr.cont desc;
end $fn$;

-- ── 3. Diseños muestrales guardados ─────────────────────────────────────────
create table if not exists public.muestras (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  n_objetivo  int not null,
  confianza   numeric not null default 95,
  margen      numeric,                     -- margen de error resultante, en puntos
  estratos    jsonb not null default '[]'::jsonb,  -- [{circuito, electores, entrevistas, peso}]
  notas       text not null default '',
  creado_por  uuid references public.perfiles (id) on delete set null,
  creado_en   timestamptz not null default now()
);

alter table public.muestras enable row level security;
drop policy if exists muestras_todo on public.muestras;
create policy muestras_todo on public.muestras
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.muestras from anon;

-- ── 4. Calendario electoral ─────────────────────────────────────────────────
/**
 * Hitos de la jornada con su plazo expresado en DÍAS ANTES de la elección, para
 * que sirva en cualquier elección: la fecha concreta se calcula contra la fecha
 * cargada en diad_config. Los plazos son parametrizables porque cada elección
 * los fija por resolución de la Junta Electoral.
 */
create table if not exists public.calendario_hitos (
  id          bigint generated always as identity primary key,
  hito        text not null,
  dias_antes  int not null,
  norma       text not null default '',
  responsable text not null default '',
  -- 'verificado' = plazo confirmado en la norma citada · 'a confirmar' = hay que
  -- validarlo con la Junta Electoral antes de operar sobre él
  certeza     text not null default 'a confirmar' check (certeza in ('verificado', 'a confirmar')),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'en curso', 'cumplido', 'no aplica')),
  notas       text not null default '',
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en  timestamptz not null default now()
);

alter table public.calendario_hitos enable row level security;
drop policy if exists calendario_hitos_todo on public.calendario_hitos;
create policy calendario_hitos_todo on public.calendario_hitos
  for all to authenticated using ((select public.tiene_perfil())) with check ((select public.tiene_perfil()));
revoke all on public.calendario_hitos from anon;

-- ── 5. Voto joven ───────────────────────────────────────────────────────────
/**
 * NO se puede medir el primer voto 2027 con este padrón. Los que cumplen 16 o
 * 17 en 2027 nacieron en 2010-2011, y el padrón vigente tiene 47 electores
 * nacidos en 2010 y ninguno en 2011: se armó cuando esos chicos tenían 13-14
 * años. Recién van a aparecer cuando la Junta publique el padrón actualizado.
 *
 * Lo que sí se mide es el VOTO JOVEN ya inscripto, que es el segmento de menor
 * lealtad partidaria: 48.003 electores de 16 a 24 años estimados (10,5% del
 * padrón), concentrados en el circuito 21 (16,3%). La edad es ESTIMADA por
 * rango de DNI (±3 años): dimensiona cohortes, no afirma la edad de nadie.
 */
drop function if exists public.primer_voto(int);

create or replace function public.cohorte_joven(p_edad_max int default 24)
returns table (
  circuito text,
  electores bigint,
  jovenes bigint,
  pct numeric,
  mujeres bigint,
  varones bigint,
  anio_min int,
  anio_max int
)
language plpgsql stable security definer set search_path = public
as $fn$
declare v_max int; v_desde int; v_anio_actual int;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  v_max := greatest(17, least(coalesce(p_edad_max, 24), 40));
  v_anio_actual := extract(year from current_date)::int;
  v_desde := v_anio_actual - v_max;
  return query
  select e.circuito,
         count(*)::bigint,
         count(*) filter (where e.anio_nac_estimado >= v_desde)::bigint,
         round(100.0 * count(*) filter (where e.anio_nac_estimado >= v_desde) / greatest(1, count(*)), 2),
         count(*) filter (where e.anio_nac_estimado >= v_desde and e.sexo = 'F')::bigint,
         count(*) filter (where e.anio_nac_estimado >= v_desde and e.sexo = 'M')::bigint,
         v_desde,
         v_anio_actual - 16
  from public.electores e
  where e.circuito is not null
  group by 1
  order by 3 desc;
end $fn$;

-- ── 6. Qué mesas fiscalizar primero ─────────────────────────────────────────
/**
 * Con fiscales limitados no se cubren 1.087 mesas: se cubren las que importan.
 * El score combina el VOLUMEN de la mesa, la COMPETITIVIDAD de su circuito en
 * 2025 (cuánto se define por poco) y el VOTO PROPIO POTENCIAL de su escuela
 * (disperso 2023), y penaliza las que ya tienen fiscal para que el ranking
 * muestre lo que falta cubrir.
 *
 * Las mesas de 2025 tienen otra numeración que el padrón provincial, así que la
 * competitividad se toma a nivel CIRCUITO, que es donde los códigos coinciden.
 */
create or replace function public.diad_prioridad_mesas(p_listas int[] default null, p_limite int default 200)
returns table (
  mesa int, escuela text, circuito text, electores int,
  competitividad numeric, disperso_escuela bigint, tiene_fiscal boolean,
  score numeric, acumulado_electores bigint
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  return query
  with comp as (
    -- 1 - (diferencia 1º-2º / positivos) por circuito en 2025: 1 = empate técnico
    select x.circuito as circ,
           greatest(0, 1 - (x.primero - x.segundo)::numeric / greatest(1, x.positivos)) as valor
    from (
      select r.circuito,
             max(r.suma) as primero,
             coalesce((array_agg(r.suma order by r.suma desc))[2], 0) as segundo,
             sum(r.suma) as positivos
      from (select r2.circuito, r2.agrupacion_id, sum(r2.votos) as suma
            from public.resultados_2025 r2 group by 1, 2) r
      group by 1
    ) x
  ), disp as (
    select r.escuela as esc, sum(r.votos)::bigint as votos
    from public.v_votos_elecciones r
    where r.eleccion = '2023' and r.categoria = 'CONCEJAL'
      and r.escuela is not null
      and (p_listas is null or r.lista_id = any (p_listas))
    group by 1
  ), maxes as (
    select greatest(1, max(m.electores)) as max_el,
           greatest(1, coalesce(max(d.votos), 1)) as max_disp
    from public.mesas m left join disp d on d.esc = m.escuela
  ), base as (
    select m.mesa, coalesce(m.escuela, '') as escuela, coalesce(m.circuito, '') as circuito,
           m.electores,
           round(coalesce(comp.valor, 0), 3) as competitividad,
           coalesce(disp.votos, 0) as disperso,
           (f.mesa is not null) as con_fiscal,
           -- 40% competitividad + 35% volumen + 25% voto propio potencial
           round(100 * (
             0.40 * coalesce(comp.valor, 0)
             + 0.35 * (m.electores::numeric / (select max_el from maxes))
             + 0.25 * (coalesce(disp.votos, 0)::numeric / (select max_disp from maxes))
           ), 1) as score
    from public.mesas m
    left join comp on comp.circ = m.circuito
    left join disp on disp.esc = m.escuela
    left join public.diad_fiscales f on f.mesa = m.mesa
  )
  select b.mesa, b.escuela, b.circuito, b.electores, b.competitividad, b.disperso, b.con_fiscal, b.score,
         sum(b.electores) over (order by b.con_fiscal, b.score desc, b.mesa
                                rows between unbounded preceding and current row)::bigint
  from base b
  -- sin fiscal primero, y dentro de eso por score: es el orden en que conviene cubrir
  order by b.con_fiscal, b.score desc, b.mesa
  limit greatest(1, least(coalesce(p_limite, 200), 1200));
end $fn$;

notify pgrst, 'reload schema';

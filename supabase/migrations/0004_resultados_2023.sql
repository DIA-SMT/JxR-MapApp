-- ═══════════════════════════════════════════════════════════════════════════
-- Resultados electorales 2023 (escrutinio definitivo, mesa a mesa, Capital)
-- + mapeo mesa→escuela (derivado del padrón) + universo de la estrategia.
-- Datos AGREGADOS y públicos (Junta Electoral): ningún dato individual.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.resultados_2023 (
  id           bigint generated always as identity primary key,
  categoria    text not null,      -- GOBERNADOR / LEGISLADOR / INTENDENTE / CONCEJAL
  mesa         int not null,
  circuito     text,
  lista_numero int not null,
  lista_nombre text not null,
  votos        int not null
);
create index resultados_2023_cat_mesa_idx on public.resultados_2023 (categoria, mesa);
create index resultados_2023_cat_lista_idx on public.resultados_2023 (categoria, lista_numero);
create index resultados_2023_circuito_idx on public.resultados_2023 (circuito);

/** Totales por mesa y categoría (blanco/nulos/positivos/total). */
create table public.mesas_2023_totales (
  categoria  text not null,
  mesa       int not null,
  circuito   text,
  blanco     int,
  nulos      int,
  positivos  int,
  total      int,
  primary key (categoria, mesa)
);

/** Mesa → escuela/circuito/electores según el padrón vigente. */
create table public.mesas (
  mesa      int primary key,
  escuela   text,
  circuito  text,
  electores int not null default 0
);

/** Universo de la estrategia: escuelas marcadas para trabajar. */
create table public.estrategia_escuelas (
  escuela        text primary key,
  incluida       boolean not null default true,
  notas          text,
  actualizado_por uuid references public.perfiles (id) on delete set null,
  actualizado_en timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.resultados_2023     enable row level security;
alter table public.mesas_2023_totales  enable row level security;
alter table public.mesas               enable row level security;
alter table public.estrategia_escuelas enable row level security;

create policy resultados_2023_select on public.resultados_2023
  for select to authenticated using (public.tiene_perfil());
create policy mesas_2023_totales_select on public.mesas_2023_totales
  for select to authenticated using (public.tiene_perfil());
create policy mesas_select on public.mesas
  for select to authenticated using (public.tiene_perfil());
create policy estrategia_escuelas_todo on public.estrategia_escuelas
  for all to authenticated using (public.tiene_perfil()) with check (public.tiene_perfil());

revoke all on public.resultados_2023, public.mesas_2023_totales, public.mesas, public.estrategia_escuelas from anon;
revoke insert, update, delete on public.resultados_2023, public.mesas_2023_totales, public.mesas from authenticated;

-- ── Funciones de análisis (RLS del usuario) ──────────────────────────────────

/** Ranking de listas de una categoría con su total en la Capital. */
create or replace function public.listas_2023(p_categoria text)
returns table (lista_numero int, lista_nombre text, votos bigint, mesas bigint)
language sql stable
as $$
  select r.lista_numero, max(r.lista_nombre), sum(r.votos)::bigint, count(distinct r.mesa)::bigint
  from public.resultados_2023 r
  where r.categoria = upper(p_categoria)
  group by r.lista_numero
  order by 3 desc
$$;

/** Votos de un conjunto de listas agrupados por ESCUELA (cruce mesa→escuela
    del padrón; las mesas sin cruce quedan agrupadas como 'Mesa N'). */
create or replace function public.votos_por_escuela_2023(p_categoria text, p_listas int[])
returns table (escuela text, circuito text, votos bigint, mesas bigint, electores bigint)
language sql stable
as $$
  select coalesce(m.escuela, 'Mesa ' || r.mesa) as escuela,
         coalesce(m.circuito, r.circuito) as circuito,
         sum(r.votos)::bigint as votos,
         count(distinct r.mesa)::bigint as mesas,
         coalesce(max(es.electores), 0)::bigint as electores
  from public.resultados_2023 r
  left join public.mesas m on m.mesa = r.mesa
  left join public.escuelas es on es.nombre = m.escuela
  where r.categoria = upper(p_categoria)
    and r.lista_numero = any (p_listas)
  group by 1, 2
  order by 3 desc
$$;

/** Votos de un conjunto de listas por CIRCUITO (coropleta del mapa). */
create or replace function public.votos_por_circuito_2023(p_categoria text, p_listas int[])
returns table (circuito text, votos bigint)
language sql stable
as $$
  select r.circuito, sum(r.votos)::bigint
  from public.resultados_2023 r
  where r.categoria = upper(p_categoria)
    and r.lista_numero = any (p_listas)
    and r.circuito is not null
  group by 1
$$;

/** Estado del universo de la estrategia contra la meta. */
create or replace function public.estrategia_resumen(
  p_categoria text,
  p_listas int[],
  p_meta int default 20000
) returns json
language sql stable
as $$
  with v as (select * from public.votos_por_escuela_2023(p_categoria, p_listas))
  select json_build_object(
    'meta', p_meta,
    'escuelas_incluidas', (select count(*) from public.estrategia_escuelas where incluida),
    'votos_incluidos', coalesce((
      select sum(v.votos) from v
      join public.estrategia_escuelas ee on ee.escuela = v.escuela and ee.incluida
    ), 0)
  )
$$;

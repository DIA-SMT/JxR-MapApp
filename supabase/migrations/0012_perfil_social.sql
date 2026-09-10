-- ═══════════════════════════════════════════════════════════════════════════
-- Inteligencia territorial: perfil socioeconómico por radio censal (Censo
-- 2022, INDEC) cruzado con circuitos electorales y barrios.
--
--  · radios_censo: indicadores agregados por radio censal (671 en Capital).
--    Datos PÚBLICOS y AGREGADOS del censo — nunca microdato individual.
--  · radios_espacios: qué proporción de cada radio cae en cada circuito y en
--    cada barrio (cruce por muestreo geométrico). Permite agregar el perfil
--    social al nivel electoral sin inventar precisión.
--  · perfil_social(): el perfil de un circuito o barrio, con los indicadores
--    ponderados por la superposición de los radios.
--
-- Límite honesto: el censo no dice cómo vota nadie ni qué problemática tiene
-- una persona. Da el CONTEXTO SOCIAL de la zona (empleo, NBI, servicios,
-- educación, edad) para cruzarlo con el comportamiento electoral agregado.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.radios_censo (
  radio                   text primary key,   -- cod_indec del INDEC (ej 900842103)
  poblacion               int not null default 0,
  hogares                 int not null default 0,
  pob_hasta14             int not null default 0,
  pob_15_64               int not null default 0,
  pob_65mas               int not null default 0,
  -- Vivienda y pobreza estructural
  hogares_nbi             int not null default 0,  -- NBI_TOT = Sí
  hogares_privacion       int not null default 0,  -- IPMH con privación (recursos y/o patrimonial)
  hogares_hacinamiento    int not null default 0,  -- 2 o más personas por cuarto
  hogares_clima_edu_bajo  int not null default 0,  -- clima educativo muy bajo o bajo
  hogares_sin_cloaca      int not null default 0,
  hogares_sin_agua_red    int not null default 0,
  -- Situación laboral (condición de actividad)
  ocupados                int not null default 0,
  desocupados             int not null default 0,
  inactivos               int not null default 0,
  -- Categoría ocupacional
  emp_dependencia         int not null default 0,  -- empleada/o u obrera/o
  emp_cuenta_propia       int not null default 0,
  emp_domestico           int not null default 0,  -- servicio doméstico
  emp_patron              int not null default 0,
  -- Rama del establecimiento
  rama_publica            int not null default 0,  -- administración pública, educación o salud pública
  rama_comercio           int not null default 0,
  rama_construccion       int not null default 0,
  -- Salud y educación
  sin_cobertura_salud     int not null default 0,  -- sin obra social, prepaga ni plan estatal
  edu_sec_completo_mas    int not null default 0
);

/** Superposición radio ↔ espacio electoral/barrial (pct del radio en el espacio). */
create table if not exists public.radios_espacios (
  radio  text not null,
  tipo   text not null,   -- 'circuito' | 'barrio'
  codigo text not null,
  pct    numeric not null,
  primary key (radio, tipo, codigo)
);
create index if not exists radios_espacios_busca_idx on public.radios_espacios (tipo, codigo);

alter table public.radios_censo enable row level security;
alter table public.radios_espacios enable row level security;
drop policy if exists radios_censo_select on public.radios_censo;
create policy radios_censo_select on public.radios_censo
  for select to authenticated using ((select public.tiene_perfil()));
drop policy if exists radios_espacios_select on public.radios_espacios;
create policy radios_espacios_select on public.radios_espacios
  for select to authenticated using ((select public.tiene_perfil()));
revoke all on public.radios_censo, public.radios_espacios from anon;
revoke insert, update, delete on public.radios_censo, public.radios_espacios from authenticated;

/**
 * Perfil social de un circuito o barrio: suma los indicadores de los radios
 * censales que lo componen, ponderados por la proporción del radio que cae
 * dentro del espacio. Devuelve valores absolutos y los porcentajes que
 * importan para la estrategia territorial.
 *
 * p_codigo null = toda la ciudad (útil para comparar una zona con el promedio).
 */
create or replace function public.perfil_social(
  p_nivel text default 'circuito',
  p_codigo text default null
) returns json
language plpgsql stable security definer set search_path = public
as $fn$
declare r json;
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  if p_nivel not in ('circuito', 'barrio', 'ciudad') then
    raise exception 'nivel inválido: % (usar circuito, barrio o ciudad)', p_nivel;
  end if;

  with base as (
    select c.*,
           case when p_nivel = 'ciudad' or p_codigo is null then 1.0
                else coalesce(re.pct, 0) / 100.0 end as w
    from public.radios_censo c
    left join public.radios_espacios re
      on re.radio = c.radio
     and re.tipo = p_nivel
     and upper(re.codigo) = upper(coalesce(p_codigo, ''))
    where p_nivel = 'ciudad' or p_codigo is null or re.pct is not null
  ), agg as (
    select
      round(sum(b.poblacion * b.w))::bigint            as poblacion,
      round(sum(b.hogares * b.w))::bigint              as hogares,
      round(sum(b.pob_hasta14 * b.w))::bigint          as pob_hasta14,
      round(sum(b.pob_15_64 * b.w))::bigint            as pob_15_64,
      round(sum(b.pob_65mas * b.w))::bigint            as pob_65mas,
      round(sum(b.hogares_nbi * b.w))::bigint          as hogares_nbi,
      round(sum(b.hogares_privacion * b.w))::bigint    as hogares_privacion,
      round(sum(b.hogares_hacinamiento * b.w))::bigint as hogares_hacinamiento,
      round(sum(b.hogares_clima_edu_bajo * b.w))::bigint as hogares_clima_edu_bajo,
      round(sum(b.hogares_sin_cloaca * b.w))::bigint   as hogares_sin_cloaca,
      round(sum(b.hogares_sin_agua_red * b.w))::bigint as hogares_sin_agua_red,
      round(sum(b.ocupados * b.w))::bigint             as ocupados,
      round(sum(b.desocupados * b.w))::bigint          as desocupados,
      round(sum(b.inactivos * b.w))::bigint            as inactivos,
      round(sum(b.emp_dependencia * b.w))::bigint      as emp_dependencia,
      round(sum(b.emp_cuenta_propia * b.w))::bigint    as emp_cuenta_propia,
      round(sum(b.emp_domestico * b.w))::bigint        as emp_domestico,
      round(sum(b.emp_patron * b.w))::bigint           as emp_patron,
      round(sum(b.rama_publica * b.w))::bigint         as rama_publica,
      round(sum(b.rama_comercio * b.w))::bigint        as rama_comercio,
      round(sum(b.rama_construccion * b.w))::bigint    as rama_construccion,
      round(sum(b.sin_cobertura_salud * b.w))::bigint  as sin_cobertura_salud,
      round(sum(b.edu_sec_completo_mas * b.w))::bigint as edu_sec_completo_mas,
      count(*) filter (where b.w > 0)::int             as radios
    from base b
  )
  select json_build_object(
    'nivel', p_nivel,
    'codigo', p_codigo,
    'radios_censales', a.radios,
    'poblacion', a.poblacion,
    'hogares', a.hogares,
    'edad', json_build_object(
      'hasta_14', a.pob_hasta14, 'de_15_a_64', a.pob_15_64, 'de_65_y_mas', a.pob_65mas,
      'pct_65_y_mas', case when a.poblacion > 0 then round(100.0 * a.pob_65mas / a.poblacion, 1) end
    ),
    'pobreza', json_build_object(
      'hogares_nbi', a.hogares_nbi,
      'pct_nbi', case when a.hogares > 0 then round(100.0 * a.hogares_nbi / a.hogares, 1) end,
      'hogares_con_privacion', a.hogares_privacion,
      'pct_privacion', case when a.hogares > 0 then round(100.0 * a.hogares_privacion / a.hogares, 1) end,
      'hogares_hacinados', a.hogares_hacinamiento,
      'pct_hacinamiento', case when a.hogares > 0 then round(100.0 * a.hogares_hacinamiento / a.hogares, 1) end
    ),
    'servicios', json_build_object(
      'hogares_sin_cloaca', a.hogares_sin_cloaca,
      'pct_sin_cloaca', case when a.hogares > 0 then round(100.0 * a.hogares_sin_cloaca / a.hogares, 1) end,
      'hogares_sin_agua_de_red', a.hogares_sin_agua_red,
      'pct_sin_agua_de_red', case when a.hogares > 0 then round(100.0 * a.hogares_sin_agua_red / a.hogares, 1) end
    ),
    'trabajo', json_build_object(
      'ocupados', a.ocupados, 'desocupados', a.desocupados, 'inactivos', a.inactivos,
      'tasa_desocupacion', case when (a.ocupados + a.desocupados) > 0
                                then round(100.0 * a.desocupados / (a.ocupados + a.desocupados), 1) end,
      'en_relacion_de_dependencia', a.emp_dependencia,
      'cuenta_propia', a.emp_cuenta_propia,
      'servicio_domestico', a.emp_domestico,
      'patron_o_empleador', a.emp_patron,
      'empleo_publico_o_educacion_salud_publica', a.rama_publica,
      'comercio', a.rama_comercio,
      'construccion', a.rama_construccion
    ),
    'educacion_salud', json_build_object(
      'secundario_completo_o_mas', a.edu_sec_completo_mas,
      'hogares_clima_educativo_bajo', a.hogares_clima_edu_bajo,
      'pct_clima_educativo_bajo', case when a.hogares > 0 then round(100.0 * a.hogares_clima_edu_bajo / a.hogares, 1) end,
      'sin_cobertura_de_salud', a.sin_cobertura_salud,
      'pct_sin_cobertura', case when a.poblacion > 0 then round(100.0 * a.sin_cobertura_salud / a.poblacion, 1) end
    ),
    'fuente', 'Censo Nacional 2022 (INDEC), agregado por radio censal y ponderado por superposición geográfica'
  ) into r
  from agg a;
  return r;
end $fn$;

/** Ranking de circuitos o barrios por un indicador social (para priorizar). */
create or replace function public.ranking_social(
  p_nivel text default 'circuito',
  p_indicador text default 'pct_nbi',
  p_limite int default 50
) returns table (codigo text, poblacion bigint, hogares bigint, valor numeric)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.tiene_perfil() then raise exception 'no autorizado'; end if;
  if p_nivel not in ('circuito', 'barrio') then raise exception 'nivel inválido'; end if;
  if p_indicador not in ('pct_nbi', 'pct_privacion', 'pct_hacinamiento', 'pct_sin_cloaca',
                         'tasa_desocupacion', 'pct_clima_educativo_bajo', 'pct_sin_cobertura', 'pct_65_y_mas') then
    raise exception 'indicador inválido: %', p_indicador;
  end if;
  return query
  with agg as (
    select re.codigo as cod,
           sum(c.poblacion * re.pct / 100.0) as pob,
           sum(c.hogares * re.pct / 100.0) as hog,
           sum(c.hogares_nbi * re.pct / 100.0) as nbi,
           sum(c.hogares_privacion * re.pct / 100.0) as priv,
           sum(c.hogares_hacinamiento * re.pct / 100.0) as hac,
           sum(c.hogares_sin_cloaca * re.pct / 100.0) as sincloaca,
           sum(c.hogares_clima_edu_bajo * re.pct / 100.0) as climabajo,
           sum(c.ocupados * re.pct / 100.0) as ocup,
           sum(c.desocupados * re.pct / 100.0) as desoc,
           sum(c.sin_cobertura_salud * re.pct / 100.0) as sinsalud,
           sum(c.pob_65mas * re.pct / 100.0) as p65
    from public.radios_espacios re
    join public.radios_censo c on c.radio = re.radio
    where re.tipo = p_nivel
    group by re.codigo
  )
  select a.cod, round(a.pob)::bigint, round(a.hog)::bigint,
         case p_indicador
           when 'pct_nbi' then case when a.hog > 0 then round(100.0 * a.nbi / a.hog, 1) else 0 end
           when 'pct_privacion' then case when a.hog > 0 then round(100.0 * a.priv / a.hog, 1) else 0 end
           when 'pct_hacinamiento' then case when a.hog > 0 then round(100.0 * a.hac / a.hog, 1) else 0 end
           when 'pct_sin_cloaca' then case when a.hog > 0 then round(100.0 * a.sincloaca / a.hog, 1) else 0 end
           when 'tasa_desocupacion' then case when (a.ocup + a.desoc) > 0 then round(100.0 * a.desoc / (a.ocup + a.desoc), 1) else 0 end
           when 'pct_clima_educativo_bajo' then case when a.hog > 0 then round(100.0 * a.climabajo / a.hog, 1) else 0 end
           when 'pct_sin_cobertura' then case when a.pob > 0 then round(100.0 * a.sinsalud / a.pob, 1) else 0 end
           else case when a.pob > 0 then round(100.0 * a.p65 / a.pob, 1) else 0 end
         end
  from agg a
  where a.pob > 0
  order by 4 desc
  limit greatest(1, least(p_limite, 400));
end $fn$;

notify pgrst, 'reload schema';

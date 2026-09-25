-- 0016 · Presupuesto: asignación del crédito disponible a políticas públicas por barrio
--
--   1. Acceso: es_superadmin(), presupuesto_habilitados y puede_presupuesto()
--   2. presupuesto_ejercicios          · los totales de la ordenanza, como vara de control
--   3. presupuesto_vedas               · períodos en que no se aprueban cupos ni programas nuevos
--   4. presupuesto_partidas            · crédito vigente y comprometido por partida
--   5. politicas_publicas              · catálogo del Plan Rector 2023-2030
--   6. escenarios (+ asignaciones, financiamiento y ajustes manuales)
--   7. presupuesto_bitacora            · registro inmutable de cada cambio
--   8. necesidad_barrios()             · el Censo 2022 agregado por barrio
--   9. presupuesto_partidas_estado()   · disponible, reservado, libre y excedido por partida
--  10. guardar_escenario() / cambiar_estado_escenario() / borrar_escenario()
--
-- Reglas que este esquema hace cumplir en la BASE, no solo en la pantalla:
--   · lo ve y lo usa solo el superadmin y quien él habilite: no todo usuario
--     de la aplicación;
--   · ningún escenario financia más que el crédito libre de una partida, y lo
--     asignado por política es exactamente lo financiado;
--   · una partida solo financia políticas compatibles según la Ordenanza de
--     Contabilidad 570/80: misma sección, partida principal admitida, y nunca
--     personal (11), intereses (21), inversión financiera (61) ni amortización (71);
--   · aprobar exige superadmin, número de norma y que no lo apruebe quien lo
--     armó (cuatro ojos); no se aprueba con partidas estimadas ni, dentro de
--     una veda, con cupos o programas nuevos (Ley 7876, art. 34);
--   · lo aprobado guarda una foto de las políticas y partidas: si después se
--     edita el catálogo, el acto sigue diciendo lo que decía;
--   · lo que llegó a proponerse no se borra, y la bitácora no se edita;
--   · no hay beneficiarios con nombre: las políticas a personas son cupos por
--     barrio, y el barrio tiene que existir en el censo.
--
-- Nada de esto lee datos electorales.

-- ── 1. Acceso ──────────────────────────────────────────────────────────────
create or replace function public.es_superadmin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'superadmin')
$$;

-- Quién puede usar la herramienta además del superadmin. La aplicación es el
-- comando de una campaña: que tener usuario no alcance para ver y proponer
-- sobre el presupuesto público.
create table if not exists public.presupuesto_habilitados (
  perfil_id uuid primary key references public.perfiles(id) on delete cascade,
  habilitado_por uuid,
  habilitado_en timestamptz not null default now()
);
alter table public.presupuesto_habilitados enable row level security;
drop policy if exists presupuesto_habilitados_select on public.presupuesto_habilitados;
create policy presupuesto_habilitados_select on public.presupuesto_habilitados
  for select to authenticated using ((select public.es_superadmin()) or perfil_id = auth.uid());
revoke all on public.presupuesto_habilitados from anon;
revoke insert, update, delete, truncate on public.presupuesto_habilitados from authenticated;

create or replace function public.puede_presupuesto()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.es_superadmin()
      or exists (select 1 from public.presupuesto_habilitados h
                 join public.perfiles p on p.id = h.perfil_id
                 where h.perfil_id = auth.uid())
$$;

-- ── 2. Ejercicios ──────────────────────────────────────────────────────────
create table if not exists public.presupuesto_ejercicios (
  ejercicio int primary key,
  total_corrientes numeric(18,2) not null check (total_corrientes >= 0 and total_corrientes <> 'NaN'),
  total_capital numeric(18,2) not null check (total_capital >= 0 and total_capital <> 'NaN'),
  norma text not null default '',
  notas text not null default ''
);

insert into public.presupuesto_ejercicios (ejercicio, total_corrientes, total_capital, norma, notas)
values (
  2026, 266821140000, 82947843000,
  'Ordenanza 5486/26 · Presupuesto General 2026 (expte. 537-HCD-25-L)',
  'Art. 1º: erogaciones $349.768.983.000. El detalle por partida va en las planillas anexas y en el decreto de distribución del Art. 4º. En 2026, la ordenanza del expte. 1.253-HCD-26-L faculta a Economía y Hacienda a incrementar partidas hasta un 15% y exceptúa al Ejecutivo de los arts. 23 y 24 de la Ord. 570/80.'
)
on conflict (ejercicio) do nothing;

-- ── 3. Vedas ───────────────────────────────────────────────────────────────
-- Vive en el módulo de presupuesto y no en la configuración de la campaña:
-- la herramienta no depende de nada electoral para saber qué no puede hacer.
create table if not exists public.presupuesto_vedas (
  id bigint generated always as identity primary key,
  desde date not null,
  hasta date not null check (hasta >= desde),
  motivo text not null,
  norma text not null,
  unique (desde, hasta)
);

insert into public.presupuesto_vedas (desde, hasta, motivo, norma)
values (
  '2027-04-09', '2027-05-08',
  'Elección provincial y municipal del 9 de mayo de 2027: en los 30 días previos no se inauguran obras, no se lanzan programas ni proyectos ni se hace ningún acto de gobierno que pueda promover la captación del sufragio.',
  'Ley 7876, art. 34'
)
on conflict (desde, hasta) do nothing;

-- Una veda que todavía no terminó no se modifica ni se borra, ni siquiera el
-- superadmin: si no, la regla dependería de la voluntad de quien aprueba. Se
-- pueden agregar vedas nuevas.
create or replace function public._proteger_veda()
returns trigger
language plpgsql
as $fn$
begin
  if old.hasta >= (now() at time zone 'America/Argentina/Tucuman')::date then
    raise exception 'la veda del % al % (%) está vigente o por venir: no se modifica ni se borra', old.desde, old.hasta, old.norma;
  end if;
  return coalesce(new, old);
end $fn$;

-- ── 4. Partidas ────────────────────────────────────────────────────────────
create table if not exists public.presupuesto_partidas (
  id bigint generated always as identity primary key,
  ejercicio int not null default 2026 references public.presupuesto_ejercicios(ejercicio),
  codigo text not null,
  anexo text not null default '',
  jurisdiccion text not null default '',          -- Ítem (repartición)
  programa text not null default '',
  clase text not null check (clase in ('corriente', 'capital')),
  -- Partida Principal de la Ord. 570/80 ('' si el reporte no la trae)
  partida_principal text not null default ''
    check (partida_principal in ('', '11', '12', '13', '21', '31', '41', '32', '51', '52', '61', '71', '81')),
  -- '' = rentas generales (libre disponibilidad); si no, la afectación específica
  afectacion text not null default '',
  -- 'NaN' pasaría cualquier ">= 0" en numeric: se excluye explícitamente
  credito_vigente numeric(18,2) not null check (credito_vigente >= 0 and credito_vigente <> 'NaN'),
  comprometido numeric(18,2) not null default 0 check (comprometido >= 0 and comprometido <> 'NaN'),
  -- una estimación sirve para simular, no para aprobar
  estimada boolean not null default false,
  fuente_dato text not null default '',
  actualizado_por uuid references public.perfiles(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  unique (ejercicio, codigo)
);
create index if not exists presupuesto_partidas_ejercicio on public.presupuesto_partidas (ejercicio);

-- ── 5. Políticas públicas ──────────────────────────────────────────────────
create table if not exists public.politicas_publicas (
  id bigint generated always as identity primary key,
  -- Ordinal propio dentro de cada eje: el Plan Rector no numera las líneas.
  codigo text not null unique,
  nombre text not null,
  ambito text not null default '',
  eje text not null default '',
  descripcion text not null default '',
  secretaria text not null default '',
  tipo text not null check (tipo in ('obra', 'servicio', 'transferencia_personas', 'programa_social', 'institucional')),
  clase text not null check (clase in ('corriente', 'capital')),
  unidad text not null default '',
  costo_unitario numeric(18,2) check (costo_unitario is null or (costo_unitario > 0 and costo_unitario <> 'NaN')),
  indicador text not null default '',
  partidas_principales text[] not null default '{}',
  afectaciones text[] not null default '{}',
  prioridad numeric not null default 1 check (prioridad >= 0 and prioridad <> 'NaN'),
  piso numeric(18,2) check (piso is null or (piso >= 0 and piso <> 'NaN')),
  tope numeric(18,2) check (tope is null or (tope >= 0 and tope <> 'NaN')),
  activa boolean not null default true,
  notas text not null default '',
  fuente text not null default 'Plan Rector 2023-2030',
  actualizado_por uuid references public.perfiles(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  check (piso is null or tope is null or piso <= tope)
);

drop trigger if exists proteger on public.presupuesto_vedas;
create trigger proteger before update or delete on public.presupuesto_vedas
  for each row execute function public._proteger_veda();

-- ── 6. Escenarios ──────────────────────────────────────────────────────────
-- Los autores se guardan como uuid + email, sin FK: borrar un usuario no tiene
-- que editar un acto aprobado.
create table if not exists public.escenarios_presupuesto (
  id bigint generated always as identity primary key,
  ejercicio int not null default 2026 references public.presupuesto_ejercicios(ejercicio),
  nombre text not null,
  -- registro interno de por qué esta asignación; la motivación del acto va en la norma
  criterio text not null check (length(btrim(criterio)) >= 20),
  -- borrador → propuesto → aprobado → ejecutado; o descartado
  estado text not null default 'borrador'
    check (estado in ('borrador', 'propuesto', 'aprobado', 'ejecutado', 'descartado')),
  parametros jsonb not null default '{}',
  -- lo calcula la base al guardar, no el cliente
  resumen jsonb not null default '{}',
  avisos jsonb not null default '[]',
  norma text not null default '',
  boletin text not null default '',
  ejecucion text not null default '',
  creado_por uuid,
  creado_email text not null default '',
  creado_en timestamptz not null default now(),
  propuesto_en timestamptz,
  aprobado_por uuid,
  aprobado_email text not null default '',
  aprobado_en timestamptz
);

-- Cada fila guarda una foto de la política: lo aprobado sigue diciendo lo mismo
-- aunque después se edite el catálogo.
create table if not exists public.escenario_asignaciones (
  escenario_id bigint not null references public.escenarios_presupuesto(id) on delete cascade,
  politica_id bigint not null references public.politicas_publicas(id) on delete restrict,
  barrio text not null check (btrim(barrio) <> ''),
  monto numeric(18,2) not null check (monto > 0 and monto <> 'NaN'),
  unidades numeric not null check (unidades >= 0 and unidades <> 'NaN'),
  fijado boolean not null default false,
  politica_codigo text not null,
  politica_nombre text not null,
  politica_tipo text not null,
  unidad text not null,
  costo_unitario numeric(18,2) not null,
  primary key (escenario_id, politica_id, barrio),
  check (abs(unidades * costo_unitario - monto) <= 1)
);

create table if not exists public.escenario_financiamiento (
  escenario_id bigint not null references public.escenarios_presupuesto(id) on delete cascade,
  partida_id bigint not null references public.presupuesto_partidas(id) on delete restrict,
  politica_id bigint not null references public.politicas_publicas(id) on delete restrict,
  monto numeric(18,2) not null check (monto > 0 and monto <> 'NaN'),
  partida_codigo text not null,
  partida_clase text not null,
  partida_principal text not null,
  partida_afectacion text not null,
  primary key (escenario_id, partida_id, politica_id)
);
create index if not exists escenario_financiamiento_partida on public.escenario_financiamiento (partida_id);

-- Los montos fijados a mano, con lo que el motor daba sin ellos y por qué se
-- tocaron. Quien aprueba ve cada desvío del criterio, incluidos los ceros.
create table if not exists public.escenario_ajustes (
  escenario_id bigint not null references public.escenarios_presupuesto(id) on delete cascade,
  politica_id bigint not null references public.politicas_publicas(id) on delete restrict,
  barrio text not null,
  monto_motor numeric(18,2) not null check (monto_motor >= 0 and monto_motor <> 'NaN'),
  monto_fijado numeric(18,2) not null check (monto_fijado >= 0 and monto_fijado <> 'NaN'),
  motivo text not null check (length(btrim(motivo)) >= 5),
  primary key (escenario_id, politica_id, barrio)
);

-- ── RLS de todo el módulo ──────────────────────────────────────────────────
do $$
declare t text;
begin
  -- lectura: quien puede usar la herramienta
  foreach t in array array['presupuesto_ejercicios', 'presupuesto_vedas', 'presupuesto_partidas', 'politicas_publicas',
                           'escenarios_presupuesto', 'escenario_asignaciones', 'escenario_financiamiento', 'escenario_ajustes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.puede_presupuesto()))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate on public.%I from authenticated', t);
  end loop;
  -- catálogos: los escribe solo el superadmin
  foreach t in array array['presupuesto_ejercicios', 'presupuesto_vedas', 'presupuesto_partidas', 'politicas_publicas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_escritura', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.es_superadmin())) with check ((select public.es_superadmin()))', t || '_escritura', t);
  end loop;
  -- escenarios: se escriben SOLO por las funciones de abajo, que validan
  foreach t in array array['escenarios_presupuesto', 'escenario_asignaciones', 'escenario_financiamiento', 'escenario_ajustes'] loop
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ── 7. Bitácora ────────────────────────────────────────────────────────────
create table if not exists public.presupuesto_bitacora (
  id bigint generated always as identity primary key,
  cuando timestamptz not null default now(),
  quien uuid,
  quien_email text not null default '',
  tabla text not null,
  accion text not null,
  registro text not null,
  antes jsonb,
  despues jsonb
);
create index if not exists presupuesto_bitacora_cuando on public.presupuesto_bitacora (cuando desc);

alter table public.presupuesto_bitacora enable row level security;
drop policy if exists presupuesto_bitacora_select on public.presupuesto_bitacora;
create policy presupuesto_bitacora_select on public.presupuesto_bitacora
  for select to authenticated using (
    (select public.puede_presupuesto())
    and (tabla <> 'presupuesto_habilitados' or (select public.es_superadmin()) or registro = auth.uid()::text)
  );
revoke all on public.presupuesto_bitacora from anon;
revoke insert, update, delete, truncate on public.presupuesto_bitacora from authenticated;

-- Ni siquiera el dueño de la tabla la edita: la bitácora solo crece.
create or replace function public._bitacora_inmutable()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'la bitácora del presupuesto no se modifica ni se borra';
end $fn$;
drop trigger if exists inmutable on public.presupuesto_bitacora;
create trigger inmutable before update or delete on public.presupuesto_bitacora
  for each row execute function public._bitacora_inmutable();
drop trigger if exists inmutable_truncate on public.presupuesto_bitacora;
create trigger inmutable_truncate before truncate on public.presupuesto_bitacora
  for each statement execute function public._bitacora_inmutable();

create or replace function public._bitacora_presupuesto()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_email text;
  v_fila jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  select email into v_email from public.perfiles where id = auth.uid();
  insert into public.presupuesto_bitacora (quien, quien_email, tabla, accion, registro, antes, despues)
  values (
    auth.uid(), coalesce(v_email, ''), tg_table_name, tg_op,
    coalesce(v_fila ->> 'id', v_fila ->> 'perfil_id', v_fila ->> 'escenario_id', v_fila ->> 'ejercicio', ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $fn$;

do $$
declare t text;
begin
  foreach t in array array['presupuesto_partidas', 'politicas_publicas', 'escenarios_presupuesto',
                           'presupuesto_ejercicios', 'presupuesto_vedas', 'presupuesto_habilitados', 'escenario_ajustes'] loop
    execute format('drop trigger if exists bitacora on public.%I', t);
    execute format('create trigger bitacora after insert or update or delete on public.%I for each row execute function public._bitacora_presupuesto()', t);
  end loop;
end $$;

-- La hora y el autor de una edición los pone la base, no el cliente. Una
-- acción de FK (borrar un usuario pone actualizado_por en null) no re-sella.
create or replace function public._sellar_actualizacion()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  new.actualizado_por := auth.uid();
  new.actualizado_en := now();
  return new;
end $fn$;

drop trigger if exists sellar on public.presupuesto_partidas;
create trigger sellar before insert or update on public.presupuesto_partidas
  for each row execute function public._sellar_actualizacion();
drop trigger if exists sellar on public.politicas_publicas;
create trigger sellar before insert or update on public.politicas_publicas
  for each row execute function public._sellar_actualizacion();

-- Una partida que financia algo aprobado no cambia lo que la hace compatible.
-- Los montos sí se actualizan (la Contaduría recarga el comprometido): si la
-- partida queda excedida, presupuesto_partidas_estado lo muestra.
create or replace function public._proteger_partida()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
begin
  if exists (
    select 1 from public.escenario_financiamiento f
    join public.escenarios_presupuesto e on e.id = f.escenario_id
    where f.partida_id = old.id and e.estado = 'aprobado'
  ) then
    if new.ejercicio is distinct from old.ejercicio or new.codigo is distinct from old.codigo
       or new.clase is distinct from old.clase or new.partida_principal is distinct from old.partida_principal
       or new.afectacion is distinct from old.afectacion then
      raise exception 'la partida % financia un escenario aprobado: no se le cambia código, clase, partida principal ni afectación', old.codigo;
    end if;
    if new.estimada and not old.estimada then
      raise exception 'la partida % financia un escenario aprobado: no puede pasar a estimada', old.codigo;
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists proteger on public.presupuesto_partidas;
create trigger proteger before update on public.presupuesto_partidas
  for each row execute function public._proteger_partida();

-- ── 8. Necesidad por barrio ────────────────────────────────────────────────
/**
 * El Censo 2022 por radio, agregado por barrio en una sola pasada.
 *
 * radios_espacios.pct es el % DEL RADIO que cae en el barrio (muestreo de
 * grilla, migración 0012): cada conteo se reparte en proporción. Los barrios
 * más chicos que un radio pueden no tener ningún cruce y no aparecen; los
 * cuatro nombres duplicados del GeoJSON (Vial, San Jose, San Martin, San
 * Miguel) salen fundidos en un solo barrio.
 */
create or replace function public.necesidad_barrios()
returns table (
  barrio text, radios int, poblacion numeric, hogares numeric,
  hogares_nbi numeric, hogares_privacion numeric, hogares_hacinamiento numeric,
  hogares_clima_edu_bajo numeric, hogares_sin_cloaca numeric, hogares_sin_agua_red numeric,
  ocupados numeric, desocupados numeric, sin_cobertura_salud numeric,
  pob_hasta14 numeric, pob_15_64 numeric, pob_65mas numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;
  return query
  select re.codigo,
         count(*)::int,
         round(sum(rc.poblacion * re.pct / 100.0), 1),
         round(sum(rc.hogares * re.pct / 100.0), 1),
         round(sum(rc.hogares_nbi * re.pct / 100.0), 1),
         round(sum(rc.hogares_privacion * re.pct / 100.0), 1),
         round(sum(rc.hogares_hacinamiento * re.pct / 100.0), 1),
         round(sum(rc.hogares_clima_edu_bajo * re.pct / 100.0), 1),
         round(sum(rc.hogares_sin_cloaca * re.pct / 100.0), 1),
         round(sum(rc.hogares_sin_agua_red * re.pct / 100.0), 1),
         round(sum(rc.ocupados * re.pct / 100.0), 1),
         round(sum(rc.desocupados * re.pct / 100.0), 1),
         round(sum(rc.sin_cobertura_salud * re.pct / 100.0), 1),
         round(sum(rc.pob_hasta14 * re.pct / 100.0), 1),
         round(sum(rc.pob_15_64 * re.pct / 100.0), 1),
         round(sum(rc.pob_65mas * re.pct / 100.0), 1)
  from public.radios_espacios re
  join public.radios_censo rc on rc.radio = re.radio
  where re.tipo = 'barrio'
  group by re.codigo
  order by re.codigo;
end $fn$;

-- ── 9. Estado de las partidas ──────────────────────────────────────────────
/**
 * Por partida: disponible (vigente − comprometido), reservado por escenarios
 * APROBADOS que todavía no se ejecutaron, libre para asignar y excedido (lo
 * reservado que ya no entra porque después bajó el crédito o subió el
 * comprometido).
 *
 * Un escenario 'ejecutado' deja de reservar porque su gasto ya está en el
 * comprometido que informa la Contaduría: si siguiera reservando se contaría
 * dos veces.
 */
create or replace function public.presupuesto_partidas_estado(p_ejercicio int default 2026, p_excluir_escenario bigint default null)
returns table (
  id bigint, codigo text, anexo text, jurisdiccion text, programa text, clase text, partida_principal text, afectacion text,
  credito_vigente numeric, comprometido numeric, estimada boolean, fuente_dato text, actualizado_en timestamptz,
  disponible numeric, reservado numeric, libre numeric, excedido numeric
)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;
  return query
  select p.id, p.codigo, p.anexo, p.jurisdiccion, p.programa, p.clase, p.partida_principal, p.afectacion,
         p.credito_vigente, p.comprometido, p.estimada, p.fuente_dato, p.actualizado_en,
         greatest(0, p.credito_vigente - p.comprometido),
         coalesce(r.monto, 0),
         greatest(0, p.credito_vigente - p.comprometido - coalesce(r.monto, 0)),
         greatest(0, coalesce(r.monto, 0) - greatest(0, p.credito_vigente - p.comprometido))
  from public.presupuesto_partidas p
  left join (
    select f.partida_id, sum(f.monto) as monto
    from public.escenario_financiamiento f
    join public.escenarios_presupuesto e on e.id = f.escenario_id
    where e.estado = 'aprobado'
      and (p_excluir_escenario is null or e.id <> p_excluir_escenario)
    group by f.partida_id
  ) r on r.partida_id = p.id
  where p.ejercicio = p_ejercicio
  order by p.clase, p.jurisdiccion, p.codigo, p.id;
end $fn$;

-- ── 10. Escenarios: guardar, cambiar de estado, borrar ─────────────────────
/** Ord. 570/80: misma sección, partida principal admitida, afectación respetada, y nunca 11/21/61/71. */
create or replace function public._partida_compatible(p_partida public.presupuesto_partidas, p_politica public.politicas_publicas)
returns boolean
language sql immutable
as $$
  select p_partida.partida_principal in ('12', '13', '31', '41', '32', '51', '52', '81')
     and p_partida.clase = p_politica.clase
     and (cardinality(p_politica.partidas_principales) = 0 or p_partida.partida_principal = any (p_politica.partidas_principales))
     and (p_partida.afectacion = '' or p_partida.afectacion = any (p_politica.afectaciones))
$$;

/**
 * Valida el financiamiento de un escenario contra el crédito libre de hoy.
 * Bloquea antes las partidas involucradas, en orden, para que dos
 * aprobaciones simultáneas no reserven dos veces lo mismo. Lanza una
 * excepción con el primer problema que encuentra.
 */
create or replace function public._validar_financiamiento(p_escenario bigint, p_ejercicio int)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  v record;
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;

  perform 1 from public.presupuesto_partidas
  where id in (select partida_id from public.escenario_financiamiento where escenario_id = p_escenario)
  order by id
  for update;

  -- compatibilidad partida ↔ política
  select pa.codigo as partida, po.codigo as politica into v
  from public.escenario_financiamiento f
  join public.presupuesto_partidas pa on pa.id = f.partida_id
  join public.politicas_publicas po on po.id = f.politica_id
  where f.escenario_id = p_escenario and not public._partida_compatible(pa, po)
  limit 1;
  if found then
    raise exception 'la partida % no puede financiar la política % (sección, partida principal o afectación)', v.partida, v.politica;
  end if;

  -- partidas de otro ejercicio
  select pa.codigo as partida into v
  from public.escenario_financiamiento f
  join public.presupuesto_partidas pa on pa.id = f.partida_id
  where f.escenario_id = p_escenario and pa.ejercicio <> p_ejercicio
  limit 1;
  if found then
    raise exception 'la partida % es de otro ejercicio', v.partida;
  end if;

  -- lo que se pide contra lo libre (sin contar este escenario)
  select e.codigo as partida, s.pide, e.libre into v
  from (
    select partida_id, sum(monto) as pide
    from public.escenario_financiamiento
    where escenario_id = p_escenario
    group by partida_id
  ) s
  join public.presupuesto_partidas_estado(p_ejercicio, p_escenario) e on e.id = s.partida_id
  where s.pide > e.libre + 1
  limit 1;
  if found then
    raise exception 'la partida % no alcanza: se piden $% y quedan libres $%', v.partida, round(v.pide), round(v.libre);
  end if;

  -- ninguna política se financia sin barrios de destino, ni por un peso
  select po.codigo as politica into v
  from public.escenario_financiamiento f
  join public.politicas_publicas po on po.id = f.politica_id
  where f.escenario_id = p_escenario
    and not exists (select 1 from public.escenario_asignaciones a
                    where a.escenario_id = f.escenario_id and a.politica_id = f.politica_id)
  limit 1;
  if found then
    raise exception 'la política % tiene financiamiento pero ningún barrio asignado', v.politica;
  end if;

  -- asignado = financiado, por política, EN LAS DOS PUNTAS: ni barrios sin
  -- financiar ni crédito reservado sin barrio de destino
  select coalesce(a.politica_id, f.politica_id) as politica, coalesce(a.monto, 0) as asignado, coalesce(f.monto, 0) as financiado into v
  from (select politica_id, sum(monto) as monto from public.escenario_asignaciones where escenario_id = p_escenario group by politica_id) a
  full join (select politica_id, sum(monto) as monto from public.escenario_financiamiento where escenario_id = p_escenario group by politica_id) f
    on f.politica_id = a.politica_id
  where abs(coalesce(a.monto, 0) - coalesce(f.monto, 0)) > 1
  limit 1;
  if found then
    raise exception 'la política % asigna $% pero tiene financiados $%', v.politica, round(v.asignado), round(v.financiado);
  end if;
end $fn$;

/**
 * Guarda un escenario completo en una sola transacción: cabecera, asignaciones
 * por política y barrio, qué partida financia qué y los ajustes manuales. Si
 * algo no valida, no se guarda nada.
 *
 * p_asignaciones:   [{politica_id, barrio, monto, unidades, fijado}]
 * p_financiamiento: [{partida_id, politica_id, monto}]
 * p_ajustes:        [{politica_id, barrio, monto_motor, monto_fijado, motivo}]
 * p_avisos:         ["texto", …] los avisos del motor, para quien apruebe
 */
create or replace function public.guardar_escenario(
  p_nombre text,
  p_criterio text,
  p_parametros jsonb,
  p_asignaciones jsonb,
  p_financiamiento jsonb,
  p_ajustes jsonb default '[]',
  p_avisos jsonb default '[]',
  p_ejercicio int default 2026
)
returns bigint
language plpgsql security definer set search_path = public
as $fn$
declare
  v_id bigint;
  v_n int;
  v record;
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;
  if coalesce(btrim(p_nombre), '') = '' then raise exception 'el escenario necesita un nombre'; end if;
  if length(coalesce(btrim(p_criterio), '')) < 20 then
    raise exception 'explicá el criterio de la asignación (al menos 20 caracteres)';
  end if;
  if p_asignaciones is null or jsonb_typeof(p_asignaciones) is distinct from 'array' or jsonb_array_length(p_asignaciones) = 0 then
    raise exception 'el escenario no asigna nada';
  end if;
  if p_financiamiento is null or jsonb_typeof(p_financiamiento) is distinct from 'array' then
    raise exception 'falta el financiamiento';
  end if;
  if p_ajustes is not null and jsonb_typeof(p_ajustes) is distinct from 'array' then
    raise exception 'los ajustes tienen que ser una lista';
  end if;

  -- el costo con que se calculó tiene que ser el de hoy: si cambió, hay que recalcular
  select po.codigo as politica into v
  from jsonb_array_elements(p_asignaciones) x
  join public.politicas_publicas po on po.id = (x ->> 'politica_id')::bigint
  where x ? 'costo_unitario' and (x ->> 'costo_unitario')::numeric is distinct from po.costo_unitario
  limit 1;
  if found then
    raise exception 'el costo por unidad de la política % cambió desde que se calculó: recalculá antes de guardar', v.politica;
  end if;

  -- los ajustes también son por barrio del censo (nada de nombres propios en la bitácora)
  select x ->> 'barrio' as barrio into v
  from jsonb_array_elements(coalesce(p_ajustes, '[]'::jsonb)) x
  where not exists (select 1 from public.radios_espacios re where re.tipo = 'barrio' and re.codigo = x ->> 'barrio')
  limit 1;
  if found then
    raise exception 'el barrio «%» de un ajuste no existe en el censo', v.barrio;
  end if;

  -- las políticas tienen que estar activas, con costo y ser asignables por barrio
  select x ->> 'politica_id' as politica into v
  from jsonb_array_elements(p_asignaciones) x
  left join public.politicas_publicas po on po.id = (x ->> 'politica_id')::bigint
  where po.id is null or not po.activa or po.costo_unitario is null or po.tipo = 'institucional'
  limit 1;
  if found then
    raise exception 'la política % no está activa, no tiene costo o no se asigna por barrio', v.politica;
  end if;

  -- el destino es un barrio del censo, no un texto libre (y mucho menos una persona)
  select x ->> 'barrio' as barrio into v
  from jsonb_array_elements(p_asignaciones) x
  where not exists (
    select 1 from public.radios_espacios re where re.tipo = 'barrio' and re.codigo = x ->> 'barrio'
  )
  limit 1;
  if found then
    raise exception 'el barrio «%» no existe en el censo', v.barrio;
  end if;

  insert into public.escenarios_presupuesto (ejercicio, nombre, criterio, parametros, avisos, creado_por, creado_email)
  values (
    p_ejercicio, btrim(p_nombre), btrim(p_criterio),
    case when jsonb_typeof(p_parametros) = 'object' then p_parametros else '{}'::jsonb end,
    -- solo textos: un objeto en la lista rompería la tarjeta del escenario
    (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements(
       case when jsonb_typeof(p_avisos) = 'array' then p_avisos else '[]'::jsonb end) a
     where jsonb_typeof(a) = 'string'),
    auth.uid(), coalesce((select email from public.perfiles where id = auth.uid()), '')
  )
  returning id into v_id;

  insert into public.escenario_asignaciones
    (escenario_id, politica_id, barrio, monto, unidades, fijado, politica_codigo, politica_nombre, politica_tipo, unidad, costo_unitario)
  select v_id, po.id, x ->> 'barrio', (x ->> 'monto')::numeric, coalesce((x ->> 'unidades')::numeric, 0),
         coalesce((x ->> 'fijado')::boolean, false), po.codigo, po.nombre, po.tipo, po.unidad, po.costo_unitario
  from jsonb_array_elements(p_asignaciones) x
  join public.politicas_publicas po on po.id = (x ->> 'politica_id')::bigint
  where (x ->> 'monto')::numeric > 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'el escenario no asigna nada'; end if;

  insert into public.escenario_financiamiento
    (escenario_id, partida_id, politica_id, monto, partida_codigo, partida_clase, partida_principal, partida_afectacion)
  select v_id, pa.id, (x ->> 'politica_id')::bigint, sum((x ->> 'monto')::numeric),
         pa.codigo, pa.clase, pa.partida_principal, pa.afectacion
  from jsonb_array_elements(p_financiamiento) x
  join public.presupuesto_partidas pa on pa.id = (x ->> 'partida_id')::bigint
  where (x ->> 'monto')::numeric > 0
  group by pa.id, (x ->> 'politica_id')::bigint, pa.codigo, pa.clase, pa.partida_principal, pa.afectacion;

  insert into public.escenario_ajustes (escenario_id, politica_id, barrio, monto_motor, monto_fijado, motivo)
  select v_id, (x ->> 'politica_id')::bigint, x ->> 'barrio', coalesce((x ->> 'monto_motor')::numeric, 0),
         coalesce((x ->> 'monto_fijado')::numeric, 0), coalesce(x ->> 'motivo', '')
  from jsonb_array_elements(case when jsonb_typeof(p_ajustes) = 'array' then p_ajustes else '[]'::jsonb end) x;

  -- cada ajuste coincide con lo asignado (0 si se sacó el barrio) y cada celda fijada tiene su ajuste
  select aj.barrio, aj.monto_fijado, coalesce(a.monto, 0) as asignado into v
  from public.escenario_ajustes aj
  left join public.escenario_asignaciones a
    on a.escenario_id = aj.escenario_id and a.politica_id = aj.politica_id and a.barrio = aj.barrio
  where aj.escenario_id = v_id and abs(coalesce(a.monto, 0) - aj.monto_fijado) > 1
  limit 1;
  if found then
    raise exception 'el ajuste de «%» dice $% pero se asignan $%', v.barrio, round(v.monto_fijado), round(v.asignado);
  end if;
  select a.barrio into v
  from public.escenario_asignaciones a
  where a.escenario_id = v_id and a.fijado
    and not exists (select 1 from public.escenario_ajustes aj
                    where aj.escenario_id = a.escenario_id and aj.politica_id = a.politica_id and aj.barrio = a.barrio)
  limit 1;
  if found then
    raise exception 'la asignación fijada a mano en «%» no tiene su motivo', v.barrio;
  end if;

  perform public._validar_financiamiento(v_id, p_ejercicio);

  -- el resumen sale de las filas guardadas, no de lo que diga el cliente
  update public.escenarios_presupuesto
  set resumen = (
    select jsonb_build_object(
      'asignado', coalesce(sum(monto), 0),
      'barrios', count(distinct barrio),
      'politicas', count(distinct politica_id),
      'ajustes', (select count(*) from public.escenario_ajustes where escenario_id = v_id)
    )
    from public.escenario_asignaciones where escenario_id = v_id
  )
  where id = v_id;
  return v_id;
end $fn$;

/**
 * Transiciones de estado:
 *   borrador → propuesto               cualquiera con acceso
 *   borrador|propuesto → aprobado      solo superadmin, que no sea quien lo
 *                                      armó, con número de norma; revalida
 *                                      contra el crédito libre de hoy, no
 *                                      admite partidas estimadas y, en veda,
 *                                      no admite cupos ni programas
 *   aprobado → ejecutado               solo superadmin, con expediente o norma
 *   borrador|propuesto → descartado    quien lo creó o superadmin
 *   aprobado → descartado (anulación)  solo superadmin, con norma
 */
create or replace function public.cambiar_estado_escenario(
  p_id bigint,
  p_estado text,
  p_norma text default '',
  p_boletin text default ''
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  v public.escenarios_presupuesto;
  v_codigo text;
  v_veda public.presupuesto_vedas;
  v_email text := coalesce((select email from public.perfiles where id = auth.uid()), '');
  -- una norma tiene que traer al menos un número: "Decreto 1234/2026"
  v_norma_ok boolean := length(coalesce(btrim(p_norma), '')) >= 5 and p_norma ~ '[0-9]';
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;
  select * into v from public.escenarios_presupuesto where id = p_id for update;
  if not found then raise exception 'no existe el escenario %', p_id; end if;

  if p_estado = 'propuesto' then
    if v.estado <> 'borrador' then raise exception 'solo un borrador pasa a propuesto'; end if;

  elsif p_estado = 'aprobado' then
    if not public.es_superadmin() then raise exception 'aprobar es solo del superadmin'; end if;
    if v.estado not in ('borrador', 'propuesto') then raise exception 'solo se aprueba un borrador o una propuesta'; end if;
    if v.creado_por is not distinct from auth.uid() then
      raise exception 'quien armó el escenario no lo aprueba: hace falta otra persona (control de cuatro ojos)';
    end if;
    if not v_norma_ok then raise exception 'indicá la norma que aprueba la asignación, con su número (ej. Decreto 1234/2026)'; end if;
    -- bloquear las partidas ANTES de leer nada de ellas
    perform 1 from public.presupuesto_partidas
    where id in (select partida_id from public.escenario_financiamiento where escenario_id = p_id)
    order by id
    for update;
    -- lo que se aprueba es lo que se guardó: si después se editó el catálogo, recalcular
    select f.partida_codigo into v_codigo
    from public.escenario_financiamiento f
    join public.presupuesto_partidas pa on pa.id = f.partida_id
    where f.escenario_id = p_id
      and (pa.codigo, pa.clase, pa.partida_principal, pa.afectacion)
          is distinct from (f.partida_codigo, f.partida_clase, f.partida_principal, f.partida_afectacion)
    limit 1;
    if found then
      raise exception 'la partida % cambió desde que se guardó el escenario: volvé a calcularlo y guardarlo', v_codigo;
    end if;
    select a.politica_codigo into v_codigo
    from public.escenario_asignaciones a
    join public.politicas_publicas po on po.id = a.politica_id
    where a.escenario_id = p_id
      and ((po.codigo, po.nombre, po.tipo, po.unidad, po.costo_unitario)
           is distinct from (a.politica_codigo, a.politica_nombre, a.politica_tipo, a.unidad, a.costo_unitario)
           or not po.activa or po.tipo = 'institucional')
    limit 1;
    if found then
      raise exception 'la política % cambió o se desactivó desde que se guardó el escenario: volvé a calcularlo y guardarlo', v_codigo;
    end if;
    select codigo into v_codigo from public.escenario_financiamiento f
    join public.presupuesto_partidas pa on pa.id = f.partida_id
    where f.escenario_id = p_id and pa.estimada
    limit 1;
    if found then
      raise exception 'la partida % es una estimación: cargá el dato de la Contaduría antes de aprobar', v_codigo;
    end if;
    -- la fecha de hoy en Tucumán, no la del servidor (UTC)
    select * into v_veda from public.presupuesto_vedas
    where (now() at time zone 'America/Argentina/Tucuman')::date between desde and hasta limit 1;
    if found and exists (
      select 1 from public.escenario_asignaciones
      where escenario_id = p_id and politica_tipo in ('transferencia_personas', 'programa_social')
    ) then
      raise exception 'veda (%) hasta el %: no se aprueban cupos ni programas nuevos', v_veda.norma, to_char(v_veda.hasta, 'DD/MM/YYYY');
    end if;
    perform public._validar_financiamiento(p_id, v.ejercicio);

  elsif p_estado = 'ejecutado' then
    if not public.es_superadmin() then raise exception 'solo el superadmin marca un escenario como ejecutado'; end if;
    if v.estado <> 'aprobado' then raise exception 'solo se ejecuta lo aprobado'; end if;
    if not v_norma_ok then
      raise exception 'indicá el expediente o la norma de la ejecución: al pasar a ejecutado deja de reservar crédito';
    end if;

  elsif p_estado = 'descartado' then
    if v.estado = 'aprobado' then
      if not public.es_superadmin() then raise exception 'anular un escenario aprobado es solo del superadmin'; end if;
      if not v_norma_ok then raise exception 'indicá la norma que anula la aprobación, con su número'; end if;
    elsif v.estado in ('borrador', 'propuesto') then
      if v.creado_por is distinct from auth.uid() and not public.es_superadmin() then
        raise exception 'solo quien lo creó o el superadmin lo descartan';
      end if;
    else
      raise exception 'un escenario % no se descarta', v.estado;
    end if;

  else
    raise exception 'estado inválido: %', p_estado;
  end if;

  update public.escenarios_presupuesto
  set estado = p_estado,
      propuesto_en = case when p_estado = 'propuesto' then now() else propuesto_en end,
      -- la anulación no borra la norma que lo había aprobado: se le suma
      norma = case
                when p_estado = 'aprobado' then btrim(p_norma)
                when p_estado = 'descartado' and v.estado = 'aprobado' then v.norma || ' · anulado por ' || btrim(p_norma)
                else norma
              end,
      boletin = case when p_estado = 'aprobado' then coalesce(btrim(p_boletin), '') else boletin end,
      ejecucion = case when p_estado = 'ejecutado' then btrim(p_norma) else ejecucion end,
      aprobado_por = case when p_estado = 'aprobado' then auth.uid() else aprobado_por end,
      aprobado_email = case when p_estado = 'aprobado' then v_email else aprobado_email end,
      aprobado_en = case when p_estado = 'aprobado' then now() else aprobado_en end
  where id = p_id;
end $fn$;

/** Borra un escenario que nunca se propuso. Lo que llegó a proponerse queda como antecedente. */
create or replace function public.borrar_escenario(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare
  v public.escenarios_presupuesto;
begin
  if not public.puede_presupuesto() then raise exception 'no autorizado'; end if;
  select * into v from public.escenarios_presupuesto where id = p_id;
  if not found then return; end if;
  if v.estado not in ('borrador', 'descartado') or v.propuesto_en is not null or v.aprobado_en is not null then
    raise exception 'un escenario que llegó a proponerse no se borra: queda como antecedente (se puede descartar)';
  end if;
  if v.creado_por is distinct from auth.uid() and not public.es_superadmin() then
    raise exception 'solo quien lo creó o el superadmin lo borran';
  end if;
  delete from public.escenarios_presupuesto where id = p_id;
end $fn$;

-- ── Acceso: habilitar y listar (superadmin) ────────────────────────────────
create or replace function public.presupuesto_accesos()
returns table (perfil_id uuid, email text, nombre text, rol text, habilitado boolean)
language plpgsql stable security definer set search_path = public
as $fn$
begin
  if not public.es_superadmin() then raise exception 'solo el superadmin ve los accesos'; end if;
  return query
  select p.id, p.email, p.nombre, p.rol::text,
         (p.rol = 'superadmin' or exists (select 1 from public.presupuesto_habilitados h where h.perfil_id = p.id))
  from public.perfiles p
  order by p.rol, p.email;
end $fn$;

create or replace function public.presupuesto_habilitar(p_perfil uuid, p_habilitar boolean)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if not public.es_superadmin() then raise exception 'solo el superadmin habilita accesos'; end if;
  if p_habilitar then
    insert into public.presupuesto_habilitados (perfil_id, habilitado_por) values (p_perfil, auth.uid())
    on conflict (perfil_id) do nothing;
  else
    delete from public.presupuesto_habilitados where perfil_id = p_perfil;
  end if;
end $fn$;

-- ── Permisos de ejecución ──────────────────────────────────────────────────
-- En Postgres toda función nueva viene con EXECUTE para PUBLIC: hay que sacarlo
-- explícitamente, y también a anon, que en Supabase lo recibe por privilegio por defecto.
revoke execute on function public.es_superadmin() from public, anon;
revoke execute on function public.puede_presupuesto() from public, anon;
revoke execute on function public.necesidad_barrios() from public, anon;
revoke execute on function public.presupuesto_partidas_estado(int, bigint) from public, anon;
revoke execute on function public.guardar_escenario(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, int) from public, anon;
revoke execute on function public.cambiar_estado_escenario(bigint, text, text, text) from public, anon;
revoke execute on function public.borrar_escenario(bigint) from public, anon;
revoke execute on function public.presupuesto_accesos() from public, anon;
revoke execute on function public.presupuesto_habilitar(uuid, boolean) from public, anon;
revoke execute on function public._validar_financiamiento(bigint, int) from public, anon;
revoke execute on function public._bitacora_presupuesto() from public, anon;
revoke execute on function public._sellar_actualizacion() from public, anon;
revoke execute on function public._proteger_partida() from public, anon;
revoke execute on function public._bitacora_inmutable() from public, anon;
revoke execute on function public._partida_compatible(public.presupuesto_partidas, public.politicas_publicas) from public, anon;

grant execute on function public.es_superadmin() to authenticated;
grant execute on function public.puede_presupuesto() to authenticated;
grant execute on function public.necesidad_barrios() to authenticated;
grant execute on function public.presupuesto_partidas_estado(int, bigint) to authenticated;
grant execute on function public.guardar_escenario(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, int) to authenticated;
grant execute on function public.cambiar_estado_escenario(bigint, text, text, text) to authenticated;
grant execute on function public.borrar_escenario(bigint) to authenticated;
grant execute on function public.presupuesto_accesos() to authenticated;
grant execute on function public.presupuesto_habilitar(uuid, boolean) to authenticated;

-- Las internas no se llaman por la API: solo desde otras funciones o triggers.
revoke execute on function public._validar_financiamiento(bigint, int) from authenticated;
revoke execute on function public._bitacora_presupuesto() from authenticated;
revoke execute on function public._sellar_actualizacion() from authenticated;
revoke execute on function public._proteger_partida() from authenticated;
revoke execute on function public._bitacora_inmutable() from authenticated;
revoke execute on function public._partida_compatible(public.presupuesto_partidas, public.politicas_publicas) from authenticated;
revoke execute on function public._proteger_veda() from public, anon, authenticated;

-- ── Catálogo inicial: las líneas del Plan Rector 2023-2030 ────────────────
-- Las territoriales con un indicador del censo quedan activas; el costo por
-- unidad lo carga el área (sin costo, el motor no las usa). Las que no se
-- pueden asignar por barrio —una planta única, gestión interna— quedan
-- inactivas para que el catálogo esté completo. Partidas principales por
-- tipo: obra 51/52 · servicio 12/13 · cupos a personas 31 · programa 12/31.
insert into public.politicas_publicas (codigo, nombre, ambito, eje, secretaria, tipo, clase, unidad, indicador, partidas_principales, activa, notas) values
  ('1.1',  'Ciudad humanizada', 'A1 · Ordenada y sustentable', '1 · Reestructuración urbana', '', 'obra', 'capital', 'habitante', 'poblacion', '{51,52}', true, ''),
  ('1.2',  'Puntos de Acceso Ciudadano (PACs) en los CICs', 'A1 · Ordenada y sustentable', '1 · Reestructuración urbana', 'Secretaría de Atención Ciudadana', 'servicio', 'corriente', 'habitante', 'poblacion', '{12,13}', true, ''),
  ('1.3',  'Zonas de Influencia Municipal', 'A1 · Ordenada y sustentable', '1 · Reestructuración urbana', '', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('2.1',  'Diagnóstico del estado de calles', 'A1 · Ordenada y sustentable', '2 · Repavimentación planificada y estratégica', 'Secretaría de Obras Públicas', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('2.2',  'Plan Integral de Recuperación de Calles y Bacheo', 'A1 · Ordenada y sustentable', '2 · Repavimentación planificada y estratégica', 'Secretaría de Obras Públicas', 'obra', 'capital', 'hogar', 'hogares', '{52}', true, 'Indicador provisorio: hogares del barrio. El dato fino es el estado del pavimento por cuadra (capa Calles de SMT en Datos), que todavía no está importado.'),
  ('2.3',  'Plan de Prevención de Daños', 'A1 · Ordenada y sustentable', '2 · Repavimentación planificada y estratégica', 'Secretaría de Obras Públicas', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('3.1',  'Recuperación de espacios en desuso', 'A1 · Ordenada y sustentable', '3 · Refuncionalización edilicia', 'Secretaría de Obras Públicas', 'obra', 'capital', 'hogar', 'nbi', '{51,52}', true, ''),
  ('3.2',  'Recuperación de obras emblemáticas', 'A1 · Ordenada y sustentable', '3 · Refuncionalización edilicia', 'Secretaría de Obras Públicas', 'obra', 'capital', '', '', '{52}', false, 'Obras puntuales (Palacio de los Deportes, Mercado del Norte, Asistencia Pública): se deciden por proyecto, no por necesidad barrial.'),
  ('4.1',  'Saneamiento de basurales y separación de residuos', 'A2 · Bienestar para todas las familias', '4 · Cultura ambiental, espacios verdes y áreas protegidas', 'Secretaría de Ambiente y Desarrollo Sustentable', 'servicio', 'corriente', 'hogar', 'nbi', '{12,13}', true, ''),
  ('4.2',  'Plan GIRSU', 'A2 · Bienestar para todas las familias', '4 · Cultura ambiental, espacios verdes y áreas protegidas', 'Secretaría de Ambiente y Desarrollo Sustentable', 'servicio', 'corriente', '', '', '{12,13}', false, 'Plan de toda la ciudad: no se reparte por barrio.'),
  ('4.3',  'Plan de Arborización y Espacios Verdes', 'A2 · Bienestar para todas las familias', '4 · Cultura ambiental, espacios verdes y áreas protegidas', 'Secretaría de Ambiente y Desarrollo Sustentable', 'obra', 'capital', 'habitante', 'poblacion', '{51,52}', true, ''),
  ('4.4',  'Vinculación de actores para el desarrollo sostenible', 'A2 · Bienestar para todas las familias', '4 · Cultura ambiental, espacios verdes y áreas protegidas', 'Secretaría de Ambiente y Desarrollo Sustentable', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('5.1',  'Educación Ambiental Integral', 'A2 · Bienestar para todas las familias', '5 · Educación y sostenibilidad ambiental', 'Secretaría de Ambiente y Desarrollo Sustentable', 'programa_social', 'corriente', '', '', '{12,31}', false, 'Programa de alcance general.'),
  ('5.2',  'Educación sobre cambio climático', 'A2 · Bienestar para todas las familias', '5 · Educación y sostenibilidad ambiental', 'Secretaría de Ambiente y Desarrollo Sustentable', 'programa_social', 'corriente', '', '', '{12,31}', false, 'Programa de alcance general.'),
  ('5.3',  'Uso sostenible de recursos naturales', 'A2 · Bienestar para todas las familias', '5 · Educación y sostenibilidad ambiental', 'Secretaría de Ambiente y Desarrollo Sustentable', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('6.1',  'Primera Planta de Reciclaje municipal', 'A2 · Bienestar para todas las familias', '6 · Empleo verde', 'Secretaría de Ambiente y Desarrollo Sustentable', 'obra', 'capital', '', '', '{51,52}', false, 'Una sola planta: se decide por proyecto.'),
  ('6.2',  'Ecopuntos y Programa SE-PA-RÁ', 'A2 · Bienestar para todas las familias', '6 · Empleo verde', 'Secretaría de Ambiente y Desarrollo Sustentable', 'servicio', 'corriente', 'hogar', 'hogares', '{12,13}', true, ''),
  ('6.3',  'Coordinación con empresas e industrias', 'A2 · Bienestar para todas las familias', '6 · Empleo verde', 'Secretaría de Ambiente y Desarrollo Sustentable', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('6.4',  'Consumo responsable', 'A2 · Bienestar para todas las familias', '6 · Empleo verde', 'Secretaría de Ambiente y Desarrollo Sustentable', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('6.5',  'Programa CONTROLÁ', 'A2 · Bienestar para todas las familias', '6 · Empleo verde', 'Secretaría de Ambiente y Desarrollo Sustentable', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('7.1',  'Control de población de animales callejeros', 'A2 · Bienestar para todas las familias', '7 · Cuidado de los animales de compañía', '', 'servicio', 'corriente', 'hogar', 'hogares', '{12,13}', true, ''),
  ('7.2',  'Gestión integral de salud de animales de compañía', 'A2 · Bienestar para todas las familias', '7 · Cuidado de los animales de compañía', '', 'servicio', 'corriente', 'hogar', 'hogares', '{12,13}', true, ''),
  ('8.1',  'Nuevo esquema de transporte público', 'A3 · Cercana, accesible y segura', '8 · Movilidad urbana accesible, ecológica y sostenible', 'Secretaría de Movilidad Urbana', 'servicio', 'corriente', '', '', '{12,13}', false, 'Red de toda la ciudad.'),
  ('8.2',  'Movilidad sostenible no motorizada', 'A3 · Cercana, accesible y segura', '8 · Movilidad urbana accesible, ecológica y sostenible', 'Secretaría de Movilidad Urbana', 'servicio', 'corriente', '', '', '{12,13}', false, 'Programa de alcance general.'),
  ('8.3',  'Ciclovías', 'A3 · Cercana, accesible y segura', '8 · Movilidad urbana accesible, ecológica y sostenible', 'Secretaría de Movilidad Urbana', 'obra', 'capital', 'habitante', 'poblacion', '{52}', true, ''),
  ('8.4',  'Movilidad inclusiva', 'A3 · Cercana, accesible y segura', '8 · Movilidad urbana accesible, ecológica y sostenible', 'Secretaría de Movilidad Urbana', 'servicio', 'corriente', 'persona', 'poblacion_65_mas', '{12,13}', false, 'Programa de alcance general; se puede activar si se territorializa.'),
  ('9.1',  'Zonas de alto caudal y onda verde remota', 'A3 · Cercana, accesible y segura', '9 · Semaforización inteligente', 'Secretaría de Movilidad Urbana', 'obra', 'capital', '', '', '{51,52}', false, 'Se decide por caudal de tránsito, que no es un dato censal.'),
  ('10.1', 'Plan de Transformación Digital TRADI', 'A3 · Cercana, accesible y segura', '10 · Smart City', 'Secretaría de Innovación Tecnológica', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('10.2', 'Tecnología para la gestión colaborativa', 'A3 · Cercana, accesible y segura', '10 · Smart City', 'Secretaría de Innovación Tecnológica', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('10.3', 'Reducción de la brecha digital', 'A3 · Cercana, accesible y segura', '10 · Smart City', 'Secretaría de Innovación Tecnológica', 'programa_social', 'corriente', 'hogar', '', '{12,31}', false, 'Falta el indicador: "hogares sin internet" está en el censo pero no se importó.'),
  ('10.4', 'Soluciones colectivas para el espacio público', 'A3 · Cercana, accesible y segura', '10 · Smart City', '', 'obra', 'capital', 'habitante', 'poblacion', '{51,52}', true, ''),
  ('11.1', 'Refuncionalización de la Asistencia Pública', 'A4 · Centrada en las personas', '11 · Salud', '', 'obra', 'capital', '', '', '{52}', false, 'Un solo establecimiento: se decide por proyecto.'),
  ('11.2', 'Fortalecimiento de los 15 Centros de Atención Comunitaria', 'A4 · Centrada en las personas', '11 · Salud', '', 'servicio', 'corriente', 'persona', 'sin_cobertura_salud', '{12,13}', true, ''),
  ('11.3', 'Emergencias odontológicas 24 hs', 'A4 · Centrada en las personas', '11 · Salud', '', 'servicio', 'corriente', 'persona', 'sin_cobertura_salud', '{12,13}', true, ''),
  ('11.4', 'Trailer de Desarrollo Humano', 'A4 · Centrada en las personas', '11 · Salud', '', 'servicio', 'corriente', 'hogar', 'nbi', '{12,13}', true, ''),
  ('11.5', 'Red de Salud Mental', 'A4 · Centrada en las personas', '11 · Salud', '', 'servicio', 'corriente', '', '', '{12,13}', false, 'Red de toda la ciudad.'),
  ('11.6', 'Fortalecimiento del CIMTEA', 'A4 · Centrada en las personas', '11 · Salud', '', 'servicio', 'corriente', '', '', '{12,13}', false, 'Un solo centro.'),
  ('12.1', 'Infraestructura y recursos de escuelas municipales', 'A4 · Centrada en las personas', '12 · Educación', '', 'obra', 'capital', 'niña o niño', 'poblacion_0_14', '{51,52}', true, ''),
  ('12.2', 'Orientación en Informática en secundarias municipales', 'A4 · Centrada en las personas', '12 · Educación', '', 'programa_social', 'corriente', 'joven', '', '{12,31}', false, 'Falta el indicador: jóvenes de 15 a 24 no están importados del censo.'),
  ('12.3', 'Gabinete Psicopedagógico', 'A4 · Centrada en las personas', '12 · Educación', '', 'servicio', 'corriente', '', '', '{12,13}', false, 'Servicio central.'),
  ('12.4', 'Idiomas extranjeros y actividades de extensión', 'A4 · Centrada en las personas', '12 · Educación', '', 'programa_social', 'corriente', 'niña o niño', 'poblacion_0_14', '{12,31}', true, ''),
  ('13.1', 'Sistema Integral de Seguridad Ciudadana', 'A4 · Centrada en las personas', '13 · Seguridad humana y ciudadana', '', 'obra', 'capital', 'habitante', 'poblacion', '{51,52}', true, ''),
  ('13.2', 'Programa de Mediación Comunitaria', 'A4 · Centrada en las personas', '13 · Seguridad humana y ciudadana', '', 'programa_social', 'corriente', 'habitante', 'poblacion', '{12,31}', true, ''),
  ('13.3', 'Programa de Prevención de Siniestros Viales', 'A4 · Centrada en las personas', '13 · Seguridad humana y ciudadana', 'Secretaría de Movilidad Urbana', 'servicio', 'corriente', '', '', '{12,13}', false, 'Se decide por siniestralidad, que no es un dato censal.'),
  ('14.1', 'Circuitos Turísticos inclusivos', 'A4 · Centrada en las personas', '14 · Turismo', '', 'servicio', 'corriente', '', '', '{12,13}', false, 'No territorializable por necesidad.'),
  ('14.2', 'App Mi Municipio para oferta turística', 'A4 · Centrada en las personas', '14 · Turismo', 'Secretaría de Innovación Tecnológica', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('15.1', 'Proyectos culturales en barrios', 'A4 · Centrada en las personas', '15 · Cultura', 'Secretaría de Cultura', 'programa_social', 'corriente', 'hogar', 'nbi', '{12,31}', true, ''),
  ('15.2', 'Pase Cultural joven', 'A4 · Centrada en las personas', '15 · Cultura', 'Secretaría de Cultura', 'transferencia_personas', 'corriente', 'pase', '', '{31}', false, 'Cupos por barrio, nunca beneficiarios con nombre. Falta el indicador: jóvenes de 15 a 25 no están importados del censo.'),
  ('15.3', 'Museos innovadores e interactivos', 'A4 · Centrada en las personas', '15 · Cultura', 'Secretaría de Cultura', 'servicio', 'corriente', '', '', '{12,13}', false, 'Establecimientos puntuales.'),
  ('15.4', 'Plan de Reestructuración y Revalorización de Bibliotecas Municipales', 'A4 · Centrada en las personas', '15 · Cultura', 'Secretaría de Cultura', 'servicio', 'corriente', 'hogar', 'clima_educativo_bajo', '{12,13}', true, ''),
  ('16.1', 'Articulación con clubes barriales', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'programa_social', 'corriente', 'niña o niño', 'poblacion_0_14', '{12,31}', true, ''),
  ('16.2', 'Circuito de las Infancias', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'obra', 'capital', 'niña o niño', 'poblacion_0_14', '{51,52}', true, ''),
  ('16.3', 'Paseo del Adulto Mayor', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'obra', 'capital', 'persona mayor', 'poblacion_65_mas', '{51,52}', true, ''),
  ('16.4', 'Expo Ciudad Joven SMT', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'programa_social', 'corriente', '', '', '{12,31}', false, 'Evento central.'),
  ('16.5', 'Presupuesto Participativo', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'obra', 'capital', '', '', '{52}', false, 'No se reparte con este motor: lo reservado y las obras las votan los 20 distritos y se incorporan por ordenanza (Ord. 5027/19). No es crédito libre.'),
  ('16.6', 'Programa Orientar Futuro', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'programa_social', 'corriente', 'joven', '', '{12,31}', false, 'Falta el indicador: jóvenes desde 16 años no están importados del censo.'),
  ('16.7', 'Asistencia técnica al colectivo LGBTQ+', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'programa_social', 'corriente', '', '', '{12,31}', false, 'Programa de alcance general.'),
  ('16.8', 'Observatorio de Violencia de Género Municipal', 'A5 · Abierta y de oportunidades', '16 · Niñez, juventud, mujeres y adultos mayores', '', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('17.1', 'Talleres para emprendedores', 'A5 · Abierta y de oportunidades', '17 · Emprendedurismo y fomento de empleo', '', 'programa_social', 'corriente', 'persona', 'desocupados', '{12,31}', true, ''),
  ('17.2', 'Emprendimientos y PyMEs de economía circular', 'A5 · Abierta y de oportunidades', '17 · Emprendedurismo y fomento de empleo', '', 'programa_social', 'corriente', '', '', '{12,31}', false, 'Programa de alcance general.'),
  ('17.3', 'Empleabilidad de recicladores urbanos', 'A5 · Abierta y de oportunidades', '17 · Emprendedurismo y fomento de empleo', '', 'programa_social', 'corriente', 'persona', 'desocupados', '{12,31}', true, ''),
  ('17.4', 'Digesto Fiscal', 'A5 · Abierta y de oportunidades', '17 · Emprendedurismo y fomento de empleo', 'Secretaría de Ingresos Municipales', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.'),
  ('17.5', 'Habilitación digital de comercios', 'A5 · Abierta y de oportunidades', '17 · Emprendedurismo y fomento de empleo', '', 'institucional', 'corriente', '', '', '{}', false, 'Gestión interna: no se asigna por barrio.')
on conflict (codigo) do nothing;

notify pgrst, 'reload schema';

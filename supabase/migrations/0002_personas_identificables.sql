-- Personas identificables: no son usuarios del sistema, son personas reales
-- del territorio a las que se les asignan espacios y tareas. Se las identifica
-- por documento y dirección además del nombre.
alter table public.personas
  add column documento text,
  add column direccion text;

create index personas_documento_idx on public.personas (documento);

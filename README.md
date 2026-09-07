# JxR MapApp — Comando Territorial

Sistema de gestión territorial electoral de **San Miguel de Tucumán**: un mapa
comando donde los administradores asignan **distritos** (20) y **circuitos
electorales** (47) a personas, con un **checklist de tareas** por asignación.

El lenguaje visual, las capas del mapa (distritos, circuitos, avenidas
realzadas, satélite) y **Migue** (el asistente IA) heredan del sistema CIMBA.

```
Espacio (distrito o circuito)
   ↓  N asignaciones
Persona (referente, fiscal, coordinador…)
   ↓  N tareas
Checklist (pendiente / hecha, con quién y cuándo)
```

## Stack

Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · **MapLibre GL**
(react-map-gl) · Tailwind 4 · OpenRouter (Migue) · Vercel.

## Roles

- **admin** (`admin1@jxr.com` … `admin6@jxr.com`): asigna personas a espacios,
  gestiona el checklist y las personas del operativo.
- **superadmin** (`direccionia@jxr.com`): además crea y elimina usuarios
  (pestaña Usuarios).

Todos los usuarios entran con una contraseña inicial temporal y el sistema
**exige cambiarla en el primer ingreso**.

## Desarrollo local

Requisitos: Node ≥ 20 y un proyecto de Supabase.

```bash
npm install
cp .env.example .env.local    # completar con las claves del proyecto
# 1) aplicar supabase/migrations/0001_inicial.sql (SQL editor del dashboard)
# 2) crear los usuarios:
npm run seed:usuarios
npm run dev                   # http://localhost:3400
```

> Las credenciales viven solo en `.env.local` (gitignored) y en las variables
> de entorno de Vercel. **Nunca** se commitean.

## Mapa

- Capas de referencia: distritos (violeta), circuitos (verde), avenidas y
  corredores realzados desde las teselas del mapa base, satélite Esri opcional.
- Cobertura: cada espacio se pinta según su estado — **sin asignar** (rojo),
  **en curso** (amarillo), **checklist completo** (verde).
- Clic en un espacio → panel de asignaciones y checklist.
- `/?tipo=circuito&codigo=15B` selecciona y encuadra un espacio (lo usa Migue).

## Padrón electoral y resultados 2023

Los datos electorales viven **solo en Supabase con RLS** (jamás en el repo):

```bash
# 1) padrón (xlsx de la Junta Electoral): 459 mil electores → electores/escuelas/mesas
node --max-old-space-size=6144 scripts/importar-padron.mjs "C:\ruta\padron.xlsx" [--reemplazar]
# 2) escrutinio definitivo 2023 (PDF mesa a mesa) → resultados_2023 (valida el cruce mesa→escuela)
node --max-old-space-size=6144 scripts/importar-resultados-2023.mjs "C:\ruta\mesa_a_mesa.pdf" [--reemplazar]
# 3) coordenadas de las escuelas de votación (Nominatim/OSM, 1 req/seg)
node scripts/geocodificar-escuelas.mjs
```

- **Vistas del mapa** (patrón CIMBA): Operativo · Padrón (coropleta/3D de
  electores, filtrable por sexo y franja etaria *estimada por DNI*) ·
  Escuelas (puntos + calor de concentración) · 2023 (voto disperso por circuito).
- **¿Dónde vota?**: búsqueda por apellido/DNI con escuela, mesa y orden.
- **Estrategia**: votos 2023 de listas seleccionadas agrupados por escuela,
  umbral configurable (~200 votos por escuela) y universo acumulado hacia la
  meta de 20.000. La selección de listas es del equipo (preselección editable).
- El análisis político es **siempre agregado** (escuela/circuito/cohorte):
  el voto es secreto y acá no se etiqueta a personas.

## Migue

Asistente conversacional (OpenRouter, tool-calling de solo lectura con la
sesión RLS del usuario): cobertura, personas, tareas, padrón ("¿dónde vota
Pérez?", "¿cuántos electores tiene el 15B?"), resultados 2023 y estrategia
("¿en qué escuelas el peronismo disperso sacó entre 150 y 300 votos?"),
más acción visual sobre el mapa ("mostrame el circuito 15B").

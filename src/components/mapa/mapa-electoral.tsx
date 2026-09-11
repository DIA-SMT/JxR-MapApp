"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Box, Building2, Check, Info, Layers, Route, Satellite, Sparkles, Waypoints, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layer,
  Map as MapaGL,
  NavigationControl,
  ScaleControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { FilterSpecification, Map as MapaLibre } from "maplibre-gl";
import { claveEspacio, useTerritorio } from "@/lib/territorio";
import { etiquetaEspacio } from "@/lib/espacios";
import {
  FRANJAS,
  obtenerEscuelas,
  obtenerPadronPorCircuito,
  obtenerPrioridadEscuelas,
  obtenerResumenPadron,
  obtenerVotosPorCircuito2023,
  type Escuela,
  type PrioridadEscuela,
  type ResumenPadron,
} from "@/lib/padron";
import { META_VOTOS, resolverSeleccion } from "@/lib/estrategia";
import {
  calcularOportunidades,
  compararListasCircuitos,
  listarListasEleccion,
  type DeltaCircuito,
  type ListaEleccion,
  type OportunidadCircuito,
} from "@/lib/analisis";
import type { AccionMapaElena, TipoEspacio } from "@/lib/tipos";
import { BusquedaInteligente, type AccionInteligente } from "./busqueda-inteligente";
import { PanelEscuela } from "./panel-escuela";
import { PanelEspacio } from "./panel-espacio";
import cruceBarrios from "@/lib/datos/barrios-circuitos.json";

/** Barrios oficiales con su bbox y el cruce a circuitos (JSON estático). */
export interface BarrioCruce {
  id: number | null;
  nombre: string;
  bbox: number[];
  circuitos: Array<{ circuito: string; pct: number }>;
}
const BARRIOS: BarrioCruce[] = (cruceBarrios as unknown as { barrios: BarrioCruce[] }).barrios;

/** Capas de territorio: polígonos de distritos y circuitos electorales. */
type FCPoligono = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
type FCPuntos = FeatureCollection<Point, Record<string, unknown>>;
type Tema = "oscuro" | "claro";

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];
const ESTILO_OSCURO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const ESTILO_CLARO =
  process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Colores de las capas según el tema del mapa base. */
const COLORES = {
  oscuro: {
    halo: "#05070c",
    casing: "#05070c",
    hover: "#edf2fa",
    distrito: "#a78bfa",
    circuito: "#34d399",
    avenidaTexto: "#7cc4e8",
    escuelaTexto: "#9fd3f5",
    rampaPadron: ["#0e2a52", "#3987e5", "#cde2fb"] as [string, string, string],
    rampa2023: ["#471527", "#e14f82", "#ffd6e4"] as [string, string, string],
  },
  claro: {
    halo: "#ffffff",
    casing: "#ffffff",
    hover: "#14213d",
    distrito: "#7c3aed",
    circuito: "#047857",
    avenidaTexto: "#0c6aa8",
    escuelaTexto: "#0c6fb8",
    rampaPadron: ["#e3edfb", "#3987e5", "#0e2a52"] as [string, string, string],
    rampa2023: ["#fde7f0", "#e14f82", "#5c1129"] as [string, string, string],
  },
} as const;

/**
 * Vistas del mapa comando (el patrón de CIMBA: cada vista prende solo las
 * capas que sirven para esa tarea).
 */
const VISTAS = {
  operativo: { etiqueta: "Operativo", descripcion: "Cobertura del operativo: asignaciones y tareas" },
  padron: { etiqueta: "Padrón", descripcion: "Densidad de electores por circuito (filtrable por sexo y franja etaria estimada)" },
  escuelas: { etiqueta: "Escuelas", descripcion: "Escuelas de votación: dónde se concentra el electorado (clic en una escuela = sus datos y resultados)" },
  v2023: { etiqueta: "2023", descripcion: "Voto disperso 2023 (Concejal) por circuito, según la selección de listas de Estrategia" },
  prioridad: { etiqueta: "Prioridad", descripcion: "Frontera 20K: dónde actuar primero — escuelas por tier de prioridad y votos huérfanos (dispersos sin referente) por circuito" },
  oportunidad: { etiqueta: "Oportunidad", descripcion: "Índice de Oportunidad 0-100 por circuito: 40% voto disperso 2023 + 35% bolsa 2025 (blancos y ausentes) + 25% competitividad 2025" },
  evolucion: { etiqueta: "2023↔2025", descripcion: "Evolución por circuito: puntos que una agrupación 2025 saca por encima (verde) o debajo (rojo) de una lista 2023 — elegí ambas abajo" },
} as const;
type Vista = keyof typeof VISTAS;

const COLOR_TIER: Record<string, string> = { A: "#e14f82", B: "#f2a0be", C: "#6b7280" };

// ── Calles: avenidas y corredores realzados desde las teselas del mapa base ──
const FILTRO_AVENIDA: FilterSpecification = [
  "any",
  [">=", ["index-of", "venida", ["coalesce", ["get", "name"], ""]], 0],
  [">=", ["index-of", "Av. ", ["coalesce", ["get", "name"], ""]], 0],
  ["match", ["get", "class"], ["motorway", "trunk"], true, false],
];

const capaAvenidasBrillo: LayerProps = {
  id: "avenidas-brillo",
  type: "line",
  source: "carto",
  "source-layer": "transportation_name",
  filter: FILTRO_AVENIDA,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#0066ff",
    "line-opacity": 0.2,
    "line-blur": 2.5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 8, 17, 14],
  },
};
const capaAvenidas: LayerProps = {
  id: "avenidas-linea",
  type: "line",
  source: "carto",
  "source-layer": "transportation_name",
  filter: FILTRO_AVENIDA,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#2eb1ff",
    "line-opacity": 0.62,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.1, 14, 2.2, 17, 4],
  },
};
const capaAvenidasNombre = (tema: Tema): LayerProps => ({
  id: "avenidas-nombre",
  type: "symbol",
  source: "carto",
  "source-layer": "transportation_name",
  filter: FILTRO_AVENIDA,
  layout: {
    "symbol-placement": "line",
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9.5, 16, 12.5],
    "text-letter-spacing": 0.04,
    "symbol-spacing": 320,
    "text-max-angle": 35,
  },
  paint: {
    "text-color": COLORES[tema].avenidaTexto,
    "text-opacity": 0.9,
    "text-halo-color": COLORES[tema].halo,
    "text-halo-width": 1.8,
  },
});

// ── Rellenos según vista ──────────────────────────────────────────────────────
const COLOR_ESTADO = ["match", ["get", "estado"], "sin", "#ff3b30", "en_curso", "#f4dc00", "completo", "#199e70", "#6b7280"] as const;

const capaRellenoOperativo = (tipo: TipoEspacio, verCobertura: boolean): LayerProps => ({
  id: `${tipo}-relleno`,
  type: "fill",
  source: tipo,
  paint: {
    "fill-color": [...COLOR_ESTADO] as never,
    "fill-opacity": verCobertura
      ? (["match", ["get", "estado"], "sin", 0.14, "en_curso", 0.22, "completo", 0.26, 0] as never)
      : 0.03,
  },
});

const capaCoropleta = (tipo: TipoEspacio, prop: string, max: number, colores: [string, string, string]): LayerProps => ({
  id: `${tipo}-relleno`,
  type: "fill",
  source: tipo,
  paint: {
    "fill-color": [
      "interpolate", ["linear"], ["coalesce", ["get", prop], 0],
      0, colores[0],
      Math.max(1, Math.round(max * 0.5)), colores[1],
      Math.max(2, max), colores[2],
    ],
    "fill-opacity": ["case", ["<=", ["coalesce", ["get", prop], 0], 0], 0.05, 0.55],
  },
});

const capa3DOperativo = (tipo: TipoEspacio): LayerProps => ({
  id: `${tipo}-3d`,
  type: "fill-extrusion",
  source: tipo,
  paint: {
    "fill-extrusion-color": [...COLOR_ESTADO] as never,
    "fill-extrusion-height": [
      "case",
      ["==", ["get", "estado"], "sin"],
      140,
      ["+", 320, ["*", ["get", "personas"], 450], ["*", ["-", ["get", "tareas"], ["get", "hechas"]], 160]],
    ],
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": 0.78,
  },
});

const capa3DCoropleta = (tipo: TipoEspacio, prop: string, max: number, colores: [string, string, string]): LayerProps => ({
  id: `${tipo}-3d`,
  type: "fill-extrusion",
  source: tipo,
  paint: {
    "fill-extrusion-color": [
      "interpolate", ["linear"], ["coalesce", ["get", prop], 0],
      0, colores[0],
      Math.max(1, Math.round(max * 0.5)), colores[1],
      Math.max(2, max), colores[2],
    ],
    "fill-extrusion-height": ["*", ["coalesce", ["get", prop], 0], Math.max(0.05, 4200 / Math.max(1, max))],
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": 0.82,
  },
});

// ── Límites BIEN marcados: brillo + casing + línea sólida ────────────────────
const capaGlow = (tipo: TipoEspacio, activa: boolean, tema: Tema): LayerProps => ({
  id: `${tipo}-glow`,
  type: "line",
  source: tipo,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": COLORES[tema][tipo],
    "line-opacity": (tema === "claro" ? 0.7 : 1) * (activa ? 0.38 : 0.14),
    "line-blur": 5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, activa ? 7 : 4, 14, activa ? 12 : 6, 17, activa ? 18 : 9],
  },
});
const capaCasing = (tipo: TipoEspacio, activa: boolean, tema: Tema): LayerProps => ({
  id: `${tipo}-casing`,
  type: "line",
  source: tipo,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": COLORES[tema].casing,
    "line-opacity": activa ? 0.9 : 0.55,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, activa ? 4 : 2.2, 14, activa ? 6.5 : 3.2, 17, activa ? 9 : 4.5],
  },
});
const capaLinea = (tipo: TipoEspacio, activa: boolean, tema: Tema): LayerProps => ({
  id: `${tipo}-linea`,
  type: "line",
  source: tipo,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": COLORES[tema][tipo],
    "line-opacity": activa ? 0.95 : 0.5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, activa ? 1.8 : 1, 14, activa ? 3.2 : 1.6, 17, activa ? 5 : 2.4],
    ...(activa ? {} : { "line-dasharray": tipo === "distrito" ? [4, 2] : [1, 1.6] }),
  },
});

const capaNombre = (tipo: TipoEspacio, vista: Vista, tema: Tema, elenaPinta = false): LayerProps => {
  let campo: unknown;
  if (elenaPinta && tipo === "circuito") {
    campo = [
      "case",
      ["!=", ["coalesce", ["get", "elenaValor"], -99999], -99999],
      ["concat", "Circuito ", ["get", "codigo"], "\n", ["to-string", ["get", "elenaValor"]]],
      ["concat", "Circuito ", ["get", "codigo"]],
    ];
  } else if (tipo === "distrito") {
    campo = [
      "case",
      [">", ["get", "personas"], 0],
      ["concat", ["get", "nombre"], "\n", ["to-string", ["get", "personas"]], " pers. · ", ["to-string", ["get", "hechas"]], "/", ["to-string", ["get", "tareas"]], " tareas"],
      ["get", "nombre"],
    ];
  } else if (vista === "padron") {
    campo = ["concat", "Circuito ", ["get", "codigo"], "\n", ["to-string", ["coalesce", ["get", "electores"], 0]], " electores"];
  } else if (vista === "v2023") {
    campo = ["concat", "Circuito ", ["get", "codigo"], "\n", ["to-string", ["coalesce", ["get", "votos2023"], 0]], " votos"];
  } else if (vista === "prioridad") {
    campo = [
      "case",
      [">", ["coalesce", ["get", "huerfanos"], 0], 0],
      ["concat", "Circuito ", ["get", "codigo"], "\n", ["to-string", ["get", "huerfanos"]], " huérfanos"],
      ["concat", "Circuito ", ["get", "codigo"]],
    ];
  } else if (vista === "oportunidad") {
    campo = [
      "case",
      ["!=", ["coalesce", ["get", "oportunidad"], -1], -1],
      ["concat", "Circuito ", ["get", "codigo"], "\nIO ", ["to-string", ["get", "oportunidad"]]],
      ["concat", "Circuito ", ["get", "codigo"]],
    ];
  } else if (vista === "evolucion") {
    campo = [
      "case",
      ["!=", ["coalesce", ["get", "delta"], -99999], -99999],
      [
        "concat", "Circuito ", ["get", "codigo"], "\n",
        ["case", [">=", ["get", "delta"], 0], "+", ""], ["to-string", ["get", "delta"]], " pts",
      ],
      ["concat", "Circuito ", ["get", "codigo"]],
    ];
  } else if (vista === "escuelas") {
    campo = ["concat", "Circuito ", ["get", "codigo"]];
  } else {
    campo = [
      "case",
      [">", ["get", "personas"], 0],
      ["concat", "Circuito ", ["get", "codigo"], "\n", ["to-string", ["get", "personas"]], " pers."],
      ["concat", "Circuito ", ["get", "codigo"]],
    ];
  }
  return {
    id: `${tipo}-nombre`,
    type: "symbol",
    source: tipo,
    minzoom: tipo === "distrito" ? 10 : 11,
    layout: {
      "text-field": campo as never,
      "text-font": ["Open Sans Bold"],
      "text-size":
        tipo === "distrito"
          ? (["interpolate", ["linear"], ["zoom"], 11, 13, 14, 17] as never)
          : (["interpolate", ["linear"], ["zoom"], 11, 11, 14, 14.5] as never),
      "text-line-height": 1.25,
      "text-letter-spacing": 0.03,
    },
    paint: {
      "text-color": vista === "v2023" && tipo === "circuito" ? (tema === "claro" ? "#b3134f" : "#ffb3cd") : COLORES[tema][tipo],
      "text-halo-color": COLORES[tema].halo,
      "text-halo-width": 2.2,
      "text-halo-blur": 0.5,
    },
  };
};

const capaHoverRelleno = (tipo: TipoEspacio, codigo: string, tema: Tema): LayerProps => ({
  id: `${tipo}-hover-relleno`,
  type: "fill",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  paint: { "fill-color": COLORES[tema].hover, "fill-opacity": 0.09 },
});
const capaHoverLinea = (tipo: TipoEspacio, codigo: string, tema: Tema): LayerProps => ({
  id: `${tipo}-hover-linea`,
  type: "line",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": COLORES[tema].hover, "line-width": 2.6, "line-opacity": 0.85 },
});
const capaSeleccionGlow = (tipo: TipoEspacio, codigo: string): LayerProps => ({
  id: `${tipo}-seleccion-glow`,
  type: "line",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  paint: { "line-color": "#e14f82", "line-width": 12, "line-blur": 6, "line-opacity": 0.5 },
});
const capaSeleccion = (tipo: TipoEspacio, codigo: string): LayerProps => ({
  id: `${tipo}-seleccion`,
  type: "line",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#e14f82", "line-width": 4, "line-opacity": 0.95 },
});

// ── Escuelas de votación (vista Escuelas) ─────────────────────────────────────
const capaEscuelasCalor: LayerProps = {
  id: "escuelas-calor",
  type: "heatmap",
  source: "escuelas",
  paint: {
    "heatmap-weight": ["interpolate", ["linear"], ["get", "electores"], 0, 0, 8000, 1],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 15, 1.6],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 22, 15, 46],
    "heatmap-opacity": 0.55,
    "heatmap-color": [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(225,79,130,0)",
      0.3, "#7c2547",
      0.6, "#c93f6d",
      0.85, "#e14f82",
      1, "#ffd6e4",
    ],
  },
};
/** Halo circular bajo el emoji: hace legible el tamaño (electores) y marca
 *  en rosa las escuelas que ya integran el universo de la estrategia. */
const capaEscuelasHalo = (tema: Tema): LayerProps => ({
  id: "escuelas-halo",
  type: "circle",
  source: "escuelas",
  paint: {
    "circle-color": [
      "case",
      ["==", ["get", "enEstrategia"], true],
      "#e14f82",
      tema === "claro" ? "#0c6fb8" : "#2eb1ff",
    ],
    "circle-opacity": ["case", ["==", ["get", "enEstrategia"], true], 0.4, 0.22],
    "circle-radius": ["interpolate", ["linear"], ["get", "electores"], 500, 9, 3000, 13, 6000, 17, 9500, 22],
    "circle-stroke-width": ["case", ["==", ["get", "enEstrategia"], true], 2, 1],
    "circle-stroke-color": ["case", ["==", ["get", "enEstrategia"], true], "#e14f82", COLORES[tema].halo],
  },
});

/** El emoji de escuela, dibujado a canvas y registrado como imagen del mapa. */
const capaEscuelasPuntos: LayerProps = {
  id: "escuelas-puntos",
  type: "symbol",
  source: "escuelas",
  layout: {
    "icon-image": "icono-escuela",
    "icon-size": ["interpolate", ["linear"], ["get", "electores"], 500, 0.32, 3000, 0.45, 6000, 0.58, 9500, 0.72],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  },
};

/** Renderiza 🏫 en un canvas y lo registra como icono del estilo (los glifos
 *  PBF de Carto no traen emoji, así que se inyecta como imagen). */
function asegurarIconoEscuela(mapa: MapaLibre) {
  try {
    if (mapa.hasImage("icono-escuela")) return;
    const tam = 64;
    const canvas = document.createElement("canvas");
    canvas.width = tam;
    canvas.height = tam;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "52px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
    ctx.fillText("🏫", tam / 2, tam / 2 + 4);
    const datos = ctx.getImageData(0, 0, tam, tam);
    mapa.addImage("icono-escuela", datos, { pixelRatio: 2 });
  } catch {
    // sin canvas/emoji: la capa de halos sigue mostrando las escuelas
  }
}
// ── Barrios oficiales (contexto territorial: nombres y límites suaves) ───────
const capaBarriosLinea = (tema: Tema): LayerProps => ({
  id: "barrios-linea",
  type: "line",
  source: "barrios",
  paint: {
    "line-color": tema === "claro" ? "#b45309" : "#f2c94c",
    "line-opacity": 0.35,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 15, 1.4],
    "line-dasharray": [2, 2],
  },
});
/** Barrio resaltado: el que se eligió desde el panel del circuito. */
const capaBarrioResaltadoRelleno = (nombre: string): LayerProps => ({
  id: "barrio-resaltado-relleno",
  type: "fill",
  source: "barrios",
  filter: ["==", ["get", "nombre"], nombre],
  paint: { "fill-color": "#f2c94c", "fill-opacity": 0.22 },
});
const capaBarrioResaltadoLinea = (nombre: string): LayerProps => ({
  id: "barrio-resaltado-linea",
  type: "line",
  source: "barrios",
  filter: ["==", ["get", "nombre"], nombre],
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#f2c94c", "line-width": 3, "line-opacity": 0.95 },
});
const capaBarrioResaltadoGlow = (nombre: string): LayerProps => ({
  id: "barrio-resaltado-glow",
  type: "line",
  source: "barrios",
  filter: ["==", ["get", "nombre"], nombre],
  paint: { "line-color": "#f2c94c", "line-width": 12, "line-blur": 7, "line-opacity": 0.45 },
});

// ── Capa de Elena: análisis pintado/resaltado desde el chat ──────────────────
/** Resaltado múltiple: los circuitos que Elena señaló en su análisis. */
const filtroElena = (circuitos: string[]): FilterSpecification =>
  ["in", ["get", "codigo"], ["literal", circuitos]] as unknown as FilterSpecification;
const capaElenaGlow = (circuitos: string[]): LayerProps => ({
  id: "elena-resaltado-glow",
  type: "line",
  source: "circuito",
  filter: filtroElena(circuitos),
  paint: { "line-color": "#f2c94c", "line-width": 11, "line-blur": 6, "line-opacity": 0.5 },
});
const capaElenaRelleno = (circuitos: string[]): LayerProps => ({
  id: "elena-resaltado-relleno",
  type: "fill",
  source: "circuito",
  filter: filtroElena(circuitos),
  paint: { "fill-color": "#f2c94c", "fill-opacity": 0.16 },
});
const capaElenaLinea = (circuitos: string[]): LayerProps => ({
  id: "elena-resaltado-linea",
  type: "line",
  source: "circuito",
  filter: filtroElena(circuitos),
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#f2c94c", "line-width": 3, "line-opacity": 0.95 },
});

/**
 * Coropleta por valor arbitrario (lo pintado por Elena, o el delta 2023↔2025).
 * Con valores negativos se vuelve divergente (rojo ← 0 → verde); si todos son
 * positivos, la rampa de la casa. Los espacios sin dato quedan casi apagados.
 */
const capaCoropletaValor = (tipo: TipoEspacio, prop: string, min: number, max: number, colores: [string, string, string]): LayerProps => {
  const color =
    min < 0
      ? ([
          "interpolate", ["linear"], ["coalesce", ["get", prop], 0],
          Math.min(-0.001, min), "#e14f42",
          0, "#6b7280",
          Math.max(0.001, max), "#22c55e",
        ] as never)
      : ([
          "interpolate", ["linear"], ["coalesce", ["get", prop], 0],
          Math.min(0, min), colores[0],
          min + Math.max(0.001, (max - min) / 2), colores[1],
          Math.max(min + 0.002, max), colores[2],
        ] as never);
  return {
    id: `${tipo}-relleno`,
    type: "fill",
    source: tipo,
    paint: {
      "fill-color": color,
      "fill-opacity": ["case", ["==", ["coalesce", ["get", prop], -99999], -99999], 0.04, 0.6] as never,
    },
  };
};

const capaBarriosNombre = (tema: Tema): LayerProps => ({
  id: "barrios-nombre",
  type: "symbol",
  source: "barrios",
  minzoom: 12.5,
  layout: {
    "text-field": ["get", "nombre"],
    "text-font": ["Open Sans Italic"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 9, 16, 12],
    "text-max-width": 8,
    "text-letter-spacing": 0.05,
  },
  paint: {
    "text-color": tema === "claro" ? "#92610a" : "#f2c94c",
    "text-opacity": 0.85,
    "text-halo-color": COLORES[tema].halo,
    "text-halo-width": 1.6,
  },
});

const capaEscuelasNombre = (tema: Tema): LayerProps => ({
  id: "escuelas-nombre",
  type: "symbol",
  source: "escuelas",
  minzoom: 14,
  layout: {
    "text-field": ["get", "nombre"],
    "text-font": ["Open Sans Regular"],
    "text-size": 9.5,
    "text-max-width": 16,
    "text-offset": [0, 1.2],
    "text-anchor": "top",
  },
  paint: { "text-color": COLORES[tema].escuelaTexto, "text-halo-color": COLORES[tema].halo, "text-halo-width": 1.6 },
});

/** Vista Prioridad: escuelas por tier (halo A/B/C) con borde rojo si el
 *  circuito no tiene referente (votos huérfanos). */
const capaPrioridadHalo = (tema: Tema): LayerProps => ({
  id: "prioridad-halo",
  type: "circle",
  source: "prioridad-escuelas",
  paint: {
    "circle-color": ["match", ["get", "tier"], "A", COLOR_TIER.A, "B", COLOR_TIER.B, COLOR_TIER.C],
    "circle-opacity": ["match", ["get", "tier"], "A", 0.5, "B", 0.35, 0.18],
    "circle-radius": ["interpolate", ["linear"], ["get", "votos"], 50, 8, 200, 12, 400, 17, 900, 23],
    "circle-stroke-width": ["case", ["==", ["get", "referentes"], 0], 2.5, 1],
    "circle-stroke-color": ["case", ["==", ["get", "referentes"], 0], "#ff3b30", COLORES[tema].halo],
  },
});
const capaPrioridadPuntos: LayerProps = {
  id: "prioridad-puntos",
  type: "symbol",
  source: "prioridad-escuelas",
  layout: {
    "icon-image": "icono-escuela",
    "icon-size": ["interpolate", ["linear"], ["get", "votos"], 50, 0.3, 400, 0.5, 900, 0.68],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  },
};

/**
 * Callejero legible (el realce de CIMBA): dark-matter es deliberadamente
 * minimalista — rellena las calles menores recién en zoom 15, esconde sus
 * nombres hasta zoom 16 y pinta las de servicio casi negras. Acá se adelantan
 * esos zooms y se sube el contraste sobre las capas ya presentes del estilo.
 * El toggle «Calles» controla los NOMBRES; las trazas quedan siempre realzadas.
 */
const CALLES_NOMBRES = {
  oscuro: [
    { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#b9c6d8" },
    { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#c8d4e4" },
    { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#d6e0ee" },
    { id: "roadname_major", minzoom: 11.5, size: 12, color: "#e2eaf5" },
  ],
  claro: [
    { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#5b6b7d" },
    { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#4d5c6e" },
    { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#41505f" },
    { id: "roadname_major", minzoom: 11.5, size: 12, color: "#36434f" },
  ],
} as const;
const CALLES_TRAZAS = [
  { id: "road_minor_fill", minzoom: 13.5, color: "rgba(88, 97, 118, 1)" },
  { id: "road_minor_case", minzoom: 12.5, color: "rgba(72, 79, 98, 1)" },
  { id: "road_service_fill", minzoom: 14.5, color: "rgba(70, 76, 94, 1)" },
  { id: "road_sec_fill_noramp", minzoom: 12, color: "rgba(96, 105, 126, 1)" },
] as const;

function aplicarCalles(mapa: MapaLibre, visibles: boolean, tema: Tema): boolean {
  let capas = 0;
  try {
    capas = mapa.getStyle()?.layers?.length ?? 0;
  } catch {
    capas = 0;
  }
  if (capas === 0) return false;

  for (const c of CALLES_NOMBRES[tema]) {
    if (!mapa.getLayer(c.id)) continue;
    mapa.setLayoutProperty(c.id, "visibility", visibles ? "visible" : "none");
    if (!visibles) continue;
    mapa.setLayerZoomRange(c.id, c.minzoom, 24);
    mapa.setLayoutProperty(c.id, "text-size", c.size);
    mapa.setPaintProperty(c.id, "text-color", c.color);
    mapa.setPaintProperty(c.id, "text-halo-color", tema === "oscuro" ? "#070a10" : "#ffffff");
    mapa.setPaintProperty(c.id, "text-halo-width", 1.7);
  }
  // Las trazas se realzan siempre (solo aclaramos colores en oscuro: positron
  // ya trae calles legibles y pisarlas con estos grises las volvería barro)
  for (const c of CALLES_TRAZAS) {
    if (!mapa.getLayer(c.id)) continue;
    mapa.setLayerZoomRange(c.id, c.minzoom, 24);
    if (tema === "oscuro") mapa.setPaintProperty(c.id, "line-color", c.color);
  }
  return true;
}

/** bbox recursivo de una geometría GeoJSON (Polygon/MultiPolygon). */
function bboxDeCoordenadas(c: unknown): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const recorrer = (x: unknown): void => {
    if (Array.isArray(x) && typeof x[0] === "number") {
      const [lon, lat] = x as [number, number];
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      return;
    }
    if (Array.isArray(x)) for (const y of x) recorrer(y);
  };
  recorrer(c);
  return [minLon, minLat, maxLon, maxLat];
}

const numero = (n: number) => n.toLocaleString("es-AR");
/** Delta con signo explícito: "+3,2" / "-1,8" (el 0 va sin signo). */
const conSigno = (n: number) => (n > 0 ? `+${numero(n)}` : numero(n));

export interface SeleccionEspacio {
  tipo: TipoEspacio;
  codigo: string;
}

export interface InicialMapa extends Partial<SeleccionEspacio> {
  vista?: Vista;
  sexo?: "F" | "M";
  franja?: string;
}

export function MapaElectoral({ inicial }: { inicial?: InicialMapa | null }) {
  const mapRef = useRef<MapRef>(null);
  const territorio = useTerritorio();
  const { supabase, asignaciones, tareas, porEspacio } = territorio;

  const [tema, setTema] = useState<Tema>("oscuro");
  const [vista, setVista] = useState<Vista>("operativo");
  const [tipoActivo, setTipoActivo] = useState<TipoEspacio>("circuito");
  const [seleccion, setSeleccion] = useState<SeleccionEspacio | null>(null);
  const [escuelaSel, setEscuelaSel] = useState<Escuela | null>(null);
  const [hover, setHover] = useState<{ codigo: string; x: number; y: number } | null>(null);
  const [hoverEscuela, setHoverEscuela] = useState<{ nombre: string; electores: number; mesas: number; circuito: string; x: number; y: number } | null>(null);
  const [verCobertura, setVerCobertura] = useState(true);
  const [ver3D, setVer3D] = useState(false);
  const [verSatelite, setVerSatelite] = useState(false);
  const [verAvenidas, setVerAvenidas] = useState(true);
  const [verCalles, setVerCalles] = useState(true);
  const [verBarrios, setVerBarrios] = useState(false);
  const [barrioResaltado, setBarrioResaltado] = useState<string | null>(null);
  /** Análisis de Elena pintado sobre el mapa: resaltado múltiple o coropleta propia. */
  const [capaElena, setCapaElena] = useState<{
    etiqueta: string;
    resaltados: string[] | null;
    valores: Map<string, number> | null;
  } | null>(null);
  const [menuCapas, setMenuCapas] = useState(false);
  const [verLeyenda, setVerLeyenda] = useState(true);

  // En pantallas chicas la leyenda arranca cerrada (tapa demasiado mapa).
  // Se decide en el cliente para no romper el HTML del servidor.
  useEffect(() => {
    if (window.innerWidth < 640) setVerLeyenda(false);
  }, []);
  const [hayAnclaEtiquetas, setHayAnclaEtiquetas] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [usuarioId, setUsuarioId] = useState<string | null>(null);

  // Microsegmentación del padrón (vista Padrón)
  const [sexoFiltro, setSexoFiltro] = useState<"F" | "M" | null>(null);
  const [franjaClave, setFranjaClave] = useState("todas");
  // Vista Escuelas: mínimo de electores (lo setea la búsqueda inteligente)
  const [escuelasMin, setEscuelasMin] = useState(0);

  // Datos del padrón / escuelas / 2023
  const [resumen, setResumen] = useState<ResumenPadron | null>(null);
  const [padronCirc, setPadronCirc] = useState<Map<string, number>>(new Map());
  const [escuelas, setEscuelas] = useState<Escuela[]>([]);
  const [votos2023, setVotos2023] = useState<Map<string, number> | null>(null);
  const [enEstrategia, setEnEstrategia] = useState<Set<string>>(new Set());

  const avisoTimer = useRef<number | null>(null);
  const avisar = useCallback((texto: string) => {
    if (avisoTimer.current) window.clearTimeout(avisoTimer.current);
    setAviso(texto);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 4000);
  }, []);

  // Tema del mapa: sigue el toggle global (clase .claro en <html>)
  useEffect(() => {
    const leer = () => setTema(document.documentElement.classList.contains("claro") ? "claro" : "oscuro");
    leer();
    window.addEventListener("jxr:tema", leer);
    return () => window.removeEventListener("jxr:tema", leer);
  }, []);

  useEffect(() => {
    void obtenerResumenPadron(supabase).then(setResumen);
    void obtenerEscuelas(supabase).then(setEscuelas);
    void supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null));
    void supabase
      .from("estrategia_escuelas")
      .select("escuela, incluida")
      .then(({ data }) => {
        const filas = (data as Array<{ escuela: string; incluida: boolean }>) ?? [];
        setEnEstrategia(new Set(filas.filter((f) => f.incluida).map((f) => f.escuela)));
      });
  }, [supabase]);

  useEffect(() => {
    const franja = FRANJAS.find((f) => f.clave === franjaClave);
    void obtenerPadronPorCircuito(supabase, {
      sexo: sexoFiltro,
      edadMin: franja?.min ?? null,
      edadMax: franja?.max ?? null,
    }).then((filas) => {
      setPadronCirc(new Map(filas.filter((f) => f.circuito).map((f) => [f.circuito as string, Number(f.total)])));
    });
  }, [supabase, sexoFiltro, franjaClave]);

  // Voto disperso 2023 (Concejal): la selección de listas compartida (base)
  useEffect(() => {
    if (vista !== "v2023" || votos2023 !== null) return;
    void (async () => {
      const listas = await resolverSeleccion(supabase, "CONCEJAL");
      const filas = await obtenerVotosPorCircuito2023(supabase, "CONCEJAL", listas);
      setVotos2023(new Map(filas.map((f) => [f.circuito, Number(f.votos)])));
    })();
  }, [vista, votos2023, supabase]);

  // Índice de Oportunidad por circuito (vista Oportunidad)
  const [oportunidad, setOportunidad] = useState<Map<string, OportunidadCircuito> | null>(null);
  useEffect(() => {
    if (vista !== "oportunidad" || oportunidad !== null) return;
    void (async () => {
      const listas = await resolverSeleccion(supabase, "CONCEJAL");
      const filas = await calcularOportunidades(supabase, listas);
      setOportunidad(new Map(filas.map((f) => [f.circuito, f])));
    })().catch(() => avisar("No pude calcular el Índice de Oportunidad"));
  }, [vista, oportunidad, supabase, avisar]);
  const topOportunidad = useMemo(
    () => [...(oportunidad?.values() ?? [])].sort((a, b) => b.indice - a.indice).slice(0, 3),
    [oportunidad],
  );

  // Evolución 2023 ↔ 2025 (vista 2023↔2025): delta de % por circuito
  const [listas23, setListas23] = useState<ListaEleccion[] | null>(null);
  const [listas25, setListas25] = useState<ListaEleccion[] | null>(null);
  const [sel23, setSel23] = useState<number | null>(null);
  const [sel25, setSel25] = useState<number | null>(null);
  const [deltas, setDeltas] = useState<Map<string, DeltaCircuito> | null>(null);
  useEffect(() => {
    if (vista !== "evolucion" || listas23 !== null) return;
    void (async () => {
      const [l23, l25] = await Promise.all([
        listarListasEleccion(supabase, "2023", "CONCEJAL"),
        listarListasEleccion(supabase, "2025"),
      ]);
      setListas23(l23);
      setListas25(l25);
      // Arranca comparando las dos más votadas: hay algo pintado desde el segundo cero
      if (l23[0]) setSel23((v) => v ?? l23[0].lista_id);
      if (l25[0]) setSel25((v) => v ?? l25[0].lista_id);
    })().catch(() => avisar("No pude cargar las listas para comparar"));
  }, [vista, listas23, supabase, avisar]);
  useEffect(() => {
    if (vista !== "evolucion" || sel23 == null || sel25 == null) return;
    setDeltas(null);
    void compararListasCircuitos(supabase, sel23, sel25)
      .then((filas) => setDeltas(new Map(filas.map((f) => [f.circuito, f]))))
      .catch(() => avisar("No pude comparar esas listas"));
  }, [vista, sel23, sel25, supabase, avisar]);
  const rangoDelta = useMemo(() => {
    if (!deltas || deltas.size === 0) return null;
    const v = [...deltas.values()].map((f) => Number(f.delta_pct));
    return { min: Math.min(...v), max: Math.max(...v) };
  }, [deltas]);

  // Frontera 20K (vista Prioridad): escuelas rankeadas + huérfanos por circuito
  const [prioridad, setPrioridad] = useState<PrioridadEscuela[] | null>(null);
  useEffect(() => {
    if (vista !== "prioridad" || prioridad !== null) return;
    void (async () => {
      const listas = await resolverSeleccion(supabase, "CONCEJAL");
      setPrioridad(await obtenerPrioridadEscuelas(supabase, "CONCEJAL", listas, META_VOTOS));
    })();
  }, [vista, prioridad, supabase]);

  const huerfanosCirc = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const f of prioridad ?? []) {
      if (f.referentes === 0 && f.circuito) {
        mapa.set(f.circuito, (mapa.get(f.circuito) ?? 0) + Number(f.votos_dispersos));
      }
    }
    return mapa;
  }, [prioridad]);
  const maxHuerfanos = useMemo(() => Math.max(1, ...huerfanosCirc.values()), [huerfanosCirc]);
  const kpisPrioridad = useMemo(() => {
    const filas = prioridad ?? [];
    const front = filas.filter((f) => f.en_frontera);
    return {
      frontera: front.length,
      votosFrontera: front.reduce((a, f) => a + Number(f.votos_dispersos), 0),
      huerfanos: filas.filter((f) => f.referentes === 0).reduce((a, f) => a + Number(f.votos_dispersos), 0),
    };
  }, [prioridad]);

  const prioridadGeo = useMemo<FCPuntos>(
    () => ({
      type: "FeatureCollection",
      features: (prioridad ?? [])
        .filter((f) => f.lat != null && f.lon != null)
        .map((f) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [f.lon as number, f.lat as number] },
          properties: {
            nombre: f.escuela,
            tier: f.tier,
            votos: Number(f.votos_dispersos),
            referentes: f.referentes,
            circuito: f.circuito ?? "",
            electores: f.electores,
          },
        })),
    }),
    [prioridad],
  );

  const [hoverPrioridad, setHoverPrioridad] = useState<{ nombre: string; tier: string; votos: number; referentes: number; circuito: string; x: number; y: number } | null>(null);

  // Las vistas de datos electorales trabajan por circuito
  const avisoGeoRef = useRef(false);
  useEffect(() => {
    if (vista !== "operativo" && tipoActivo !== "circuito") setTipoActivo("circuito");
    if (vista !== "escuelas" && vista !== "prioridad") setEscuelaSel(null);
    setHoverPrioridad(null);
    // Honestidad visual: avisar una vez que las escuelas sin coordenadas no
    // aparecen como punto (sí están en tablas, paneles y análisis)
    if ((vista === "escuelas" || vista === "prioridad") && !avisoGeoRef.current && escuelas.length > 0) {
      const sinGeo = escuelas.filter((e) => e.lat == null).length;
      if (sinGeo > 0) {
        avisoGeoRef.current = true;
        avisar(`${sinGeo} de ${escuelas.length} escuelas sin ubicación: no se ven como punto, pero cuentan en tablas y análisis`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  // GeoJSON crudos
  const [distritosGeo, setDistritosGeo] = useState<FCPoligono | null>(null);
  const [circuitosGeo, setCircuitosGeo] = useState<FCPoligono | null>(null);
  const [barriosGeo, setBarriosGeo] = useState<FCPoligono | null>(null);
  useEffect(() => {
    fetch("/data/distritos.json").then((r) => r.json()).then(setDistritosGeo).catch(() => {});
    fetch("/data/circuitos.json").then((r) => r.json()).then(setCircuitosGeo).catch(() => {});
  }, []);
  // Barrios: recién cuando se activan (152 KB que la mayoría de las sesiones no usa)
  useEffect(() => {
    if (!verBarrios || barriosGeo) return;
    fetch("/data/barrios.json").then((r) => r.json()).then(setBarriosGeo).catch(() => {});
  }, [verBarrios, barriosGeo]);

  // GeoJSON enriquecidos con operativo + padrón + 2023
  const enriquecer = (geo: FCPoligono | null, tipo: TipoEspacio): FCPoligono | null => {
    if (!geo) return null;
    return {
      type: "FeatureCollection",
      features: geo.features.map((f) => {
        const codigo = tipo === "distrito" ? String(f.properties.id) : String(f.properties.circuito);
        const r = porEspacio.get(claveEspacio(tipo, codigo));
        return {
          ...f,
          properties: {
            ...f.properties,
            codigo,
            nombre: tipo === "distrito" ? (f.properties.nombre ?? `Distrito ${codigo}`) : `Circuito ${codigo}`,
            estado: r?.estado ?? "sin",
            personas: r?.asignaciones.length ?? 0,
            tareas: r?.tareas.length ?? 0,
            hechas: r?.nHechas ?? 0,
            electores: tipo === "circuito" ? (padronCirc.get(codigo) ?? 0) : 0,
            votos2023: tipo === "circuito" ? (votos2023?.get(codigo) ?? 0) : 0,
            huerfanos: tipo === "circuito" ? (huerfanosCirc.get(codigo) ?? 0) : 0,
            elenaValor: tipo === "circuito" ? (capaElena?.valores?.get(codigo) ?? null) : null,
            oportunidad: tipo === "circuito" ? (oportunidad?.get(codigo)?.indice ?? null) : null,
            delta: tipo === "circuito" ? (deltas?.has(codigo) ? Number(deltas.get(codigo)?.delta_pct) : null) : null,
          },
        };
      }),
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const distritos = useMemo(() => enriquecer(distritosGeo, "distrito"), [distritosGeo, porEspacio, padronCirc, votos2023, huerfanosCirc, capaElena, oportunidad, deltas]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const circuitos = useMemo(() => enriquecer(circuitosGeo, "circuito"), [circuitosGeo, porEspacio, padronCirc, votos2023, huerfanosCirc, capaElena, oportunidad, deltas]);
  const geoPorTipo: Record<TipoEspacio, FCPoligono | null> = { distrito: distritos, circuito: circuitos };

  /** Escuelas con coordenadas: las que se pueden marcar en el mapa. */
  const escuelasUbicadas = useMemo(
    () => new Set(escuelas.filter((e) => e.lat != null && e.lon != null).map((e) => e.nombre)),
    [escuelas],
  );

  const maxElectores = useMemo(() => Math.max(1, ...padronCirc.values()), [padronCirc]);
  const maxVotos2023 = useMemo(() => Math.max(1, ...(votos2023?.values() ?? [1])), [votos2023]);

  const escuelasGeo = useMemo<FCPuntos>(
    () => ({
      type: "FeatureCollection",
      features: escuelas
        .filter((e) => e.lat != null && e.lon != null && e.electores >= escuelasMin)
        .map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lon as number, e.lat as number] },
          properties: {
            nombre: e.nombre,
            electores: e.electores,
            mesas: e.mesas ?? 0,
            circuito: e.circuito ?? "",
            enEstrategia: enEstrategia.has(e.nombre),
          },
        })),
    }),
    [escuelas, escuelasMin, enEstrategia],
  );

  const volarAEspacio = (tipo: TipoEspacio, codigo: string) => {
    const geo = tipo === "distrito" ? distritosGeo : circuitosGeo;
    const f = geo?.features.find((x) =>
      tipo === "distrito" ? String(x.properties.id) === codigo : String(x.properties.circuito) === codigo,
    );
    if (!f) return;
    const [minLon, minLat, maxLon, maxLat] = bboxDeCoordenadas(f.geometry.coordinates);
    const mapa = mapRef.current?.getMap();
    if (!mapa || !Number.isFinite(minLon)) return;
    mapa.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      padding: { top: 90, bottom: 60, left: 60, right: 440 },
      maxZoom: 15,
      duration: 1000,
      pitch: mapa.getPitch(),
      bearing: mapa.getBearing(),
    });
  };
  const volarRef = useRef(volarAEspacio);
  volarRef.current = volarAEspacio;

  /** Encuadra el conjunto de circuitos que Elena resaltó o pintó. */
  const volarACircuitos = (codigos: string[]) => {
    if (!circuitosGeo || codigos.length === 0) return;
    const set = new Set(codigos);
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const f of circuitosGeo.features) {
      if (!set.has(String(f.properties.circuito))) continue;
      const [a, b, cc, d] = bboxDeCoordenadas(f.geometry.coordinates);
      minLon = Math.min(minLon, a); minLat = Math.min(minLat, b);
      maxLon = Math.max(maxLon, cc); maxLat = Math.max(maxLat, d);
    }
    const mapa = mapRef.current?.getMap();
    if (!mapa || !Number.isFinite(minLon)) return;
    mapa.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      padding: { top: 130, bottom: 60, left: 50, right: 50 },
      maxZoom: 14.5,
      duration: 1000,
    });
  };
  const volarACircuitosRef = useRef(volarACircuitos);
  volarACircuitosRef.current = volarACircuitos;

  /** Aplica las acciones avanzadas de Elena (resaltar / pintar / barrio). */
  const aplicarAccionesElena = useCallback((acciones: AccionMapaElena[]) => {
    for (const a of acciones) {
      if (a.modo === "barrio") {
        verBarrioRef.current(a.barrio);
        continue;
      }
      setEscuelaSel(null);
      setTipoActivo("circuito");
      if (a.modo === "resaltar") {
        setCapaElena({ etiqueta: a.etiqueta, resaltados: a.circuitos, valores: null });
        volarACircuitosRef.current(a.circuitos);
      } else {
        setCapaElena({
          etiqueta: a.etiqueta,
          resaltados: null,
          valores: new Map(a.valores.map((v) => [v.circuito, v.valor])),
        });
        volarACircuitosRef.current(a.valores.map((v) => v.circuito));
      }
    }
  }, []);

  // Elena pinta el mapa: en vivo (evento) o al llegar desde otra pantalla
  // (sessionStorage: el evento se perdería durante la navegación)
  useEffect(() => {
    const alElena = (e: Event) => {
      const acciones = (e as CustomEvent<AccionMapaElena[]>).detail;
      if (Array.isArray(acciones)) aplicarAccionesElena(acciones);
    };
    window.addEventListener("jxr:elena-mapa", alElena);
    return () => window.removeEventListener("jxr:elena-mapa", alElena);
  }, [aplicarAccionesElena]);
  useEffect(() => {
    if (!circuitosGeo) return;
    try {
      const crudo = sessionStorage.getItem("jxr:elena-mapa-pendiente");
      if (!crudo) return;
      sessionStorage.removeItem("jxr:elena-mapa-pendiente");
      aplicarAccionesElena(JSON.parse(crudo) as AccionMapaElena[]);
    } catch {
      // sin storage no hay acción pendiente que aplicar
    }
  }, [circuitosGeo, aplicarAccionesElena]);

  const rangoElena = useMemo(() => {
    if (!capaElena?.valores || capaElena.valores.size === 0) return null;
    const v = [...capaElena.valores.values()];
    return { min: Math.min(...v), max: Math.max(...v) };
  }, [capaElena]);

  const seleccionarCircuito = useCallback((codigo: string) => {
    setEscuelaSel(null);
    setTipoActivo("circuito");
    setSeleccion({ tipo: "circuito", codigo });
    volarRef.current("circuito", codigo);
  }, []);

  /** Acciones de la búsqueda inteligente (texto/voz → mapa). */
  const escuelasRef = useRef(escuelas);
  escuelasRef.current = escuelas;
  const ejecutarAccion = useCallback((a: AccionInteligente) => {
    switch (a.accion) {
      case "ir_espacio":
        setEscuelaSel(null);
        setTipoActivo(a.tipo);
        setSeleccion({ tipo: a.tipo, codigo: a.codigo });
        volarRef.current(a.tipo, a.codigo);
        break;
      case "vista":
        setVista(a.vista);
        break;
      case "filtros_padron":
        setVista("padron");
        if (a.sexo) setSexoFiltro(a.sexo === "todos" ? null : a.sexo);
        if (a.franja) setFranjaClave(a.franja);
        break;
      case "escuelas_min":
        setVista("escuelas");
        setEscuelasMin(a.minimo);
        break;
      case "escuela": {
        const esc = escuelasRef.current.find((x) => x.nombre === a.nombre);
        if (!esc) break;
        setVista((v) => (v === "escuelas" || v === "prioridad" ? v : "escuelas"));
        setSeleccion(null);
        setEscuelaSel(esc);
        const mapa = mapRef.current?.getMap();
        if (mapa && esc.lon != null && esc.lat != null) {
          mapa.easeTo({ center: [esc.lon - 0.004, esc.lat], zoom: Math.max(mapa.getZoom(), 14), duration: 800 });
        }
        break;
      }
      case "barrio":
        verBarrioRef.current(a.nombre);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Resalta un barrio y lo encuadra (lo llama la búsqueda y también los chips
   * de barrios del panel del circuito). Prende la capa de barrios si estaba
   * apagada, así el resaltado siempre se ve.
   */
  const verBarrio = useCallback(
    (nombre: string) => {
      const b = BARRIOS.find((x) => x.nombre === nombre);
      if (!b) {
        avisar(`El barrio ${nombre} no está en el mapa oficial`);
        return;
      }
      setVerBarrios(true);
      setBarrioResaltado((actual) => (actual === nombre ? null : nombre));
      const mapa = mapRef.current?.getMap();
      mapa?.fitBounds([[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[3]]], {
        padding: { top: 90, bottom: 60, left: 60, right: 440 },
        maxZoom: 15.5,
        duration: 900,
      });
      avisar(
        `Barrio ${b.nombre} · circuito${b.circuitos.length === 1 ? "" : "s"} ${b.circuitos.map((c) => `${c.circuito} (${c.pct}%)`).join(", ")}`,
      );
    },
    [avisar],
  );
  const verBarrioRef = useRef(verBarrio);
  verBarrioRef.current = verBarrio;

  /** Abre la ficha de una escuela por nombre y la encuadra si tiene ubicación. */
  const verEscuela = useCallback(
    (nombre: string) => {
      const esc = escuelasRef.current.find((x) => x.nombre === nombre);
      if (!esc) {
        avisar(`No encuentro la escuela ${nombre}`);
        return;
      }
      setSeleccion(null);
      setEscuelaSel(esc);
      const mapa = mapRef.current?.getMap();
      if (mapa && esc.lon != null && esc.lat != null) {
        mapa.easeTo({ center: [esc.lon - 0.004, esc.lat], zoom: Math.max(mapa.getZoom(), 14.5), duration: 800 });
      } else {
        avisar(`${esc.nombre} todavía no tiene ubicación en el mapa: se abre su ficha igual`);
      }
    },
    [avisar],
  );

  const alternar3D = () => {
    const mapa = mapRef.current?.getMap();
    setVer3D((v) => {
      const nuevo = !v;
      mapa?.easeTo(nuevo ? { pitch: 58, bearing: -20, duration: 1000 } : { pitch: 0, bearing: 0, duration: 800 });
      return nuevo;
    });
  };

  // Realce del callejero: se aplica al cargar, al alternar el toggle y en cada
  // styledata — el cambio de tema dispara un setStyle que borra los ajustes, y
  // sin el listener el realce moriría tras el primer cambio de estilo.
  // aplicarCalles es idempotente, así que no hay bucle.
  useEffect(() => {
    let cancelado = false;
    const aplicar = () => {
      const mapa = mapRef.current?.getMap();
      if (!mapa) return false;
      const ok = aplicarCalles(mapa, verCalles, tema);
      if (ok) {
        setHayAnclaEtiquetas(!!mapa.getLayer("roadname_minor"));
        asegurarIconoEscuela(mapa);
      }
      return ok;
    };
    aplicar();
    const id = window.setInterval(() => {
      if (cancelado || aplicar()) window.clearInterval(id);
    }, 300);
    const mapa = mapRef.current?.getMap();
    mapa?.on("styledata", aplicar);
    return () => {
      cancelado = true;
      window.clearInterval(id);
      mapa?.off("styledata", aplicar);
    };
  }, [verCalles, tema]);

  // Elena (u otro link) acciona el mapa
  useEffect(() => {
    const alAccionar = (e: Event) => {
      const d = (e as CustomEvent<SeleccionEspacio>).detail;
      if (!d?.tipo || !d?.codigo) return;
      setEscuelaSel(null);
      setTipoActivo(d.tipo);
      setSeleccion(d);
      volarRef.current(d.tipo, d.codigo);
    };
    window.addEventListener("jxr:accionar-mapa", alAccionar);
    return () => window.removeEventListener("jxr:accionar-mapa", alAccionar);
  }, []);

  // Estado inicial por URL (?tipo=&codigo=&vista=&sexo=&franja=)
  const inicialHechoRef = useRef(false);
  useEffect(() => {
    if (!inicial || inicialHechoRef.current || !distritosGeo || !circuitosGeo) return;
    inicialHechoRef.current = true;
    if (inicial.vista) setVista(inicial.vista);
    if (inicial.sexo) setSexoFiltro(inicial.sexo);
    if (inicial.franja) setFranjaClave(inicial.franja);
    if (inicial.tipo && inicial.codigo) {
      setTipoActivo(inicial.tipo);
      setSeleccion({ tipo: inicial.tipo, codigo: inicial.codigo });
      volarRef.current(inicial.tipo, inicial.codigo);
    }
  }, [inicial, distritosGeo, circuitosGeo]);

  const alClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setSeleccion(null);
      setEscuelaSel(null);
      return;
    }
    if (f.layer.id === "escuelas-puntos" || f.layer.id === "prioridad-puntos") {
      const nombre = String(f.properties.nombre ?? "");
      const esc = escuelas.find((x) => x.nombre === nombre);
      if (esc) {
        setSeleccion(null);
        setEscuelaSel(esc);
        const mapa = mapRef.current?.getMap();
        if (esc.lon != null && esc.lat != null) {
          mapa?.easeTo({ center: [esc.lon - 0.004, esc.lat], zoom: Math.max(mapa.getZoom(), 14), duration: 800 });
        }
      }
      return;
    }
    const codigo = String(f.properties.codigo);
    setEscuelaSel(null);
    setSeleccion({ tipo: tipoActivo, codigo });
    volarRef.current(tipoActivo, codigo);
  };

  const alMover = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setHover(null);
      setHoverEscuela(null);
      setHoverPrioridad(null);
      return;
    }
    if (f.layer.id === "prioridad-puntos") {
      setHover(null);
      setHoverEscuela(null);
      setHoverPrioridad({
        nombre: String(f.properties.nombre),
        tier: String(f.properties.tier),
        votos: Number(f.properties.votos),
        referentes: Number(f.properties.referentes),
        circuito: String(f.properties.circuito),
        x: e.point.x,
        y: e.point.y,
      });
      return;
    }
    setHoverPrioridad(null);
    if (f.layer.id === "escuelas-puntos") {
      setHover(null);
      setHoverEscuela({
        nombre: String(f.properties.nombre),
        electores: Number(f.properties.electores),
        mesas: Number(f.properties.mesas),
        circuito: String(f.properties.circuito),
        x: e.point.x,
        y: e.point.y,
      });
      return;
    }
    setHoverEscuela(null);
    setHover({ codigo: String(f.properties.codigo), x: e.point.x, y: e.point.y });
  };

  // KPIs del operativo
  const kpis = useMemo(() => {
    let distritosCubiertos = 0, circuitosCubiertos = 0;
    for (const clave of porEspacio.keys()) {
      if (clave.startsWith("distrito:")) distritosCubiertos++;
      else circuitosCubiertos++;
    }
    return {
      distritosCubiertos,
      circuitosCubiertos,
      personasAsignadas: new Set(asignaciones.map((a) => a.persona_id)).size,
      tareasHechas: tareas.filter((t) => t.hecha).length,
      tareasTotal: tareas.length,
    };
  }, [porEspacio, asignaciones, tareas]);

  const resumenHover = hover ? porEspacio.get(claveEspacio(tipoActivo, hover.codigo)) : null;
  const resumenSeleccion = seleccion ? porEspacio.get(claveEspacio(seleccion.tipo, seleccion.codigo)) : null;
  const tipoContexto: TipoEspacio = tipoActivo === "distrito" ? "circuito" : "distrito";
  const c = COLORES[tema];

  /** Las capas del mapa, una sola definición para la barra y el menú "Capas". */
  const capas = [
    {
      clave: "3d",
      etiqueta: "3D",
      icono: Box,
      activa: ver3D,
      claseActiva: "bg-amarillo/20 text-amarillo",
      alternar: alternar3D,
      titulo: "Vista 3D: la altura es la métrica de la vista (cobertura, electores o votos 2023)",
    },
    ...(vista === "operativo"
      ? [
          {
            clave: "cobertura",
            etiqueta: "Cobertura",
            icono: Layers,
            activa: verCobertura,
            claseActiva: "bg-panel-3 text-texto",
            alternar: () => setVerCobertura((v) => !v),
            titulo: "Pintar cada espacio según su estado: sin asignar / en curso / completo",
          },
        ]
      : []),
    {
      clave: "avenidas",
      etiqueta: "Avenidas",
      icono: Route,
      activa: verAvenidas,
      claseActiva: "bg-panel-3 text-texto",
      alternar: () => setVerAvenidas((v) => !v),
      titulo: "Realzar avenidas y corredores principales",
    },
    {
      clave: "calles",
      etiqueta: "Calles",
      icono: Waypoints,
      activa: verCalles,
      claseActiva: "bg-panel-3 text-texto",
      alternar: () => setVerCalles((v) => !v),
      titulo: "Nombres de todas las calles al acercar el zoom (las trazas quedan siempre realzadas)",
    },
    {
      clave: "barrios",
      etiqueta: "Barrios",
      icono: Building2,
      activa: verBarrios,
      claseActiva: "bg-panel-3 text-texto",
      alternar: () => setVerBarrios((v) => !v),
      titulo: "Límites y nombres de los 327 barrios oficiales (mapa municipal)",
    },
    {
      clave: "satelite",
      etiqueta: "Satélite",
      icono: Satellite,
      activa: verSatelite,
      claseActiva: "bg-panel-3 text-texto",
      alternar: () => setVerSatelite((v) => !v),
      titulo: "Imagen satelital real (Esri) — los nombres de calles quedan encima",
    },
  ];

  const capasInteractivas =
    vista === "escuelas"
      ? ["escuelas-puntos", ver3D ? `${tipoActivo}-3d` : `${tipoActivo}-relleno`]
      : vista === "prioridad"
        ? ["prioridad-puntos", ver3D ? `${tipoActivo}-3d` : `${tipoActivo}-relleno`]
        : [ver3D ? `${tipoActivo}-3d` : `${tipoActivo}-relleno`];

  return (
    <div className="relative h-full w-full">
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 12.1 }}
        mapStyle={tema === "claro" ? ESTILO_CLARO : ESTILO_OSCURO}
        attributionControl={{ compact: true }}
        interactiveLayerIds={capasInteractivas}
        cursor={hover || hoverEscuela || hoverPrioridad ? "pointer" : "grab"}
        onClick={alClick}
        onMouseMove={alMover}
        onMouseOut={() => {
          setHover(null);
          setHoverEscuela(null);
        }}
        onLoad={(e) => {
          setHayAnclaEtiquetas(e.target.getLayer("roadname_minor") != null);
          asegurarIconoEscuela(e.target);
        }}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        <ScaleControl position="bottom-left" />

        {verSatelite && (
          <Source
            id="satelite"
            type="raster"
            tiles={["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]}
            tileSize={256}
            attribution="Esri, Maxar, Earthstar Geographics"
          >
            <Layer id="satelite-capa" type="raster" beforeId={hayAnclaEtiquetas ? "roadname_minor" : undefined} />
          </Source>
        )}

        {/* Cada Layer va suelto: react-map-gl clona los hijos del mapa para
            pasarles el contexto y a un Fragment no se le pueden pasar props. */}
        {verAvenidas && <Layer {...capaAvenidasBrillo} />}
        {verAvenidas && <Layer {...capaAvenidas} />}
        {verAvenidas && <Layer {...capaAvenidasNombre(tema)} />}

        {/* La capa activa se monta al final para dibujarse encima del contexto */}
        {([tipoContexto, tipoActivo] as const).map((tipo) => {
          const geo = geoPorTipo[tipo];
          if (!geo) return null;
          const activa = tipo === tipoActivo;
          const relleno =
            tipo === "circuito" && rangoElena
              ? capaCoropletaValor(tipo, "elenaValor", rangoElena.min, rangoElena.max, c.rampa2023)
              : vista === "padron"
              ? capaCoropleta(tipo, "electores", maxElectores, c.rampaPadron)
              : vista === "v2023"
                ? capaCoropleta(tipo, "votos2023", maxVotos2023, c.rampa2023)
                : vista === "prioridad"
                  ? capaCoropleta(tipo, "huerfanos", maxHuerfanos, c.rampa2023)
                  : vista === "oportunidad"
                    ? capaCoropleta(tipo, "oportunidad", 100, c.rampa2023)
                    : vista === "evolucion" && rangoDelta
                      ? capaCoropletaValor(tipo, "delta", rangoDelta.min, rangoDelta.max, c.rampa2023)
                      : capaRellenoOperativo(tipo, vista === "escuelas" || vista === "evolucion" ? false : verCobertura);
          const tresD =
            vista === "padron"
              ? capa3DCoropleta(tipo, "electores", maxElectores, c.rampaPadron)
              : vista === "v2023"
                ? capa3DCoropleta(tipo, "votos2023", maxVotos2023, c.rampa2023)
                : vista === "prioridad"
                  ? capa3DCoropleta(tipo, "huerfanos", maxHuerfanos, c.rampa2023)
                  : vista === "oportunidad"
                    ? capa3DCoropleta(tipo, "oportunidad", 100, c.rampa2023)
                    : capa3DOperativo(tipo);
          return (
            <Source key={tipo} id={tipo} type="geojson" data={geo}>
              {activa && !ver3D && <Layer {...relleno} />}
              {activa && ver3D && <Layer {...tresD} />}
              {/* key con `activa`: fuerza el remontaje para que la capa activa
                  quede ARRIBA (react-map-gl no reordena capas ya montadas) */}
              <Layer key={`${tipo}-glow-${activa}`} {...capaGlow(tipo, activa, tema)} />
              <Layer key={`${tipo}-casing-${activa}`} {...capaCasing(tipo, activa, tema)} />
              <Layer key={`${tipo}-linea-${activa}`} {...capaLinea(tipo, activa, tema)} />
              {activa && hover && <Layer {...capaHoverRelleno(tipo, hover.codigo, tema)} />}
              {activa && hover && <Layer {...capaHoverLinea(tipo, hover.codigo, tema)} />}
              {seleccion?.tipo === tipo && <Layer {...capaSeleccionGlow(tipo, seleccion.codigo)} />}
              {seleccion?.tipo === tipo && <Layer {...capaSeleccion(tipo, seleccion.codigo)} />}
              {/* Resaltado múltiple de Elena (solo circuitos), sin Fragment */}
              {tipo === "circuito" && capaElena?.resaltados && (
                <Layer key={`elena-glow-${capaElena.etiqueta}`} {...capaElenaGlow(capaElena.resaltados)} />
              )}
              {tipo === "circuito" && capaElena?.resaltados && (
                <Layer key={`elena-relleno-${capaElena.etiqueta}`} {...capaElenaRelleno(capaElena.resaltados)} />
              )}
              {tipo === "circuito" && capaElena?.resaltados && (
                <Layer key={`elena-linea-${capaElena.etiqueta}`} {...capaElenaLinea(capaElena.resaltados)} />
              )}
              {activa && <Layer {...capaNombre(tipo, vista, tema, tipo === "circuito" && !!rangoElena)} />}
            </Source>
          );
        })}

        {verBarrios && barriosGeo && (
          <Source id="barrios" type="geojson" data={barriosGeo}>
            {/* key con tipoActivo/ver3D: remonta la capa arriba cuando el territorio se remonta */}
            <Layer key={`barrios-linea-${tipoActivo}-${ver3D}`} {...capaBarriosLinea(tema)} />
            {/* Sin Fragment: react-map-gl clona los hijos del Source para pasarles
                el mapa, y a un Fragment no se le pueden pasar props. */}
            {barrioResaltado && <Layer key={`barrio-glow-${barrioResaltado}`} {...capaBarrioResaltadoGlow(barrioResaltado)} />}
            {barrioResaltado && <Layer key={`barrio-relleno-${barrioResaltado}`} {...capaBarrioResaltadoRelleno(barrioResaltado)} />}
            {barrioResaltado && <Layer key={`barrio-linea-${barrioResaltado}`} {...capaBarrioResaltadoLinea(barrioResaltado)} />}
            <Layer key={`barrios-nombre-${tipoActivo}-${ver3D}`} {...capaBarriosNombre(tema)} />
          </Source>
        )}

        {vista === "escuelas" && escuelasGeo.features.length > 0 && (
          <Source id="escuelas" type="geojson" data={escuelasGeo}>
            <Layer {...capaEscuelasCalor} />
            <Layer {...capaEscuelasHalo(tema)} />
            <Layer {...capaEscuelasPuntos} />
            <Layer {...capaEscuelasNombre(tema)} />
          </Source>
        )}

        {vista === "prioridad" && prioridadGeo.features.length > 0 && (
          <Source id="prioridad-escuelas" type="geojson" data={prioridadGeo}>
            <Layer {...capaPrioridadHalo(tema)} />
            <Layer {...capaPrioridadPuntos} />
          </Source>
        )}
      </MapaGL>

      {/* ── Controles del mapa ──
          Todo en UNA columna: con dos bloques absolutos de `top` fijo, al
          envolverse la primera fila en pantallas chicas la segunda quedaba
          encima. Así las filas se apilan solas en cualquier ancho. */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 z-10 flex flex-col items-start gap-1.5">
        <div className="flex w-full flex-wrap items-center gap-2">
        {/* Vistas: deslizables cuando no caben, en lugar de cortarse */}
        <div className="panel-vidrio pointer-events-auto flex max-w-full overflow-x-auto rounded-xl text-xs font-bold">
          {(Object.keys(VISTAS) as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              title={VISTAS[v].descripcion}
              className={`shrink-0 px-3 py-2 transition ${vista === v ? "bg-rosa/25 text-rosa" : "text-texto-3 hover:text-texto"}`}
            >
              {VISTAS[v].etiqueta}
            </button>
          ))}
        </div>

        <div className="panel-vidrio pointer-events-auto flex overflow-hidden rounded-xl text-xs font-bold">
          {(["distrito", "circuito"] as const).map((t) => (
            <button
              key={t}
              onClick={() => vista === "operativo" && setTipoActivo(t)}
              disabled={vista !== "operativo" && t === "distrito"}
              title={vista !== "operativo" && t === "distrito" ? "El padrón y los resultados se organizan por circuito" : undefined}
              className={`px-3 py-2 transition disabled:cursor-not-allowed disabled:opacity-30 ${
                tipoActivo === t
                  ? t === "distrito"
                    ? "bg-distrito/20 text-distrito"
                    : "bg-circuito/20 text-circuito"
                  : "text-texto-3 hover:text-texto"
              }`}
            >
              {t === "distrito" ? "Distritos" : "Circuitos"}
            </button>
          ))}
        </div>

        {/* Capas: en línea cuando hay ancho; si no, detrás del botón "Capas" */}
        <div className="panel-vidrio pointer-events-auto hidden items-center gap-1 rounded-xl p-1 text-xs xl:flex">
          {capas.map((c) => (
            <button
              key={c.clave}
              onClick={c.alternar}
              title={c.titulo}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
                c.activa ? c.claseActiva : "text-texto-3 hover:text-texto"
              }`}
            >
              <c.icono size={12} /> {c.etiqueta}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto relative xl:hidden">
          <button
            onClick={() => setMenuCapas((v) => !v)}
            title="Capas del mapa: 3D, cobertura, avenidas, calles, barrios y satélite"
            className={`panel-vidrio flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
              menuCapas ? "text-rosa" : "text-texto-2"
            }`}
          >
            <Layers size={12} /> Capas
            <span className="num rounded-full bg-panel-3 px-1.5 text-[10px]">{capas.filter((c) => c.activa).length}</span>
          </button>
          {menuCapas && (
            <div className="panel-solido absolute top-full left-0 z-30 mt-1 flex w-48 flex-col gap-0.5 rounded-xl p-1 text-xs">
              {capas.map((c) => (
                <button
                  key={c.clave}
                  onClick={c.alternar}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold transition ${
                    c.activa ? c.claseActiva : "text-texto-3 hover:bg-panel-3 hover:text-texto"
                  }`}
                >
                  <c.icono size={13} /> {c.etiqueta}
                  {c.activa && <Check size={12} className="ml-auto" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <BusquedaInteligente supabase={supabase} escuelas={escuelas} barrios={BARRIOS} onAccion={ejecutarAccion} onAviso={avisar} />
        </div>

      {/* ── Segunda fila: KPIs + microsegmentación (misma columna que la barra) ── */}
      <div className="flex w-full flex-wrap items-center gap-2">
        {/* Flota sobre el mapa: las cifras van en una línea con separadores finos,
            no apiladas, para no comerle alto al mapa. */}
        <div className="panel-vidrio pointer-events-auto flex max-w-full items-center overflow-x-auto rounded-xl px-3 py-2 text-xs sm:px-4 [&>span]:border-l [&>span]:border-borde [&>span]:px-3 [&>span]:first:border-l-0 [&>span]:first:pl-0 sm:[&>span]:px-3.5">
          {resumen && (
            <span className="shrink-0 whitespace-nowrap" title="Electores del padrón de la Capital">
              <span className="num font-bold text-texto">{numero(resumen.total)}</span>
              <span className="text-texto-3"> electores</span>
            </span>
          )}
          <span className="shrink-0 whitespace-nowrap" title="Distritos con al menos una persona asignada">
            <span className="num font-bold text-distrito">{kpis.distritosCubiertos}</span>
            <span className="text-texto-3">/20 distritos</span>
          </span>
          <span className="shrink-0 whitespace-nowrap" title="Circuitos con al menos una persona asignada">
            <span className="num font-bold text-circuito">{kpis.circuitosCubiertos}</span>
            <span className="text-texto-3">/47 circuitos</span>
          </span>
          <span className="shrink-0 whitespace-nowrap" title="Personas con al menos un espacio asignado">
            <span className="num font-bold text-rosa">{kpis.personasAsignadas}</span>
            <span className="text-texto-3">
              {" "}
              {kpis.personasAsignadas === 1 ? "persona" : "personas"}
            </span>
          </span>
          <span className="shrink-0 whitespace-nowrap" title="Tareas completadas sobre el total del checklist">
            <span className="num font-bold text-amarillo">{kpis.tareasHechas}</span>
            <span className="text-texto-3">/{kpis.tareasTotal} tareas</span>
          </span>
        </div>

        {vista === "padron" && (
          <div className="panel-vidrio pointer-events-auto flex items-center gap-1.5 rounded-xl p-1 text-[11px]">
            {([null, "F", "M"] as const).map((s) => (
              <button
                key={s ?? "todos"}
                onClick={() => setSexoFiltro(s)}
                className={`rounded-lg px-2 py-1 font-semibold transition ${
                  sexoFiltro === s ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
                }`}
              >
                {s === null ? "Todos" : s === "F" ? "Mujeres" : "Varones"}
              </button>
            ))}
            <span className="h-4 w-px bg-borde-2" />
            <select
              value={franjaClave}
              onChange={(e) => setFranjaClave(e.target.value)}
              title="Franja etaria estimada por rango de DNI (±3 años)"
              className="rounded-lg bg-panel-2 px-1.5 py-1 text-[11px] outline-none"
            >
              {FRANJAS.map((f) => (
                <option key={f.clave} value={f.clave}>
                  {f.etiqueta}
                </option>
              ))}
            </select>
          </div>
        )}

        {vista === "prioridad" && prioridad !== null && (
          <div className="panel-vidrio pointer-events-auto flex items-center gap-3 rounded-xl px-3 py-1.5 text-[11px]">
            <span>
              Frontera: <b className="num text-rosa">{kpisPrioridad.frontera}</b> escuelas ·{" "}
              <b className="num">{numero(kpisPrioridad.votosFrontera)}</b> votos
            </span>
            <span className="h-4 w-px bg-borde-2" />
            <span title="Votos dispersos 2023 en circuitos sin ningún referente asignado">
              <b className="num text-sin">{numero(kpisPrioridad.huerfanos)}</b> huérfanos
            </span>
          </div>
        )}

        {vista === "oportunidad" && topOportunidad.length > 0 && (
          <div className="panel-vidrio pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl px-3 py-1.5 text-[11px]">
            <span className="shrink-0 text-texto-3">Dónde invertir primero:</span>
            {topOportunidad.map((f) => (
              <button
                key={f.circuito}
                onClick={() => seleccionarCircuito(f.circuito)}
                className="num shrink-0 rounded-full border border-rosa/40 px-2 py-0.5 font-bold text-rosa transition hover:border-rosa"
                title={`IO ${f.indice} · ${numero(f.votosDisperso)} dispersos 2023 · bolsa ${Math.round(f.bolsaPct)}% · clic para abrirlo`}
              >
                {f.circuito} · {f.indice}
              </button>
            ))}
          </div>
        )}

        {vista === "evolucion" && listas23 && listas25 && (
          <div className="panel-vidrio pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-xl p-1.5 text-[11px]">
            <select
              value={sel23 ?? ""}
              onChange={(e) => setSel23(Number(e.target.value))}
              title="Lista 2023 (Concejal) contra la que se compara"
              className="max-w-[46vw] rounded-lg bg-panel-2 px-1.5 py-1 text-[11px] outline-none sm:max-w-56"
            >
              {listas23.map((l) => (
                <option key={l.lista_id} value={l.lista_id}>
                  2023 · {l.lista_id} {l.lista}
                </option>
              ))}
            </select>
            <span className="text-texto-3">→</span>
            <select
              value={sel25 ?? ""}
              onChange={(e) => setSel25(Number(e.target.value))}
              title="Agrupación 2025 (Diputados, provisorio)"
              className="max-w-[46vw] rounded-lg bg-panel-2 px-1.5 py-1 text-[11px] outline-none sm:max-w-56"
            >
              {listas25.map((l) => (
                <option key={l.lista_id} value={l.lista_id}>
                  2025 · {l.lista}
                </option>
              ))}
            </select>
            {deltas === null && <span className="text-texto-3">calculando…</span>}
          </div>
        )}

        {vista === "escuelas" && escuelasMin > 0 && (
          <div className="panel-vidrio pointer-events-auto flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px]">
            <span>
              Escuelas con ≥ <b className="num">{numero(escuelasMin)}</b> electores
            </span>
            <button onClick={() => setEscuelasMin(0)} className="font-bold text-rosa hover:underline">
              quitar filtro
            </button>
          </div>
        )}
        </div>

        {/* ── Análisis de Elena activo sobre el mapa ── */}
        {capaElena && (
          <div className="panel-vidrio pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border-amarillo/50 px-3 py-1.5 text-[11px]">
            <Sparkles size={12} className="shrink-0 text-amarillo" />
            <span className="min-w-0 truncate">
              <b>Elena:</b> {capaElena.etiqueta}
              {capaElena.resaltados ? ` · ${capaElena.resaltados.length} circuitos` : ""}
              {rangoElena ? ` · ${numero(rangoElena.min)} a ${numero(rangoElena.max)}` : ""}
            </span>
            <button
              onClick={() => setCapaElena(null)}
              title="Quitar el análisis de Elena del mapa"
              className="shrink-0 text-texto-3 transition hover:text-texto"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* ── Aviso de la búsqueda/acciones ── */}
      {aviso && (
        <div className="panel-vidrio pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-xl border-rosa/40 px-4 py-2 text-xs font-bold text-rosa">
          {aviso}
        </div>
      )}

      {/* ── Leyenda ──
          Se puede colapsar: en pantallas chicas tapaba buena parte del mapa,
          así que arranca cerrada ahí y abierta cuando hay lugar. */}
      {!verLeyenda && (
        <button
          onClick={() => setVerLeyenda(true)}
          title="Mostrar la leyenda del mapa"
          className="panel-vidrio absolute bottom-8 left-3 z-10 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[10px] font-bold text-texto-2"
        >
          <Info size={11} /> Leyenda
        </button>
      )}
      <div
        className={`panel-vidrio absolute bottom-8 left-3 z-10 max-w-64 rounded-xl px-3 py-2.5 text-[10px] leading-relaxed ${verLeyenda ? "" : "hidden"}`}
      >
        <button
          onClick={() => setVerLeyenda(false)}
          title="Ocultar la leyenda"
          className="absolute top-1.5 right-1.5 text-texto-3 transition hover:text-texto"
        >
          <X size={11} />
        </button>
        {rangoElena && (
          <>
            <div className="mb-1 font-bold tracking-wide text-amarillo uppercase">Elena · {capaElena?.etiqueta}</div>
            <div
              className="h-2 w-full rounded-sm"
              style={{
                background:
                  rangoElena.min < 0
                    ? "linear-gradient(90deg,#e14f42,#6b7280,#22c55e)"
                    : `linear-gradient(90deg,${c.rampa2023[0]},${c.rampa2023[1]},${c.rampa2023[2]})`,
              }}
            />
            <div className="flex justify-between text-texto-3"><span>{numero(rangoElena.min)}</span><span>{numero(rangoElena.max)}</span></div>
            <div className="mb-1.5 border-b border-borde pb-1.5 text-texto-3">Coropleta pedida en el chat (tapa la de la vista)</div>
          </>
        )}
        {vista === "operativo" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Cobertura</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-sin/70" /> Sin asignar</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-encurso/80" /> En curso</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-completo" /> Checklist completo</div>
          </>
        )}
        {vista === "padron" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Electores por circuito</div>
            <div className="h-2 w-full rounded-sm" style={{ background: `linear-gradient(90deg,${c.rampaPadron[0]},${c.rampaPadron[1]},${c.rampaPadron[2]})` }} />
            <div className="flex justify-between text-texto-3"><span>0</span><span>{numero(maxElectores)}</span></div>
            <div className="mt-1 text-texto-3">Franjas etarias estimadas por DNI (±3 años)</div>
          </>
        )}
        {vista === "v2023" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Voto disperso 2023 · Concejal</div>
            <div className="h-2 w-full rounded-sm" style={{ background: `linear-gradient(90deg,${c.rampa2023[0]},${c.rampa2023[1]},${c.rampa2023[2]})` }} />
            <div className="flex justify-between text-texto-3"><span>0</span><span>{numero(maxVotos2023)}</span></div>
            <div className="mt-1 text-texto-3">Listas según la selección de Estrategia</div>
          </>
        )}
        {vista === "prioridad" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Frontera 20K · Prioridad</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_TIER.A }} /> Tier A: dentro de la frontera de {numero(META_VOTOS)}</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_TIER.B }} /> Tier B: siguiente anillo</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_TIER.C }} /> Tier C: resto</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-sin" /> Borde rojo = circuito sin referente</div>
            <div className="mt-1">Relleno del circuito = votos huérfanos</div>
            <div className="h-2 w-full rounded-sm" style={{ background: `linear-gradient(90deg,${c.rampa2023[0]},${c.rampa2023[1]},${c.rampa2023[2]})` }} />
            <div className="flex justify-between text-texto-3"><span>0</span><span>{numero(maxHuerfanos)}</span></div>
          </>
        )}
        {vista === "oportunidad" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Índice de Oportunidad (0–100)</div>
            <div className="h-2 w-full rounded-sm" style={{ background: `linear-gradient(90deg,${c.rampa2023[0]},${c.rampa2023[1]},${c.rampa2023[2]})` }} />
            <div className="flex justify-between text-texto-3"><span>0</span><span>100</span></div>
            <div className="mt-1 text-texto-3">
              40% voto disperso 2023 · 35% bolsa 2025 (blancos + ausentes) · 25% competitividad 2025.
              Alto = mucha base propia potencial, muchos votos sin dueño y elección peleada.
            </div>
          </>
        )}
        {vista === "evolucion" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Evolución 2023 → 2025</div>
            <div
              className="h-2 w-full rounded-sm"
              style={{
                background:
                  rangoDelta && rangoDelta.min < 0
                    ? "linear-gradient(90deg,#e14f42,#6b7280,#22c55e)"
                    : `linear-gradient(90deg,${c.rampa2023[0]},${c.rampa2023[1]},${c.rampa2023[2]})`,
              }}
            />
            <div className="flex justify-between text-texto-3">
              <span>{rangoDelta ? `${conSigno(rangoDelta.min)} pts` : "cae"}</span>
              <span>{rangoDelta ? `${conSigno(rangoDelta.max)} pts` : "crece"}</span>
            </div>
            <div className="mt-1 text-texto-3">
              Puntos de % que la agrupación 2025 saca por encima o debajo de la lista 2023 en cada circuito.
              {rangoDelta && rangoDelta.min < 0
                ? " Verde = creció, rojo = cayó."
                : " Creció en todos los circuitos: más oscuro = creció más."}{" "}
              Elecciones distintas: leer como tendencia. 2025 es provisorio.
            </div>
          </>
        )}
        {vista === "escuelas" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Escuelas de votación</div>
            <div className="flex items-center gap-1.5">🏫 Tamaño = electores que votan ahí</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-rosa bg-rosa/40" /> Anillo rosa = en la estrategia</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm" style={{ background: "linear-gradient(90deg,rgba(225,79,130,0),#e14f82)" }} /> Calor = concentración</div>
            <div className="mt-1 text-texto-3">
              {escuelas.filter((e) => e.lat != null).length}/{escuelas.length} escuelas geocodificadas
              {escuelas.some((e) => e.lat == null) ? " (el resto cuenta en tablas y análisis)" : ""}
            </div>
            <div className="mt-1 text-texto-3">Clic en una escuela: padrón, mesas y resultados 2023</div>
          </>
        )}
        <div className="mt-1.5 border-t border-borde pt-1.5">
          <div className="flex items-center gap-1.5"><span className="inline-block w-4" style={{ borderTop: `3px solid ${c.distrito}` }} /> Distritos</div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-4" style={{ borderTop: `3px solid ${c.circuito}` }} /> Circuitos</div>
        </div>
        {ver3D && (
          <div className="mt-1.5 border-t border-borde pt-1.5 text-texto-3">
            Altura 3D = {vista === "padron" ? "electores" : vista === "v2023" ? "votos dispersos 2023" : "personas + tareas pendientes"}
          </div>
        )}
      </div>

      {/* ── Tooltips ── */}
      {hover && (
        <div
          className="panel-vidrio pointer-events-none absolute z-20 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ left: hover.x + 14, top: hover.y + 10 }}
        >
          <div className="font-bold">{etiquetaEspacio(tipoActivo, hover.codigo)}</div>
          {/* Ficha completa al pasar: todo lo ya cargado, no solo lo de la vista */}
          <div className="space-y-0.5 text-texto-2">
            {tipoActivo === "circuito" && padronCirc.has(hover.codigo) && (
              <div>
                <b className="num text-texto">{numero(padronCirc.get(hover.codigo) ?? 0)}</b> electores
                {sexoFiltro || franjaClave !== "todas" ? " (filtro activo)" : ""}
              </div>
            )}
            {tipoActivo === "circuito" && capaElena?.valores?.has(hover.codigo) && (
              <div>
                <b className="num text-amarillo">{numero(capaElena.valores.get(hover.codigo) ?? 0)}</b> {capaElena.etiqueta}
              </div>
            )}
            {tipoActivo === "circuito" && votos2023?.has(hover.codigo) && (
              <div>
                <b className="num text-rosa">{numero(votos2023.get(hover.codigo) ?? 0)}</b> votos dispersos 2023
              </div>
            )}
            {tipoActivo === "circuito" && vista === "oportunidad" && oportunidad?.has(hover.codigo) && (() => {
              const f = oportunidad.get(hover.codigo)!;
              return (
                <div>
                  <div>
                    <b className="num text-rosa">IO {f.indice}</b> · {numero(f.votosDisperso)} dispersos 2023
                  </div>
                  <div>
                    bolsa 2025: <b className="num">{numero(f.blancos2025 + f.ausentes2025)}</b> ({Math.round(f.bolsaPct)}%) ·{" "}
                    {f.ganador2025} +{numero(f.diferencia2025)}
                  </div>
                </div>
              );
            })()}
            {tipoActivo === "circuito" && vista === "evolucion" && deltas?.has(hover.codigo) && (() => {
              const f = deltas.get(hover.codigo)!;
              const d = Number(f.delta_pct);
              return (
                <div>
                  <b className={`num ${d >= 0 ? "text-completo" : "text-sin"}`}>{d >= 0 ? "+" : ""}{d} pts</b>{" "}
                  <span className="text-texto-3">
                    ({f.pct_2023}% → {f.pct_2025}%)
                  </span>
                </div>
              );
            })()}
            {tipoActivo === "circuito" && prioridad !== null && (huerfanosCirc.get(hover.codigo) ?? 0) > 0 && (
              <div>
                <b className="num text-sin">{numero(huerfanosCirc.get(hover.codigo) ?? 0)}</b> huérfanos (sin referente)
              </div>
            )}
            <div>
              {resumenHover
                ? `${resumenHover.asignaciones.length} persona${resumenHover.asignaciones.length === 1 ? "" : "s"} · tareas ${resumenHover.nHechas}/${resumenHover.tareas.length}`
                : "Sin asignar — clic para asignar"}
            </div>
          </div>
        </div>
      )}
      {hoverPrioridad && (
        <div
          className="panel-vidrio pointer-events-none absolute z-20 max-w-72 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ left: hoverPrioridad.x + 14, top: hoverPrioridad.y + 10 }}
        >
          <div className="flex items-center gap-1.5 font-bold">
            <span className="rounded-full px-1.5 text-[9px] font-extrabold text-white" style={{ background: COLOR_TIER[hoverPrioridad.tier] ?? "#6b7280" }}>
              {hoverPrioridad.tier}
            </span>
            {hoverPrioridad.nombre}
          </div>
          <div className="text-texto-2">
            {numero(hoverPrioridad.votos)} votos dispersos · Circuito {hoverPrioridad.circuito}
            {hoverPrioridad.referentes === 0 ? " · SIN referente" : ` · ${hoverPrioridad.referentes} referente${hoverPrioridad.referentes === 1 ? "" : "s"}`}
          </div>
          <div className="text-[10px] text-rosa">Clic: panel de la escuela</div>
        </div>
      )}
      {hoverEscuela && (
        <div
          className="panel-vidrio pointer-events-none absolute z-20 max-w-72 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ left: hoverEscuela.x + 14, top: hoverEscuela.y + 10 }}
        >
          <div className="font-bold">{hoverEscuela.nombre}</div>
          <div className="text-texto-2">
            {numero(hoverEscuela.electores)} electores · {hoverEscuela.mesas} mesas · Circuito {hoverEscuela.circuito}
          </div>
          <div className="text-[10px] text-rosa">Clic: padrón + resultados 2023 de la escuela</div>
        </div>
      )}

      {/* ── Paneles laterales ── */}
      {escuelaSel && (
        <PanelEscuela
          supabase={supabase}
          escuela={escuelaSel}
          usuarioId={usuarioId}
          onVerCircuito={seleccionarCircuito}
          onCambioEstrategia={(nombre, incluida) =>
            setEnEstrategia((prev) => {
              const nuevo = new Set(prev);
              if (incluida) nuevo.add(nombre);
              else nuevo.delete(nombre);
              return nuevo;
            })
          }
          onCerrar={() => setEscuelaSel(null)}
        />
      )}
      {seleccion && !escuelaSel && (
        <PanelEspacio
          seleccion={seleccion}
          resumen={resumenSeleccion ?? null}
          territorio={territorio}
          escuelasUbicadas={escuelasUbicadas}
          barrioResaltado={barrioResaltado}
          onVerBarrio={verBarrio}
          onVerEscuela={verEscuela}
          onCerrar={() => {
            setSeleccion(null);
            setBarrioResaltado(null);
          }}
        />
      )}
    </div>
  );
}

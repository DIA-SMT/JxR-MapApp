"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Box, Layers, Route, Satellite, Waypoints } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { FilterSpecification } from "maplibre-gl";
import { claveEspacio, useTerritorio } from "@/lib/territorio";
import { etiquetaEspacio } from "@/lib/espacios";
import {
  FRANJAS,
  obtenerEscuelas,
  obtenerListas2023,
  obtenerPadronPorCircuito,
  obtenerResumenPadron,
  obtenerVotosPorCircuito2023,
  type Escuela,
  type ResumenPadron,
} from "@/lib/padron";
import { leerSeleccion, presetPeronismoDisperso } from "@/lib/estrategia";
import type { TipoEspacio } from "@/lib/tipos";
import { BuscadorElectores } from "./buscador-electores";
import { PanelEspacio } from "./panel-espacio";

/** Capas de territorio: polígonos de distritos y circuitos electorales. */
type FCPoligono = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
type FCPuntos = FeatureCollection<Point, Record<string, unknown>>;

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];
const ESTILO_MAPA =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const COLOR_TERRITORIO: Record<TipoEspacio, string> = {
  distrito: "#a78bfa",
  circuito: "#34d399",
};

/**
 * Vistas del mapa comando (el patrón de CIMBA: cada vista prende solo las
 * capas que sirven para esa tarea):
 *  · Operativo — cobertura de asignaciones y checklist.
 *  · Padrón — densidad de electores por circuito (con microsegmentación).
 *  · Escuelas — establecimientos de votación y concentración de electorado.
 *  · 2023 — voto disperso del escrutinio 2023 por circuito (estrategia).
 */
const VISTAS = {
  operativo: { etiqueta: "Operativo", descripcion: "Cobertura del operativo: asignaciones y tareas" },
  padron: { etiqueta: "Padrón", descripcion: "Densidad de electores por circuito (filtrable por sexo y franja etaria estimada)" },
  escuelas: { etiqueta: "Escuelas", descripcion: "Escuelas de votación: dónde se concentra el electorado" },
  v2023: { etiqueta: "2023", descripcion: "Voto disperso 2023 (Concejal) por circuito, según la selección de listas de Estrategia" },
} as const;
type Vista = keyof typeof VISTAS;

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
const capaAvenidasNombre: LayerProps = {
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
    "text-color": "#7cc4e8",
    "text-opacity": 0.85,
    "text-halo-color": "#070a10",
    "text-halo-width": 1.8,
  },
};

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

/** Coropleta genérica (padrón/2023): rampa secuencial sobre fondo oscuro. */
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

/** 3D de coropletas: la altura es la métrica (electores / votos dispersos). */
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

// ── Límites BIEN marcados: brillo + casing oscuro + línea sólida ─────────────
const capaGlow = (tipo: TipoEspacio, activa: boolean): LayerProps => ({
  id: `${tipo}-glow`,
  type: "line",
  source: tipo,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": COLOR_TERRITORIO[tipo],
    "line-opacity": activa ? 0.38 : 0.14,
    "line-blur": 5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, activa ? 7 : 4, 14, activa ? 12 : 6, 17, activa ? 18 : 9],
  },
});
const capaCasing = (tipo: TipoEspacio, activa: boolean): LayerProps => ({
  id: `${tipo}-casing`,
  type: "line",
  source: tipo,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#05070c",
    "line-opacity": activa ? 0.9 : 0.55,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, activa ? 4 : 2.2, 14, activa ? 6.5 : 3.2, 17, activa ? 9 : 4.5],
  },
});
const capaLinea = (tipo: TipoEspacio, activa: boolean): LayerProps => ({
  id: `${tipo}-linea`,
  type: "line",
  source: tipo,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": COLOR_TERRITORIO[tipo],
    "line-opacity": activa ? 0.95 : 0.5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, activa ? 1.8 : 1, 14, activa ? 3.2 : 1.6, 17, activa ? 5 : 2.4],
    ...(activa ? {} : { "line-dasharray": tipo === "distrito" ? [4, 2] : [1, 1.6] }),
  },
});

const capaNombre = (tipo: TipoEspacio, vista: Vista): LayerProps => {
  let campo: unknown;
  if (tipo === "distrito") {
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
      "text-color": vista === "v2023" && tipo === "circuito" ? "#ffb3cd" : COLOR_TERRITORIO[tipo],
      "text-halo-color": "#05070c",
      "text-halo-width": 2.2,
      "text-halo-blur": 0.5,
    },
  };
};

const capaHoverRelleno = (tipo: TipoEspacio, codigo: string): LayerProps => ({
  id: `${tipo}-hover-relleno`,
  type: "fill",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  paint: { "fill-color": "#edf2fa", "fill-opacity": 0.09 },
});
const capaHoverLinea = (tipo: TipoEspacio, codigo: string): LayerProps => ({
  id: `${tipo}-hover-linea`,
  type: "line",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": "#edf2fa", "line-width": 2.6, "line-opacity": 0.85 },
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
      0, "rgba(61,21,39,0)",
      0.3, "#7c2547",
      0.6, "#c93f6d",
      0.85, "#e14f82",
      1, "#ffd6e4",
    ],
  },
};
const capaEscuelasPuntos: LayerProps = {
  id: "escuelas-puntos",
  type: "circle",
  source: "escuelas",
  paint: {
    "circle-color": "#2eb1ff",
    "circle-opacity": 0.92,
    "circle-radius": ["interpolate", ["linear"], ["get", "electores"], 500, 4.5, 3000, 8, 6000, 12, 9500, 17],
    "circle-stroke-width": 1.5,
    "circle-stroke-color": "#05070c",
  },
};
const capaEscuelasNombre: LayerProps = {
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
  paint: { "text-color": "#9fd3f5", "text-halo-color": "#05070c", "text-halo-width": 1.6 },
};

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

export interface SeleccionEspacio {
  tipo: TipoEspacio;
  codigo: string;
}

export function MapaElectoral({ inicial }: { inicial?: SeleccionEspacio | null }) {
  const mapRef = useRef<MapRef>(null);
  const territorio = useTerritorio();
  const { supabase, asignaciones, tareas, porEspacio } = territorio;

  const [vista, setVista] = useState<Vista>("operativo");
  const [tipoActivo, setTipoActivo] = useState<TipoEspacio>("circuito");
  const [seleccion, setSeleccion] = useState<SeleccionEspacio | null>(null);
  const [hover, setHover] = useState<{ codigo: string; x: number; y: number } | null>(null);
  const [hoverEscuela, setHoverEscuela] = useState<{ nombre: string; electores: number; mesas: number; circuito: string; x: number; y: number } | null>(null);
  const [verCobertura, setVerCobertura] = useState(true);
  const [ver3D, setVer3D] = useState(false);
  const [verSatelite, setVerSatelite] = useState(false);
  const [verAvenidas, setVerAvenidas] = useState(true);
  const [verCalles, setVerCalles] = useState(true);
  const [hayAnclaEtiquetas, setHayAnclaEtiquetas] = useState(true);

  // Microsegmentación del padrón (vista Padrón)
  const [sexoFiltro, setSexoFiltro] = useState<"F" | "M" | null>(null);
  const [franjaClave, setFranjaClave] = useState("todas");

  // Datos del padrón / escuelas / 2023
  const [resumen, setResumen] = useState<ResumenPadron | null>(null);
  const [padronCirc, setPadronCirc] = useState<Map<string, number>>(new Map());
  const [escuelas, setEscuelas] = useState<Escuela[]>([]);
  const [votos2023, setVotos2023] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    void obtenerResumenPadron(supabase).then(setResumen);
    void obtenerEscuelas(supabase).then(setEscuelas);
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

  // Voto disperso 2023 (Concejal): usa la selección guardada en Estrategia o el preset
  useEffect(() => {
    if (vista !== "v2023" || votos2023 !== null) return;
    void (async () => {
      let listas = leerSeleccion("CONCEJAL");
      if (!listas || listas.length === 0) {
        const todas = await obtenerListas2023(supabase, "CONCEJAL");
        listas = presetPeronismoDisperso(todas);
      }
      const filas = await obtenerVotosPorCircuito2023(supabase, "CONCEJAL", listas);
      setVotos2023(new Map(filas.map((f) => [f.circuito, Number(f.votos)])));
    })();
  }, [vista, votos2023, supabase]);

  // Las vistas de datos electorales trabajan por circuito (el padrón es por circuito)
  useEffect(() => {
    if (vista !== "operativo" && tipoActivo !== "circuito") setTipoActivo("circuito");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  // GeoJSON crudos
  const [distritosGeo, setDistritosGeo] = useState<FCPoligono | null>(null);
  const [circuitosGeo, setCircuitosGeo] = useState<FCPoligono | null>(null);
  useEffect(() => {
    fetch("/data/distritos.json").then((r) => r.json()).then(setDistritosGeo).catch(() => {});
    fetch("/data/circuitos.json").then((r) => r.json()).then(setCircuitosGeo).catch(() => {});
  }, []);

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
          },
        };
      }),
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const distritos = useMemo(() => enriquecer(distritosGeo, "distrito"), [distritosGeo, porEspacio, padronCirc, votos2023]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const circuitos = useMemo(() => enriquecer(circuitosGeo, "circuito"), [circuitosGeo, porEspacio, padronCirc, votos2023]);
  const geoPorTipo: Record<TipoEspacio, FCPoligono | null> = { distrito: distritos, circuito: circuitos };

  const maxElectores = useMemo(() => Math.max(1, ...padronCirc.values()), [padronCirc]);
  const maxVotos2023 = useMemo(() => Math.max(1, ...(votos2023?.values() ?? [1])), [votos2023]);

  const escuelasGeo = useMemo<FCPuntos>(
    () => ({
      type: "FeatureCollection",
      features: escuelas
        .filter((e) => e.lat != null && e.lon != null)
        .map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lon as number, e.lat as number] },
          properties: { nombre: e.nombre, electores: e.electores, mesas: e.mesas ?? 0, circuito: e.circuito ?? "" },
        })),
    }),
    [escuelas],
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

  const seleccionarCircuito = (codigo: string) => {
    setTipoActivo("circuito");
    setSeleccion({ tipo: "circuito", codigo });
    volarRef.current("circuito", codigo);
  };

  const alternar3D = () => {
    const mapa = mapRef.current?.getMap();
    setVer3D((v) => {
      const nuevo = !v;
      mapa?.easeTo(nuevo ? { pitch: 58, bearing: -20, duration: 1000 } : { pitch: 0, bearing: 0, duration: 800 });
      return nuevo;
    });
  };

  // Calles del mapa base (teselas carto): prender/apagar
  useEffect(() => {
    const mapa = mapRef.current?.getMap();
    if (!mapa || !mapa.isStyleLoaded()) return;
    try {
      for (const capa of mapa.getStyle().layers ?? []) {
        const sl = (capa as { "source-layer"?: string })["source-layer"];
        if (sl === "transportation" && capa.type !== "symbol") {
          mapa.setLayoutProperty(capa.id, "visibility", verCalles ? "visible" : "none");
        }
      }
    } catch {
      // el estilo puede no estar listo: el toggle vuelve a intentar en el próximo cambio
    }
  }, [verCalles]);

  // Migue (u otro link) acciona el mapa
  useEffect(() => {
    const alAccionar = (e: Event) => {
      const d = (e as CustomEvent<SeleccionEspacio>).detail;
      if (!d?.tipo || !d?.codigo) return;
      setTipoActivo(d.tipo);
      setSeleccion(d);
      volarRef.current(d.tipo, d.codigo);
    };
    window.addEventListener("jxr:accionar-mapa", alAccionar);
    return () => window.removeEventListener("jxr:accionar-mapa", alAccionar);
  }, []);

  // Selección inicial por URL (?tipo=&codigo=)
  const inicialHechoRef = useRef(false);
  useEffect(() => {
    if (!inicial || inicialHechoRef.current || !distritosGeo || !circuitosGeo) return;
    inicialHechoRef.current = true;
    setTipoActivo(inicial.tipo);
    setSeleccion(inicial);
    volarRef.current(inicial.tipo, inicial.codigo);
  }, [inicial, distritosGeo, circuitosGeo]);

  const alClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setSeleccion(null);
      return;
    }
    if (f.layer.id === "escuelas-puntos") {
      const circ = String(f.properties.circuito ?? "");
      if (circ) seleccionarCircuito(circ);
      return;
    }
    const codigo = String(f.properties.codigo);
    setSeleccion({ tipo: tipoActivo, codigo });
    volarRef.current(tipoActivo, codigo);
  };

  const alMover = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setHover(null);
      setHoverEscuela(null);
      return;
    }
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

  const capasInteractivas =
    vista === "escuelas"
      ? ["escuelas-puntos", ver3D ? `${tipoActivo}-3d` : `${tipoActivo}-relleno`]
      : [ver3D ? `${tipoActivo}-3d` : `${tipoActivo}-relleno`];

  return (
    <div className="relative h-full w-full">
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 12.1 }}
        mapStyle={ESTILO_MAPA}
        attributionControl={{ compact: true }}
        interactiveLayerIds={capasInteractivas}
        cursor={hover || hoverEscuela ? "pointer" : "grab"}
        onClick={alClick}
        onMouseMove={alMover}
        onMouseOut={() => {
          setHover(null);
          setHoverEscuela(null);
        }}
        onLoad={(e) => setHayAnclaEtiquetas(e.target.getLayer("roadname_minor") != null)}
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

        {verAvenidas && (
          <>
            <Layer {...capaAvenidasBrillo} />
            <Layer {...capaAvenidas} />
            <Layer {...capaAvenidasNombre} />
          </>
        )}

        {/* La capa activa se monta al final para dibujarse encima del contexto */}
        {([tipoContexto, tipoActivo] as const).map((tipo) => {
          const geo = geoPorTipo[tipo];
          if (!geo) return null;
          const activa = tipo === tipoActivo;
          const relleno =
            vista === "padron"
              ? capaCoropleta(tipo, "electores", maxElectores, ["#0e2a52", "#3987e5", "#cde2fb"])
              : vista === "v2023"
                ? capaCoropleta(tipo, "votos2023", maxVotos2023, ["#471527", "#e14f82", "#ffd6e4"])
                : capaRellenoOperativo(tipo, vista === "escuelas" ? false : verCobertura);
          const tresD =
            vista === "padron"
              ? capa3DCoropleta(tipo, "electores", maxElectores, ["#0e2a52", "#3987e5", "#cde2fb"])
              : vista === "v2023"
                ? capa3DCoropleta(tipo, "votos2023", maxVotos2023, ["#471527", "#e14f82", "#ffd6e4"])
                : capa3DOperativo(tipo);
          return (
            <Source key={tipo} id={tipo} type="geojson" data={geo}>
              {activa && !ver3D && <Layer {...relleno} />}
              {activa && ver3D && <Layer {...tresD} />}
              <Layer {...capaGlow(tipo, activa)} />
              <Layer {...capaCasing(tipo, activa)} />
              <Layer {...capaLinea(tipo, activa)} />
              {activa && hover && <Layer {...capaHoverRelleno(tipo, hover.codigo)} />}
              {activa && hover && <Layer {...capaHoverLinea(tipo, hover.codigo)} />}
              {seleccion?.tipo === tipo && <Layer {...capaSeleccionGlow(tipo, seleccion.codigo)} />}
              {seleccion?.tipo === tipo && <Layer {...capaSeleccion(tipo, seleccion.codigo)} />}
              {activa && <Layer {...capaNombre(tipo, vista)} />}
            </Source>
          );
        })}

        {vista === "escuelas" && escuelasGeo.features.length > 0 && (
          <Source id="escuelas" type="geojson" data={escuelasGeo}>
            <Layer {...capaEscuelasCalor} />
            <Layer {...capaEscuelasPuntos} />
            <Layer {...capaEscuelasNombre} />
          </Source>
        )}
      </MapaGL>

      {/* ── Barra superior ── */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2">
        {/* Vistas (patrón CIMBA) */}
        <div className="panel-vidrio pointer-events-auto flex overflow-hidden rounded-xl text-xs font-bold">
          {(Object.keys(VISTAS) as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              title={VISTAS[v].descripcion}
              className={`px-3 py-2 transition ${vista === v ? "bg-rosa/25 text-rosa" : "text-texto-3 hover:text-texto"}`}
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

        <div className="panel-vidrio pointer-events-auto flex items-center gap-1 rounded-xl p-1 text-xs">
          <button
            onClick={alternar3D}
            title="Vista 3D: la altura es la métrica de la vista (cobertura, electores o votos 2023)"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
              ver3D ? "bg-amarillo/20 text-amarillo" : "text-texto-3 hover:text-texto"
            }`}
          >
            <Box size={12} /> 3D
          </button>
          {vista === "operativo" && (
            <button
              onClick={() => setVerCobertura((v) => !v)}
              title="Pintar cada espacio según su estado: sin asignar / en curso / completo"
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
                verCobertura ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
              }`}
            >
              <Layers size={12} /> Cobertura
            </button>
          )}
          <button
            onClick={() => setVerAvenidas((v) => !v)}
            title="Realzar avenidas y corredores principales"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
              verAvenidas ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
            }`}
          >
            <Route size={12} /> Avenidas
          </button>
          <button
            onClick={() => setVerCalles((v) => !v)}
            title="Mostrar u ocultar el callejero del mapa base"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
              verCalles ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
            }`}
          >
            <Waypoints size={12} /> Calles
          </button>
          <button
            onClick={() => setVerSatelite((v) => !v)}
            title="Imagen satelital real (Esri) — los nombres de calles quedan encima"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
              verSatelite ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
            }`}
          >
            <Satellite size={12} /> Satélite
          </button>
        </div>

        <BuscadorElectores supabase={supabase} onIrACircuito={seleccionarCircuito} />
      </div>

      {/* ── Segunda fila: KPIs + microsegmentación ── */}
      <div className="pointer-events-none absolute top-[52px] left-3 z-10 mt-1 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2">
        <div className="panel-vidrio pointer-events-auto flex items-center gap-4 rounded-xl px-4 py-2 text-xs">
          {resumen && (
            <span title="Electores del padrón de la Capital">
              <span className="num font-bold text-texto">{numero(resumen.total)}</span>
              <span className="text-texto-3"> electores</span>
            </span>
          )}
          <span title="Distritos con al menos una persona asignada">
            <span className="num font-bold text-distrito">{kpis.distritosCubiertos}</span>
            <span className="text-texto-3">/20 distritos</span>
          </span>
          <span title="Circuitos con al menos una persona asignada">
            <span className="num font-bold text-circuito">{kpis.circuitosCubiertos}</span>
            <span className="text-texto-3">/47 circuitos</span>
          </span>
          <span title="Personas con al menos un espacio asignado">
            <span className="num font-bold text-rosa">{kpis.personasAsignadas}</span>
            <span className="text-texto-3"> personas</span>
          </span>
          <span title="Tareas completadas sobre el total del checklist">
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
      </div>

      {/* ── Leyenda ── */}
      <div className="panel-vidrio absolute bottom-8 left-3 z-10 max-w-64 rounded-xl px-3 py-2.5 text-[10px] leading-relaxed">
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
            <div className="h-2 w-full rounded-sm" style={{ background: "linear-gradient(90deg,#0e2a52,#3987e5,#cde2fb)" }} />
            <div className="flex justify-between text-texto-3"><span>0</span><span>{numero(maxElectores)}</span></div>
            <div className="mt-1 text-texto-3">Franjas etarias estimadas por DNI (±3 años)</div>
          </>
        )}
        {vista === "v2023" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Voto disperso 2023 · Concejal</div>
            <div className="h-2 w-full rounded-sm" style={{ background: "linear-gradient(90deg,#471527,#e14f82,#ffd6e4)" }} />
            <div className="flex justify-between text-texto-3"><span>0</span><span>{numero(maxVotos2023)}</span></div>
            <div className="mt-1 text-texto-3">Listas según la selección de Estrategia</div>
          </>
        )}
        {vista === "escuelas" && (
          <>
            <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Escuelas de votación</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border border-fondo bg-celeste" /> Tamaño = electores que votan ahí</div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-sm" style={{ background: "linear-gradient(90deg,rgba(61,21,39,0),#e14f82)" }} /> Calor = concentración</div>
          </>
        )}
        <div className="mt-1.5 border-t border-borde pt-1.5">
          <div className="flex items-center gap-1.5"><span className="inline-block w-4" style={{ borderTop: "3px solid #a78bfa" }} /> Distritos</div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-4" style={{ borderTop: "3px solid #34d399" }} /> Circuitos</div>
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
          <div className="text-texto-2">
            {vista === "padron" && `${numero(padronCirc.get(hover.codigo) ?? 0)} electores (filtro activo)`}
            {vista === "v2023" && `${numero(votos2023?.get(hover.codigo) ?? 0)} votos dispersos 2023`}
            {(vista === "operativo" || vista === "escuelas") &&
              (resumenHover
                ? `${resumenHover.asignaciones.length} persona${resumenHover.asignaciones.length === 1 ? "" : "s"} · tareas ${resumenHover.nHechas}/${resumenHover.tareas.length}`
                : "Sin asignar — clic para asignar")}
          </div>
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
        </div>
      )}

      {/* ── Panel del espacio seleccionado ── */}
      {seleccion && (
        <PanelEspacio
          seleccion={seleccion}
          resumen={resumenSeleccion ?? null}
          territorio={territorio}
          onCerrar={() => setSeleccion(null)}
        />
      )}
    </div>
  );
}

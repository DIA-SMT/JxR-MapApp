"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Layers, Route, Satellite } from "lucide-react";
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
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { FilterSpecification } from "maplibre-gl";
import { claveEspacio, useTerritorio } from "@/lib/territorio";
import { etiquetaEspacio } from "@/lib/espacios";
import type { TipoEspacio } from "@/lib/tipos";
import { PanelEspacio } from "./panel-espacio";

/** Capas de territorio: polígonos de distritos y circuitos electorales. */
type FCPoligono = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];
const ESTILO_MAPA =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// ── Calles: avenidas y corredores realzados desde las teselas del mapa base ──
// (mismo criterio que CIMBA: el nombre dice "Avenida"/"Av." o es troncal)
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

// ── Cobertura del operativo: cada espacio teñido según su estado ─────────────
const COLOR_COBERTURA: [string, string, string, string, string, string] = [
  "sin", "#ff3b30",
  "en_curso", "#f4dc00",
  "completo", "#199e70",
];

const capaRelleno = (tipo: TipoEspacio, verCobertura: boolean): LayerProps => ({
  id: `${tipo}-relleno`,
  type: "fill",
  source: tipo,
  paint: {
    "fill-color": ["match", ["get", "estado"], ...COLOR_COBERTURA, "#6b7280"],
    "fill-opacity": verCobertura
      ? ["match", ["get", "estado"], "sin", 0.08, "en_curso", 0.14, "completo", 0.18, 0]
      : 0.02,
  },
});

const capaDistritosLinea = (activa: boolean): LayerProps => ({
  id: "distrito-linea",
  type: "line",
  source: "distrito",
  paint: {
    "line-color": "#a78bfa",
    "line-opacity": activa ? 0.8 : 0.35,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 14, 2, 17, 3],
    "line-dasharray": [4, 2],
  },
});
const capaCircuitosLinea = (activa: boolean): LayerProps => ({
  id: "circuito-linea",
  type: "line",
  source: "circuito",
  paint: {
    "line-color": "#34d399",
    "line-opacity": activa ? 0.75 : 0.3,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 14, 1.4, 17, 2.2],
    "line-dasharray": [1, 1.6],
  },
});

const capaDistritosNombre: LayerProps = {
  id: "distrito-nombre",
  type: "symbol",
  source: "distrito",
  minzoom: 11,
  layout: {
    "text-field": [
      "case",
      [">", ["get", "personas"], 0],
      ["concat", ["get", "nombre"], " · ", ["to-string", ["get", "personas"]], " pers."],
      ["get", "nombre"],
    ],
    "text-font": ["Open Sans Bold"],
    "text-size": 12,
  },
  paint: { "text-color": "#a78bfa", "text-halo-color": "#070a10", "text-halo-width": 1.6 },
};
const capaCircuitosNombre: LayerProps = {
  id: "circuito-nombre",
  type: "symbol",
  source: "circuito",
  minzoom: 12,
  layout: {
    "text-field": ["concat", "Circuito ", ["get", "codigo"]],
    "text-font": ["Open Sans Regular"],
    "text-size": 10.5,
  },
  paint: { "text-color": "#34d399", "text-halo-color": "#070a10", "text-halo-width": 1.4 },
};

/** Contorno del espacio bajo el cursor. */
const capaHover = (tipo: TipoEspacio, codigo: string): LayerProps => ({
  id: `${tipo}-hover`,
  type: "line",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  paint: { "line-color": "#edf2fa", "line-width": 2, "line-opacity": 0.7 },
});

/** Contorno grueso amarillo del espacio seleccionado (mismo foco que CIMBA). */
const capaSeleccion = (tipo: TipoEspacio, codigo: string): LayerProps => ({
  id: `${tipo}-seleccion`,
  type: "line",
  source: tipo,
  filter: ["==", ["get", "codigo"], codigo],
  paint: { "line-color": "#f4dc00", "line-width": 3, "line-opacity": 0.9 },
});

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

export interface SeleccionEspacio {
  tipo: TipoEspacio;
  codigo: string;
}

export function MapaElectoral({ inicial }: { inicial?: SeleccionEspacio | null }) {
  const mapRef = useRef<MapRef>(null);
  const territorio = useTerritorio();
  const { asignaciones, tareas, porEspacio } = territorio;

  const [tipoActivo, setTipoActivo] = useState<TipoEspacio>("circuito");
  const [seleccion, setSeleccion] = useState<SeleccionEspacio | null>(null);
  const [hover, setHover] = useState<{ codigo: string; x: number; y: number } | null>(null);
  const [verCobertura, setVerCobertura] = useState(true);
  const [verSatelite, setVerSatelite] = useState(false);
  const [verAvenidas, setVerAvenidas] = useState(true);
  const [hayAnclaEtiquetas, setHayAnclaEtiquetas] = useState(true);

  // GeoJSON crudos
  const [distritosGeo, setDistritosGeo] = useState<FCPoligono | null>(null);
  const [circuitosGeo, setCircuitosGeo] = useState<FCPoligono | null>(null);
  useEffect(() => {
    fetch("/data/distritos.json").then((r) => r.json()).then(setDistritosGeo).catch(() => {});
    fetch("/data/circuitos.json").then((r) => r.json()).then(setCircuitosGeo).catch(() => {});
  }, []);

  // GeoJSON enriquecidos con el estado del operativo (codigo/estado/contadores)
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
          },
        };
      }),
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const distritos = useMemo(() => enriquecer(distritosGeo, "distrito"), [distritosGeo, porEspacio]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const circuitos = useMemo(() => enriquecer(circuitosGeo, "circuito"), [circuitosGeo, porEspacio]);

  const volarAEspacio = (tipo: TipoEspacio, codigo: string) => {
    const geo = tipo === "distrito" ? distritosGeo : circuitosGeo;
    const f = geo?.features.find((x) =>
      tipo === "distrito" ? String(x.properties.id) === codigo : String(x.properties.circuito) === codigo,
    );
    if (!f) return;
    const [minLon, minLat, maxLon, maxLat] = bboxDeCoordenadas(f.geometry.coordinates);
    if (Number.isFinite(minLon)) {
      mapRef.current?.getMap()?.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 90, duration: 1100 });
    }
  };
  const volarRef = useRef(volarAEspacio);
  volarRef.current = volarAEspacio;

  // Migue (u otro link) acciona el mapa: seleccionar y encuadrar un espacio
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
    const codigo = String(f.properties.codigo);
    setSeleccion({ tipo: tipoActivo, codigo });
  };

  const alMover = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (f) setHover({ codigo: String(f.properties.codigo), x: e.point.x, y: e.point.y });
    else setHover(null);
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

  return (
    <div className="relative h-full w-full">
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 12.1 }}
        mapStyle={ESTILO_MAPA}
        attributionControl={{ compact: true }}
        interactiveLayerIds={[`${tipoActivo}-relleno`]}
        cursor={hover ? "pointer" : "grab"}
        onClick={alClick}
        onMouseMove={alMover}
        onMouseOut={() => setHover(null)}
        onLoad={(e) => setHayAnclaEtiquetas(e.target.getLayer("roadname_minor") != null)}
      >
        <NavigationControl position="bottom-right" />
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

        {distritos && (
          <Source id="distrito" type="geojson" data={distritos}>
            {tipoActivo === "distrito" && <Layer {...capaRelleno("distrito", verCobertura)} />}
            <Layer {...capaDistritosLinea(tipoActivo === "distrito")} />
            {tipoActivo === "distrito" && <Layer {...capaDistritosNombre} />}
            {tipoActivo === "distrito" && hover && <Layer {...capaHover("distrito", hover.codigo)} />}
            {seleccion?.tipo === "distrito" && <Layer {...capaSeleccion("distrito", seleccion.codigo)} />}
          </Source>
        )}

        {circuitos && (
          <Source id="circuito" type="geojson" data={circuitos}>
            {tipoActivo === "circuito" && <Layer {...capaRelleno("circuito", verCobertura)} />}
            <Layer {...capaCircuitosLinea(tipoActivo === "circuito")} />
            {tipoActivo === "circuito" && <Layer {...capaCircuitosNombre} />}
            {tipoActivo === "circuito" && hover && <Layer {...capaHover("circuito", hover.codigo)} />}
            {seleccion?.tipo === "circuito" && <Layer {...capaSeleccion("circuito", seleccion.codigo)} />}
          </Source>
        )}
      </MapaGL>

      {/* ── Barra superior: modo + KPIs ── */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <div className="panel-vidrio pointer-events-auto flex overflow-hidden rounded-xl text-xs font-bold">
          {(["distrito", "circuito"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTipoActivo(t)}
              className={`px-3 py-2 transition ${
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

        <div className="panel-vidrio pointer-events-auto flex items-center gap-4 rounded-xl px-4 py-2 text-xs">
          <span title="Distritos con al menos una persona asignada">
            <span className="num font-bold text-distrito">{kpis.distritosCubiertos}</span>
            <span className="text-texto-3">/20 distritos</span>
          </span>
          <span title="Circuitos con al menos una persona asignada">
            <span className="num font-bold text-circuito">{kpis.circuitosCubiertos}</span>
            <span className="text-texto-3">/47 circuitos</span>
          </span>
          <span title="Personas con al menos un espacio asignado">
            <span className="num font-bold text-celeste">{kpis.personasAsignadas}</span>
            <span className="text-texto-3"> personas</span>
          </span>
          <span title="Tareas completadas sobre el total del checklist">
            <span className="num font-bold text-amarillo">{kpis.tareasHechas}</span>
            <span className="text-texto-3">/{kpis.tareasTotal} tareas</span>
          </span>
        </div>

        <div className="panel-vidrio pointer-events-auto flex items-center gap-1 rounded-xl p-1 text-xs">
          <button
            onClick={() => setVerCobertura((v) => !v)}
            title="Pintar cada espacio según su estado: sin asignar / en curso / completo"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
              verCobertura ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
            }`}
          >
            <Layers size={12} /> Cobertura
          </button>
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
            onClick={() => setVerSatelite((v) => !v)}
            title="Imagen satelital real (Esri) — los nombres de calles quedan encima"
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition ${
              verSatelite ? "bg-panel-3 text-texto" : "text-texto-3 hover:text-texto"
            }`}
          >
            <Satellite size={12} /> Satélite
          </button>
        </div>
      </div>

      {/* ── Leyenda ── */}
      <div className="panel-vidrio absolute bottom-8 left-3 z-10 rounded-xl px-3 py-2.5 text-[10px] leading-relaxed">
        <div className="mb-1 font-bold tracking-wide text-texto-2 uppercase">Cobertura</div>
        <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-sin/70" /> Sin asignar</div>
        <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-encurso/80" /> En curso</div>
        <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-completo" /> Checklist completo</div>
        <div className="mt-1.5 border-t border-borde pt-1.5">
          <div className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-distrito" style={{ borderTop: "2px dashed #a78bfa", background: "none" }} /> Distritos</div>
          <div className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ borderTop: "2px dotted #34d399" }} /> Circuitos</div>
        </div>
      </div>

      {/* ── Tooltip ── */}
      {hover && (
        <div
          className="panel-vidrio pointer-events-none absolute z-20 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ left: hover.x + 14, top: hover.y + 10 }}
        >
          <div className="font-bold">{etiquetaEspacio(tipoActivo, hover.codigo)}</div>
          <div className="text-texto-2">
            {resumenHover
              ? `${resumenHover.asignaciones.length} persona${resumenHover.asignaciones.length === 1 ? "" : "s"} · tareas ${resumenHover.nHechas}/${resumenHover.tareas.length}`
              : "Sin asignar — clic para asignar"}
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

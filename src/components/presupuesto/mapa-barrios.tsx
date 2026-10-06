"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layer,
  Map as MapaGL,
  NavigationControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";

type FCPoligono = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
type Tema = "oscuro" | "claro";

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];
const ESTILO_OSCURO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ?? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const ESTILO_CLARO =
  process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT ?? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Para comparar: lo que pierde en celeste, lo que gana en rosa, sin cambio en neutro. */
const DIVERGENTE: Record<Tema, [string, string, string]> = {
  oscuro: ["#3fa7d6", "#2a3247", "#e14f82"],
  claro: ["#2b7fb8", "#eef1f6", "#c93f6d"],
};

/** Rampa secuencial de la marca: de casi fondo a rosa pleno. */
const RAMPA: Record<Tema, [string, string, string]> = {
  oscuro: ["#23304a", "#8a3d6c", "#e14f82"],
  claro: ["#fbe3ec", "#ef8fb3", "#c93f6d"],
};

// Una sola descarga por sesión, aunque el mapa se monte varias veces.
let barriosPromesa: Promise<FCPoligono> | null = null;
const cargarBarrios = () => {
  barriosPromesa ??= fetch("/data/barrios.json").then((r) => {
    if (!r.ok) throw new Error(`no pude cargar los barrios (${r.status})`);
    return r.json() as Promise<FCPoligono>;
  });
  return barriosPromesa;
};

/**
 * Mapa de barrios pintado por un valor. La escala corta en el percentil 95
 * para que un barrio extremo no deje a todos los demás del mismo color, y la
 * leyenda muestra exactamente esa escala.
 *
 * La clave es el NOMBRE del barrio: el GeoJSON tiene ids nulos y repetidos.
 */
export function MapaBarrios({
  valores,
  formatear,
  etiqueta,
  seleccionado = null,
  onSeleccionar,
  alto = "h-[440px]",
  divergente = false,
  tope: topeFijo,
}: {
  valores: Record<string, number>;
  formatear: (v: number) => string;
  etiqueta: string;
  seleccionado?: string | null;
  onSeleccionar?: (nombre: string | null) => void;
  alto?: string;
  /** Valores con signo (una diferencia): escala simétrica alrededor de cero. */
  divergente?: boolean;
  /** Escala fija (por ejemplo 100 para porcentajes) en vez del percentil 95. */
  tope?: number;
}) {
  const [tema, setTema] = useState<Tema>("oscuro");
  const [geo, setGeo] = useState<FCPoligono | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ nombre: string; x: number; y: number } | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const leer = () => setTema(document.documentElement.classList.contains("claro") ? "claro" : "oscuro");
    leer();
    window.addEventListener("jxr:tema", leer);
    return () => window.removeEventListener("jxr:tema", leer);
  }, []);

  useEffect(() => {
    let vivo = true;
    cargarBarrios()
      .then((g) => vivo && setGeo(g))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "no pude cargar los barrios"));
    return () => {
      vivo = false;
    };
  }, []);

  const tope = useMemo(() => {
    if (topeFijo != null && topeFijo > 0) return topeFijo;
    const v = Object.values(valores)
      .map((x) => (divergente ? Math.abs(x) : x))
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    if (v.length === 0) return 1;
    return v[Math.min(v.length - 1, Math.floor(0.95 * (v.length - 1)))] || v[v.length - 1];
  }, [valores, divergente, topeFijo]);

  const datos = useMemo<FCPoligono | null>(() => {
    if (!geo) return null;
    return {
      ...geo,
      features: geo.features.map((f) => {
        const nombre = String(f.properties?.nombre ?? "");
        const v = valores[nombre];
        // «tiene» separa al barrio sin dato del que vale cero (o, comparando, del que pierde)
        // comparando, un barrio que recibe lo mismo con las dos (diferencia 0) va en el tono neutro
        const tiene = v != null && (divergente || v > 0);
        return { ...f, properties: { ...f.properties, valor: tiene ? v : 0, tiene: tiene ? 1 : 0 } };
      }),
    };
  }, [geo, valores, divergente]);

  const colores = divergente ? DIVERGENTE[tema] : RAMPA[tema];
  const escala = divergente
    ? ["interpolate", ["linear"], ["get", "valor"], -tope, colores[0], 0, colores[1], tope, colores[2]]
    : ["interpolate", ["linear"], ["get", "valor"], 0, colores[0], tope / 2, colores[1], tope, colores[2]];
  const relleno: LayerProps = {
    id: "barrios-valor",
    type: "fill",
    paint: {
      "fill-color": ["case", ["==", ["get", "tiene"], 0], tema === "claro" ? "#d7deea" : "#161d2e", escala] as never,
      "fill-opacity": ["case", ["==", ["get", "tiene"], 0], 0.25, 0.78],
    },
  };
  const borde: LayerProps = {
    id: "barrios-borde",
    type: "line",
    paint: { "line-color": tema === "claro" ? "#ffffff" : "#070a10", "line-width": 0.6, "line-opacity": 0.8 },
  };
  const marcado: LayerProps = {
    id: "barrios-seleccionado",
    type: "line",
    filter: ["==", ["get", "nombre"], seleccionado ?? "\u0000"],
    paint: { "line-color": tema === "claro" ? "#14213d" : "#ffffff", "line-width": 2.4 },
  };

  const alMover = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    setHover(f ? { nombre: String(f.properties?.nombre ?? ""), x: e.point.x, y: e.point.y } : null);
  };

  if (error) return <p className="p-4 text-xs text-peligro">{error}</p>;

  return (
    <div ref={caja} className={`relative w-full overflow-hidden rounded-2xl border border-borde ${alto}`}>
      <MapaGL
        initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 11.6 }}
        mapStyle={tema === "claro" ? ESTILO_CLARO : ESTILO_OSCURO}
        attributionControl={{ compact: true }}
        interactiveLayerIds={["barrios-valor"]}
        cursor={hover ? "pointer" : "grab"}
        onMouseMove={alMover}
        onMouseOut={() => setHover(null)}
        onClick={(e) => {
          const f = e.features?.[0];
          onSeleccionar?.(f ? String(f.properties?.nombre ?? "") : null);
        }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        {datos && (
          <Source id="barrios-presupuesto" type="geojson" data={datos}>
            <Layer {...relleno} />
            <Layer {...borde} />
            <Layer {...marcado} />
          </Source>
        )}
      </MapaGL>

      {hover && (
        <div
          className="panel-solido pointer-events-none absolute z-10 rounded-lg px-2.5 py-1.5 text-[11px]"
          // del lado del cursor que tenga lugar, para que no se corte en el borde
          style={
            hover.x > (caja.current?.clientWidth ?? 0) / 2
              ? { right: (caja.current?.clientWidth ?? 0) - hover.x + 12, top: hover.y + 12 }
              : { left: hover.x + 12, top: hover.y + 12 }
          }
        >
          <div className="font-bold">{hover.nombre}</div>
          <div className="num text-texto-2">
            {valores[hover.nombre] ? formatear(valores[hover.nombre]) : divergente ? "sin cambio" : "sin asignación"}
          </div>
        </div>
      )}

      {/* La leyenda es la misma escala que se pinta */}
      <div className="panel-solido absolute top-2 left-2 z-10 rounded-lg px-2.5 py-2 text-[10px]">
        <div className="font-bold tracking-wide text-texto-2 uppercase">{etiqueta}</div>
        <div
          className="mt-1 h-2 w-36 rounded-full"
          style={{ background: `linear-gradient(to right, ${colores[0]}, ${colores[1]}, ${colores[2]})` }}
        />
        <div className="num mt-0.5 flex justify-between text-texto-3">
          <span>{divergente ? `≤ ${formatear(-tope)}` : "0"}</span>
          {divergente && <span>0</span>}
          <span>≥ {formatear(tope)}</span>
        </div>
      </div>

      {!datos && <div className="absolute inset-0 animate-pulse bg-panel-3/40" />}
    </div>
  );
}

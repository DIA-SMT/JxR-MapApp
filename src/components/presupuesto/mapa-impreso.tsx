"use client";

import type { FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import { useEffect, useMemo, useState } from "react";

type FC = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;

/** Cinco tonos que se distinguen impresos en blanco y negro. */
const TONOS = ["#fde4ee", "#f6b3cb", "#ee82a8", "#d9497c", "#9c2252"];
const SIN_DATO = "#eef0f4";

/**
 * El mapa de barrios en SVG, para el papel: un canvas de MapLibre no se
 * imprime bien. Cinco clases por quintiles, con la leyenda de cada corte.
 */
export function MapaImpreso({
  valores,
  formatear,
  ancho = 640,
  onListo,
}: {
  valores: Record<string, number>;
  formatear: (v: number) => string;
  ancho?: number;
  onListo?: () => void;
}) {
  const [geo, setGeo] = useState<FC | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/data/barrios.json")
      .then((r) =>
        r.ok ? (r.json() as Promise<FC>) : Promise.reject(new Error(`no pude cargar los barrios (${r.status})`)),
      )
      .then((g) => vivo && setGeo(g))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "no pude cargar los barrios"));
    return () => {
      vivo = false;
    };
  }, []);

  const cortes = useMemo<number[]>(() => {
    const v = Object.values(valores)
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    if (v.length === 0) return [];
    // con pocos valores distintos los quintiles se repiten: quedan los cortes únicos
    return [...new Set([0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]))].filter(
      (c) => c < v[v.length - 1],
    );
  }, [valores]);

  // tantos tonos como clases, repartidos entre el más claro y el más oscuro
  const tonos = useMemo(
    () =>
      cortes.length >= 4
        ? TONOS
        : Array.from({ length: cortes.length + 1 }, (_, i) => TONOS[Math.round((i * 4) / Math.max(1, cortes.length))]),
    [cortes],
  );

  const dibujo = useMemo(() => {
    if (!geo) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const anillos = (f: FC["features"][number]): Position[][] =>
      f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
    for (const f of geo.features)
      for (const r of anillos(f))
        for (const [x, y] of r) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    // equirectangular con la corrección de la latitud media: a esta escala alcanza
    const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
    const escala = ancho / ((x1 - x0) * k);
    const alto = (y1 - y0) * escala;
    const p = ([x, y]: Position) => `${((x - x0) * k * escala).toFixed(1)},${((y1 - y) * escala).toFixed(1)}`;
    const color = (v: number | undefined) => {
      if (!(v != null && v > 0)) return SIN_DATO;
      const i = cortes.findIndex((c) => v <= c);
      return tonos[i < 0 ? cortes.length : i];
    };
    return {
      alto,
      caminos: geo.features.map((f, i) => ({
        key: i,
        d: anillos(f)
          .map((r) => `M${r.map(p).join("L")}Z`)
          .join(""),
        fill: color(valores[String(f.properties?.nombre ?? "")]),
      })),
    };
  }, [geo, valores, cortes, tonos, ancho]);

  useEffect(() => {
    if (dibujo || error) onListo?.();
  }, [dibujo, error, onListo]);

  if (error) return <p className="text-[11px] text-red-700">{error}</p>;
  if (!dibujo) return <div className="h-64 animate-pulse rounded bg-neutral-100" />;

  const hayValores = Object.values(valores).some((x) => x > 0);
  const etiquetas = !hayValores
    ? []
    : cortes.length === 0
      ? ["con asignación"]
      : [
          `hasta ${formatear(cortes[0])}`,
          ...cortes.slice(1).map((c, i) => `${formatear(cortes[i])} – ${formatear(c)}`),
          `más de ${formatear(cortes[cortes.length - 1])}`,
        ];

  return (
    <div>
      <svg
        viewBox={`0 0 ${ancho} ${dibujo.alto.toFixed(0)}`}
        className="h-auto w-full"
        role="img"
        aria-label="Mapa de barrios por monto asignado"
      >
        {dibujo.caminos.map((c) => (
          <path key={c.key} d={c.d} fill={c.fill} stroke="#ffffff" strokeWidth={0.4} fillRule="evenodd" />
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-neutral-600">
        {etiquetas.map((t, i) => (
          <span key={i} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-3.5 rounded-sm border border-neutral-300"
              style={{ background: tonos[i] }}
            />
            {t}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3.5 rounded-sm border border-neutral-300"
            style={{ background: SIN_DATO }}
          />
          sin asignación
        </span>
      </div>
    </div>
  );
}

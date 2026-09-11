/**
 * Esqueletos de carga.
 *
 * Varias pantallas colapsaban a una línea de puntos mientras esperaban a la
 * base: el panel de resultado quedaba de 40px de alto, el layout se reacomodaba
 * de golpe al llegar el dato y por un segundo la pantalla parecía vacía o rota.
 * El esqueleto reserva el lugar con la forma que va a tener el contenido.
 */

/** Bloque gris con el pulso de carga. `w` y `h` son clases de Tailwind. */
export function Barra({ w = "w-full", h = "h-3" }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} animate-pulse rounded-md bg-panel-3`} />;
}

/** Filas de barras decrecientes: el hueco de una lista o un ranking. */
export function ListaEsqueleto({ filas = 6 }: { filas?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Barra w="w-24" h="h-2.5" />
            <Barra w="w-10" h="h-2.5" />
          </div>
          {/* decrece como decrecería un ranking real */}
          <div
            className="h-1.5 animate-pulse rounded-full bg-panel-3"
            style={{ width: `${Math.max(12, 100 - i * 13)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** Hueco de una tabla: encabezado y filas. */
export function TablaEsqueleto({ filas = 8, columnas = 5 }: { filas?: number; columnas?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-3 border-b border-borde pb-2">
        {Array.from({ length: columnas }, (_, c) => (
          <Barra key={c} w={c === 0 ? "w-32" : "flex-1"} h="h-2" />
        ))}
      </div>
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="flex gap-3">
          {Array.from({ length: columnas }, (_, c) => (
            <Barra key={c} w={c === 0 ? "w-32" : "flex-1"} h="h-2.5" />
          ))}
        </div>
      ))}
    </div>
  );
}

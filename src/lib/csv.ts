/**
 * Descarga de tablas como CSV, para seguir procesando la información afuera
 * (Excel, Sheets, cruces con otras bases). Separador ";" y BOM UTF-8: es lo
 * que espera el Excel configurado en es-AR — sin el BOM los acentos se rompen.
 */
export function descargarCSV(
  nombreArchivo: string,
  encabezados: string[],
  filas: Array<Array<string | number | boolean | null | undefined>>,
) {
  const celda = (v: string | number | boolean | null | undefined) => {
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "sí" : "no";
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = [encabezados, ...filas].map((f) => f.map(celda).join(";")).join("\r\n");
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + texto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo.endsWith(".csv") ? nombreArchivo : `${nombreArchivo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

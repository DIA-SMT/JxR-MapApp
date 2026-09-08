import { SegmentosTaller } from "@/components/segmentos-taller";

export default function PaginaSegmentos() {
  return (
    <div className="fondo-grilla h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <SegmentosTaller />
      </div>
    </div>
  );
}

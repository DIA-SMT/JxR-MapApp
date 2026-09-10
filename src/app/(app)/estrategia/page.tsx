import { EstrategiaTabs } from "@/components/estrategia-tabs";

export default function PaginaEstrategia() {
  return (
    <div className="fondo-grilla h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <EstrategiaTabs />
      </div>
    </div>
  );
}

import { PersonasAdmin } from "@/components/personas-admin";

export default function PaginaPersonas() {
  return (
    <div className="fondo-grilla h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <PersonasAdmin />
      </div>
    </div>
  );
}

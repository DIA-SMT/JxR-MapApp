/**
 * Los términos del presupuesto que no son de todos los días, con su
 * explicación al pasar el mouse (o al mantener apretado en el celular).
 */
export const GLOSARIO = {
  vigente:
    "Crédito vigente: lo que el presupuesto (la ordenanza y sus modificaciones) autoriza a gastar en esa partida.",
  comprometido:
    "Comprometido: lo que ya está tomado por contratos, órdenes de compra u otros actos de gasto, según la Contaduría.",
  reservado: "Reservado: lo que tomaron las propuestas aprobadas que todavía no se ejecutaron.",
  libre: "Libre: lo que queda para repartir. Vigente menos comprometido menos reservado.",
  partidaPrincipal:
    "Partida principal: el tipo de gasto según la Ordenanza de Contabilidad 570/80 (12 bienes y servicios, 31 transferencias, 52 obras…). Define qué se puede pagar con esa plata.",
  estimada:
    "Estimada: un monto aproximado para planificar. Una propuesta que la use no se aprueba hasta cargar el dato real.",
} as const;

export function Termino({ t, children }: { t: keyof typeof GLOSARIO; children: React.ReactNode }) {
  return (
    <span
      title={GLOSARIO[t]}
      className="cursor-help underline decoration-current/40 decoration-dotted underline-offset-2"
    >
      {children}
    </span>
  );
}

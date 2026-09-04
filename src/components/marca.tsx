/**
 * Marca JxR — isotipo oficial: "JxR" en blanco sobre rosa (#E14F82), con la
 * "x" tachada en azul marino (#14213D) y el trazo inferior de la campaña.
 */

export function InsigniaJxR({ tam = 30 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 64 64" aria-hidden>
      <rect x="1" y="1" width="62" height="62" rx="16" fill="#E14F82" />
      <text
        x="11"
        y="43"
        fontFamily="var(--font-poppins), system-ui, sans-serif"
        fontWeight="800"
        fontSize="30"
        fill="#ffffff"
      >
        J
      </text>
      <text
        x="38"
        y="43"
        fontFamily="var(--font-poppins), system-ui, sans-serif"
        fontWeight="800"
        fontSize="30"
        fill="#ffffff"
      >
        R
      </text>
      <text
        x="24"
        y="41"
        fontFamily="var(--font-poppins), system-ui, sans-serif"
        fontWeight="800"
        fontSize="21"
        fill="#14213D"
        transform="rotate(-8 32 32)"
      >
        x
      </text>
      <path d="M13 51 Q32 59 51 49" stroke="#14213D" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function LogoJxR({ tam = 30 }: { tam?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <InsigniaJxR tam={tam} />
      <div className="leading-none">
        <div className="text-[8px] font-semibold tracking-[0.18em] text-texto-2 uppercase">Comando</div>
        <div className="text-sm font-extrabold tracking-tight">Territorial</div>
      </div>
    </div>
  );
}

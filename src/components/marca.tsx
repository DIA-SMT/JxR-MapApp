/**
 * Marca JxR — hereda el lenguaje visual del centro de comando (paleta SMT:
 * azul #0066FF, celeste #2EB1FF, amarillo #F4DC00) con un glifo propio:
 * radar territorial sobre anillo de circuitos.
 */

export function GlifoJxR({ tam = 30 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" stroke="#2EB1FF" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="11.5" stroke="#A78BFA" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="4 2.5" />
      <circle cx="20" cy="20" r="5" stroke="#0066FF" strokeWidth="2" />
      <circle cx="20" cy="20" r="1.8" fill="#F4DC00" />
      <g style={{ transformOrigin: "20px 20px", animation: "barrido 4s linear infinite" }}>
        <path d="M20 20 L20 2 A18 18 0 0 1 33.5 7.5 Z" fill="url(#haz-jxr)" />
      </g>
      <defs>
        <linearGradient id="haz-jxr" x1="20" y1="2" x2="33" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2EB1FF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#2EB1FF" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LogoJxR({ tam = 30 }: { tam?: number }) {
  return (
    <div className="flex items-center gap-2">
      <GlifoJxR tam={tam} />
      <div className="leading-none">
        <div className="text-lg font-extrabold tracking-tight">
          JxR<span className="text-amarillo">.</span>
        </div>
        <div className="text-[8px] font-medium tracking-[0.14em] text-texto-2 uppercase">
          Comando Territorial
        </div>
      </div>
    </div>
  );
}

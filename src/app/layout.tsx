import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
});

const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jbmono",
});

export const metadata: Metadata = {
  title: "JxR · Comando Territorial",
  description: "Asignación de distritos y circuitos electorales — San Miguel de Tucumán",
};

export const viewport: Viewport = {
  themeColor: "#070A10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${poppins.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <body>
        {/* Tema antes del primer paint (evita el destello al recargar en claro) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('jxr:tema')==='claro')document.documentElement.classList.add('claro')}catch(e){}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}

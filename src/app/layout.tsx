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

const DESCRIPCION =
  "El mapa electoral de San Miguel de Tucumán: padrón, resultados 2023, estrategia y operativo territorial en un solo comando.";

export const metadata: Metadata = {
  // Base para que los og:image/íconos salgan con URL absoluta en los previews
  metadataBase: new URL("https://jxr-mapapp.vercel.app"),
  title: { default: "JxR · Comando Territorial", template: "%s · JxR Comando Territorial" },
  description: DESCRIPCION,
  applicationName: "JxR Comando Territorial",
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: "/",
    siteName: "JxR Comando Territorial",
    title: "JxR · Comando Territorial",
    description: DESCRIPCION,
  },
  twitter: {
    card: "summary_large_image",
    title: "JxR · Comando Territorial",
    description: DESCRIPCION,
  },
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

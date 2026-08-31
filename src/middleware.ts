import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión de Supabase en cada request y protege las rutas:
 * sin usuario, todo salvo /acceso redirige al login.
 */
export async function middleware(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (aEscribir: Array<{ name: string; value: string; options?: CookieOptions }>) => {
          for (const { name, value } of aEscribir) request.cookies.set(name, value);
          respuesta = NextResponse.next({ request });
          for (const { name, value, options } of aEscribir) respuesta.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const ruta = request.nextUrl.pathname;

  if (!user && ruta !== "/acceso") {
    const url = request.nextUrl.clone();
    url.pathname = "/acceso";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && ruta === "/acceso") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return respuesta;
}

export const config = {
  matcher: [
    // Todo salvo estáticos de Next y archivos públicos (datos del mapa, marca)
    "/((?!_next/static|_next/image|favicon.ico|data/|marca/|.*\\.(?:png|jpg|svg|ico|json|webp)$).*)",
  ],
};

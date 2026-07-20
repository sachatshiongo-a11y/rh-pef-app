import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getJwksKeys } from "@/lib/supabase/jwks";

const PUBLIC_PATHS = ["/login", "/mot-de-passe-oublie", "/reinitialiser"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Vérification LOCALE du jeton (signature ES256 + expiration) sans appel réseau au serveur
  // Auth : on fournit les clés JWKS depuis le cache module (récupérées 1×/6 h), sinon getClaims
  // retéléchargerait le JWKS à chaque requête (client recréé à chaque fois). Un rafraîchissement
  // réseau n'a lieu qu'à l'approche de l'expiration du jeton (~1×/heure), pas à chaque navigation.
  const keys = await getJwksKeys();
  const { data } = await supabase.auth.getClaims(undefined, { keys });
  const estAuthentifie = !!data?.claims?.sub;

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!estAuthentifie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (estAuthentifie && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/entree";
    return NextResponse.redirect(url);
  }

  // Mémorise le dernier espace visité (les accueils d'espace sont les seuls points d'entrée
  // depuis /choix-espace) — le sélecteur d'espace met ensuite ce choix en avant.
  if (estAuthentifie) {
    const p = request.nextUrl.pathname;
    // RH et Stock partagent désormais l'espace « gestion » (accueils /accueil et /stock).
    const espace =
      p === "/espace" || p.startsWith("/espace/") ? "salarie"
      : p === "/accueil" || p === "/stock" || p.startsWith("/stock/") ? "gestion"
      : null;
    if (espace && request.cookies.get("dernier-espace")?.value !== espace) {
      response.cookies.set("dernier-espace", espace, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    }
  }

  return response;
}

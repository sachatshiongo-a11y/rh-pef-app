import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Exclus : sw.js (service worker Web Push, doit être servi tel quel) et api/cron (déclencheurs
    // protégés par leur propre jeton CRON_SECRET) — sinon redirigés vers /login par le garde d'auth.
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

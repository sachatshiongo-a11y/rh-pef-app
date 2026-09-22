import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Exclus : sw.js (service worker Web Push, doit être servi tel quel) et api/cron (déclencheurs
    // protégés par leur propre jeton CRON_SECRET) — sinon redirigés vers /login par le garde d'auth.
    //
    // `.mjs` est exclu pour `public/pdf.worker.min.mjs`, le worker de pdf.js que la visionneuse de
    // documents va chercher toute seule (src/components/visionneuse-document.tsx). Ce piège s'est
    // refermé TROIS fois dans cette famille de dépôts : une redirection 307 vers /login sur un
    // fichier que le NAVIGATEUR récupère de lui-même ne se voit pas (un utilisateur connecté
    // obtient bien le fichier), mais le jour où le service worker mettra ces réponses en cache,
    // c'est la page de connexion qui sera gardée sous le nom du worker — et la visionneuse restera
    // cassée sur ce téléphone, sans un seul message d'erreur. Aucune route de l'application ne se
    // termine par `.mjs` : seuls des fichiers statiques de `public/` sont concernés.
    // Vérifié par src/lib/chemins-publics.test.ts.
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js|api/cron|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mjs)$).*)",
  ],
};

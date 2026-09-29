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
    //
    // `icons/` AVEC la barre (2026-09-29) : sans elle, le motif excluait tout chemin qui COMMENCE par
    // « icons » — une future page « /icons-admin » ou « /iconsxyz » aurait échappé au garde. Seul le
    // DOSSIER public/icons est exclu.
    // Même règle pour `api/cron/` (le DOSSIER des déclencheurs) et `api/version` (ce chemin exact, ou
    // sous lui) : une future route « /api/cron-admin » ou « /api/versionner » passe par le garde.
    // Vérifié par src/lib/chemins-publics.test.ts.
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|manifest-espace.json|icons/|sw.js|api/cron/|api/version(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mjs)$).*)",
  ],
};

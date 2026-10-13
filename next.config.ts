import type { NextConfig } from "next";

/**
 * En-têtes de sécurité (audit du 10/10/2026, sécurité 3), posés sur TOUTES les réponses.
 *
 * Volontairement SANS politique de scripts (CSP `script-src`) : elle casserait la PWA, le service
 * worker, le worker de pdf.js ou les scripts en ligne de Next sans qu'aucun test ne le voie. On se
 * limite à ce qui ne peut rien casser dans l'application :
 *  - interdiction d'être affichée dans un cadre (clickjacking) : `frame-ancestors 'none'` + son
 *    équivalent ancien `X-Frame-Options: DENY`. L'application n'encadre aucune de ses pages (la
 *    visionneuse dessine dans des <canvas>, plus d'<iframe>) ;
 *  - `nosniff` : un fichier téléversé n'est jamais interprété comme un script ou une page ;
 *  - `Referrer-Policy` : les adresses internes (identifiants dans le chemin) ne partent pas vers
 *    un autre site ;
 *  - HSTS : le domaine ne se consulte qu'en HTTPS (ignoré par les navigateurs en HTTP local).
 */
export const ENTETES_SECURITE: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Pas d'en-tête « x-powered-by: Next.js » (inutile, et renseigne sur la version à attaquer).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: ENTETES_SECURITE }];
  },
  // Build Render (512 Mo) : le contrôle des types se fait AILLEURS — la CI GitHub (`npm run typecheck`)
  // à chaque poussée, et `tsc --noEmit` avant chaque déploiement. Le refaire dans `next build` construisait
  // un programme TypeScript complet et faisait mourir le build en mémoire (même parade qu'Atelier, 01/10).
  typescript: { ignoreBuildErrors: true },
  // pdf-parse (pdfjs) doit rester un module Node externe (pas bundlé par Next) pour l'import de BC.
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    // Cache de navigation du navigateur (2026-10-13) : une page DÉJÀ VUE il y a moins de 30 s se réaffiche
    // sans repasser par le serveur (Render 0,1 vCPU + un aller-retour Kinshasa ↔ Francfort par clic).
    // Sans risque de donnée périmée après un geste : toute action serveur qui revalide vide ce cache en
    // entier (toutes les pages), connexion et déconnexion comprises — vérifié par
    // src/app/cache-navigation.garde-fou.test.ts. Seul effet : une modification faite par QUELQU'UN D'AUTRE
    // peut mettre jusqu'à 30 s à apparaître sur une page qu'on vient de quitter. La pastille et la cloche
    // (rendues par le layout) n'étaient déjà relues qu'après un geste, au rechargement ou en changeant
    // d'espace ; seul ce dernier cas peut désormais, dans les 30 s, reprendre l'espace tel qu'on l'a laissé.
    staleTimes: { dynamic: 30 },
    // Un seul ouvrier de compilation : chacun a son propre tas, leur somme dépassait la mémoire de Render.
    cpus: 1,
    // Les Server Actions plafonnent le corps de requête à 1 Mo par défaut, ce qui fait échouer
    // les téléversements de fiches (surtout l'import en masse). On relève la limite ; le contrôle
    // par fichier (15 Mo) reste appliqué dans televerserFiche.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;

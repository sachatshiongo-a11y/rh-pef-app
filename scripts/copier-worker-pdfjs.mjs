// Copie le worker de pdfjs-dist dans public/, pour qu'il soit SERVI PAR L'APPLICATION — jamais un
// CDN (cf. l'en-tête de src/components/visionneuse-document.tsx : le réseau de Kinshasa est
// instable, et un fichier tiers est un point de panne de plus ; le jour où un mode hors ligne
// arrivera, il ne pourra mettre en cache que ce que l'application sert elle-même).
//
// Lancé en `postinstall` (package.json) : le fichier copié suit TOUJOURS la version de pdfjs-dist
// réellement installée, sans étape manuelle à oublier le jour d'une mise à jour. Le fichier
// `public/pdf.worker.min.mjs` est donc IGNORÉ PAR GIT (.gitignore) — il est produit, pas écrit.
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const racineDepot = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(racineDepot, "public", "pdf.worker.min.mjs");

// `require.resolve` dans un try/catch, et PAS un `existsSync` posé après : quand
// `pdfjs-dist/build/pdf.worker.min.mjs` n'existe pas, `require.resolve` LÈVE — un test placé
// APRÈS, sur son résultat, ne serait jamais atteint. La première mise à jour de pdfjs-dist qui
// déplacerait ce fichier (ou un `postinstall` lancé avant que la dépendance ne soit posée) ferait
// alors échouer `npm install` en entier, l'inverse de ce que ce script promet.
let source;
try {
  source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
} catch {
  // `postinstall` tourne aussi quand pdfjs-dist n'est pas encore posé (installation partielle,
  // arbre de travail incomplet…) : on ne casse pas l'installation pour ça. Si le fichier manque
  // réellement en production, la visionneuse le DIRA elle-même (message d'échec), elle ne fera
  // jamais semblant d'afficher un document.
  console.warn("[copier-worker-pdfjs] pdfjs-dist/build/pdf.worker.min.mjs introuvable — copie ignorée.");
  process.exit(0);
}

copyFileSync(source, destination);
console.log(`[copier-worker-pdfjs] public/pdf.worker.min.mjs mis à jour depuis ${source}.`);

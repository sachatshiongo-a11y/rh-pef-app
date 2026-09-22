// Copie le worker de pdfjs-dist dans public/, pour qu'il soit SERVI PAR L'APPLICATION — jamais un
// CDN (cf. l'en-tête de src/components/visionneuse-document.tsx : le réseau de Kinshasa est
// instable, et un fichier tiers est un point de panne de plus ; le jour où un mode hors ligne
// arrivera, il ne pourra mettre en cache que ce que l'application sert elle-même).
//
// DEUX APPELS, DEUX EXIGENCES (package.json) :
//   • `postinstall` — INDULGENT. `npm install` tourne aussi dans des états incomplets (dépendance
//     pas encore posée, installation partielle) : on ne casse pas une installation pour ça.
//   • `prebuild --exiger` — INTRANSIGEANT. Au moment du build, le fichier DOIT exister : c'est le
//     dernier endroit où échouer est utile. Sans ce contrôle, un build « réussi » partirait en
//     production sans worker, et la visionneuse serait cassée sur les téléphones — constaté par
//     personne avant Sacha.
//
// Le fichier copié suit TOUJOURS la version de pdfjs-dist réellement installée, sans étape
// manuelle à oublier. `public/pdf.worker.min.mjs` est donc IGNORÉ PAR GIT : il est produit.
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const racineDepot = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINATION = join(racineDepot, "public", "pdf.worker.min.mjs");

/**
 * Décision PURE, séparée de l'exécution pour être testable : que faire quand la source est (ou
 * n'est pas) trouvable, selon qu'on exige ou non sa présence.
 *
 * ⚠️ `exiger` n'est pas décoratif : c'est lui qui fait ÉCHOUER LE BUILD. Le rendre indulgent
 * partout laisserait partir en production un bundle sans worker.
 */
export function decisionCopie({ source, exiger }) {
  if (source) return { action: "copier", code: 0 };
  return {
    action: "abandonner",
    code: exiger ? 1 : 0,
    message:
      "pdfjs-dist/build/pdf.worker.min.mjs introuvable — aucun PDF ne s'affichera dans la " +
      "visionneuse de documents.",
  };
}

/**
 * `require.resolve` dans un try/catch, et PAS un `existsSync` posé après : quand le fichier
 * n'existe pas, `require.resolve` LÈVE — un test placé APRÈS, sur son résultat, ne serait jamais
 * atteint.
 */
export function trouverSource() {
  try {
    return require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
  } catch {
    return null;
  }
}

function executer(argv) {
  const exiger = argv.includes("--exiger");
  const source = trouverSource();
  const decision = decisionCopie({ source, exiger });

  if (decision.action === "abandonner") {
    const dire = exiger ? console.error : console.warn;
    dire(`[copier-worker-pdfjs] ${decision.message}`);
    return decision.code;
  }

  copyFileSync(source, DESTINATION);
  console.log(`[copier-worker-pdfjs] public/pdf.worker.min.mjs mis à jour depuis ${source}.`);
  return 0;
}

// Lancé en ligne de commande (et non importé par un test) : on exécute et on sort avec le code.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(executer(process.argv.slice(2)));
}

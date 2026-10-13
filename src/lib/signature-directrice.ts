import path from "node:path";
import fs from "node:fs";

// Module VOLONTAIREMENT sans React-PDF : `lib/entreprise.ts` (importé par de nombreuses pages) n'a besoin que de ce chemin,
// et l'importer depuis `lib/pdf/layout.tsx` embarquait @react-pdf dans toutes ces pages (mesure du 13/10/2026).
// `lib/pdf/layout.tsx` le réexporte pour les documents.

/**
 * Signature manuscrite de la Direction, apposée sur les PDF générés par le SERVEUR.
 * JAMAIS dans `public/` : tout fichier de `public/` est servi tel quel, sans session (le proxy
 * exclut même les `*.png` de sa garde) — jusqu'au 2026-09-28, n'importe qui pouvait télécharger
 * la signature à l'adresse /signatures/signature-directrice.png. Elle vit dans `assets/`, à côté
 * des polices, et n'est lue que par `fs` côté serveur. Vérifié par signature-directrice.render.test.ts.
 */
export const SIGNATURE_DIRECTRICE_PATH = path.join(process.cwd(), "assets/signatures/signature-directrice.png");

/** La signature de la directrice n'est disponible que si le fichier a été déposé dans le projet. */
export function signatureDirectriceDisponible(): boolean {
  return fs.existsSync(SIGNATURE_DIRECTRICE_PATH);
}

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Garde-fou de source : aucun fichier de src/app ne doit peindre lui-même un bouton
 * d'approbation / de refus / de validation (couleur, forme, icône en dur). Le seul chemin
 * autorisé est d'importer BoutonApprouver / BoutonRefuser / BoutonValider (ou, pour une
 * étape intermédiaire qui n'est ni l'un ni l'autre, BTN_NEUTRE) depuis
 * "@/components/action-buttons".
 *
 * Règle (honnête, pas parfaite) : pour chaque .tsx de src/app, on repère les <button ...>
 * littéraux (pas un composant — <BoutonApprouver> etc. ne matche pas "<button\b") et on
 * regarde si le mot « Approuver », « Refuser » ou « Valider » apparaît dans les 400
 * caractères qui suivent l'ouverture de la balise — c'est-à-dire dans son className ou son
 * texte, puisque dans ce dépôt les deux sont toujours côte à côte. Si oui, le fichier doit
 * importer "@/components/action-buttons" ; sinon, quelqu'un a repeint un bouton de décision
 * à la main sans passer par la source unique.
 *
 * Ce que la règle NE détecte PAS (limite assumée, pas cachée) : un bouton peint à la main
 * dont le libellé n'utilise aucun des trois mots exacts (une icône seule, par exemple), ou
 * un mot surveillé qui apparaîtrait à plus de 400 caractères de la balise <button>.
 */

const RACINE_APP = join(__dirname, "..", "app");

// Exceptions documentées, pas des oublis : ces boutons emploient « Valider » au sens de
// « confirmer/enregistrer un formulaire », jamais pour approuver ou refuser une demande
// faite par quelqu'un d'autre — aucun n'a de bouton "Refuser" en vis-à-vis.
const EXCEPTIONS = new Set<string>([
  // Couleur qui code le SENS du mouvement (entrée = vert, sortie = rouge), pas une décision.
  "(stock)/stock/mouvements/mouvements-client.tsx",
  // Enregistre la réception d'un bon de commande déjà validé par la Direction ; bg-primary,
  // pas bg-success — aucun rapport avec l'approbation du bon lui-même (déjà convertie).
  "(stock)/stock/commandes/[id]/reception-client.tsx",
  // Enregistre une entrée en stock (formulaire de saisie) ; bg-primary, aucun bouton
  // "Refuser" en vis-à-vis — ce n'est l'approbation d'aucune demande.
  "(stock)/stock/entree/entree-client.tsx",
]);

function listerFichiersTsx(dir: string): string[] {
  const resultat: string[] = [];
  for (const entree of readdirSync(dir)) {
    const chemin = join(dir, entree);
    const info = statSync(chemin);
    if (info.isDirectory()) resultat.push(...listerFichiersTsx(chemin));
    else if (entree.endsWith(".tsx")) resultat.push(chemin);
  }
  return resultat;
}

const MOT_SURVEILLE = /\b(Approuver|Refuser|Valider)\b/;

/** true si une fenêtre de 400 caractères après un <button littéral contient un mot surveillé. */
function contientBoutonPeintALaMain(source: string): boolean {
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const fenetre = source.slice(m.index, m.index + 400);
    if (MOT_SURVEILLE.test(fenetre)) return true;
  }
  return false;
}

describe("action-buttons — garde-fou de source (src/app)", () => {
  const fichiers = listerFichiersTsx(RACINE_APP);

  it("tout <button> Approuver/Refuser/Valider peint à la main importe @/components/action-buttons", () => {
    const violations: string[] = [];
    for (const chemin of fichiers) {
      const relatif = relative(RACINE_APP, chemin).replace(/\\/g, "/");
      if (EXCEPTIONS.has(relatif)) continue;
      const source = readFileSync(chemin, "utf-8");
      if (!contientBoutonPeintALaMain(source)) continue;
      if (!source.includes("@/components/action-buttons")) violations.push(relatif);
    }
    expect(violations, `bouton(s) peint(s) à la main hors de la source unique : ${violations.join(", ")}`).toEqual([]);
  });

  it("la règle se falsifie — sanity check sur les exceptions déclarées", () => {
    // Si ce test échoue, une exception de la liste ne correspond plus à un fichier réel :
    // le garde-fou protégerait alors un fichier qui n'existe pas (silencieusement inutile).
    for (const relatif of EXCEPTIONS) {
      const chemin = join(RACINE_APP, relatif);
      expect(() => statSync(chemin), `exception obsolète : ${relatif} n'existe plus`).not.toThrow();
    }
  });
});

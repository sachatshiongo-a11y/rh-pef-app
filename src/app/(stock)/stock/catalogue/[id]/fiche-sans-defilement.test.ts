import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Fiche d'un article de l'inventaire : tout s'affiche DANS la page (Direction, 2026-09-28 :
 * « pourquoi ne pas juste les mettre sur la page »). Plus aucun cadre à hauteur bornée muni de sa
 * propre barre de défilement — ni pour les mouvements, ni pour l'historique des prix. Les listes
 * longues se déplient par tranches (« Voir les N … plus anciens »), dans la page.
 *
 * Contrôle de SOURCE : la page est un composant serveur branché sur Prisma ; ce qui compte ici,
 * ce sont les classes qu'elle pose, et elles sont toutes écrites dans ce fichier.
 */
const PAGE = path.join(__dirname, "page.tsx");

/** Classes qui créent un cadre défilant : hauteur bornée, ou défilement propre. */
const DEFILEMENT_INTERNE = /(?<![\w-])(max-h-[\w[\]./%-]+|overflow(?:-[xy])?-(?:auto|scroll))(?![\w-])/g;

describe("fiche article — pas de défilement interne", () => {
  const source = readFileSync(PAGE, "utf8");

  it("aucune classe de cadre défilant (max-h-*, overflow-auto, overflow-y-scroll…)", () => {
    expect(source.match(DEFILEMENT_INTERNE) ?? []).toEqual([]);
  });

  it("le détecteur voit bien les deux cadres d'origine", () => {
    const avant = `<div className="mt-3 max-h-64 overflow-auto"> <div className="max-h-[70vh] divide-y overflow-auto">`;
    expect(avant.match(DEFILEMENT_INTERNE)).toEqual(["max-h-64", "overflow-auto", "max-h-[70vh]", "overflow-auto"]);
  });

  it("les listes longues se déplient dans la page (mouvements et prix plus anciens)", () => {
    expect(source).toContain("Voir les {mouvementsChargesEnPlus} mouvements plus anciens");
    expect(source).toContain("Voir les {prixRecents.length - prixAffiches.length} achats plus anciens");
    expect(source).toContain("/stock/mouvements?articleId=");
  });
});

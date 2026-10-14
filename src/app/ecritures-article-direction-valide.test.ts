import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : « LA DIRECTION VALIDE » — AUCUNE ÉCRITURE D'ARTICLE DE L'INVENTAIRE SANS ELLE.
 *
 * Règle de Sacha (2026-09-30, reprise le 2026-10-14 pour la suppression et l'unité en masse) : un compte qui n'est
 * pas la Direction ne modifie pas un article — il PROPOSE (« À valider »), la Direction approuve ; seule la Direction
 * supprime. Une Server Action s'appelle directement : masquer le bouton ne protège rien.
 *
 * (Pendant, pour les articles, de `ecritures-fiche-sensible.test.ts`, qui garde les champs sensibles de la fiche
 * SALARIÉ : celui-ci ne voit pas `articleStock`.)
 *
 * Règle vérifiée sur `(stock)/stock/catalogue/actions.ts` : chaque fonction EXPORTÉE qui écrit l'article, son stock ou
 * ses fournisseurs — elle-même ou par une fonction NON exportée du même fichier — porte l'une des deux protections :
 *   - une garde Direction DURE (`exigerDirectionPourSupprimer`, `requireRole(…, ["ADMIN"])`, `if (!estDirection(…)) throw`) ;
 *   - ou le couple `estDirection(…)` + `proposer(…)` : hors Direction, le geste devient une proposition.
 * Sinon elle figure dans la liste fermée OUVERTE_PAR_CONCEPTION, avec sa raison.
 *
 * LIMITE ASSUMÉE (comme actions-gardees) : le test prouve que la protection est APPELÉE dans l'action, pas qu'elle précède
 * l'écriture ni que chaque branche est couverte ; les tests d'intégration (unite-masse, suppression-masse,
 * article-demande) prouvent le comportement. Il attrape l'oubli pur.
 */

const FICHIER = path.join(__dirname, "(stock)/stock/catalogue/actions.ts");

const ECRITURES = [
  /\.articleStock\.(?:create|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\.stock\.(?:create|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /\bappliquerPatchArticleTx\s*\(/,
  /\bposerStocksTx\s*\(/,
  /\bvariationsStockTx\s*\(/,
  /\bsupprimerArticlesSansHistoriqueTx\s*\(/,
  /\b(?:definirHabituelEnMasseTx|ajouterFournisseursEnMasseTx|retirerFournisseursEnMasseTx|definirHabituelTx)\s*\(/,
];
const GARDE_DURE = [
  /\bexigerDirectionPourSupprimer\s*\(/,
  /\brequireRole\s*\(\s*\w+\s*,\s*\[\s*["']ADMIN["']\s*\]\s*\)/,
  /\bif\s*\(\s*!\s*estDirection\s*\(\s*\w+\s*\)\s*\)\s*throw\b/,
];
const PROPOSITION = [/\bestDirection\s*\(/, /\bproposer\s*\(|\bgestesFournisseurs\s*\(/];

/** Exports qui écrivent l'article sans protection reconnue, avec ce qu'ils ont de moins. */
const OUVERTE_PAR_CONCEPTION: Record<string, string> = {
  creerArticle: "Création d'un article : permise à tous (un article nouveau n'est pas une modification), SIGNALÉE sur la cloche ; le stock initial est réservé à la Direction (`estDirection` dans le corps).",
};

function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
type Decl = { nom: string; exporte: boolean; corps: string };
function declarations(src: string): Decl[] {
  const re = /^(export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=)/gm;
  const debuts = [...src.matchAll(re)].map((m) => ({ exporte: !!m[1], nom: (m[2] ?? m[3])!, i: m.index! }));
  return debuts.map((d, k) => {
    const brut = src.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : src.length);
    const i = brut.indexOf("{");
    return { nom: d.nom, exporte: d.exporte, corps: i >= 0 ? brut.slice(i) : brut };
  });
}
const appelle = (corps: string, nom: string) => new RegExp(`\\b${nom}\\s*\\(`).test(corps);

/** Pour chaque export : écrit-il l'article, et par quelle protection est-il couvert ? (parcours des fonctions locales non exportées) */
function analyser(source: string) {
  const decls = declarations(sansCommentaires(source));
  const locales = decls.filter((d) => !d.exporte);
  const atteint = (d: Decl, test: (corps: string) => boolean, pile = new Set<string>()): boolean => {
    if (pile.has(d.nom)) return false;
    pile.add(d.nom);
    return test(d.corps) || locales.some((l) => l.nom !== d.nom && appelle(d.corps, l.nom) && atteint(l, test, pile));
  };
  return decls.filter((d) => d.exporte).map((d) => ({
    nom: d.nom,
    ecrit: atteint(d, (c) => ECRITURES.some((re) => re.test(c))),
    gardeDure: atteint(d, (c) => GARDE_DURE.some((re) => re.test(c))),
    proposition: PROPOSITION.every((re) => atteint(d, (c) => re.test(c))),
  }));
}
const sansProtection = (source: string) => analyser(source).filter((a) => a.ecrit && !a.gardeDure && !a.proposition).map((a) => a.nom);

const SOURCE = fs.readFileSync(FICHIER, "utf8");

describe("la Direction valide : aucune écriture d'article de l'Inventaire sans garde Direction ni proposition", () => {
  it("le parcours voit bien les actions d'écriture (garde contre un faux vert)", () => {
    const ecrivent = analyser(SOURCE).filter((a) => a.ecrit).map((a) => a.nom);
    for (const nom of ["modifierArticle", "categoriserEnMasse", "basculerActifArticles", "definirSeuilEnMasse", "changerDomaineEnMasse", "fusionnerArticles", "supprimerArticle", "supprimerArticlesEnMasse", "changerUniteEnMasse", "corrigerStocksNegatifs", "retirerFournisseurEnMasse"]) {
      expect(ecrivent, nom).toContain(nom);
    }
  });

  it("chaque action d'écriture est protégée, ou ouverte par conception (liste fermée)", () => {
    expect(sansProtection(SOURCE).filter((nom) => !(nom in OUVERTE_PAR_CONCEPTION))).toEqual([]);
  });

  it("la liste OUVERTE_PAR_CONCEPTION est fermée : chaque entrée existe, écrit encore et reste sans protection", () => {
    for (const [nom, raison] of Object.entries(OUVERTE_PAR_CONCEPTION)) {
      expect(raison.length, nom).toBeGreaterThan(20);
      expect(sansProtection(SOURCE), nom).toContain(nom);
    }
  });

  it("l'unité en masse : Direction = écriture, autre rôle = proposition (jamais d'écriture directe hors Direction)", () => {
    const corps = declarations(sansCommentaires(SOURCE)).find((d) => d.nom === "changerUniteEnMasse")!.corps;
    const hors = corps.indexOf("if (!estDirection(user))");
    expect(hors).toBeGreaterThan(-1);
    expect(corps.indexOf('proposer(user, "Unité en masse"')).toBeGreaterThan(hors);
    // Toute écriture de l'unité vient APRÈS la branche « hors Direction », qui sort par un `return`.
    expect(corps.indexOf(".articleStock.updateMany(")).toBeGreaterThan(corps.indexOf("return k === 0 ? r :"));
  });

  it("falsification : la branche « proposer » retirée de l'unité en masse → l'action est signalée", () => {
    expect(sansProtection(SOURCE)).not.toContain("changerUniteEnMasse");
    const f = SOURCE.replace(/if \(!estDirection\(user\)\) \{\s*const r = await proposer\(user, "Unité en masse"[\s\S]*?\n  \}\n/, "");
    expect(f).not.toBe(SOURCE);
    expect(sansProtection(f)).toContain("changerUniteEnMasse");
  });

  it("falsification : un export qui écrit l'article sans garde ni proposition → signalé", () => {
    const src = `"use server";
export const x = actionLisible(async (ids) => { await prisma.articleStock.updateMany({ where: { id: { in: ids } }, data: { unite: "g" } }); });`;
    expect(sansProtection(src)).toEqual(["x"]);
    const gardee = `"use server";
export const x = actionLisible(async (ids) => { const user = await garde(); if (!estDirection(user)) return proposer(user, "x", []); await prisma.articleStock.updateMany({}); });`;
    expect(sansProtection(gardee)).toEqual([]);
    const locale = `"use server";
async function ecrire(ids) { await tx.stock.upsert({}); }
export const y = actionLisible(async (ids) => { await ecrire(ids); });`;
    expect(sansProtection(locale)).toEqual(["y"]);
  });
});

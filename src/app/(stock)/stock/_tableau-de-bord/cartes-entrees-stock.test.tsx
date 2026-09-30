import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CartesEntreesStock, CartesEntreesStockVue } from "./cartes-entrees-stock";
import type { IndicateursEntrees } from "@/lib/indicateurs/entrees-stock";

// Rendu des cartes « Entrées de stock » du tableau de bord : ce que la Direction lit. Les chiffres
// viennent du calcul (testé sur une vraie base) ; ici, la présentation : égalité écrite, « partiel »,
// « Autres » quand il existe, légumes hors total, liens sur le mois reçu, période dite, écart jamais masqué.

const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
const vide = { montant: 0, nb: 0, nbSansValeur: 0 };
const base: IndicateursEntrees = {
  annee: 2026, mois: 9, cleMois: "2026-9", libellePeriode: "septembre 2026",
  total: { montant: 113.77, nb: 10, nbSansValeur: 3 },
  achats: { montant: 37.07, nb: 5, nbSansValeur: 1 },
  factures: { montant: 26.7, nb: 2, nbSansValeur: 0 },
  autres: { montant: 50, nb: 3, nbSansValeur: 2 },
  ecart: null,
  facture: { montant: 146.7, nb: 2 },
};
const rendu = (d: IndicateursEntrees, moisEnCours = true) => renderToStaticMarkup(<CartesEntreesStockVue donnees={d} moisEnCours={moisEnCours} />);
const carte = (html: string, cle: string) => {
  const i = html.indexOf(`data-carte="${cle}"`);
  if (i < 0) return null;
  const j = html.indexOf("data-carte=", i + 1);
  return html.slice(i, j < 0 ? undefined : j);
};

describe("cartes « Entrées de stock » du tableau de bord", () => {
  it("total, dont Liste d'achat, dont Factures, dont Autres : montants au format maison, égalité écrite en tête, légumes exclus", () => {
    const h = rendu(base);
    expect(texte(h)).toContain("Entrées de stock · septembre 2026 (mois en cours) · Total = Liste d'achat + Factures + Autres · légumes frais hors stock, non compris");
    expect(texte(carte(h, "total")!)).toContain("Total des entrées de stock 113,77 $ 10 entrée(s)");
    expect(texte(carte(h, "achats")!)).toContain("dont Liste d'achat 37,07 $ 5 entrée(s)");
    expect(texte(carte(h, "factures")!)).toContain("dont Factures fournisseurs 26,70 $ 2 entrée(s)");
    expect(texte(carte(h, "autres")!)).toContain("dont Autres entrées 50,00 $ 3 entrée(s)");
    expect(carte(h, "legumes")).toBeNull();
  });

  it("« partiel » annoncé avec le nombre d'entrées sans valeur (et teinte d'attention) ; rien quand tout est valorisé", () => {
    const h = rendu(base);
    expect(texte(carte(h, "total")!)).toContain("partiel : 3 sans valeur");
    expect(texte(carte(h, "achats")!)).toContain("partiel : 1 sans valeur");
    expect(texte(carte(h, "autres")!)).toContain("partiel : 2 sans valeur");
    expect(carte(h, "total")).toContain("bg-amber-50");
    expect(texte(carte(h, "factures")!)).not.toContain("partiel");
    expect(carte(h, "factures")).not.toContain("bg-amber-50");
    // Rien de valorisé : « — », jamais « 0,00 $ ».
    const h2 = rendu({ ...base, achats: { montant: 0, nb: 2, nbSansValeur: 2 } });
    expect(texte(carte(h2, "achats")!)).toContain("dont Liste d'achat — 2 entrée(s) · partiel : 2 sans valeur");
  });

  it("« Autres » n'apparaît que s'il existe de telles entrées ; l'égalité écrite suit ; le total prend alors la largeur", () => {
    const h = rendu({ ...base, total: { montant: 63.77, nb: 7, nbSansValeur: 1 }, autres: vide });
    expect(carte(h, "autres")).toBeNull();
    expect(texte(h)).toContain("Total = Liste d'achat + Factures · légumes");
    expect(texte(h)).not.toContain("Autres");
    expect(carte(h, "total")).toContain("col-span-2");
    expect(carte(rendu(base), "total")).not.toContain("col-span-2");
  });

  it("chaque carte ouvre Mouvements filtré sur le mois REÇU et sa catégorie", () => {
    const h = rendu({ ...base, annee: 2026, mois: 8, cleMois: "2026-8", libellePeriode: "août 2026" }, false);
    expect(carte(h, "total")).toContain('href="/stock/mouvements?mois=2026-8&amp;motif=entrees"');
    expect(carte(h, "achats")).toContain('href="/stock/mouvements?mois=2026-8&amp;motif=achats"');
    expect(carte(h, "factures")).toContain('href="/stock/mouvements?mois=2026-8&amp;motif=factures"');
    expect(carte(h, "autres")).toContain('href="/stock/mouvements?mois=2026-8&amp;motif=autres"');
  });

  it("le facturé du mois n'est rappelé que s'il diffère des entrées par facture (et reste alors visible sur téléphone)", () => {
    const f = carte(rendu(base), "factures")!;
    expect(texte(f)).toContain("facturé ce mois : 146,70 $");
    expect(f).not.toContain("hidden sm:block");
    expect(texte(carte(rendu({ ...base, facture: { montant: 26.7, nb: 1 } }), "factures")!)).not.toContain("facturé");
  });

  it("la période est dite ; « mois en cours » seulement quand c'est le cas", () => {
    expect(texte(rendu(base, true))).toContain("Entrées de stock · septembre 2026 (mois en cours)");
    const aout = texte(rendu({ ...base, cleMois: "2026-8", mois: 8, libellePeriode: "août 2026" }, false));
    expect(aout).toContain("Entrées de stock · août 2026 · Total");
    expect(aout).not.toContain("mois en cours");
  });

  it("un écart de classement est affiché, jamais masqué", () => {
    const h = rendu({ ...base, ecart: { montant: 12.5, nb: 1 } });
    expect(h).toContain('role="alert"');
    expect(texte(h)).toContain("Écart de classement : 1 entrée(s) et 12,50 $");
    expect(rendu(base)).not.toContain('role="alert"');
  });

  it("sans droit (voitMontants = false) : aucune carte, aucun chargement", () => {
    expect(renderToStaticMarkup(<CartesEntreesStock annee={2026} mois={9} voitMontants={false} />)).toBe("");
  });
});

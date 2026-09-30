import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListeDisponibilitePlats } from "./disponibilite-plats";
import { BlocDisponibilitePlatsVue } from "@/app/(stock)/stock/_tableau-de-bord/bloc-disponibilite-plats";
import type { DisponibilitePlats } from "@/app/(stock)/stock/fiches/_data/disponibilite-plats";

// Lignes du bloc « Plats (disponibilité selon le stock) », identiques sur l'Exploitation et le Stock.
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");
const donnees: DisponibilitePlats = {
  plats: { etats: { DISPONIBLE: 12, RUPTURE: 2, A_VERIFIER: 3 }, recettesACompleter: 4, nbVendues: 21 },
  bar: { etats: { DISPONIBLE: 5, RUPTURE: 0, A_VERIFIER: 1 }, recettesACompleter: 2, nbVendues: 8 },
};
const vide = { etats: { DISPONIBLE: 0, RUPTURE: 0, A_VERIFIER: 0 }, recettesACompleter: 0, nbVendues: 0 };

describe("liste de disponibilité des plats", () => {
  it("chiffres, ligne Bar et recettes à compléter", () => {
    const t = texte(renderToStaticMarkup(<ListeDisponibilitePlats donnees={donnees} avecLiens />));
    expect(t).toContain("Plats en rupture 2 Plats à vérifier 3 Plats disponibles 12 Recettes à compléter 4");
    expect(t).toContain("Fiches Bar (à part des plats) 5 dispo. · 0 rupture · 1 à vérifier · 2 recette(s) à compléter");
  });

  it("sans recette à compléter ni fiche Bar : ces lignes n'apparaissent pas ; les plats à 0 restent écrits (0 fiche, pas un inconnu)", () => {
    const t = texte(renderToStaticMarkup(<ListeDisponibilitePlats donnees={{ plats: { ...donnees.plats, recettesACompleter: 0 }, bar: vide }} avecLiens />));
    expect(t).not.toContain("Recettes à compléter");
    expect(t).not.toContain("Fiches Bar");
    expect(t).toContain("Plats en rupture 2");
  });

  it("liens vers la liste filtrée ; sans accès au Stock, aucun lien", () => {
    const h = renderToStaticMarkup(<ListeDisponibilitePlats donnees={donnees} avecLiens />);
    for (const href of ["/stock/fiches?etat=RUPTURE", "/stock/fiches?etat=A_VERIFIER", "/stock/fiches?etat=DISPONIBLE", "/stock/fiches?vue=boissons", "/stock/fiches"]) expect(h).toContain(`href="${href}"`);
    expect(renderToStaticMarkup(<ListeDisponibilitePlats donnees={donnees} avecLiens={false} />)).not.toContain("<a ");
  });

  it("téléphone : les lignes passent à la ligne au lieu de déborder", () => {
    const h = renderToStaticMarkup(<ListeDisponibilitePlats donnees={donnees} avecLiens />);
    expect(h).toContain("flex-wrap");
  });
});

describe("bloc du tableau de bord Stock", () => {
  it("titre, « Tout voir » vers les fiches, et « aujourd'hui » quand la page suit un mois passé", () => {
    const courant = renderToStaticMarkup(<BlocDisponibilitePlatsVue donnees={donnees} />);
    expect(texte(courant)).toContain("Plats (disponibilité selon le stock) Tout voir Plats en rupture 2");
    expect(courant).not.toContain("data-periode");
    const passe = renderToStaticMarkup(<BlocDisponibilitePlatsVue donnees={donnees} periode="aujourd'hui" />);
    expect(texte(passe)).toContain("Plats (disponibilité selon le stock) · aujourd'hui Tout voir");
    expect(passe).toContain('href="/stock/fiches"');
  });
});

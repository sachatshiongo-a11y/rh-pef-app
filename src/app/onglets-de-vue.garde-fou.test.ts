// GARDE-FOU « UN SEUL DESSIN D'ONGLETS DE VUE » (plan d'ergonomie H2, 2026-10-12).
//
// Avant : sept dessins d'onglets (segment commun, segment refait à la main, onglets soulignés,
// pastilles du MÊME dessin que les filtres, pastilles pleines, liste déroulante, sélecteur de période) :
// on ne distinguait plus « changer de VUE » de « FILTRER ». Maintenant les vues de ces écrans passent
// toutes par `OngletsDefilants` (segment encadré qui défile de côté sur téléphone) ; les pastilles
// rondes restent réservées aux filtres.
//
// Ce fichier fait échouer la suite si :
//   1. un des écrans convertis n'emploie plus `OngletsDefilants` ;
//   2. un écran converti perd le paramètre d'adresse de sa vue (`?tab=`, `?onglet=`, `?vue=`,
//      `?espace=`) : un lien, un favori ou une notification existants casserait ;
//   3. un ancien dessin réapparaît (onglets soulignés `-mb-px … border-b-2`, liste déroulante des
//      vues du planning).
// Ce qu'il ne couvre PAS : la mise en page réelle (à voir à l'œil, aux deux largeurs). L'onglet actif
// selon l'adresse est éprouvé sur les composants qui se montent sans base (onglets-vues.test.tsx,
// onglets-achats.test.tsx, ecran-fiches.test.tsx, restaurant-ecran.test.tsx).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = __dirname;
const lire = (rel: string) => readFileSync(path.join(APP, rel), "utf8");

/** Écran converti → le paramètre d'adresse qui porte sa vue (inchangé : aucun lien existant ne casse). */
const ECRANS: { fichier: string; param: RegExp; quoi: string }[] = [
  { fichier: "(app)/paie/page.tsx", param: /\/paie\?vue=/, quoi: "Paie" },
  { fichier: "(app)/employes/[id]/page.tsx", param: /\?tab=/, quoi: "fiche salarié" },
  { fichier: "(app)/employes/page.tsx", param: /lienVue\("transport"\)/, quoi: "Employés (Fiche RH / Transport)" },
  { fichier: "(app)/conges/page.tsx", param: /\/conges\?vue=calendrier/, quoi: "Congés (Liste)" },
  { fichier: "(app)/conges/calendrier.tsx", param: /\/conges\?vue=calendrier/, quoi: "Congés (Calendrier)" },
  { fichier: "(app)/documents/page.tsx", param: /\/documents\?onglet=/, quoi: "Documents" },
  { fichier: "(app)/planning/onglets-vues.tsx", param: /\/planning\?vue=modele/, quoi: "Planning" },
  { fichier: "(stock)/stock/archives/page.tsx", param: /\/stock\/archives\?vue=/, quoi: "Archives" },
  { fichier: "(stock)/stock/_achats/onglets-achats.tsx", param: /SOUS_ONGLETS_ACHATS/, quoi: "Achats & mouvements" },
  { fichier: "(stock)/stock/factures/page.tsx", param: /vue: "echeancier"/, quoi: "Factures (vues)" },
  { fichier: "(stock)/stock/restaurant/restaurant-ecran.tsx", param: /\/stock\/restaurant\?espace=/, quoi: "Stock restaurant" },
  { fichier: "(stock)/stock/fiches/ecran-fiches.tsx", param: /lienOngletFiches/, quoi: "Fiches techniques" },
];

describe("onglets de vue — un seul dessin (OngletsDefilants)", () => {
  for (const e of ECRANS) {
    it(`${e.quoi} : segment commun, paramètre d'adresse conservé`, () => {
      const src = lire(e.fichier);
      expect(src, `${e.fichier} doit employer OngletsDefilants`).toMatch(/<OngletsDefilants\b/);
      expect(src, `${e.fichier} a perdu son paramètre de vue`).toMatch(e.param);
    });
  }

  it("les paramètres d'adresse historiques sont toujours lus par les pages", () => {
    expect(lire("(app)/employes/[id]/page.tsx")).toMatch(/tab\?: string/);
    expect(lire("(app)/documents/page.tsx")).toMatch(/onglet\?: string/);
    expect(lire("(app)/paie/page.tsx")).toMatch(/vue\?: string/);
    expect(lire("(stock)/stock/archives/page.tsx")).toMatch(/sp\.vue ===/);
  });

  it("les onglets soulignés et la liste déroulante des vues n'existent plus", () => {
    const fautifs: string[] = [];
    (function parcourir(dir: string) {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) { parcourir(p); continue; }
        if (!/\.tsx$/.test(n) || /\.test\./.test(n)) continue;
        const src = readFileSync(p, "utf8");
        if (/-mb-px[^"`]*border-b-2/.test(src)) fautifs.push(`${path.relative(APP, p)} (onglets soulignés)`);
        if (/Choisir la vue du planning/.test(src)) fautifs.push(`${path.relative(APP, p)} (liste déroulante des vues)`);
      }
    })(APP);
    expect(fautifs).toEqual([]);
  });
});

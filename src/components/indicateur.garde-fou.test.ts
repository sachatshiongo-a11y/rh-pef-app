import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Plan d'ergonomie H3 (2026-10-12) : UNE seule carte de chiffres, `Indicateur`. Chaque écran recopiait la
// sienne (Kpi, CarteKpi, CarteChiffre…) avec ses espacements et ses teintes : onze cartes, onze aspects.
// Ce garde-fou refuse le retour d'une copie — par son NOM (définition ou emploi en JSX) — et exige que les
// écrans de la liste du plan emploient bien la carte commune (renommer une copie ne suffirait pas).
//
// Hors champ, à dessein : les PDF (`src/lib/pdf/`, react-pdf ne sait pas rendre une carte HTML) ; les blocs
// « chiffre » de l'espace salarié, de la fiche salarié (lot V12, autre branche) et la grille de transport,
// qui ne sont pas des cartes d'indicateurs de la liste du plan.
const NOMS_INTERDITS = ["Kpi", "KpiCard", "CarteKpi", "CarteChiffre", "CarteIndicateur", "CarteStat", "StatCard"];
const DEFINITION = new RegExp(`\\b(?:function|const|class)\\s+(?:${NOMS_INTERDITS.join("|")})\\b`);
const EMPLOI_JSX = new RegExp(`<(?:${NOMS_INTERDITS.join("|")})[\\s/>]`);

const fichiers = (readdirSync("src", { recursive: true }) as string[])
  .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx?$/.test(f) && !f.startsWith(join("lib", "pdf") + "/"))
  .map((f) => join("src", f));

// Les écrans que le plan (annexe A, « Cartes (H3) ») a converti : chacun doit importer la carte commune.
const ECRANS_CONVERTIS = [
  "src/app/(app)/accueil/page.tsx",
  "src/app/(stock)/stock/page.tsx",
  "src/app/(stock)/stock/factures/page.tsx",
  "src/app/(stock)/stock/fournisseurs/[id]/page.tsx",
  "src/app/(stock)/stock/catalogue/[id]/page.tsx",
  "src/app/(stock)/stock/fiches/[id]/editer-fiche.tsx",
  "src/app/(stock)/stock/imports/import-client.tsx",
  "src/app/(stock)/stock/imports/doublons-client.tsx",
  "src/app/(stock)/stock/imports/import-factures-client.tsx",
  "src/app/(exploitation)/exploitation/annuel/tableau-annuel.tsx",
  "src/app/(exploitation)/exploitation/rapports/apercu-rapport.tsx",
  "src/app/(exploitation)/exploitation/journal/page.tsx",
];

describe("une seule carte de chiffres : Indicateur", () => {
  it("trouve les fichiers à lire", () => {
    expect(fichiers.length).toBeGreaterThan(200);
  });
  it.each(fichiers)("%s : aucune copie de carte (Kpi, CarteKpi, CarteChiffre…)", (f: string) => {
    const s = readFileSync(f, "utf8");
    expect(s, "définition d'une carte maison").not.toMatch(DEFINITION);
    expect(s, "emploi d'une carte maison").not.toMatch(EMPLOI_JSX);
  });
  it.each(ECRANS_CONVERTIS)("%s : emploie la carte commune", (f: string) => {
    const s = readFileSync(f, "utf8");
    expect(s).toMatch(/import \{ Indicateur \} from "@\/components\/indicateur";/);
    expect(s).toMatch(/<Indicateur\b/);
  });
});

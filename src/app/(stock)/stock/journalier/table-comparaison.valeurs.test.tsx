// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableComparaison } from "./table-comparaison";
import { JOURS_FIXTURE, LABELS_FIXTURE, lignesFixture } from "./comparaison.fixture";
import { lignesExportComparaison, partiesPdfComparaison, type LigneComparaison } from "@/lib/journalier-restaurant";
import { feuilleExcelComparaison, partiesDocumentComparaison } from "@/lib/journalier-comparaison-export";
import avant from "./comparaison.valeurs-avant.json";

// « Aucun calcul ne change » : le tableau, le PDF et l'Excel de la Comparaison montrent les MÊMES
// valeurs qu'avant la refonte de lisibilité (2026-09-30). `comparaison.valeurs-avant.json` a été
// produit par l'ANCIEN composant et l'ANCIEN export sur ces mêmes lignes (`lignesFixture`, fabriquées
// par `lignesComparaison`) : 40 articles × 7 jours, écarts de toute nature, « — », grosses quantités.
// Ne le régénérez pas depuis le code courant : il perdrait son sens.

const lignes = lignesFixture(40);

describe("Comparaison : mêmes valeurs qu'avant la refonte de lisibilité", () => {
  it("le tableau affiche, case par case, les valeurs de l'ancien tableau (et les mêmes écarts)", () => {
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(<TableComparaison jours={JOURS_FIXTURE} lignes={lignes} sansMotif={0} />);
    const trs = [...div.querySelectorAll('[data-vue="semaine"] tr[data-article]')];
    expect(trs).toHaveLength(avant.nbLignes);
    const valeurs = trs.map((tr) => [...tr.children].map((td) => (td.querySelector("[data-valeur]") ?? td).textContent?.trim() ?? ""));
    expect(valeurs).toEqual(avant.ecran);
    const ecarts = trs.map((tr) => [...tr.children].map((td) => td.getAttribute("data-ecart") ?? ""));
    expect(ecarts).toEqual(avant.ecransEcarts);
  });

  it("grosses quantités et trois décimales : les mêmes textes qu'avant, à l'écran comme à l'export", () => {
    // Valeurs écrites à la main d'après l'ancien affichage (voir l'ancien test PDF : « 1 180,125 », « 1 268,5 »).
    const l: LigneComparaison = {
      id: "p", designation: "Parmigiano", categorie: "Frais", lien: true,
      cmd: [1250.5, 0, 0, 0, 0, 0, 0], liv: [1250.5, 0.333, 0, 0, 0, 0, 0], conso: ["1180.125", "0.333", null, null, null, null, null],
      ecarts: ["LIVRE_NON_CONSOMME", null, null, null, null, null, null],
    };
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(<TableComparaison jours={JOURS_FIXTURE} lignes={[l]} sansMotif={0} />);
    const cases = [...div.querySelectorAll('[data-vue="semaine"] tr[data-article] td')].map((td) => (td.querySelector("[data-valeur]") ?? td).textContent?.trim());
    // L'écran écrit commandé / livré par `qte` (espace fine insécable, comme avant) et le consommé en espace ordinaire.
    expect(cases.slice(1, 7)).toEqual(["1\u202f250,5", "1\u202f250,5", "1 180,125", "", "0,333", "0,333"]);
    expect(cases.slice(-3)).toEqual(["1\u202f250,5", "1\u202f250,833", "—"]);
    const e = lignesExportComparaison([l], LABELS_FIXTURE);
    expect(e.lignes[1]!.slice(1, 7)).toEqual(["1 250,5", "1 250,5", "1 180,125", "", "0,333", "0,333"]);
    expect(e.lignes[1]!.slice(-3)).toEqual(["1 250,5", "1 250,833", "—"]);
  });

  it("l'export garde ses valeurs, ses rubriques et ses cellules en écart", () => {
    const e = lignesExportComparaison(lignes, LABELS_FIXTURE);
    expect(e.lignes).toEqual(avant.export.lignes);
    expect(e.sectionRows).toEqual(avant.export.sectionRows);
    expect([...e.ecarts].sort()).toEqual(avant.export.ecarts);
    expect(e.entete).toEqual(avant.export.entete);
  });

  it("PDF et Excel : les valeurs de l'export, rien de plus que les écarts signés à côté", () => {
    const e = lignesExportComparaison(lignes, LABELS_FIXTURE);
    const donnees = { ...e, lignes: e.lignes };
    // PDF : chaque partie reprend les colonnes de l'export, telles quelles.
    for (const p of partiesDocumentComparaison(donnees, partiesPdfComparaison(LABELS_FIXTURE))) {
      const indices = partiesPdfComparaison(LABELS_FIXTURE).find((q) => q.titre === p.titre)!.indices;
      expect(p.lignes).toEqual(avant.export.lignes.map((l) => indices.map((i) => l[i] ?? "")));
    }
    // Excel : la valeur, puis (si écart) « (+n) » ou « (-n) » ; sans ce suffixe c'est l'export d'avant.
    const f = feuilleExcelComparaison({ ...donnees, enteteCourt: e.enteteCourt, groupesEntete: e.groupes });
    const sansSigne = f.lignes.map((l) => l.map((v) => String(v).replace(/ \([+-][^)]*\)$/, "")));
    expect(sansSigne).toEqual(avant.export.lignes);
    const avecSigne = f.lignes.flat().filter((v) => / \([+-][^)]*\)$/.test(String(v))).length;
    expect(avecSigne).toBe(e.signes.size);
    expect(avecSigne).toBeGreaterThan(20);
  });

  it("l'écart signé est bien conso - livré (et livré - commandé) ; jamais d'écart inventé", () => {
    const e = lignesExportComparaison(lignes, LABELS_FIXTURE);
    // Pour chaque cellule en écart de consommé, le signe est celui de (consommé - livré) calculé à part.
    let verifies = 0;
    for (const [cle, ecart] of e.signes) {
      const [r, c] = cle.split(":").map(Number) as [number, number];
      const ligneComp = lignes.find((l) => l.designation === e.lignes[r]![0])!;
      const jour = Math.floor((c - 1) / 3);
      if (ecart.nature === "LIVRE_DIFFERE") {
        expect(ecart.signe.startsWith(ligneComp.liv[jour]! > ligneComp.cmd[jour]! ? "+" : "-")).toBe(true);
      } else {
        const delta = Number(ligneComp.conso[jour]) - ligneComp.liv[jour]!;
        expect(ecart.signe.startsWith(delta > 0 ? "+" : "-")).toBe(true);
        expect(ecart.nature).toBe(delta > 0 ? "CONSOMME_PLUS_QUE_LIVRE" : "LIVRE_NON_CONSOMME");
      }
      verifies++;
    }
    expect(verifies).toBe(e.signes.size);
    // Tout écart de consommé de l'export a un signe (aucun n'est resté coloré seul).
    expect([...e.ecarts].every((k) => e.signes.has(k))).toBe(true);
  });
});

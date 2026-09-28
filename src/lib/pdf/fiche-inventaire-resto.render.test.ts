import { describe, it, expect } from "vitest";
import { renderPdfBuffer } from "./fonts";
import { policesDeRepli, pagesDuPdf } from "@/lib/test/pdf-lecture";
import { FichesInventaireDocument, rangeesFicheInventaire, type ArticleFiche } from "./fiche-inventaire-resto";

/** Fiches d'inventaire Cuisine / Bar : ce que le PDF rendu montre, page par page. */

const art = (categorie: string | null, designation: string, unite: string | null = "Kg", actif = true): ArticleFiche => ({ categorie, designation, unite, actif });

describe("rangées d'une fiche d'inventaire", () => {
  it("une rubrique par catégorie dans l'ordre reçu, les articles inactifs écartés, cases Stock et Commentaire vides", () => {
    const rangees = rangeesFicheInventaire("CUISINE", [
      art("Crèmerie", "Beurre", "Pièce"),
      art("Crèmerie", "Comté", "Kg", false),
      art("Pâtes", "Fusilli", "Paquet"),
      art(null, "Sel fin"),
    ]);
    expect(rangees).toEqual([
      { rubrique: "Crèmerie" },
      { cellules: ["Beurre", "Pièce", "", ""] },
      { rubrique: "Pâtes" },
      { cellules: ["Fusilli", "Paquet", "", ""] },
      { rubrique: "Sans catégorie" },
      { cellules: ["Sel fin", "Kg", "", ""] },
    ]);
  });

  it("Bar : la deuxième colonne porte la catégorie, pas l'unité", () => {
    expect(rangeesFicheInventaire("BAR", [art("Bière locale", "Castel", "Bouteille")])).toEqual([
      { rubrique: "Bière locale" },
      { cellules: ["Castel", "Bière locale", "", ""] },
    ]);
  });
});

describe("fiche d'inventaire rendue", () => {
  it("accents, apostrophes et esperluettes des vrais libellés : aucune police de repli", async () => {
    const pdf = await renderPdfBuffer(FichesInventaireDocument({
      fiches: [
        { espace: "CUISINE", articles: [art("Viande -Volaille-Poisson-Crustacés", "Portion de Pôeléé de cossas", "Pièce"), art("Crèmerie", "Œufs", "Pièce"), art("Crèmerie", "Crème de cuisson (boite) Elle & vire", "L")] },
        { espace: "BAR", articles: [art("Vin Rosé", "Rose D'Anjou", "Bouteille"), art("Champagne", "Moêt et Chandon Rosé", "Bouteille"), art("Limonade et autre", "Vital'Ô", "Bouteille")] },
      ],
    }));
    expect(policesDeRepli(pdf)).toEqual([]);
    const plat = (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
    for (const t of ["Œufs", "Crème de cuisson (boite) Elle & vire", "Vital'Ô", "Moêt et Chandon Rosé"]) expect(plat).toContain(t);
  }, 60_000);

  it("une rubrique n'est jamais la dernière ligne d'une page, où qu'elle tombe", async () => {
    // On décale la seconde rubrique ligne par ligne : l'un de ces décalages la fait tomber en bas
    // de la première page. Elle doit alors passer à la page suivante avec ses articles.
    const rubriqueTombeEnBas: number[] = [];
    for (let n = 24; n <= 36; n++) {
      const articles = [
        ...Array.from({ length: n }, (_, i) => art("Crèmerie", `Crème ${String(i + 1).padStart(2, "0")}`)),
        ...Array.from({ length: 10 }, (_, i) => art("Pâtes", `Pâte ${String(i + 1).padStart(2, "0")}`)),
      ];
      const pages = await pagesDuPdf(await renderPdfBuffer(FichesInventaireDocument({ fiches: [{ espace: "CUISINE", articles }] })));
      for (const p of pages) {
        const dernier = p.lignes.filter((l) => /^(Crème \d\d Kg|Pâte \d\d Kg|Crèmerie|Pâtes)$/.test(l)).at(-1);
        if (dernier === "Crèmerie" || dernier === "Pâtes") rubriqueTombeEnBas.push(n);
      }
    }
    expect(rubriqueTombeEnBas).toEqual([]);
  }, 120_000);
});

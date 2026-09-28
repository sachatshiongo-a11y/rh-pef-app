import { describe, it, expect } from "vitest";
import { renderPdfBuffer } from "./fonts";
import { policesDeRepli, pagesDuPdf } from "@/lib/test/pdf-lecture";
import { LEGUMES } from "@/app/(stock)/stock/legumes/legumes-data";
import { FicheAchatLegumesDocument, ficheAchatRemplie, ficheAchatVierge, type AchatDuJour } from "./fiche-achat-legumes";

/**
 * Fiche « Achat de légumes Marché » (modèle de la Direction, 2026-09-28). Les PDF sont RENDUS
 * puis relus : titre, colonnes, totaux, une rangée par légume, aucune police de repli.
 */

const achat = (legume: string, unite: string | null, quantite: number, montantCDF: number | null, montantUSD: number | null = null): AchatDuJour =>
  ({ legume, unite, quantite, montantCDF, montantUSD });

describe("liste des légumes", () => {
  it("reprend les 38 lignes de la fiche de la Direction, dans son ordre, « Menthe » sans unité", () => {
    expect(LEGUMES).toHaveLength(38);
    expect(LEGUMES.slice(0, 3).map((l) => l.nom)).toEqual(["Ail", "Ananas", "Aubergine"]);
    expect(LEGUMES.slice(-6).map((l) => `${l.nom}|${l.unite}`)).toEqual([
      "Tomates fraiches|Kg", "Cubes|Pièce", "Cerise en boîte|Boîte", "Tomates cerises|Kg", "Tomates séchées|Boîte", "Feuilles de menthe|Boîte",
    ]);
    expect(LEGUMES.find((l) => l.nom === "Menthe")?.unite).toBe("");
    expect(new Set(LEGUMES.map((l) => l.nom)).size).toBe(38);
  });
});

describe("fiche d'achat vierge", () => {
  it("titre, « Date : », colonnes, 38 légumes avec leur unité et les trois totaux, sur UNE page A4", async () => {
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatVierge(LEGUMES) }));
    const pages = await pagesDuPdf(pdf);
    expect(pages).toHaveLength(1);
    const [page] = pages;
    expect(page.plat).toContain("Achat de légumes Marché");
    expect(page.plat).toContain("Date :");
    expect(page.plat).toMatch(/Désignation Unité QTÉ Montant/);
    for (const l of LEGUMES) expect(page.lignes, l.nom).toContain(`${l.nom}${l.unite ? ` ${l.unite}` : ""}`);
    for (const t of ["Montant donné $", "Montant total CDF", "Montant total $"]) expect(page.plat).toContain(t);
  }, 60_000);

  it("aucune police de repli", async () => {
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatVierge(LEGUMES) }));
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});

describe("fiche d'achat remplie", () => {
  const ACHATS = [
    achat("Ail", "Kg", 2.5, 12500, 4.46),
    achat("Oignons", "Kg", 10, 25000, 8.93),
    achat("Oignons", "Kg", 5, 12500, 4.46), // deuxième achat du même légume : s'additionne
    achat("lemons/citrons-verts", "Kg", 1, 3000, 1.07), // libellé saisi autrement : même légume
    achat("Champignons de Paris", "Kg", 1.25, 1234567.5, 440.9), // hors liste
  ];

  it("quantité et montant au bon légume, légumes non achetés vides, légume hors liste en fin", () => {
    const f = ficheAchatRemplie(LEGUMES, ACHATS, 2800);
    expect(f.lignes).toHaveLength(39);
    const ligne = (nom: string) => f.lignes.find((l) => l.designation === nom)!;
    expect(ligne("Ail")).toMatchObject({ quantite: 2.5, montantCDF: 12500, horsListe: false });
    expect(ligne("Oignons")).toMatchObject({ quantite: 15, montantCDF: 37500 });
    expect(ligne("Lemons / Citrons-verts")).toMatchObject({ quantite: 1, montantCDF: 3000 });
    expect(ligne("Aubergine")).toMatchObject({ quantite: null, montantCDF: null });
    expect(f.lignes.at(-1)).toMatchObject({ designation: "Champignons de Paris", unite: "Kg", quantite: 1.25, montantCDF: 1234567.5, horsListe: true });
    expect(f.totalCDF).toBe(12500 + 25000 + 12500 + 3000 + 1234567.5);
    expect(f.totalUSD).toBeCloseTo(4.46 + 8.93 + 4.46 + 1.07 + 440.9, 6);
    expect(f.mentions).toEqual([]);
  });

  it("un achat dans une autre unité que la liste ne s'additionne pas : il va en fin de tableau", () => {
    const f = ficheAchatRemplie(LEGUMES, [achat("Ail", "Kg", 1, 5000, 1.79), achat("Ail", "Botte", 3, 1500, 0.54)], 2800);
    expect(f.lignes.find((l) => l.designation === "Ail")).toMatchObject({ unite: "Kg", quantite: 1, montantCDF: 5000 });
    expect(f.lignes.at(-1)).toMatchObject({ designation: "Ail", unite: "Botte", quantite: 3, horsListe: true });
  });

  it("dollars : la contre-valeur enregistrée prime ; sans elle, taux actuel ANNONCÉ ; sans taux, total incomplet annoncé", () => {
    const f = ficheAchatRemplie(LEGUMES, [achat("Ail", "Kg", 1, 2800, 1.2), achat("Thym", "Botte", 1, 5600, null)], 2800);
    expect(f.totalUSD).toBeCloseTo(1.2 + 2, 6);
    expect(f.mentions.join(" ")).toMatch(/taux actuel .* provisoire/);
    const sansTaux = ficheAchatRemplie(LEGUMES, [achat("Thym", "Botte", 1, 5600, null)], 0);
    expect(sansTaux.totalUSD).toBeNull();
    expect(sansTaux.mentions.join(" ")).toMatch(/incomplet/);
  });

  it("le PDF montre les valeurs sur la bonne rangée, les totaux, le hors-liste en fin, sans police de repli", async () => {
    const pdf = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche: ficheAchatRemplie(LEGUMES, ACHATS, 2800), date: "28/09/2026" }));
    const pages = await pagesDuPdf(pdf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).toContain("Date : 28/09/2026");
    expect(lignes).toContain("Ail Kg 2,5 12 500");
    expect(lignes).toContain("Oignons Kg 15 37 500");
    expect(lignes).toContain("Aubergine Kg"); // non acheté : cases vides
    expect(lignes).toContain("Champignons de Paris Kg 1,25 1 234 567,5");
    // Le hors-liste vient APRÈS le dernier légume de la liste.
    expect(lignes.indexOf("Champignons de Paris Kg 1,25 1 234 567,5")).toBeGreaterThan(lignes.indexOf("Feuilles de menthe Boîte"));
    expect(plat).toMatch(/Montant total CDF 1 287 567,5/);
    expect(plat).toMatch(/Montant total \$ 459,82/);
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});

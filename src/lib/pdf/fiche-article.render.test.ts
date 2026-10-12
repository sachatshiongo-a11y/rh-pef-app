import { describe, it, expect } from "vitest";
import { renderPdfBuffer } from "./fonts";
import { FicheArticleDocument, libellePastilleMouvement, type MouvementLigne } from "./fiche-article";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";
import type { AnalysePrix } from "@/lib/stock-prix";

// Fiche article (PDF) : l'historique des mouvements porte les mêmes pastilles que l'écran (type + motif d'une sortie).
const ANALYSE: AnalysePrix = { points: [], min: null, max: null, dernier: null, precedent: null, variation: null, moyenneAnterieure: null, hausse: null };
const M = (id: string, type: string, extra: Partial<MouvementLigne> = {}): MouvementLigne => ({ id, date: new Date("2026-09-10T00:00:00Z"), type, quantite: 3, origine: null, source: null, ...extra });

describe("fiche article PDF — pastilles des mouvements", () => {
  it("le libellé de la pastille : type, et motif pour une sortie (« sans motif » dit tel quel)", () => {
    expect(libellePastilleMouvement({ type: "ENTREE" })).toBe("Entrée");
    expect(libellePastilleMouvement({ type: "SORTIE", motif: "PERTE" })).toBe("Sortie · Perte");
    expect(libellePastilleMouvement({ type: "SORTIE", motif: "LIVRAISON_RESTAURANT" })).toBe("Sortie · Livraison restaurant");
    expect(libellePastilleMouvement({ type: "SORTIE", motif: null })).toBe("Sortie · sans motif");
    expect(libellePastilleMouvement({ type: "AJUSTEMENT" })).toBe("Ajustement");
  });

  it("le PDF contient la colonne Type et les pastilles, sans caractère interdit en PDF", async () => {
    const pdf = await renderPdfBuffer(FicheArticleDocument({
      designation: "Farine", code: null, domaineLabel: "Nourriture", categorieNom: "Épicerie", fournisseurNom: "—", unite: "kg", stock: 10, stockMinimum: 2, seuilUrgent: 1,
      valeur: null, prixReference: null, alerteLabel: "OK", analyse: ANALYSE,
      mouvements: [M("1", "ENTREE"), M("2", "SORTIE", { motif: "PERTE" }), M("3", "AJUSTEMENT")],
    }));
    const texte = (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
    for (const t of ["Type", "Entrée", "Sortie · Perte", "Ajustement"]) expect(texte).toContain(t);
    expect(texte).not.toMatch(/[ −→⚠]/);
    expect(await policesDeRepli(pdf)).toEqual([]);
  });
});

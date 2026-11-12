import { describe, it, expect } from "vitest";
import { renderPdfBuffer } from "./fonts";
import { FicheFournisseurDocument } from "./fiche-fournisseur";
import { construireFiche, type FournisseurBrut } from "@/lib/fiche-fournisseur-export";
import { PdfTropLongError } from "./plafond";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";

const F: FournisseurBrut = { id: "f1", nom: "Mamie Courgette", contactNom: "Mme Kasa", telephone: "+243 81", email: null, adresse: null, ville: "Kinshasa", pays: null, rccm: null, idNational: null, delaiPaiement: null, delaiLivraison: null, modePaiement: null, produits: null };
const fiche = (nom: string) => construireFiche(
  { ...F, nom },
  [{ numero: "F1", date: new Date("2026-10-01T00:00:00Z"), dateEcheance: null, statut: "A_REGLER", annee: 2026, mois: 10, devise: "USD", montantUSD: null, resteAPayerUSD: null }],
  [], [{ designation: "Farine", categorieNom: "Épicerie", habituel: false, devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: 7000 }], 2800, "2026-11-12",
);

describe("fiche fournisseur PDF", () => {
  it("rend une fiche : sections, montant illisible en « — », devise respectée, pas de caractère interdit", async () => {
    const pdf = await renderPdfBuffer(FicheFournisseurDocument({ fiches: [fiche("Mamie Courgette")] }));
    const texte = (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
    for (const t of ["FICHE FOURNISSEUR", "Mamie Courgette", "IDENTITÉ ET COORDONNÉES", "ARTICLES FOURNIS (1)", "FACTURES", "illisible", "7 000 FC"]) expect(texte).toContain(t);
    expect(texte).not.toMatch(/[\u00a0\u202f\u2212\u2192\u26a0]/); // espaces insécables, moins typographique, flèche, panneau : absents de la police
    expect(await policesDeRepli(pdf)).toEqual([]);
  }, 30000);

  it("un lot : une fiche après l'autre", async () => {
    const pdf = await renderPdfBuffer(FicheFournisseurDocument({ fiches: [fiche("Alpha"), fiche("Beta")] }));
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const texte = pages.map((p) => p.plat).join(" ");
    expect(texte).toContain("Alpha"); expect(texte).toContain("Beta");
  }, 30000);

  it("refuse, avant tout rendu, un lot au-delà du plafond de lignes", () => {
    expect(() => FicheFournisseurDocument({ fiches: Array.from({ length: 50 }, () => fiche("X")).flatMap((f) => Array(30).fill(f)) })).toThrow(PdfTropLongError);
  });
});

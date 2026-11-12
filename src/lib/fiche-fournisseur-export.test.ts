import { describe, it, expect } from "vitest";
import { chiffresFactures, construireFiche, lireMontant, type FactureBrute, type FournisseurBrut } from "./fiche-fournisseur-export";

const F: FournisseurBrut = { id: "f1", nom: "Mamie Courgette", contactNom: "Mme Kasa", telephone: "+243 81", email: null, adresse: null, ville: "Kinshasa", pays: null, rccm: null, idNational: null, delaiPaiement: null, delaiLivraison: null, modePaiement: null, produits: null };
const fac = (o: Partial<FactureBrute>): FactureBrute => ({ numero: "F1", date: new Date("2026-10-01T00:00:00Z"), dateEcheance: new Date("2026-10-30T00:00:00Z"), statut: "A_REGLER", annee: 2026, mois: 10, devise: "USD", montantUSD: 100, montantRegleUSD: 0, resteAPayerUSD: 100, ...o });
const AUJ = "2026-11-12";

describe("fiche fournisseur exportable — montants", () => {
  it("lireMontant : absent ou illisible = null, jamais 0 ; un vrai 0 reste 0", () => {
    expect(lireMontant(null)).toBeNull();
    expect(lireMontant("")).toBeNull();
    expect(lireMontant("abc")).toBeNull();
    expect(lireMontant("0")).toBe(0);
    expect(lireMontant("12.5")).toBe(12.5);
  });

  it("totaux par devise, sans mélange dollars / francs ; l'échu se juge à la lecture", () => {
    const { chiffres } = chiffresFactures([
      fac({}),
      fac({ devise: "CDF", montantUSD: null, resteAPayerUSD: null, montantCDF: 280000, montantRegleCDF: 0, resteAPayerCDF: 280000 }),
      fac({ statut: "REGLEE", montantUSD: 50, resteAPayerUSD: 0 }),
    ], 2800, AUJ);
    const [total, paye, impaye, echu] = chiffres;
    expect(total!.valeur).toContain("$"); expect(total!.valeur).toContain("FC"); expect(total!.valeur).toContain("+");
    expect(paye!.valeur).toContain("50");
    expect(impaye!.libelle).toBe("Impayé (2)");
    expect(echu!.libelle).toBe("Échu (2)");
    expect(total!.sousTexte).toContain("≈");
  });

  it("un montant illisible n'est pas compté comme zéro : exclu des totaux, écrit « — », signalé", () => {
    const illisible = fac({ numero: "X", montantUSD: null });
    const { chiffres, avertissement } = chiffresFactures([illisible], null, AUJ);
    expect(chiffres.map((c) => c.valeur)).toEqual(["—", "—", "—", "—"]);
    expect(avertissement).toContain("1 facture(s)");
    const fiche = construireFiche(F, [illisible, fac({ numero: "Y" })], [], [], null, AUJ);
    expect(fiche.factures.find((x) => x.numero === "X")!.montant).toBe("—");
    expect(fiche.factures.find((x) => x.numero === "Y")!.montant).toContain("100");
    expect(fiche.chiffres[0]!.valeur).toContain("100"); // seule la facture lisible compte
  });

  it("francs sans taux : équivalent « — », jamais 0", () => {
    const { chiffres } = chiffresFactures([fac({ devise: "CDF", montantCDF: 1000, resteAPayerCDF: 1000, montantUSD: null, resteAPayerUSD: null })], null, AUJ);
    expect(chiffres[0]!.sousTexte).toContain("—");
  });

  it("aucune facture : zéros vrais, pas d'avertissement", () => {
    const { chiffres, avertissement } = chiffresFactures([], 2800, AUJ);
    expect(chiffres[0]!.valeur).toContain("0");
    expect(avertissement).toBeNull();
  });
});

describe("fiche fournisseur exportable — contenu", () => {
  it("identité : seulement les champs renseignés ; factures récentes plafonnées avec le vrai compte", () => {
    const factures = Array.from({ length: 20 }, (_, i) => fac({ numero: `N${i}`, mois: (i % 12) + 1 }));
    const fiche = construireFiche(F, factures, [], [], 2800, AUJ);
    expect(fiche.identite.map((l) => l.libelle)).toEqual(["Contact", "Téléphone", "Ville"]);
    expect(fiche.factures).toHaveLength(15);
    expect(fiche.nbFactures).toBe(20);
  });

  it("articles : prix dans la devise de saisie, autre devise au taux (« ≈ — » sans taux)", () => {
    const art = { designation: "Farine", categorieNom: "Épicerie", habituel: true, devisePrix: "CDF" as const, prixUnitaireUSD: null, prixUnitaireCDF: 7000 };
    const avec = construireFiche(F, [], [], [art], 2800, AUJ).articles[0]!;
    expect(avec.prix).toContain("FC"); expect(avec.prixAutre).toContain("$"); expect(avec.lien).toBe("Habituel");
    expect(construireFiche(F, [], [], [art], null, AUJ).articles[0]!.prixAutre).toBe("≈ —");
    const sans = construireFiche(F, [], [], [{ ...art, prixUnitaireCDF: null }], 2800, AUJ).articles[0]!;
    expect(sans.prix).toBe("—");
  });

  it("bons : total « — » quand rien n'est chiffré", () => {
    const fiche = construireFiche(F, [], [{ numero: "001/PEF", date: new Date("2026-10-02T00:00:00Z"), statut: "VALIDE", devise: "USD", totalUSD: null, nbLignes: 2, nbSansPrix: 2 }], [], 2800, AUJ);
    expect(fiche.bons[0]!.total).toMatch(/^—/);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { SQL_CONTRAINTES_FACTURES, poserContraintesFactures } from "@/lib/test/contraintes-factures";

// Migration « factures en francs » : les données d'AVANT (factures, lignes et paiements en dollars,
// écrits comme le logiciel les écrivait jusqu'au 2026-10-08) satisfont les trois contraintes CHECK
// sans aucune réécriture ; puis la base refuse toute facture à cheval sur deux devises.

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let factureUSD = "";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  // Écritures d'avant : aucune devise (défaut USD), montants en dollars, colonnes en francs absentes.
  const f = await prisma.factureFournisseur.create({
    data: {
      fournisseurNom: "ETS SENEVE", montantUSD: 150, montantRegleUSD: 50, resteAPayerUSD: 100, mois: 9, annee: 2026,
      lignes: { create: [{ designation: "Farine", quantite: 10, prixUnitaireUSD: 15, totalLigneUSD: 150 }] },
    },
  });
  factureUSD = f.id;
  await prisma.paiement.create({ data: { factureId: f.id, date: new Date("2026-09-10"), montantUSD: 30 } });
  await prisma.paiement.create({ data: { factureId: f.id, date: new Date("2026-09-11"), montantUSD: 20, montantCDF: 56000, tauxChangeUtilise: 2800 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("migration 20261009120000_factures_francs", () => {
  it("contient les trois contraintes", () => {
    expect(SQL_CONTRAINTES_FACTURES.map((s) => s.match(/"(\w+_devise_check)"/)?.[1])).toEqual(["FactureFournisseur_devise_check", "Paiement_devise_check", "LigneFacture_devise_check"]);
  });

  it("les données d'avant les satisfont, sans réécriture (aucun chiffre ne change)", async () => {
    await poserContraintesFactures(prisma);
    const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: factureUSD }, include: { lignes: true, paiements: true } });
    expect([f.devise, f.montantUSD?.toString(), f.montantRegleUSD?.toString(), f.resteAPayerUSD?.toString(), f.montantCDF, f.resteAPayerCDF]).toEqual(["USD", "150", "50", "100", null, null]);
    expect(f.paiements.map((p) => p.devise)).toEqual(["USD", "USD"]);
  });

  it("refuse une facture en francs avec un reste en dollars, ou sans reste en francs", async () => {
    const base = { fournisseurNom: "X", mois: 10, annee: 2026, devise: "CDF" as const };
    await expect(prisma.factureFournisseur.create({ data: { ...base, montantCDF: 1000, montantRegleCDF: 0, resteAPayerCDF: 1000 } })).rejects.toThrow(/FactureFournisseur_devise_check/); // dollars par défaut à 0
    await expect(prisma.factureFournisseur.create({ data: { ...base, montantCDF: 1000, montantRegleCDF: 0, resteAPayerCDF: null, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null } })).rejects.toThrow(/FactureFournisseur_devise_check/);
    await expect(prisma.factureFournisseur.create({ data: { fournisseurNom: "X", mois: 10, annee: 2026, montantUSD: 10, montantCDF: 28000, montantRegleCDF: 0, resteAPayerCDF: 28000 } })).rejects.toThrow(/FactureFournisseur_devise_check/);
    const ok = await prisma.factureFournisseur.create({ data: { ...base, montantCDF: 1000, montantRegleCDF: 0, resteAPayerCDF: 1000, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null } });
    expect(ok.devise).toBe("CDF");
    // Paiement imputé en francs : montant en francs obligatoire.
    await expect(prisma.paiement.create({ data: { factureId: ok.id, devise: "CDF", date: new Date("2026-10-01"), montantUSD: 1 } })).rejects.toThrow(/Paiement_devise_check/);
    await prisma.paiement.create({ data: { factureId: ok.id, devise: "CDF", date: new Date("2026-10-01"), montantCDF: 500 } });
    // Ligne : une seule devise.
    await expect(prisma.ligneFacture.create({ data: { factureId: ok.id, designation: "Y", quantite: 1, prixUnitaireUSD: 1, totalLigneUSD: 1, prixUnitaireCDF: 2800, totalLigneCDF: 2800 } })).rejects.toThrow(/LigneFacture_devise_check/);
    await prisma.ligneFacture.create({ data: { factureId: ok.id, designation: "Y", quantite: 1, prixUnitaireCDF: 1000, totalLigneCDF: 1000 } });
  });
});

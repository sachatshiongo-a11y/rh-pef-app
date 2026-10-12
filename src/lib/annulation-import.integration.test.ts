import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// ANNULER UN IMPORT ne doit jamais effacer ce qui a été saisi depuis (audit du 10/10/2026, constat 1 :
// l'annulation reposait la valeur d'AVANT en absolu — les mouvements postérieurs disparaissaient du stock).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { appliquerMouvements } = await import("@/lib/import-mouvements");
const { annulerImport } = await import("@/lib/import-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let userId: string;
const CSV = "Date,Code article,Désignation,Entrées,Sorties\n10/06/2026,3,Riz basmati 5kg,5,2";
const stockDe = async (articleId: string) => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite);
const nouvelArticle = async (designation: string, quantite: number) => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg" } });
  await prisma.stock.create({ data: { articleId: a.id, quantite } });
  return a.id;
};
/** Un import d'inventaire « posé » à la main : la valeur d'avant est 10, le stock actuel 20. */
async function inventairePose(articleId: string, avant: string, createdAt = new Date(Date.now() - 3_600_000)) {
  const batch = await prisma.importBatch.create({ data: { type: "INVENTAIRE", libelle: "Inventaire de test", createdAt } });
  await prisma.importOperation.create({ data: { batchId: batch.id, entite: "Stock", entiteId: articleId, action: "UPDATE", avant: { quantite: avant } } });
  return batch.id;
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  userId = (await prisma.user.create({ data: { email: "t@pef.cd", nom: "Testeur", role: "ADMIN" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("annulation d'un import de MOUVEMENTS — l'effet de l'import seul est défait", () => {
  it("une sortie saisie après l'import survit à l'annulation (variation inverse, pas valeur absolue)", async () => {
    const articleId = (await prisma.articleStock.create({ data: { code: "3", designation: "Riz basmati 5kg", domaine: "NOURRITURE", unite: "Sac" } })).id;
    await prisma.stock.create({ data: { articleId, quantite: 10 } });
    const { batchId } = await appliquerMouvements(CSV, "Import juin", "2026-06-10", userId);
    expect(await stockDe(articleId)).toBe(13); // 10 + 5 − 2
    // Une sortie saisie à la main APRÈS l'import.
    await prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite: 1, date: new Date("2026-06-12"), origine: "Sortie manuelle" } });
    await prisma.stock.update({ where: { articleId }, data: { quantite: 12 } });

    await annulerImport(batchId, userId);

    // 12 − (5 − 2) = 9. L'ancien code reposait 10 (valeur d'avant) : la sortie manuelle d'1 sac disparaissait du stock.
    expect(await stockDe(articleId)).toBe(9);
    const restants = await prisma.mouvementStock.findMany({ where: { articleId } });
    expect(restants.map((m) => m.origine)).toEqual(["Sortie manuelle"]);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).statut).toBe("ANNULE");
  }, 60_000);

  it("refuse dans un mois clôturé, sans rien défaire", async () => {
    const articleId = (await prisma.articleStock.create({ data: { code: "7", designation: "Farine T55", domaine: "NOURRITURE", unite: "kg" } })).id;
    await prisma.stock.create({ data: { articleId, quantite: 10 } });
    const { batchId } = await appliquerMouvements("Date,Code article,Désignation,Entrées,Sorties\n05/05/2026,7,Farine T55,4,0", "Import mai", "2026-05-05", userId);
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 5, creeParId: userId } });

    await expect(annulerImport(batchId, userId)).rejects.toThrow(/clôturée/i);

    expect(await stockDe(articleId)).toBe(14);
    expect(await prisma.mouvementStock.count({ where: { articleId } })).toBe(1);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).statut).toBe("APPLIQUE");
    await prisma.clotureStock.deleteMany({});
  }, 60_000);

  it("un stock consommé depuis (la reprise passerait sous 0) refuse l'annulation, article nommé", async () => {
    const articleId = (await prisma.articleStock.create({ data: { code: "8", designation: "Sucre glace", domaine: "NOURRITURE", unite: "kg" } })).id;
    await prisma.stock.create({ data: { articleId, quantite: 0 } });
    const { batchId } = await appliquerMouvements("Date,Code article,Désignation,Entrées,Sorties\n05/06/2026,8,Sucre glace,4,0", "Import sucre", "2026-06-05", userId);
    await prisma.stock.update({ where: { articleId }, data: { quantite: 1 } }); // 3 consommés depuis
    await expect(annulerImport(batchId, userId)).rejects.toThrow(/Sucre glace/);
    expect(await stockDe(articleId)).toBe(1);
    expect(await prisma.mouvementStock.count({ where: { articleId } })).toBe(1);
  }, 60_000);
});

describe("annulation d'un import d'INVENTAIRE — valeur posée en absolu", () => {
  it("sans saisie postérieure : la valeur d'avant est remise (comportement d'avant)", async () => {
    const articleId = await nouvelArticle("Huile d'olive", 20);
    const batchId = await inventairePose(articleId, "10");
    await annulerImport(batchId, userId);
    expect(await stockDe(articleId)).toBe(10);
  }, 60_000);

  it("un mouvement postérieur : refus qui NOMME l'article et le mouvement ; rien n'est touché", async () => {
    const articleId = await nouvelArticle("Beurre doux", 20);
    const batchId = await inventairePose(articleId, "10");
    await prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite: 3, date: new Date("2026-06-20"), origine: "Livraison restaurant" } });

    await expect(annulerImport(batchId, userId)).rejects.toThrow(/STOCK_POSTERIEUR\|[\s\S]*Beurre doux[\s\S]*sortie de 3 kg du 20\/06\/2026/);

    expect(await stockDe(articleId)).toBe(20);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).statut).toBe("APPLIQUE");
  }, 60_000);

  it("confirmée par la Direction (remettreQuandMeme) : valeur d'avant remise, avant → après au journal", async () => {
    const articleId = await nouvelArticle("Crème liquide", 20);
    const batchId = await inventairePose(articleId, "10");
    await prisma.mouvementStock.create({ data: { articleId, type: "ENTREE", quantite: 5, date: new Date("2026-06-21"), origine: "Entrée manuelle" } });

    const r = await annulerImport(batchId, userId, { remettreQuandMeme: true });

    expect(await stockDe(articleId)).toBe(10);
    expect(r.remisMalgrePosterieur.join(" ")).toMatch(/Crème liquide/);
    const j = await prisma.journalAudit.findFirstOrThrow({ where: { entiteId: batchId } });
    expect(j.nouvelleValeur).toMatch(/CONFIRMÉ par la Direction[\s\S]*Crème liquide[\s\S]*stock actuel 20 → 10/);
  }, 60_000);

  it("un comptage postérieur compte comme une saisie postérieure", async () => {
    const articleId = await nouvelArticle("Vinaigre", 20);
    const batchId = await inventairePose(articleId, "10");
    const session = await prisma.sessionComptage.create({ data: { date: new Date("2026-06-22") } });
    await prisma.ligneComptage.create({ data: { sessionId: session.id, articleId, designation: "Vinaigre", theorique: 20, physique: 20, ecart: 0 } });
    await expect(annulerImport(batchId, userId)).rejects.toThrow(/Vinaigre[\s\S]*comptage du 22\/06\/2026/);
    expect(await stockDe(articleId)).toBe(20);
  }, 60_000);

  it("un achat de légumes d'un mois clôturé n'est pas supprimé en douce", async () => {
    const articleId = await nouvelArticle("Moutarde", 20);
    const batchId = await inventairePose(articleId, "10");
    const achat = await prisma.achatLegume.create({ data: { date: new Date("2026-03-04"), legume: "Tomate", quantite: 2 } });
    await prisma.importOperation.create({ data: { batchId, entite: "AchatLegume", entiteId: achat.id, action: "CREATE" } });
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 3, creeParId: userId } });

    await expect(annulerImport(batchId, userId)).rejects.toThrow(/clôturée/i);

    expect(await prisma.achatLegume.count({ where: { id: achat.id } })).toBe(1);
    expect(await stockDe(articleId)).toBe(20);
    await prisma.clotureStock.deleteMany({});
  }, 60_000);
});

describe("annulation d'un import de FACTURES : aucune perte de paiement en cascade", () => {
  async function lot() {
    const batch = await prisma.importBatch.create({ data: { type: "FACTURES", libelle: "Factures de test" } });
    const mk = async (numero: string, o: Record<string, unknown> = {}) => {
      const f = await prisma.factureFournisseur.create({ data: { fournisseurNom: "SENEVE", numero, mois: 9, annee: 2026, montantUSD: 100, montantRegleUSD: 0, resteAPayerUSD: 100, ...o } });
      await prisma.importOperation.create({ data: { batchId: batch.id, entite: "FactureFournisseur", entiteId: f.id, action: "CREATE" } });
      return f.id;
    };
    return { batch: batch.id, mk };
  }

  it("une facture payée depuis l'import : refus nommé, tout le lot reste, paiement intact", async () => {
    const { batch, mk } = await lot();
    const propre = await mk("P-1");
    const payee = await mk("P-2");
    await prisma.paiement.create({ data: { factureId: payee, date: new Date("2026-09-20"), montantUSD: 40 } });
    await expect(annulerImport(batch, userId)).rejects.toThrow(/SENEVE n° P-2 : 1 paiement\(s\)[\s\S]*Annuler ce paiement/);
    expect(await prisma.factureFournisseur.count({ where: { id: { in: [propre, payee] } } })).toBe(2);
    expect(await prisma.paiement.count({ where: { factureId: payee } })).toBe(1);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch } })).statut).toBe("APPLIQUE");
  }, 60_000);

  it("entrée de stock, ligne liée : refusées aussi", async () => {
    const { batch, mk } = await lot();
    const art = await prisma.articleStock.create({ data: { designation: "Farine facture", domaine: "NOURRITURE" } });
    const avecEntree = await mk("R-2");
    await prisma.mouvementStock.create({ data: { articleId: art.id, type: "ENTREE", quantite: 1, factureId: avecEntree } });
    await mk("R-3", { lignes: { create: [{ designation: "x", quantite: 1, prixUnitaireUSD: 1, totalLigneUSD: 1 }] } });
    await expect(annulerImport(batch, userId)).rejects.toThrow(/R-2 : 1 entrée\(s\) en stock[\s\S]*R-3 : 1 ligne\(s\)/);
  }, 60_000);

  it("réglé sans ligne de paiement (facture importée « Réglée » du classeur) : n'empêche PAS l'annulation du lot", async () => {
    const { batch, mk } = await lot();
    const r = await mk("IMP-REGLEE", { montantRegleUSD: 100, resteAPayerUSD: 0, statut: "REGLEE" });
    await annulerImport(batch, userId);
    expect(await prisma.factureFournisseur.count({ where: { id: r } })).toBe(0);
  }, 60_000);

  it("un paiement demandé en cours : refusé", async () => {
    const { batch, mk } = await lot();
    const id = await mk("D-1");
    const u = await prisma.user.findFirstOrThrow();
    const dem = await prisma.demandeValidationStock.create({ data: { nature: "PAIEMENT_FACTURE", resume: "Payer D-1", charge: {}, auteurId: u.id, auteurNom: "X" } });
    await prisma.cibleDemandeStock.create({ data: { demandeId: dem.id, cle: `FACTURE:${id}` } });
    await expect(annulerImport(batch, userId)).rejects.toThrow(/D-1 : un paiement demandé en cours/);
  }, 60_000);

  it("factures intactes depuis l'import : l'annulation les supprime, comme avant", async () => {
    const { batch, mk } = await lot();
    const a = await mk("N-1");
    await annulerImport(batch, userId);
    expect(await prisma.factureFournisseur.count({ where: { id: a } })).toBe(0);
  }, 60_000);
});

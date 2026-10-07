import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { creerBaseTest } from "@/lib/test/db";

// Tests d'INTÉGRATION (Postgres éphémère, jamais la prod) — doublons d'imports de stock.
//
// Constat du 2026-09-28 : l'import d'inventaire recréait tout le journal détaillé du classeur,
// déjà importé le matin même par l'import de mouvements → 602 mouvements en double (le stock,
// posé en absolu par l'inventaire, restait juste ; seul l'historique était doublé).
//   1. l'outil « Retirer les mouvements en double » (aperçu, retrait, idempotence, annulation) ;
//   2. le garde-fou : les imports n'insèrent plus un mouvement déjà présent en base.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { appliquerMouvements, analyserMouvements } = await import("@/lib/import-mouvements");
const { appliquerInventaire, analyserInventaire, annulerImport } = await import("@/lib/import-inventaire");
const { detecterDoublons, retirerDoublons, lotsPourDoublons } = await import("@/lib/doublons-imports");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  userId = (await prisma.user.create({ data: { email: "direction@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

const ENTETE = "Date,Code article,Désignation,Entrées,Sorties\n";
const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const qte = async (articleId: string) => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId } })).quantite);

async function article(designation: string, stock: number, code?: string) {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", code: code ?? null, unite: "Kg" } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: stock } });
  return a.id;
}

/**
 * Reproduit l'état laissé en production par l'ANCIEN import d'inventaire (avant le garde-fou) :
 * un lot INVENTAIRE qui a posé le stock en absolu et recréé le journal détaillé, légumes compris.
 */
async function inventaireAncien(libelle: string, mvts: { articleId: string; date: string; type: "ENTREE" | "SORTIE"; quantite: number }[], stockFinal: Record<string, number>) {
  const batch = await prisma.importBatch.create({ data: { type: "INVENTAIRE", libelle, statut: "APPLIQUE", creeParId: userId } });
  for (const [articleId, q] of Object.entries(stockFinal)) {
    const avant = await qte(articleId);
    await prisma.importOperation.create({ data: { batchId: batch.id, entite: "Stock", entiteId: articleId, action: "UPDATE", avant: { quantite: String(avant) } } });
    await prisma.stock.update({ where: { articleId }, data: { quantite: q } });
  }
  for (const m of mvts) {
    const mv = await prisma.mouvementStock.create({ data: { articleId: m.articleId, type: m.type, quantite: m.quantite, date: jour(m.date), origine: libelle } });
    await prisma.importOperation.create({ data: { batchId: batch.id, entite: "MouvementStock", entiteId: mv.id, action: "CREATE" } });
  }
  const leg = await prisma.achatLegume.create({ data: { date: jour("2026-09-10"), legume: "Tomate", quantite: 3, montantCDF: 9000 } });
  await prisma.importOperation.create({ data: { batchId: batch.id, entite: "AchatLegume", entiteId: leg.id, action: "CREATE" } });
  return { batchId: batch.id, legumeId: leg.id };
}

describe("Retirer les mouvements en double — outil de nettoyage", () => {
  let riz: string, huile: string;
  let lotMvts: string, lotInv: string, legumeId: string;

  beforeAll(async () => {
    riz = await article("Riz nettoyage", 10);
    huile = await article("Huile nettoyage", 4);
    // Le matin : l'import de mouvements (deux sorties de riz identiques le 12 : deux mouvements).
    lotMvts = (await appliquerMouvements(
      ENTETE +
        "10/09/2026,,Riz nettoyage,5,2\n" +
        "11/09/2026,,Huile nettoyage,0,1\n" +
        "12/09/2026,,Riz nettoyage,0,3\n" +
        "12/09/2026,,Riz nettoyage,0,3\n" +
        "14/09/2026,,Huile nettoyage,2,0",
      "Mouvements 28/09/2026", "2026-09-28", userId
    )).batchId;
    // Puis l'ancien import d'inventaire : même journal, TROIS sorties de 3 le 12, une entrée
    // d'huile le 13 que le CSV n'avait pas, pas l'entrée d'huile du 14.
    ({ batchId: lotInv, legumeId } = await inventaireAncien("Inventaire 28 septembre 2026", [
      { articleId: riz, date: "2026-09-10", type: "ENTREE", quantite: 5 },
      { articleId: riz, date: "2026-09-10", type: "SORTIE", quantite: 2 },
      { articleId: huile, date: "2026-09-11", type: "SORTIE", quantite: 1 },
      { articleId: riz, date: "2026-09-12", type: "SORTIE", quantite: 3 },
      { articleId: riz, date: "2026-09-12", type: "SORTIE", quantite: 3 },
      { articleId: riz, date: "2026-09-12", type: "SORTIE", quantite: 3 },
      { articleId: huile, date: "2026-09-13", type: "ENTREE", quantite: 4 },
    ], { [riz]: 7, [huile]: 9 }));
  }, 60_000);

  it("propose par défaut l'import d'inventaire et les imports de mouvements du même jour", async () => {
    const lots = await lotsPourDoublons();
    expect(lots.defaut.inventaireId).toBe(lotInv);
    expect(lots.defaut.mouvementsIds).toEqual([lotMvts]);
  }, 60_000);

  it("aperçu : paires jumelles appariées un à un, sans-jumeau de chaque côté, contrôle sans écart", async () => {
    const a = await detecterDoublons(lotInv, [lotMvts]);
    expect(a.paires).toHaveLength(5);
    // Chaque paire : on RETIRE la copie de l'inventaire, on GARDE celle des mouvements.
    for (const p of a.paires) {
      expect(p.retire.batchId).toBe(lotInv);
      expect(p.garde.batchId).toBe(lotMvts);
      expect([p.retire.articleId, p.retire.date, p.retire.type, p.retire.quantite]).toEqual([p.garde.articleId, p.garde.date, p.garde.type, p.garde.quantite]);
    }
    expect(new Set(a.paires.map((p) => p.garde.id)).size).toBe(5);
    expect(a.sansJumeauInventaire.map((m) => [m.date, m.type, m.quantite])).toEqual([["2026-09-12", "SORTIE", 3], ["2026-09-13", "ENTREE", 4]]);
    expect(a.sansJumeauMouvements.map((m) => [m.date, m.type, m.quantite])).toEqual([["2026-09-14", "ENTREE", 2]]);
    expect(a.controle.ecarts).toEqual([]);
    expect(a.paires[0].retire.article).toMatch(/nettoyage/);
  }, 60_000);

  it("refuse une sélection périmée (mouvement qui n'est pas un doublon) sans rien retirer", async () => {
    const a = await detecterDoublons(lotInv, [lotMvts]);
    const intrus = a.sansJumeauInventaire[0].id;
    await expect(retirerDoublons(lotInv, [lotMvts], [a.paires[0].retire.id, intrus], userId)).rejects.toThrow(/relancez la recherche/i);
    expect(await prisma.mouvementStock.count({ where: { id: { in: [a.paires[0].retire.id, intrus] } } })).toBe(2);
  }, 60_000);

  it("retire une sélection partielle, puis le reste ; le stock, les légumes, les articles ne bougent pas", async () => {
    const stockAvant = [await qte(riz), await qte(huile)];
    const nbArticles = await prisma.articleStock.count();
    const a = await detecterDoublons(lotInv, [lotMvts]);

    const r1 = await retirerDoublons(lotInv, [lotMvts], a.paires.slice(0, 2).map((p) => p.retire.id), userId);
    expect(r1.retires).toBe(2);
    expect((await detecterDoublons(lotInv, [lotMvts])).paires).toHaveLength(3);

    const reste = (await detecterDoublons(lotInv, [lotMvts])).paires.map((p) => p.retire.id);
    const r2 = await retirerDoublons(lotInv, [lotMvts], reste, userId);
    expect(r2.retires).toBe(3);
    expect(r2.message).toMatch(/3 mouvement\(s\) en double retiré\(s\)/);

    // Copies de l'inventaire parties, copies des mouvements toutes là.
    expect(await prisma.mouvementStock.count({ where: { id: { in: a.paires.map((p) => p.retire.id) } } })).toBe(0);
    expect(await prisma.mouvementStock.count({ where: { id: { in: a.paires.map((p) => p.garde.id) } } })).toBe(5);
    // Rien d'autre n'a bougé.
    expect([await qte(riz), await qte(huile)]).toEqual(stockAvant);
    expect(await prisma.achatLegume.findUnique({ where: { id: legumeId } })).not.toBeNull();
    expect(await prisma.articleStock.count()).toBe(nbArticles);

    // Opérations marquées : l'annulation ne les rejouera pas ; la trace nomme le jumeau gardé.
    const ops = await prisma.importOperation.findMany({ where: { batchId: lotInv, entite: "MouvementStock", action: "DOUBLON_RETIRE" } });
    expect(ops).toHaveLength(5);
    const jumeaux = new Set(ops.map((o) => (o.avant as { jumeauId: string }).jumeauId));
    expect(jumeaux).toEqual(new Set(a.paires.map((p) => p.garde.id)));

    // Journal d'audit : combien, lesquels, par qui.
    const j = await prisma.journalAudit.findMany({ where: { entite: "MouvementStock", champ: { contains: "doublon" } }, orderBy: { date: "asc" } });
    expect(j).toHaveLength(2);
    expect(j[1].userId).toBe(userId);
    expect(j[1].nouvelleValeur).toMatch(/3 mouvement/);
    for (const p of a.paires.slice(2)) expect(j[1].ancienneValeur).toContain(p.retire.id);
  }, 60_000);

  it("idempotent : relancé, l'outil ne trouve plus rien (le jumeau déjà servi n'est pas réutilisé)", async () => {
    const a = await detecterDoublons(lotInv, [lotMvts]);
    expect(a.paires).toHaveLength(0);
    // La 3e sortie de 3 du 12 reste SANS jumeau : ses deux jumeaux possibles ont déjà servi.
    expect(a.sansJumeauInventaire).toHaveLength(2);
    expect(a.sansJumeauMouvements).toHaveLength(1);
    expect(a.controle.ecarts).toEqual([]);
  }, 60_000);

  it("« Annuler l'import » des MOUVEMENTS est refusé tant que l'inventaire s'appuie sur leur historique", async () => {
    await expect(annulerImport(lotMvts)).rejects.toThrow(/Inventaire 28 septembre 2026/);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: lotMvts } })).statut).toBe("APPLIQUE");
  }, 60_000);

  it("« Annuler l'import » de l'inventaire fonctionne encore après le nettoyage", async () => {
    const gardes = await prisma.importOperation.findMany({ where: { batchId: lotMvts, entite: "MouvementStock" } });
    await annulerImport(lotInv);
    // Stock restauré aux valeurs d'avant l'inventaire (10 + 5 − 2 − 3 − 3 = 7 ; 4 − 1 + 2 = 5).
    expect([await qte(riz), await qte(huile)]).toEqual([7, 5]);
    // Les copies conservées (import de mouvements) sont intactes ; les sans-jumeau de l'inventaire sont partis.
    expect(await prisma.mouvementStock.count({ where: { id: { in: gardes.map((g) => g.entiteId) } } })).toBe(gardes.length);
    expect(await prisma.mouvementStock.count({ where: { origine: "Inventaire 28 septembre 2026" } })).toBe(0);
    expect(await prisma.achatLegume.findUnique({ where: { id: legumeId } })).toBeNull();
    // Puis l'import de mouvements redevient annulable.
    await annulerImport(lotMvts);
    expect([await qte(riz), await qte(huile)]).toEqual([10, 4]);
  }, 60_000);
});

describe("Retirer les mouvements en double — refus", () => {
  it("un import qui n'est pas un inventaire appliqué, ou aucun import de mouvements → refusé", async () => {
    const mv = await prisma.importBatch.create({ data: { type: "MOUVEMENTS", libelle: "M" } });
    const inv = await prisma.importBatch.create({ data: { type: "INVENTAIRE", libelle: "I" } });
    await expect(detecterDoublons(mv.id, [mv.id])).rejects.toThrow(/inventaire/i);
    await expect(detecterDoublons(inv.id, [])).rejects.toThrow(/import de mouvements/i);
    await expect(detecterDoublons(inv.id, [inv.id])).rejects.toThrow(/import de mouvements/i);
  }, 60_000);

  it("mois clôturé : rien n'est retiré", async () => {
    const pates = await article("Pâtes clôture", 3);
    const mv = await appliquerMouvements(ENTETE + "05/10/2026,,Pâtes clôture,4,0", "M oct", "2026-10-05", userId);
    const { batchId } = await inventaireAncien("I oct", [{ articleId: pates, date: "2026-10-05", type: "ENTREE", quantite: 4 }], {});
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 10, creeParId: userId } });
    const a = await detecterDoublons(batchId, [mv.batchId]);
    expect(a.paires).toHaveLength(1);
    await expect(retirerDoublons(batchId, [mv.batchId], [a.paires[0].retire.id], userId)).rejects.toThrow(/clôturée/);
    expect(await prisma.mouvementStock.count({ where: { id: a.paires[0].retire.id } })).toBe(1);
    await prisma.clotureStock.deleteMany({ where: { annee: 2026, mois: 10 } });
  }, 60_000);
});

describe("Garde-fou — l'import de mouvements n'insère plus un mouvement déjà présent", () => {
  it("réimporter le même fichier : rien d'inséré, le stock ne bouge pas", async () => {
    const sel = await article("Sel garde", 20);
    const csv = ENTETE + "15/09/2026,,Sel garde,5,2";
    await appliquerMouvements(csv, "Premier", "2026-09-15", userId);
    expect(await qte(sel)).toBe(23);

    const p = await analyserMouvements(csv);
    expect(p.resume.dejaPresents).toBe(2);
    expect(p.lignes[0].entreeDejaPresente).toBe(true);
    expect(p.lignes[0].sortieDejaPresente).toBe(true);

    await expect(appliquerMouvements(csv, "Second", "2026-09-15", userId)).rejects.toThrow(/déjà présent/);
    expect(await qte(sel)).toBe(23);
    expect(await prisma.mouvementStock.count({ where: { articleId: sel } })).toBe(2);
    expect(await prisma.importBatch.count({ where: { libelle: "Second" } })).toBe(0);
  }, 60_000);

  it("fichier en partie déjà importé : seuls les nouveaux sont insérés, le delta ne compte qu'eux", async () => {
    const sucre = await article("Sucre garde", 10);
    await appliquerMouvements(ENTETE + "16/09/2026,,Sucre garde,0,3", "Premier sucre", "2026-09-16", userId);
    expect(await qte(sucre)).toBe(7);
    // Deux sorties de 3 le 16 dans le fichier, une seule en base → une seule insérée (un à un).
    const csv = ENTETE + "16/09/2026,,Sucre garde,0,3\n16/09/2026,,Sucre garde,0,3\n17/09/2026,,Sucre garde,4,0";
    const r = await appliquerMouvements(csv, "Second sucre", "2026-09-16", userId);
    expect(r.resume.dejaPresents).toBe(1);
    expect(r.resume.sortiesQte).toBe(3);
    expect(r.resume.entreesQte).toBe(4);
    expect(await qte(sucre)).toBe(8); // 7 − 3 + 4
    expect(await prisma.mouvementStock.count({ where: { articleId: sucre } })).toBe(3);
    // Le mouvement ignoré est tracé (DEJA_PRESENT) : il désigne le jumeau qui porte l'historique.
    const ops = await prisma.importOperation.findMany({ where: { batchId: r.batchId, action: "DEJA_PRESENT" } });
    expect(ops).toHaveLength(1);

    // L'annulation du second import ne retire que ce qu'il a créé et restaure le stock exact.
    await annulerImport(r.batchId);
    expect(await qte(sucre)).toBe(7);
    expect(await prisma.mouvementStock.count({ where: { articleId: sucre } })).toBe(1);
  }, 60_000);

  it("un article dont tout est déjà présent n'est pas « photographié » (son stock n'est pas restauré à l'annulation)", async () => {
    const a1 = await article("Farine garde", 10);
    const a2 = await article("Levure garde", 10);
    await appliquerMouvements(ENTETE + "18/09/2026,,Farine garde,1,0", "Farine 1", "2026-09-18", userId);
    const r = await appliquerMouvements(ENTETE + "18/09/2026,,Farine garde,1,0\n18/09/2026,,Levure garde,2,0", "Farine 2", "2026-09-18", userId);
    const stocks = await prisma.importOperation.findMany({ where: { batchId: r.batchId, entite: "Stock" } });
    expect(stocks.map((s) => s.entiteId)).toEqual([a2]);
    // La farine bouge entre-temps (correction manuelle) : l'annulation de « Farine 2 » n'y touche pas.
    await prisma.stock.update({ where: { articleId: a1 }, data: { quantite: 50 } });
    await annulerImport(r.batchId);
    expect(await qte(a1)).toBe(50);
    expect(await qte(a2)).toBe(10);
  }, 60_000);
});

/** Classeur d'inventaire minimal (feuille « Nourriture », colonnes du vrai classeur). */
async function classeur(lignes: { code: string; nom: string; sinit: number }[], journal: { date: string; code: string; e: number; s: number }[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Nourriture");
  const n = Math.max(lignes.length, journal.length);
  for (let i = 0; i < n; i++) {
    const row = ws.getRow(13 + i);
    const l = lignes[i];
    if (l) { row.getCell(1).value = l.code; row.getCell(2).value = l.nom; row.getCell(3).value = "Kg"; row.getCell(6).value = l.sinit; }
    const j = journal[i];
    if (j) { row.getCell(17).value = jour(j.date); row.getCell(18).value = j.code; row.getCell(22).value = j.e; row.getCell(23).value = j.s; }
    row.commit();
  }
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe("Garde-fou — l'import d'inventaire pose le stock final mais n'insère plus un mouvement déjà présent", () => {
  it("après l'import de mouvements : journal non doublé, stock final absolu appliqué, annonce dans l'aperçu et le résumé", async () => {
    const tomate = await article("Tomate pelée garde", 2, "701");
    const oignon = await article("Oignon garde", 1, "702");
    const mv = await appliquerMouvements(ENTETE + "20/09/2026,,Tomate pelée garde,6,1\n21/09/2026,,Oignon garde,0,1", "Mouvements matin", "2026-09-20", userId);

    const buf = await classeur(
      [{ code: "701", nom: "Tomate pelée garde", sinit: 2 }, { code: "702", nom: "Oignon garde", sinit: 1 }],
      [
        { date: "2026-09-20", code: "701", e: 6, s: 1 }, // déjà présents (2 mouvements)
        { date: "2026-09-21", code: "702", e: 0, s: 1 }, // déjà présent
        { date: "2026-09-22", code: "701", e: 0, s: 2 }, // nouveau
      ]
    );

    const apercu = await analyserInventaire(buf);
    expect(apercu.resume.dejaPresents).toBe(3);
    expect(apercu.resume.mvSortie + apercu.resume.mvEntree).toBe(1); // à insérer

    const avant = await prisma.mouvementStock.count();
    const r = await appliquerInventaire(buf, "Inventaire soir", userId);
    expect(r.resume.dejaPresents).toBe(3);
    expect(await prisma.mouvementStock.count()).toBe(avant + 1);
    // Stock final ABSOLU du classeur : 2 + 6 − 1 − 2 = 5 ; 1 − 1 = 0.
    expect(await qte(tomate)).toBe(5);
    expect(await qte(oignon)).toBe(0);

    // Les ignorés sont tracés et désignent leur jumeau : l'import de mouvements ne peut plus être
    // annulé sans avoir d'abord annulé l'inventaire, qui s'appuie sur son historique.
    expect(await prisma.importOperation.count({ where: { batchId: r.batchId, action: "DEJA_PRESENT" } })).toBe(3);
    await expect(annulerImport(mv.batchId)).rejects.toThrow(/Inventaire soir/);

    // L'annulation de l'inventaire ne retire QUE le mouvement qu'il a créé.
    await annulerImport(r.batchId);
    expect(await prisma.mouvementStock.count()).toBe(avant);
  }, 60_000);

  it("réappliquer le même classeur : aucun mouvement ajouté, le stock final reste posé", async () => {
    const poivre = await article("Poivre garde", 0, "703");
    const buf = await classeur([{ code: "703", nom: "Poivre garde", sinit: 0 }], [{ date: "2026-09-23", code: "703", e: 4, s: 1 }]);
    await appliquerInventaire(buf, "Inv 1", userId);
    const n = await prisma.mouvementStock.count({ where: { articleId: poivre } });
    await prisma.stock.update({ where: { articleId: poivre }, data: { quantite: 99 } });
    const r = await appliquerInventaire(buf, "Inv 2", userId);
    expect(r.resume.dejaPresents).toBe(2);
    expect(await prisma.mouvementStock.count({ where: { articleId: poivre } })).toBe(n);
    expect(await qte(poivre)).toBe(3);
  }, 60_000);
});

describe("Motif des sorties importées — « Livraison restaurant » par défaut (décision Direction)", () => {
  const motifs = async (articleId: string) =>
    (await prisma.mouvementStock.findMany({ where: { articleId }, orderBy: { type: "asc" }, select: { type: true, categorieSortie: true } }))
      .map((m) => `${m.type}:${m.categorieSortie ?? "—"}`)
      .sort();

  it("import de mouvements : par défaut, les sorties sont des livraisons au restaurant ; les entrées n'ont pas de motif", async () => {
    const a = await article("Beurre motif", 10);
    await appliquerMouvements(ENTETE + "24/09/2026,,Beurre motif,3,2", "M motif", "2026-09-24", userId);
    expect(await motifs(a)).toEqual(["ENTREE:—", "SORTIE:LIVRAISON_RESTAURANT"]);
  }, 60_000);

  it("import de mouvements, « sans motif » demandé (ancien écran) : refus, rien d'importé — motif obligatoire (2026-10-07)", async () => {
    const a = await article("Crème motif", 10);
    await expect(appliquerMouvements(ENTETE + "24/09/2026,,Crème motif,0,2", "M sans motif", "2026-09-24", userId, undefined, { sortiesLivraisonRestaurant: false })).rejects.toThrow(/motif est obligatoire/);
    expect(await motifs(a)).toEqual([]);
    expect(await prisma.importBatch.count({ where: { libelle: "M sans motif" } })).toBe(0);
    // Un fichier sans aucune sortie s'importe toujours (une entrée n'a pas de motif de sortie).
    await appliquerMouvements(ENTETE + "24/09/2026,,Crème motif,2,0", "M entrées", "2026-09-24", userId, undefined, { sortiesLivraisonRestaurant: false });
    expect(await motifs(a)).toEqual(["ENTREE:—"]);
  }, 60_000);

  it("import d'inventaire : sorties = livraisons ; « sans motif » demandé : refus, rien d'importé", async () => {
    const a = await article("Basilic motif", 0, "801");
    const b = await article("Persil motif", 0, "802");
    await appliquerInventaire(await classeur([{ code: "801", nom: "Basilic motif", sinit: 5 }], [{ date: "2026-09-25", code: "801", e: 1, s: 2 }]), "Inv motif", userId);
    expect(await motifs(a)).toEqual(["ENTREE:—", "SORTIE:LIVRAISON_RESTAURANT"]);
    await expect(appliquerInventaire(await classeur([{ code: "802", nom: "Persil motif", sinit: 5 }], [{ date: "2026-09-25", code: "802", e: 0, s: 2 }]), "Inv sans motif", userId, { sortiesLivraisonRestaurant: false })).rejects.toThrow(/motif est obligatoire/);
    expect(await motifs(b)).toEqual([]);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: b } })).quantite)).toBe(0); // stock final non posé : tout est annulé
  }, 60_000);

  it("les sorties déjà en base ne sont pas requalifiées (ni par un réimport, ni ailleurs)", async () => {
    const a = await article("Thym motif", 10);
    const ancienne = await prisma.mouvementStock.create({ data: { articleId: a, type: "SORTIE", quantite: 1, date: jour("2026-09-26") } });
    await appliquerMouvements(ENTETE + "26/09/2026,,Thym motif,0,1\n26/09/2026,,Thym motif,0,4", "M thym", "2026-09-26", userId);
    expect((await prisma.mouvementStock.findUniqueOrThrow({ where: { id: ancienne.id } })).categorieSortie).toBeNull();
    expect(await motifs(a)).toEqual(["SORTIE:LIVRAISON_RESTAURANT", "SORTIE:—"]);
  }, 60_000);
});

describe("« Annuler l'import » est journalisé (qui, quoi)", () => {
  it("l'annulation laisse une entrée au journal du Stock, au nom de la personne", async () => {
    await article("Origan journal", 5);
    const { batchId } = await appliquerMouvements(ENTETE + "27/09/2026,,Origan journal,2,0", "Import à annuler", "2026-09-27", userId);
    await annulerImport(batchId, userId);
    const j = await prisma.journalAudit.findFirst({ where: { entite: "Stock", entiteId: batchId } });
    expect(j?.userId).toBe(userId);
    expect(j?.champ).toMatch(/annulation d'import/);
    expect(j?.nouvelleValeur).toMatch(/Import à annuler/);
    expect(j?.nouvelleValeur).toMatch(/1 mouvement/);
  }, 60_000);
});

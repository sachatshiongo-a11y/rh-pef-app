import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { poserContraintesFactures } from "@/lib/test/contraintes-factures";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : factures fournisseurs EN FRANCS, au choix
// (demande de la Direction, 2026-10-09). Les trois contraintes CHECK de la migration sont posées sur
// la base de test : chaque écriture est jugée comme en production.
//  - création : devise au choix, lignes en francs, montant/reste en francs, entrée en stock avec
//    devise + taux + équivalent en dollars (comme la Liste d'achat), refus sans taux ;
//  - paiements : en francs (reste en francs, sans taux), en dollars (au taux du jour du paiement),
//    dépassement refusé, lot tout-ou-rien, demandes hors Direction validées au taux de la validation,
//    jeton du reste en francs ;
//  - statuts calculés sur le reste en francs ; factures en dollars inchangées.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock/factures;307;" }); } }));

const { creerFactureAvecLignes, marquerPayee, marquerPayeesEnLot, enregistrerPaiement } = await import("./actions");
const { validerDemandes } = await import("../a-valider/actions");
const { messageReglements } = await import("@/lib/validations-stock/reglement");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let articleFC = "", articleUSD = "";
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const taux = (t: number) => prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF: t } });
const v = async (ids: string[]) => Object.fromEntries((await prisma.demandeValidationStock.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(o)) f.set(k, x); return f; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await poserContraintesFactures(prisma);
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"]] as const) {
    U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } })).id;
  }
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  articleFC = (await prisma.articleStock.create({ data: { designation: "Manioc", domaine: "NOURRITURE", unite: "Kg", devisePrix: "CDF", prixUnitaireCDF: 7000, prixUnitaireUSD: null } })).id;
  articleUSD = (await prisma.articleStock.create({ data: { designation: "Huile", domaine: "NOURRITURE", unite: "L", prixUnitaireUSD: 3 } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.paiement.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await taux(2800);
  en("dir");
});

/** Facture en francs écrite directement (comme la créerait le formulaire). */
const factureFC = (montant: number, o: { numero?: string; echeance?: string } = {}) =>
  prisma.factureFournisseur.create({
    data: {
      fournisseurNom: "MAMAN PAPY", numero: o.numero ?? "7", date: new Date("2026-09-01T00:00:00.000Z"), dateEcheance: o.echeance ? new Date(o.echeance) : null,
      devise: "CDF", montantCDF: montant, montantRegleCDF: 0, resteAPayerCDF: montant, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null,
      statut: "A_REGLER", mois: 9, annee: 2026,
    },
  });
const factureUSD = (montant: number, numero = "12") =>
  prisma.factureFournisseur.create({ data: { fournisseurNom: "ETS SENEVE", numero, date: new Date("2026-09-01T00:00:00.000Z"), montantUSD: montant, montantRegleUSD: 0, resteAPayerUSD: montant, statut: "A_REGLER", mois: 9, annee: 2026 } });

const etat = async (id: string) => {
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
  const p = await prisma.paiement.findMany({ where: { factureId: id }, orderBy: { createdAt: "asc" } });
  const t = (x: { toString(): string } | null) => (x === null ? null : x.toString());
  return {
    devise: f.devise, statut: f.statut, regleCDF: t(f.montantRegleCDF), resteCDF: t(f.resteAPayerCDF), regleUSD: t(f.montantRegleUSD), resteUSD: t(f.resteAPayerUSD),
    paiements: p.map((x) => ({ devise: x.devise, montantCDF: t(x.montantCDF), montantUSD: t(x.montantUSD), taux: t(x.tauxChangeUtilise), note: x.note })),
  };
};

const formFacture = (o: { devise?: string; lignes: [string | null, string, string, string][]; entrer?: boolean; regle?: string }) => {
  const f = new FormData();
  f.set("fournisseurNom", "MAMAN PAPY"); f.set("date", "2026-10-02"); f.set("forcerDoublons", "on");
  if (o.devise) f.set("devise", o.devise);
  if (o.entrer) f.set("entrerEnStock", "on");
  if (o.regle) f.set("montantRegle", o.regle);
  for (const [art, des, q, p] of o.lignes) { f.append("ligne_articleId", art ?? ""); f.append("ligne_designation", des); f.append("ligne_unite", ""); f.append("ligne_quantite", q); f.append("ligne_prix", p); }
  return f;
};

describe("création d'une facture en francs", () => {
  it("lignes, montant et reste en francs ; entrée en stock avec devise, montant saisi, taux et équivalent en dollars", async () => {
    await expect(creerFactureAvecLignes(formFacture({ devise: "CDF", entrer: true, lignes: [[articleFC, "Manioc", "10", "7 000"], [null, "Sacs", "3", "1 500,5"]] }))).rejects.toThrow("NEXT_REDIRECT");
    const f = await prisma.factureFournisseur.findFirstOrThrow({ include: { lignes: { orderBy: { designation: "asc" } }, mouvements: true } });
    expect([f.devise, f.montantCDF?.toString(), f.resteAPayerCDF?.toString(), f.montantRegleCDF?.toString(), f.montantUSD, f.resteAPayerUSD, f.tauxChangeUtilise?.toString(), f.statut])
      .toEqual(["CDF", "74501.5", "74501.5", "0", null, null, "2800", "A_REGLER"]);
    expect(f.lignes.map((l) => [l.designation, l.prixUnitaireCDF?.toString(), l.totalLigneCDF?.toString(), l.prixUnitaireUSD, l.totalLigneUSD]))
      .toEqual([["Manioc", "7000", "70000", null, null], ["Sacs", "1500.5", "4501.5", null, null]]);
    // Seule la ligne reliée au catalogue entre en stock — comme une ligne en francs de la Liste d'achat.
    expect(f.mouvements.map((m) => [m.devise, m.montantOrigine?.toString(), m.tauxChangeUtilise?.toString(), m.montantUSD?.toString(), m.quantite.toString()]))
      .toEqual([["CDF", "70000", "2800", "25", "10"]]);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: articleFC } })).quantite)).toBe(10);
  }, 60_000);

  it("sans taux du jour : entrée en stock refusée, rien n'est écrit ; sans entrée en stock, la facture s'enregistre (aucun taux requis)", async () => {
    await taux(0);
    expect(await creerFactureAvecLignes(formFacture({ devise: "CDF", entrer: true, lignes: [[articleFC, "Manioc", "10", "7000"]] }))).toMatchObject({ erreur: expect.stringMatching(/taux de change CDF\/USD n'est pas défini/) });
    expect(await prisma.factureFournisseur.count()).toBe(0);
    expect(await prisma.mouvementStock.count()).toBe(0);
    await expect(creerFactureAvecLignes(formFacture({ devise: "CDF", lignes: [[articleFC, "Manioc", "10", "7000"]] }))).rejects.toThrow("NEXT_REDIRECT");
    const f = await prisma.factureFournisseur.findFirstOrThrow();
    expect([f.devise, f.montantCDF?.toString(), f.tauxChangeUtilise]).toEqual(["CDF", "70000", null]);
  }, 60_000);

  it("« déjà réglé » dans la devise de la facture (Direction) ; devise inconnue refusée", async () => {
    await expect(creerFactureAvecLignes(formFacture({ devise: "CDF", regle: "20 000", lignes: [[null, "Divers", "1", "70000"]] }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await etat((await prisma.factureFournisseur.findFirstOrThrow()).id)).toMatchObject({ devise: "CDF", regleCDF: "20000", resteCDF: "50000", regleUSD: null });
    expect(await creerFactureAvecLignes(formFacture({ devise: "EUR", lignes: [[null, "Divers", "1", "1"]] }))).toMatchObject({ erreur: expect.stringMatching(/Devise de la facture inconnue/) });
  }, 60_000);

  it("sans devise (ancien formulaire) ou en dollars : exactement comme avant", async () => {
    await expect(creerFactureAvecLignes(formFacture({ entrer: true, lignes: [[articleUSD, "Huile", "4", "3,25"]] }))).rejects.toThrow("NEXT_REDIRECT");
    const f = await prisma.factureFournisseur.findFirstOrThrow({ include: { lignes: true, mouvements: true } });
    expect([f.devise, f.montantUSD?.toString(), f.resteAPayerUSD?.toString(), f.montantCDF, f.tauxChangeUtilise]).toEqual(["USD", "13", "13", null, null]);
    expect(f.lignes.map((l) => [l.prixUnitaireUSD?.toString(), l.totalLigneUSD?.toString(), l.prixUnitaireCDF])).toEqual([["3.25", "13", null]]);
    expect(f.mouvements.map((m) => [m.devise, m.montantOrigine, m.tauxChangeUtilise, m.montantUSD?.toString()])).toEqual([[null, null, null, "13"]]);
  }, 60_000);
});

describe("payer une facture en francs (Direction)", () => {
  it("« Marquer payée » sans montant : soldée en francs, sans conversion ni taux (même sans taux du jour)", async () => {
    await taux(0);
    const f = await factureFC(280000);
    expect(await marquerPayee(f.id, "2026-10-01")).toBeUndefined();
    expect(await etat(f.id)).toEqual({ devise: "CDF", statut: "REGLEE", regleCDF: "280000", resteCDF: "0", regleUSD: null, resteUSD: null, paiements: [{ devise: "CDF", montantCDF: "280000", montantUSD: null, taux: null, note: "Marquée payée" }] });
  }, 60_000);

  it("paiement partiel en francs : le reste diminue en francs, au franc près ; statut sur le reste en francs", async () => {
    const f = await factureFC(280000, { echeance: "2026-09-15" }); // échue
    await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "CDF", montant: "100 000", date: "2026-10-01" }));
    expect(await etat(f.id)).toMatchObject({ statut: "ECHUE_NON_REGLEE", regleCDF: "100000", resteCDF: "180000", paiements: [{ devise: "CDF", montantCDF: "100000", montantUSD: null, taux: null }] });
    await marquerPayee(f.id, "2026-10-02", "180 000");
    expect(await etat(f.id)).toMatchObject({ statut: "REGLEE", resteCDF: "0" });
  }, 60_000);

  it("payée en dollars : convertis au taux du jour du PAIEMENT (dollars × taux) ; la facture reste en francs", async () => {
    const f = await factureFC(100000);
    await taux(2500);
    await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "USD", montant: "10", date: "2026-10-01" }));
    expect(await etat(f.id)).toMatchObject({ statut: "A_REGLER", regleCDF: "25000", resteCDF: "75000", paiements: [{ devise: "CDF", montantCDF: "25000", montantUSD: "10", taux: "2500" }] });
  }, 60_000);

  it("« Marquer payée » en dollars : le reste ÷ taux au centime solde la facture (à un demi-centime près)", async () => {
    const f = await factureFC(100000);
    expect(await marquerPayee(f.id, "2026-10-01", undefined, "35,71")).toBeUndefined();
    expect(await etat(f.id)).toMatchObject({ statut: "REGLEE", resteCDF: "0", paiements: [{ devise: "CDF", montantCDF: "100000", montantUSD: "35.71", taux: "2800", note: "Marquée payée (en dollars)" }] });
  }, 60_000);

  it("plus que le reste : refusé, rien n'est écrit (en francs comme en dollars)", async () => {
    const f = await factureFC(100000);
    expect(await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "CDF", montant: "100 001", date: "2026-10-01" }))).toMatchObject({ erreur: "Le paiement (100 001 FC) dépasse le reste à payer (100 000 FC)." });
    expect(await marquerPayee(f.id, "2026-10-01", undefined, "35,72")).toMatchObject({ erreur: expect.stringMatching(/dépasse le reste à payer \(100 000 FC\)/) });
    expect(await etat(f.id)).toMatchObject({ resteCDF: "100000", paiements: [] });
  }, 60_000);

  it("payée en dollars sans taux du jour : refus lisible, rien n'est écrit", async () => {
    const f = await factureFC(100000);
    await taux(0);
    expect(await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "USD", montant: "10", date: "2026-10-01" }))).toMatchObject({ erreur: expect.stringMatching(/Taux de change non configuré/) });
    expect(await etat(f.id)).toMatchObject({ resteCDF: "100000", paiements: [] });
  }, 60_000);

  it("avoir en francs : diminue le reste en francs", async () => {
    const f = await factureFC(100000);
    await enregistrerPaiement(f.id, fd({ type: "AVOIR", devise: "CDF", montant: "40000", date: "2026-10-01", note: "retour" }));
    expect(await etat(f.id)).toMatchObject({ resteCDF: "60000", paiements: [{ devise: "CDF", montantCDF: "40000" }] });
  }, 60_000);

  it("notification : montants dans la devise de la facture", () => {
    expect(messageReglements([{ factureId: "x", fournisseurNom: "MAMAN PAPY", numero: "7", devise: "CDF", montant: 100000, type: "PAIEMENT", date: "2026-10-01", solde: true, reste: 0, montantUSD: 35.71, taux: 2800 }]))
      .toBe("Facture n° 7 de MAMAN PAPY payée le 01/10/2026 — 100 000 FC (35,71 $ au taux de 2 800)");
    expect(messageReglements([
      { factureId: "a", fournisseurNom: "ETS SENEVE", numero: "12", montant: 100, type: "PAIEMENT", date: "2026-10-01", solde: true, reste: 0 },
      { factureId: "b", fournisseurNom: "MAMAN PAPY", numero: "7", devise: "CDF", montant: 280000, type: "PAIEMENT", date: "2026-10-01", solde: true, reste: 0 },
    ])).toBe("2 factures payées le 01/10/2026 — 100,00 $ + 280 000 FC (ETS SENEVE n° 12, MAMAN PAPY n° 7)");
  });
});

describe("lot (Direction) : tout ou rien, chaque facture soldée dans sa devise", () => {
  it("« chacune dans sa devise » : aucun taux requis, aucune conversion", async () => {
    const [a, b] = [await factureUSD(100), await factureFC(280000)];
    await taux(0);
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "SA_DEVISE")).toEqual({ reglees: 2, demandees: 2 });
    expect(await etat(a.id)).toMatchObject({ statut: "REGLEE", resteUSD: "0", paiements: [{ devise: "USD", montantUSD: "100", montantCDF: null, taux: null }] });
    expect(await etat(b.id)).toMatchObject({ statut: "REGLEE", resteCDF: "0", paiements: [{ devise: "CDF", montantCDF: "280000", montantUSD: null, taux: null }] });
  }, 60_000);

  it("versé en dollars : la facture en francs est soldée par reste ÷ taux ; versé en francs : la facture en dollars par reste × taux", async () => {
    const [a, b] = [await factureUSD(100), await factureFC(100000)];
    await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "USD");
    expect(await etat(a.id)).toMatchObject({ paiements: [{ devise: "USD", montantUSD: "100", montantCDF: null, taux: null }] });
    expect(await etat(b.id)).toMatchObject({ statut: "REGLEE", resteCDF: "0", paiements: [{ devise: "CDF", montantCDF: "100000", montantUSD: "35.71", taux: "2800" }] });
    const [c, d] = [await factureUSD(50, "13"), await factureFC(70000, { numero: "8" })];
    await marquerPayeesEnLot([c.id, d.id], "2026-10-01", "CDF");
    expect(await etat(c.id)).toMatchObject({ paiements: [{ devise: "USD", montantUSD: "50", montantCDF: "140000", taux: "2800" }] });
    expect(await etat(d.id)).toMatchObject({ paiements: [{ devise: "CDF", montantCDF: "70000", montantUSD: null, taux: null }] });
  }, 60_000);

  it("une conversion sans taux : le lot ENTIER est refusé, rien n'est écrit", async () => {
    const [a, b] = [await factureUSD(100), await factureFC(100000)];
    await taux(0);
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "USD")).toMatchObject({ erreur: expect.stringMatching(/Taux de change non configuré/) });
    expect(await prisma.paiement.count()).toBe(0);
  }, 60_000);

  it("une facture datée après la date de paiement : le lot ENTIER est refusé en la nommant", async () => {
    const a = await factureFC(100000);
    const b = await prisma.factureFournisseur.create({ data: { fournisseurNom: "TARDIVE", numero: "9", date: new Date("2026-10-05T00:00:00.000Z"), devise: "CDF", montantCDF: 5000, montantRegleCDF: 0, resteAPayerCDF: 5000, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null, mois: 10, annee: 2026 } });
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "SA_DEVISE")).toMatchObject({ erreur: expect.stringMatching(/TARDIVE \(n° 9\)/) });
    expect(await prisma.paiement.count()).toBe(0);
  }, 60_000);
});

describe("demandes d'un compte non-Direction sur une facture en francs", () => {
  it("« Marquer payée » : une demande portant le reste EN FRANCS ; validée, la facture est soldée en francs", async () => {
    const f = await factureFC(280000);
    en("resp");
    expect(await marquerPayee(f.id, "2026-10-01")).toMatchObject({ demande: true });
    expect(await etat(f.id)).toMatchObject({ resteCDF: "280000", paiements: [] });
    const [d] = await prisma.demandeValidationStock.findMany();
    expect(d.resume).toBe("Payer la facture n° 7 de MAMAN PAPY le 01/10/2026 — 280 000 FC");
    expect((d.charge as { factures: unknown[] }).factures).toEqual([{ id: f.id, fournisseurNom: "MAMAN PAPY", numero: "7", devise: "CDF", resteCDF: "280000" }]);
    en("dir");
    expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ traitees: [d.id], echecs: [] });
    expect(await etat(f.id)).toMatchObject({ statut: "REGLEE", resteCDF: "0", paiements: [{ devise: "CDF", montantCDF: "280000", montantUSD: null }] });
  }, 60_000);

  it("paiement en dollars demandé : converti au taux du jour de la VALIDATION", async () => {
    const f = await factureFC(280000);
    en("resp");
    await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "USD", montant: "20", date: "2026-10-01" }));
    const [d] = await prisma.demandeValidationStock.findMany();
    en("dir");
    await taux(3000);
    await validerDemandes([d.id], {}, await v([d.id]));
    expect(await etat(f.id)).toMatchObject({ resteCDF: "220000", paiements: [{ devise: "CDF", montantCDF: "60000", montantUSD: "20", taux: "3000" }] });
  }, 60_000);

  it("jeton : le reste en francs a changé depuis la demande → conflit, rien n'est écrit", async () => {
    const f = await factureFC(280000);
    en("resp");
    await marquerPayee(f.id, "2026-10-01");
    const [d] = await prisma.demandeValidationStock.findMany();
    await prisma.factureFournisseur.update({ where: { id: f.id }, data: { montantRegleCDF: 1000, resteAPayerCDF: 279000 } }); // bougé ailleurs
    en("dir");
    const r = await validerDemandes([d.id], {}, await v([d.id]));
    expect(JSON.stringify(r)).toMatch(/Le reste à payer de la facture n° 7 de MAMAN PAPY a changé depuis la demande \(280 000 FC → 279 000 FC\)/);
    expect(await prisma.paiement.count()).toBe(0);
  }, 60_000);

  it("lot « chacune dans sa devise » demandé puis validé : tout ou rien", async () => {
    const [a, b] = [await factureUSD(100), await factureFC(280000)];
    en("resp");
    expect(await marquerPayeesEnLot([a.id, b.id], "2026-10-01", "SA_DEVISE")).toMatchObject({ reglees: 0, demandePaiement: 2 });
    const [d] = await prisma.demandeValidationStock.findMany();
    expect(d.resume).toBe("Payer 2 factures le 01/10/2026 — 100,00 $ + 280 000 FC, chacune dans sa devise (ETS SENEVE n° 12, MAMAN PAPY n° 7)");
    en("dir");
    await taux(0); // aucune conversion : le taux n'est pas requis
    expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ traitees: [d.id] });
    expect((await etat(a.id)).statut).toBe("REGLEE");
    expect((await etat(b.id)).statut).toBe("REGLEE");
  }, 60_000);

  it("un paiement direct de la Direction est refusé tant qu'une demande attend (inchangé)", async () => {
    const f = await factureFC(280000);
    en("resp");
    await marquerPayee(f.id, "2026-10-01");
    en("dir");
    expect(await marquerPayee(f.id, "2026-10-01")).toMatchObject({ erreur: expect.stringMatching(/Un paiement est déjà demandé/) });
    expect(await prisma.paiement.count()).toBe(0);
  }, 60_000);
});

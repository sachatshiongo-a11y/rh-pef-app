import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : paiement de facture soumis à la
// validation de la Direction. Les VRAIES actions serveur (factures + a-valider) sont appelées avec
// un compte Direction (ADMIN) ou responsable stock (STOCK) ; seuls la session, le cache Next et
// l'envoi push sont simulés.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
const PUSH = vi.hoisted(() => ({ appels: [] as { ids: string[]; body: string }[] }));
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
vi.mock("@/lib/push", () => ({ envoyerPush: async (ids: string[], p: { body: string }) => { PUSH.appels.push({ ids, body: p.body }); } }));

const { marquerPayee, marquerPayeesEnLot, enregistrerPaiement } = await import("../factures/actions");
const { validerDemandes, refuserDemandes, retirerMaDemande } = await import("./actions");
const { validerDemande } = await import("@/lib/validations-stock/demandes");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false }, autre: { id: "", role: "STOCK", nom: "Marie", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"], ["autre", "STOCK"]] as const) {
    const u = await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } });
    U[k].id = u.id;
  }
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.paiement.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  PUSH.appels = [];
});

const facture = (o: Partial<{ fournisseurNom: string; numero: string; montant: number }> = {}) =>
  prisma.factureFournisseur.create({
    data: { fournisseurNom: o.fournisseurNom ?? "ETS SENEVE", numero: o.numero ?? "12", date: new Date("2026-09-01T00:00:00.000Z"), montantUSD: o.montant ?? 100, montantRegleUSD: 0, resteAPayerUSD: o.montant ?? 100, statut: "A_REGLER", mois: 9, annee: 2026 },
  });
const relire = (id: string) => prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
const paiements = (id: string) => prisma.paiement.findMany({ where: { factureId: id }, orderBy: { createdAt: "asc" } });
const demandes = () => prisma.demandeValidationStock.findMany({ include: { cibles: true }, orderBy: { createdAt: "asc" } });
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
/** L'état « argent » d'une facture et de ses paiements, pour comparer chemin direct et validation. */
const etatArgent = async (id: string) => {
  const f = await relire(id);
  const p = await paiements(id);
  return {
    statut: f.statut, regle: f.montantRegleUSD.toString(), reste: f.resteAPayerUSD.toString(), datePaiement: f.datePaiement?.toISOString() ?? null,
    paiements: p.map((x) => ({ type: x.type, date: x.date.toISOString(), montantUSD: x.montantUSD.toString(), montantCDF: x.montantCDF?.toString() ?? null, taux: x.tauxChangeUtilise?.toString() ?? null, mode: x.modePaiement })),
  };
};

describe("« Marquer payée » par le responsable stock : une demande, rien de payé", () => {
  it("crée une demande en attente (cible verrouillée, notification à la Direction) sans rien payer", async () => {
    const f = await facture();
    en("resp");
    const r = await marquerPayee(f.id, "2026-09-10");
    expect(r).toMatchObject({ demande: true });
    expect(await etatArgent(f.id)).toMatchObject({ statut: "A_REGLER", reste: "100", paiements: [] });
    const [d] = await demandes();
    expect(d).toMatchObject({ nature: "PAIEMENT_FACTURE", statut: "EN_ATTENTE", auteurId: U.resp.id });
    expect(d.cibles.map((c) => c.cle)).toEqual([`FACTURE:${f.id}`]);
    const n = await prisma.notification.findFirstOrThrow({ where: { refId: d.id } });
    expect(n).toMatchObject({ domaine: "STOCK", lien: "/stock/a-valider" });
    expect(n.message).toMatch(/À valider — Payer la facture n° 12 de ETS SENEVE le 10\/09\/2026 — 100,00 \$ \(Jean\)/);
  }, 60_000);

  it("double demande refusée (même compte, autre compte, autre geste, lot) — une seule demande", async () => {
    const f = await facture();
    const g = await facture({ fournisseurNom: "B", numero: "7" });
    en("resp");
    await marquerPayee(f.id, "2026-09-10");
    expect(await marquerPayee(f.id, "2026-09-10")).toMatchObject({ erreur: expect.stringMatching(/déjà en attente/) });
    en("autre");
    expect(await marquerPayee(f.id)).toMatchObject({ erreur: expect.stringMatching(/déjà en attente/) });
    expect(await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "USD", montant: "10" }))).toMatchObject({ erreur: expect.stringMatching(/déjà en attente/) });
    expect(await marquerPayeesEnLot([g.id, f.id], "2026-09-10")).toMatchObject({ erreur: expect.stringMatching(/déjà en attente/) });
    expect(await demandes()).toHaveLength(1);
    expect(await etatArgent(g.id)).toMatchObject({ statut: "A_REGLER", paiements: [] });
  }, 60_000);

  it("la Direction ne paie pas en direct une facture dont le paiement est demandé (pas de double règlement)", async () => {
    const f = await facture();
    en("resp"); await marquerPayee(f.id, "2026-09-10");
    en("dir");
    expect(await marquerPayee(f.id, "2026-09-10")).toMatchObject({ erreur: expect.stringMatching(/déjà demandé/) });
    expect(await marquerPayeesEnLot([f.id])).toMatchObject({ erreur: expect.stringMatching(/déjà demandé/) });
    expect(await enregistrerPaiement(f.id, fd({ type: "PAIEMENT", devise: "USD", montant: "10" }))).toMatchObject({ erreur: expect.stringMatching(/déjà demandé/) });
    expect(await etatArgent(f.id)).toMatchObject({ reste: "100", paiements: [] });
  }, 60_000);
});

describe("Validation = EXACTEMENT le paiement direct de la Direction", () => {
  it("« Marquer payée » : même facture, même paiement ; demande VALIDEE ; notifications", async () => {
    const directe = await facture();
    const demandee = await facture();
    en("dir"); await marquerPayee(directe.id, "2026-09-10");
    en("resp"); await marquerPayee(demandee.id, "2026-09-10");
    const [d] = await demandes();
    PUSH.appels = [];
    en("dir");
    expect(await validerDemandes([d.id])).toEqual({ traitees: [d.id], echecs: [] });
    expect(await etatArgent(demandee.id)).toEqual(await etatArgent(directe.id));
    expect((await etatArgent(demandee.id)).statut).toBe("REGLEE");
    const v = await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id }, include: { cibles: true } });
    expect(v).toMatchObject({ statut: "VALIDEE", decideurId: U.dir.id, decideurNom: "Sacha" });
    expect(v.cibles).toEqual([]);
    // Notification « à valider » retirée ; « payée » émise, push à la Direction, aux comptes Stock et au demandeur.
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0);
    const payee = await prisma.notification.findFirstOrThrow({ where: { refId: `reglement:${demandee.id}` } });
    expect(payee.message).toBe("Facture n° 12 de ETS SENEVE payée le 10/09/2026 — 100,00 $");
    expect(payee.lien).toBe(`/stock/factures/${demandee.id}`);
    expect(PUSH.appels.at(-1)?.ids.sort()).toEqual([U.dir.id, U.resp.id, U.autre.id].sort());
  }, 60_000);

  it("la Direction corrige la date de paiement à la validation", async () => {
    const f = await facture();
    en("resp"); await marquerPayee(f.id, "2026-09-10");
    const [d] = await demandes();
    en("dir"); await validerDemandes([d.id], { [d.id]: "2026-09-12" });
    expect((await etatArgent(f.id)).datePaiement).toBe("2026-09-12T00:00:00.000Z");
  }, 60_000);

  it("lot : tout ou rien, même date, identique au lot direct", async () => {
    const [a, b, c, e] = await Promise.all([facture({ fournisseurNom: "A", numero: "1" }), facture({ fournisseurNom: "B", numero: "2", montant: 40 }), facture({ fournisseurNom: "A", numero: "1" }), facture({ fournisseurNom: "B", numero: "2", montant: 40 })]);
    en("dir"); expect(await marquerPayeesEnLot([a.id, b.id], "2026-09-11")).toMatchObject({ reglees: 2 });
    en("resp"); expect(await marquerPayeesEnLot([c.id, e.id], "2026-09-11")).toMatchObject({ reglees: 0, demandePaiement: 2 });
    expect((await etatArgent(c.id)).paiements).toEqual([]);
    const [d] = await demandes();
    expect(d.cibles.map((x) => x.cle).sort()).toEqual([`FACTURE:${c.id}`, `FACTURE:${e.id}`].sort());
    en("dir"); expect(await validerDemandes([d.id])).toMatchObject({ traitees: [d.id] });
    expect(await etatArgent(c.id)).toEqual(await etatArgent(a.id));
    expect(await etatArgent(e.id)).toEqual(await etatArgent(b.id));
    expect((await prisma.notification.findFirstOrThrow({ where: { message: { startsWith: "2 factures payées" } } })).message).toBe("2 factures payées le 11/09/2026 — 140,00 $ (A n° 1, B n° 2)");
  }, 60_000);

  it("règlement partiel en francs : montant, francs et taux figés comme le chemin direct", async () => {
    const directe = await facture();
    const demandee = await facture();
    const saisie = { type: "PAIEMENT", devise: "CDF", montant: "115000", modePaiement: "Espèces", date: "2026-09-09" };
    en("dir"); await enregistrerPaiement(directe.id, fd(saisie));
    en("resp"); expect(await enregistrerPaiement(demandee.id, fd(saisie))).toMatchObject({ demande: true });
    expect((await etatArgent(demandee.id)).paiements).toEqual([]);
    const [d] = await demandes();
    en("dir"); await validerDemandes([d.id]);
    expect(await etatArgent(demandee.id)).toEqual(await etatArgent(directe.id));
    expect((await etatArgent(demandee.id)).paiements[0]).toMatchObject({ montantUSD: "50", montantCDF: "115000", taux: "2300" });
  }, 60_000);
});

describe("Refus, retrait, conflits, droits", () => {
  it("refus : motif obligatoire ; rien payé ; cible libérée ; le demandeur est notifié", async () => {
    const f = await facture();
    en("resp"); await marquerPayee(f.id, "2026-09-10");
    const [d] = await demandes();
    en("dir");
    expect(await refuserDemandes([d.id], " ")).toMatchObject({ erreur: expect.stringMatching(/motif/) });
    expect(await refuserDemandes([d.id], "Facture contestée")).toEqual({ traitees: [d.id], echecs: [] });
    const r = await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id }, include: { cibles: true } });
    expect(r).toMatchObject({ statut: "REFUSEE", motifRefus: "Facture contestée", decideurId: U.dir.id });
    expect(r.cibles).toEqual([]);
    expect(await etatArgent(f.id)).toMatchObject({ statut: "A_REGLER", paiements: [] });
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0);
    expect((await prisma.notification.findFirstOrThrow({ where: { refId: `decision:${d.id}` } })).message).toMatch(/refusée.*Facture contestée/);
    // Une demande refusée ne se valide plus, et la facture peut être redemandée.
    expect(await validerDemandes([d.id])).toMatchObject({ echecs: [{ id: d.id, erreur: expect.stringMatching(/déjà été refusée/) }] });
    en("resp"); expect(await marquerPayee(f.id, "2026-09-10")).toMatchObject({ demande: true });
  }, 60_000);

  it("retrait : seul l'auteur ; la cible est libérée", async () => {
    const f = await facture();
    en("resp"); await marquerPayee(f.id, "2026-09-10");
    const [d] = await demandes();
    en("autre"); expect(await retirerMaDemande(d.id)).toMatchObject({ erreur: expect.stringMatching(/Seul l'auteur/) });
    en("resp"); expect(await retirerMaDemande(d.id)).toBeUndefined();
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("ANNULEE");
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0);
  }, 60_000);

  it("conflit : facture réglée par un autre chemin entre la demande et la validation → rien n'est écrit, la demande reste en attente", async () => {
    const f = await facture();
    en("resp"); await marquerPayee(f.id, "2026-09-10");
    const [d] = await demandes();
    // Règlement « par ailleurs » (import du suivi, correction en base…) — hors des gestes gardés.
    await prisma.factureFournisseur.update({ where: { id: f.id }, data: { montantRegleUSD: 100, resteAPayerUSD: 0, statut: "REGLEE" } });
    en("dir");
    const r = await validerDemandes([d.id]);
    expect(r).toMatchObject({ traitees: [], echecs: [{ id: d.id, erreur: expect.stringMatching(/déjà été réglée depuis la demande.*rien n'a été écrit/) }] });
    expect(await paiements(f.id)).toEqual([]);
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  }, 60_000);

  it("conflit dans un lot : le reste d'UNE facture a changé → AUCUNE facture du lot n'est payée", async () => {
    const [a, b] = await Promise.all([facture({ numero: "1" }), facture({ numero: "2" })]);
    en("resp"); await marquerPayeesEnLot([a.id, b.id], "2026-09-10");
    const [d] = await demandes();
    await prisma.factureFournisseur.update({ where: { id: b.id }, data: { montantRegleUSD: 30, resteAPayerUSD: 70 } });
    en("dir");
    expect(await validerDemandes([d.id])).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/reste à payer.*a changé/) }] });
    expect(await prisma.paiement.count()).toBe(0);
    expect((await relire(a.id)).statut).toBe("A_REGLER");
  }, 60_000);

  it("droits : le responsable ne peut ni valider ni refuser (action serveur ET cœur) ; rien ne bouge", async () => {
    const f = await facture();
    en("resp"); await marquerPayee(f.id, "2026-09-10");
    const [d] = await demandes();
    en("resp");
    expect(await validerDemandes([d.id])).toMatchObject({ erreur: "Réservé à la Direction." });
    expect(await refuserDemandes([d.id], "je refuse")).toMatchObject({ erreur: "Réservé à la Direction." });
    // Même en appelant le cœur avec un compte non-Direction (défense en profondeur).
    await expect(validerDemande({ id: U.resp.id, nom: "Jean", role: "STOCK" }, d.id)).rejects.toThrow("Réservé à la Direction.");
    // Un salarié avec accès Stock, idem.
    A.user = { id: U.autre.id, role: "EMPLOYE", nom: "Marie", accesStock: true };
    expect(await validerDemandes([d.id])).toMatchObject({ erreur: "Réservé à la Direction." });
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
    expect(await etatArgent(f.id)).toMatchObject({ paiements: [] });
  }, 60_000);

  it("contournement : un montant « déjà réglé » à la création d'une facture est refusé hors Direction", async () => {
    const { creerFactureAvecLignes } = await import("../factures/actions");
    en("resp");
    const r = await creerFactureAvecLignes(fd({ fournisseurNom: "ETS SENEVE", ligne_designation: "Riz", ligne_quantite: "1", ligne_prix: "100", montantRegleUSD: "100" }));
    expect(r).toMatchObject({ erreur: expect.stringMatching(/validé par la Direction/) });
    expect(await prisma.factureFournisseur.count()).toBe(0);
  }, 60_000);

  it("la Direction qui paie en direct notifie aussi « payée »", async () => {
    const f = await facture();
    en("dir"); await marquerPayee(f.id, "2026-09-10");
    expect((await prisma.notification.findFirstOrThrow({ where: { refId: `reglement:${f.id}` } })).message).toBe("Facture n° 12 de ETS SENEVE payée le 10/09/2026 — 100,00 $");
    await enregistrerPaiement((await facture({ numero: "13" })).id, fd({ type: "PAIEMENT", devise: "USD", montant: "40", date: "2026-09-10" }));
    expect(await prisma.notification.findFirst({ where: { message: { startsWith: "Paiement partiel de 40,00 $ sur la facture n° 13" } } })).not.toBeNull();
  }, 60_000);
});

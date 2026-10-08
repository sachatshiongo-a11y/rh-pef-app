import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// « Changer la date » d'une sortie de stock (demande de Sacha, 2026-10-08) — test d'INTÉGRATION
// (Postgres éphémère, jamais la prod). À l'unité et en lot ; Direction seule (mêmes comptes que
// « Changer le motif ») ; SORTIES seules ; tout ou rien avec les sorties fautives nommées ; période
// clôturée (ancienne ET nouvelle date), comptage entre les deux dates (bornes incluses), réconciliation
// en attente, date future ou invalide ; journal avant → après ; notification d'un non-Direction ; la
// Conso. journalière et la Comparaison relisent la sortie au nouveau jour.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Sacha", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
const PUSH = vi.hoisted(() => ({ appels: [] as { userIds: string[]; payload: { title: string; body: string; url?: string } }[] }));
vi.mock("@/lib/push", () => ({ envoyerPush: async (userIds: string[], payload: { title: string; body: string }) => { PUSH.appels.push({ userIds, payload }); } }));

const { changerDateSorties } = await import("./actions");
const { appliquerChangementDateSorties } = await import("@/lib/validations-stock/date-sortie");
const { chargerDonneesRestaurant } = await import("../journalier/donnees-restaurant");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = {
  dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false },
  dir2: { id: "", role: "ADMIN", nom: "Associée", accesStock: false },
  resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false },
  rh: { id: "", role: "MANAGER", nom: "RH", accesStock: true },
};
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
let riz: string;
let sel: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) {
    const u = await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" | "MANAGER" } });
    U[k].id = u.id;
  }
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  PUSH.appels = [];
  await prisma.notification.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.clotureStock.deleteMany();
  await prisma.sessionComptage.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.ligneFacture.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  riz = (await prisma.articleStock.create({ data: { designation: "Riz", domaine: "NOURRITURE", unite: "kg" } })).id;
  sel = (await prisma.articleStock.create({ data: { designation: "Sel", domaine: "NOURRITURE", unite: "kg" } })).id;
  await prisma.stock.createMany({ data: [{ articleId: riz, quantite: "20" }, { articleId: sel, quantite: "9" }] });
});

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const sortie = (articleId: string, date: string, motif: "LIVRAISON_RESTAURANT" | "PERTE" = "LIVRAISON_RESTAURANT", quantite = "3") =>
  prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite, date: jour(date), categorieSortie: motif, raisonSortie: motif === "PERTE" ? "moisi" : null, origine: motif === "PERTE" ? "Perte — moisi" : "Livraison restaurant", creeParId: U.resp.id } });
const lire = (id: string) => prisma.mouvementStock.findUniqueOrThrow({ where: { id } });
const dateDe = async (id: string) => (await lire(id)).date.toISOString().slice(0, 10);
const stocks = async () => Object.fromEntries((await prisma.stock.findMany()).map((s) => [s.articleId === riz ? "riz" : "sel", s.quantite.toString()]));
const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error(`Action acceptée alors qu'elle aurait dû être refusée : ${JSON.stringify(r)}`);
};
/** Rien n'a bougé : dates d'origine, aucun journal, aucune notification. */
const rienEcrit = async (attendu: Record<string, string>) => {
  for (const [id, d] of Object.entries(attendu)) expect(await dateDe(id)).toBe(d);
  expect(await prisma.journalAudit.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
};

describe("changer la date d'une sortie — à l'unité et en lot", () => {
  it("à l'unité : seule la date change (id, motif, quantité, libellé, stock du dépôt intacts), journal avant → après", async () => {
    const s = await sortie(riz, "2026-10-03", "PERTE");
    const avant = await lire(s.id);
    expect(await changerDateSorties([s.id], "2026-10-01")).toEqual({ n: 1, deja: 0, date: "2026-10-01" });
    const apres = await lire(s.id);
    expect(apres.date.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect({ ...apres, date: avant.date }).toEqual(avant); // tout le reste à l'identique
    expect(await stocks()).toEqual({ riz: "20", sel: "9" });
    const j = await prisma.journalAudit.findMany();
    expect(j.map((x) => [x.entite, x.entiteId, x.champ, x.ancienneValeur, x.nouvelleValeur, x.userId])).toEqual([["MouvementStock", s.id, "date", "2026-10-03", "2026-10-01", U.dir.id]]);
  }, 60_000);

  it("en lot : plusieurs sorties de dates et d'articles différents ; une déjà à la date n'est ni réécrite ni journalisée", async () => {
    const a = await sortie(riz, "2026-10-03");
    const b = await sortie(sel, "2026-10-04");
    const c = await sortie(sel, "2026-10-01");
    expect(await changerDateSorties([a.id, b.id, c.id], "2026-10-01")).toEqual({ n: 2, deja: 1, date: "2026-10-01" });
    expect([await dateDe(a.id), await dateDe(b.id), await dateDe(c.id)]).toEqual(["2026-10-01", "2026-10-01", "2026-10-01"]);
    expect((await prisma.journalAudit.findMany()).map((x) => x.entiteId).sort()).toEqual([a.id, b.id].sort());
  }, 60_000);

  it("tout le filtre de la colonne Sorties : recompté par le serveur ; un nombre différent ne touche rien", async () => {
    const a = await sortie(riz, "2026-10-03");
    const b = await sortie(sel, "2026-10-04");
    const filtre = { mois: "2026-10", articleId: null, motif: null };
    const r = await changerDateSorties({ filtre, colonne: "SORTIES", attendu: 3 }, "2026-10-02");
    expect(erreurDe(r)).toMatch(/compte maintenant 2 sorties, et non 3/);
    expect((r as { nouveauNombre?: number }).nouveauNombre).toBe(2);
    await rienEcrit({ [a.id]: "2026-10-03", [b.id]: "2026-10-04" });
    expect(await changerDateSorties({ filtre, colonne: "SORTIES", attendu: 2 }, "2026-10-02")).toEqual({ n: 2, deja: 0, date: "2026-10-02" });
    // La colonne Entrées ne se redate jamais.
    expect(erreurDe(await changerDateSorties({ filtre, colonne: "ENTREES", attendu: 2 }, "2026-10-02"))).toMatch(/Seules les sorties changent de date/);
  }, 60_000);
});

describe("droits : mêmes comptes que « Changer le motif » (Direction)", () => {
  it.each(["resp", "rh"] as const)("refus pour un compte %s, appel direct de l'action : rien d'écrit", async (qui) => {
    const s = await sortie(riz, "2026-10-03");
    en(qui);
    expect(erreurDe(await changerDateSorties([s.id], "2026-10-01"))).toMatch(/Accès refusé/);
    await rienEcrit({ [s.id]: "2026-10-03" });
  }, 60_000);
});

describe("seules les sorties", () => {
  it("entrée manuelle, entrée par facture, ajustement de comptage : refus lisible qui les nomme, tout ou rien", async () => {
    const s = await sortie(riz, "2026-10-03");
    const e = await prisma.mouvementStock.create({ data: { articleId: sel, type: "ENTREE", quantite: "5", date: jour("2026-10-03"), origine: "Retour restaurant" } });
    const f = await prisma.factureFournisseur.create({ data: { fournisseurNom: "SENEVE", date: jour("2026-10-02"), montantUSD: "10", mois: 10, annee: 2026 } });
    const ef = await prisma.mouvementStock.create({ data: { articleId: riz, type: "ENTREE", quantite: "2", date: jour("2026-10-02"), factureId: f.id } });
    const aj = await prisma.mouvementStock.create({ data: { articleId: sel, type: "AJUSTEMENT", quantite: "1", date: jour("2026-10-02"), origine: "Comptage" } });
    const msg = erreurDe(await changerDateSorties([s.id, e.id, ef.id, aj.id], "2026-10-01"));
    expect(msg).toMatch(/^Seules les sorties changent de date/);
    expect(msg).toContain("Sel du 03/10 (entrée)");
    expect(msg).toContain("Riz du 02/10 (entrée par facture)");
    expect(msg).toContain("Sel du 02/10 (ajustement de comptage)");
    expect(msg).not.toContain("Riz du 03/10");
    await rienEcrit({ [s.id]: "2026-10-03", [e.id]: "2026-10-03", [ef.id]: "2026-10-02", [aj.id]: "2026-10-02" });
  }, 60_000);
});

describe("date future ou invalide", () => {
  it.each([
    ["2099-01-01", /ne peut pas être dans le futur/],
    ["", /Choisissez la nouvelle date/],
    ["2026-02-31", /Date invalide/],
    ["03/10/2026", /Date invalide/],
  ])("« %s » : refus, rien d'écrit", async (saisie, attendu) => {
    const s = await sortie(riz, "2026-10-03");
    expect(erreurDe(await changerDateSorties([s.id], saisie))).toMatch(attendu);
    await rienEcrit({ [s.id]: "2026-10-03" });
  }, 60_000);

  it("« aujourd'hui » se lit à Kinshasa : le 07/10 à 23 h 30 UTC, le 08/10 est accepté, le 09/10 refusé", async () => {
    const s = await sortie(riz, "2026-10-03");
    const minuitPasseAKinshasa = new Date("2026-10-07T23:30:00Z");
    const auteur = { id: U.dir.id, nom: "Sacha", role: "ADMIN" as const };
    await expect(appliquerChangementDateSorties(auteur, [s.id], "2026-10-09", minuitPasseAKinshasa)).rejects.toThrow(/futur \(aujourd'hui à Kinshasa : 08\/10\/2026\)/);
    expect(await appliquerChangementDateSorties(auteur, [s.id], "2026-10-08", minuitPasseAKinshasa)).toEqual({ n: 1, deja: 0, date: "2026-10-08" });
  }, 60_000);
});

describe("période clôturée", () => {
  it("ANCIENNE date dans un mois clôturé : refus qui nomme la sortie ; le lot entier est refusé", async () => {
    const vieille = await sortie(riz, "2026-08-20");
    const recente = await sortie(sel, "2026-10-03");
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    const msg = erreurDe(await changerDateSorties([vieille.id, recente.id], "2026-10-01"));
    expect(msg).toMatch(/La période 08\/2026 est clôturée/);
    expect(msg).toContain("Riz du 20/08");
    expect(msg).not.toContain("Sel du 03/10");
    await rienEcrit({ [vieille.id]: "2026-08-20", [recente.id]: "2026-10-03" });
  }, 60_000);

  it("ancienne date dans un mois ANTÉRIEUR au dernier mois clôturé (borne basse) : refus", async () => {
    const s = await sortie(riz, "2026-07-15");
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    expect(erreurDe(await changerDateSorties([s.id], "2026-10-01"))).toMatch(/08\/2026 est clôturée/);
    await rienEcrit({ [s.id]: "2026-07-15" });
  }, 60_000);

  it("NOUVELLE date dans un mois clôturé : refus", async () => {
    const s = await sortie(riz, "2026-10-03");
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 9 } });
    expect(erreurDe(await changerDateSorties([s.id], "2026-09-30"))).toMatch(/09\/2026 est clôturée : .* aucune sortie ne peut être datée du 30\/09\/2026/);
    await rienEcrit({ [s.id]: "2026-10-03" });
    // Dans le mois ouvert, la même sortie se redate.
    expect(await changerDateSorties([s.id], "2026-10-01")).toEqual({ n: 1, deja: 0, date: "2026-10-01" });
  }, 60_000);
});

describe("réconciliation : comptage entre l'ancienne et la nouvelle date", () => {
  const comptage = async (articleId: string, date: string) => {
    const session = await prisma.sessionComptage.create({ data: { date: jour(date), nbArticles: 1 } });
    await prisma.ligneComptage.create({ data: { sessionId: session.id, articleId, designation: "x", theorique: "10", physique: "10", ecart: "0" } });
  };

  it("session de comptage du même article entre les deux dates : refus qui nomme la sortie et le comptage ; tout le lot refusé", async () => {
    const a = await sortie(riz, "2026-10-05");
    const b = await sortie(sel, "2026-10-05");
    await comptage(riz, "2026-10-03");
    const msg = erreurDe(await changerDateSorties([a.id, b.id], "2026-10-01"));
    expect(msg).toMatch(/^Date non changée : rien n'a été modifié\. Un comptage du même article tombe entre l'ancienne et la nouvelle date/);
    expect(msg).toContain("Riz du 05/10 (comptage du 03/10)");
    expect(msg).not.toContain("Sel");
    await rienEcrit({ [a.id]: "2026-10-05", [b.id]: "2026-10-05" });
  }, 60_000);

  it.each([
    ["le jour de l'ANCIENNE date", "2026-10-05"],
    ["le jour de la NOUVELLE date", "2026-10-01"],
  ])("bornes incluses : comptage %s → refus", async (_quoi, date) => {
    const a = await sortie(riz, "2026-10-05");
    await comptage(riz, date);
    expect(erreurDe(await changerDateSorties([a.id], "2026-10-01"))).toMatch(/Un comptage du même article/);
    await rienEcrit({ [a.id]: "2026-10-05" });
  }, 60_000);

  it("vers une date PLUS TARDIVE aussi (comptage entre les deux, dans l'autre sens)", async () => {
    const a = await sortie(riz, "2026-10-01");
    await comptage(riz, "2026-10-03");
    expect(erreurDe(await changerDateSorties([a.id], "2026-10-05"))).toContain("Riz du 01/10 (comptage du 03/10)");
  }, 60_000);

  it("mouvement d'AJUSTEMENT du même article entre les deux dates : refus", async () => {
    const a = await sortie(riz, "2026-10-05");
    await prisma.mouvementStock.create({ data: { articleId: riz, type: "AJUSTEMENT", quantite: "1", date: jour("2026-10-02"), origine: "Comptage 02/10/2026" } });
    expect(erreurDe(await changerDateSorties([a.id], "2026-10-01"))).toContain("Riz du 05/10 (comptage du 02/10)");
  }, 60_000);

  it("comptage hors de l'intervalle, ou d'un autre article : accepté", async () => {
    const a = await sortie(riz, "2026-10-05");
    await comptage(riz, "2026-09-30");
    await comptage(riz, "2026-10-06");
    await comptage(sel, "2026-10-03");
    expect(await changerDateSorties([a.id], "2026-10-01")).toEqual({ n: 1, deja: 0, date: "2026-10-01" });
  }, 60_000);

  it("réconciliation EN ATTENTE de la Direction sur l'article : refus qui la nomme", async () => {
    const a = await sortie(riz, "2026-10-05");
    const b = await sortie(sel, "2026-10-05");
    const d = await prisma.demandeValidationStock.create({ data: { nature: "RECONCILIATION", resume: "Comptage", charge: {}, auteurId: U.resp.id, auteurNom: "Jean" } });
    await prisma.cibleDemandeStock.create({ data: { cle: `COMPTAGE:${riz}`, demandeId: d.id } });
    const msg = erreurDe(await changerDateSorties([a.id, b.id], "2026-10-01"));
    expect(msg).toMatch(/Une réconciliation de l'article attend la décision de la Direction/);
    expect(msg).toContain("Riz du 05/10");
    await rienEcrit({ [a.id]: "2026-10-05", [b.id]: "2026-10-05" });
  }, 60_000);
});

describe("notification de la Direction", () => {
  it("un compte NON-Direction (cœur appelé directement) : une notification par geste, à chaque Direction, jamais à l'auteur", async () => {
    const a = await sortie(riz, "2026-10-03");
    const b = await sortie(sel, "2026-10-03");
    const r = await appliquerChangementDateSorties({ id: U.resp.id, nom: "Jean", role: "STOCK" }, [a.id, b.id], "2026-10-01");
    expect(r).toEqual({ n: 2, deja: 0, date: "2026-10-01" });
    const notifs = await prisma.notification.findMany({ orderBy: { destinataireUserId: "asc" } });
    expect(notifs.map((n) => n.destinataireUserId).sort()).toEqual([U.dir.id, U.dir2.id].sort());
    expect(notifs.every((n) => n.message === "Date de 2 sorties changée par Jean : 03/10 → 01/10 — Riz, Sel")).toBe(true);
    expect(notifs[0]!.lien).toBe("/stock/mouvements?mois=2026-10&motif=livraison");
    expect(PUSH.appels).toHaveLength(1);
    expect(PUSH.appels[0]!.userIds).not.toContain(U.resp.id);
  }, 60_000);

  it("la Direction : rien (ni cloche, ni push)", async () => {
    const a = await sortie(riz, "2026-10-03");
    expect(await changerDateSorties([a.id], "2026-10-01")).toEqual({ n: 1, deja: 0, date: "2026-10-01" });
    expect(await prisma.notification.count()).toBe(0);
    expect(PUSH.appels).toHaveLength(0);
  }, 60_000);

  it("un refus ne notifie personne", async () => {
    const a = await sortie(riz, "2026-10-03");
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 10 } });
    expect(erreurDe(await appliquerChangementDateSorties({ id: U.resp.id, nom: "Jean", role: "STOCK" }, [a.id], "2026-10-01"))).toMatch(/clôturée/);
    expect(await prisma.notification.count()).toBe(0);
  }, 60_000);
});

describe("écrans qui lisent les sorties par jour", () => {
  it("Conso. journalière et Comparaison (sorties par motif de la semaine) voient la sortie au NOUVEAU jour", async () => {
    const a = await sortie(riz, "2026-10-08", "LIVRAISON_RESTAURANT", "4");
    const lundi = jour("2026-10-05");
    const avant = await chargerDonneesRestaurant(lundi, undefined);
    expect(avant.sorties.livraisons.find((l) => l.id === riz)?.jours).toEqual([0, 0, 0, 4, 0, 0, 0]);
    expect(await changerDateSorties([a.id], "2026-10-06")).toEqual({ n: 1, deja: 0, date: "2026-10-06" });
    const apres = await chargerDonneesRestaurant(lundi, undefined);
    expect(apres.sorties.livraisons.find((l) => l.id === riz)?.jours).toEqual([0, 4, 0, 0, 0, 0, 0]);
    // Semaine précédente : redatée d'une semaine, elle passe de l'autre côté.
    expect(await changerDateSorties([a.id], "2026-10-02")).toEqual({ n: 1, deja: 0, date: "2026-10-02" });
    expect((await chargerDonneesRestaurant(lundi, undefined)).sorties.livraisons).toEqual([]);
    expect((await chargerDonneesRestaurant(jour("2026-09-28"), undefined)).sorties.livraisons.find((l) => l.id === riz)?.jours).toEqual([0, 0, 0, 0, 4, 0, 0]);
  }, 60_000);
});

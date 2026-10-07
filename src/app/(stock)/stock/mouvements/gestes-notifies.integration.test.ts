import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { ecrireSaisieNombre } from "@/lib/nombre";
import { jourKinshasaISO } from "@/lib/date-paiement";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — décisions de Sacha du 2026-10-07 :
//  1. « je ne veux pas que la direction ait à valider les sorties de stock, je veux juste recevoir les
//     notifications lorsqu'un mouvement est fait, lorsqu'une facture est enregistrée, quand un achat est
//     fait ou tout autre entrée de stock » : toute entrée/sortie manuelle est écrite tout de suite, et
//     CHAQUE geste d'un compte non-Direction notifie la Direction (une notification par geste, aux
//     comptes ADMIN actifs seulement, jamais à l'auteur ; rien pour un geste de la Direction) ;
//  2. le MOTIF est obligatoire pour toute sortie, pour tous les rôles, Direction comprise.
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
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock/factures;307;" }); } }));
const PUSH = vi.hoisted(() => ({ casser: false, appels: [] as { userIds: string[]; payload: { title: string; body: string; url?: string; tag?: string } }[] }));
vi.mock("@/lib/push", () => ({
  envoyerPush: async (userIds: string[], payload: { title: string; body: string }) => {
    PUSH.appels.push({ userIds, payload });
    if (PUSH.casser) throw new Error("push en panne");
  },
}));

const { mouvementManuel } = await import("./actions");
const { entreeListeAchat } = await import("../entree/actions");
const { creerAchatsLegumes } = await import("../legumes/actions");
const { creerFactureAvecLignes, marquerPayee } = await import("../factures/actions");
const { receptionnerBonCommande } = await import("../commandes/actions");
const { appliquerComptage } = await import("../reconciliation/actions");
const { chargerNotifications } = await import("@/lib/notifications");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = {
  dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false },
  dir2: { id: "", role: "ADMIN", nom: "Associée", accesStock: false },
  dirInactif: { id: "", role: "ADMIN", nom: "Ancien", accesStock: false },
  resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false },
  resp2: { id: "", role: "STOCK", nom: "Paul", accesStock: false },
};
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) {
    const u = await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK", actif: k !== "dirInactif" } });
    U[k].id = u.id;
  }
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  PUSH.casser = false; PUSH.appels = [];
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.reception.deleteMany();
  await prisma.ligneFacture.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.ligneBonDeCommande.deleteMany();
  await prisma.bonDeCommande.deleteMany();
  await prisma.achatLegume.deleteMany();
  await prisma.sessionComptage.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const article = async (designation: string, quantite = 10, unite = "Kg") => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite, prixUnitaireUSD: 2 } });
  await prisma.stock.create({ data: { articleId: a.id, quantite, stockMinimum: 1 } });
  return a.id;
};
const DATE = jourKinshasaISO();
const MOIS = `${Number(DATE.slice(0, 4))}-${Number(DATE.slice(5, 7))}`;
const mvt = (o: { type: "ENTREE" | "SORTIE"; lignes: [string, number][]; categorieSortie?: string; raisonSortie?: string; motifEntree?: string; origine?: string; date?: string | null }) => {
  const f = new FormData();
  f.set("type", o.type);
  if (o.date !== null) f.set("date", o.date ?? DATE);
  if (o.categorieSortie !== undefined) f.set("categorieSortie", o.categorieSortie);
  if (o.raisonSortie) f.set("raisonSortie", o.raisonSortie);
  if (o.motifEntree) f.set("motifEntree", o.motifEntree);
  if (o.origine) f.set("origine", o.origine);
  for (const [id, q] of o.lignes) { f.append("articleId", id); f.append("quantite", ecrireSaisieNombre(q)); }
  return f;
};
const stock = async (id: string) => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: id } })).quantite);
/** Notifications de geste (cloche Stock adressée) : par destinataire. */
const gestes = async () => prisma.notification.findMany({ where: { refId: { startsWith: "geste:" } }, orderBy: { createdAt: "asc" } });
/** Exactement une notification par compte Direction ACTIF, même message ; aucune pour les autres. */
const uneParDirection = async () => {
  const n = await gestes();
  expect(n.map((x) => x.destinataireUserId).sort()).toEqual([U.dir.id, U.dir2.id].sort());
  expect(n.every((x) => x.domaine === "STOCK" && !x.lu)).toBe(true);
  expect(new Set(n.map((x) => x.message)).size).toBe(1);
  return n[0];
};

describe("Mouvements manuels : écrits tout de suite pour tout compte Stock, aucune demande", () => {
  it.each([
    ["sortie « Livraison restaurant »", { type: "SORTIE" as const, categorieSortie: "LIVRAISON_RESTAURANT" }, 7, "Sortie de 3 Kg — Riz (Livraison restaurant) par Jean", "livraison"],
    ["sortie « Perte » (raison)", { type: "SORTIE" as const, categorieSortie: "PERTE", raisonSortie: "Inventaire" }, 7, "Sortie de 3 Kg — Riz (Perte — Inventaire) par Jean", "perte"],
    ["entrée (correction)", { type: "ENTREE" as const, origine: "Correction" }, 13, "Entrée de 3 Kg — Riz (Correction) par Jean", "autres"],
    ["entrée « Retour restaurant »", { type: "ENTREE" as const, motifEntree: "RETOUR_RESTAURANT" }, 13, "Entrée de 3 Kg — Riz (Retour restaurant) par Jean", "autres"],
  ])("%s : écrite, notifiée une fois à chaque Direction active", async (_n, o, attendu, message, motif) => {
    const riz = await article("Riz");
    en("resp");
    expect(await mouvementManuel(mvt({ ...o, lignes: [[riz, 3]] }))).toMatchObject({ demande: false });
    expect(await stock(riz)).toBe(attendu);
    expect(await prisma.demandeValidationStock.count()).toBe(0);
    const n = await uneParDirection();
    expect(n.message).toBe(message);
    expect(n.lien).toBe(`/stock/mouvements?mois=${MOIS}&motif=${motif}&articleId=${riz}`);
    expect(PUSH.appels).toHaveLength(1);
    expect(PUSH.appels[0].userIds.sort()).toEqual([U.dir.id, U.dir2.id].sort());
  }, 60_000);

  it("l'exemple de Sacha : « Sortie de 3 bouteilles — Cointreau-70cl (…) par Jean » ; un salarié avec accès Stock aussi", async () => {
    const c = await article("Cointreau-70cl", 10, "bouteille");
    A.user = { id: U.resp2.id, role: "EMPLOYE", nom: "Paul", accesStock: true };
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "PERTE", raisonSortie: "Inventaire", lignes: [[c, 3]] }));
    expect((await uneParDirection()).message).toBe("Sortie de 3 bouteilles — Cointreau-70cl (Perte — Inventaire) par Paul");
  }, 60_000);

  it("une saisie de plusieurs lignes = UNE notification qui résume", async () => {
    const riz = await article("Riz"); const sel = await article("Sel"); const huile = await article("Huile", 10, "L");
    en("resp");
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 3], [sel, 1.5], [huile, 2]] }));
    const n = await uneParDirection();
    expect(n.message).toBe("Sortie de 3 articles (Livraison restaurant) par Jean : Riz 3 Kg, Sel 1,5 Kg, Huile 2 L");
    expect(n.lien).toBe(`/stock/mouvements?mois=${MOIS}&motif=livraison`);
  }, 60_000);

  it("un geste de la Direction n'est notifié à personne", async () => {
    const riz = await article("Riz");
    en("dir");
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 3]] }));
    await mouvementManuel(mvt({ type: "ENTREE", origine: "Correction", lignes: [[riz, 1]] }));
    expect(await stock(riz)).toBe(8);
    expect(await gestes()).toEqual([]);
    expect(PUSH.appels).toEqual([]);
  }, 60_000);

  it("l'auteur ne voit pas la notification de son geste ; chaque Direction ne voit que la sienne", async () => {
    const riz = await article("Riz");
    en("resp"); await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 3]] }));
    const [nDir, nDir2] = [(await gestes()).find((x) => x.destinataireUserId === U.dir.id)!, (await gestes()).find((x) => x.destinataireUserId === U.dir2.id)!];
    const ids = async (u: string) => (await chargerNotifications("STOCK", u)).items.map((x) => x.id);
    expect(await ids(U.resp.id)).not.toContain(nDir.id);
    expect(await ids(U.resp.id)).not.toContain(nDir2.id);
    expect(await ids(U.resp2.id)).not.toContain(nDir.id);
    expect(await ids(U.dir.id)).toContain(nDir.id);
    expect(await ids(U.dir.id)).not.toContain(nDir2.id);
  }, 60_000);

  it("mêmes contrôles qu'avant : article inconnu, quantité hors limites, date illisible, période clôturée → rien d'écrit, rien de notifié", async () => {
    const riz = await article("Riz");
    en("resp");
    const libre = { type: "SORTIE" as const, categorieSortie: "LIVRAISON_RESTAURANT" };
    expect(await mouvementManuel(mvt({ ...libre, lignes: [["inexistant", 1]] }))).toMatchObject({ erreur: expect.stringMatching(/Article introuvable/) });
    expect(await mouvementManuel(mvt({ ...libre, lignes: [[riz, 1e12]] }))).toMatchObject({ erreur: expect.stringMatching(/hors limites/) });
    expect(await mouvementManuel(mvt({ ...libre, lignes: [[riz, 1.2345]] }))).toMatchObject({ erreur: expect.stringMatching(/3 décimales au plus/) });
    expect(await mouvementManuel(mvt({ ...libre, date: "2026-13-45", lignes: [[riz, 1]] }))).toMatchObject({ erreur: expect.stringMatching(/Date du mouvement invalide/) });
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    try {
      expect(await mouvementManuel(mvt({ ...libre, date: "2026-08-20", lignes: [[riz, 1]] }))).toMatchObject({ erreur: expect.stringMatching(/clôtur/i) });
    } finally { await prisma.clotureStock.deleteMany(); }
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await stock(riz)).toBe(10);
    expect(await gestes()).toEqual([]);
  }, 60_000);

  it("sans date saisie : datée du jour civil de Kinshasa", async () => {
    const riz = await article("Riz");
    en("resp"); await mouvementManuel(mvt({ type: "ENTREE", origine: "Correction", date: null, lignes: [[riz, 1]] }));
    expect((await prisma.mouvementStock.findFirstOrThrow()).date.toISOString().slice(0, 10)).toBe(jourKinshasaISO());
  }, 60_000);
});

describe("Motif OBLIGATOIRE pour toute sortie (tous les rôles, Direction comprise)", () => {
  it.each(["resp", "dir"] as const)("%s : sortie sans motif, ou motif inconnu → refus lisible, rien d'écrit ni notifié", async (qui) => {
    const riz = await article("Riz");
    en(qui);
    for (const categorieSortie of [undefined, "", "INVENTAIRE"]) {
      expect(await mouvementManuel(mvt({ type: "SORTIE", categorieSortie, lignes: [[riz, 3]] }))).toMatchObject({ erreur: expect.stringMatching(/Choisissez le motif de la sortie/) });
    }
    expect(await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "PERTE", lignes: [[riz, 3]] }))).toMatchObject({ erreur: "Indiquez la raison de la perte." });
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await stock(riz)).toBe(10);
    expect(await gestes()).toEqual([]);
  }, 60_000);

  it("une entrée n'a pas de motif de sortie (aucun motif exigé)", async () => {
    const riz = await article("Riz");
    en("dir"); await mouvementManuel(mvt({ type: "ENTREE", categorieSortie: "PERTE", origine: "Don", lignes: [[riz, 1]] }));
    expect((await prisma.mouvementStock.findFirstOrThrow()).categorieSortie).toBeNull();
  }, 60_000);
});

describe("Anti-avalanche : une rafale du même auteur met à jour la notification non lue", () => {
  it("deux livraisons de suite → une notification « 2 saisies de sorties » par Direction ; lue → la suivante est nouvelle", async () => {
    const riz = await article("Riz"); const sel = await article("Sel");
    en("resp");
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 1]] }));
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[sel, 2]] }));
    let n = await uneParDirection();
    expect(n.message).toMatch(/^2 saisies de sorties \(Livraison restaurant\) par Jean depuis \d{1,2} h \d{2} — dernière : 2 Kg — Sel$/);
    expect(n.lien).toBe(`/stock/mouvements?mois=${MOIS}&motif=livraison`);
    expect(PUSH.appels.map((a) => a.payload.tag)).toEqual([PUSH.appels[0].payload.tag, PUSH.appels[0].payload.tag]); // l'appareil remplace
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[sel, 1]] }));
    n = await uneParDirection();
    expect(n.message).toMatch(/^3 saisies de sorties/);
    // La Direction a lu : le geste suivant fait une notification neuve.
    await prisma.notification.updateMany({ data: { lu: true } });
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 1]] }));
    const nonLues = (await gestes()).filter((x) => !x.lu);
    expect(nonLues).toHaveLength(2);
    expect(nonLues[0].message).toBe("Sortie de 1 Kg — Riz (Livraison restaurant) par Jean");
  }, 60_000);

  it("pas de regroupement entre motifs, entre auteurs, ni au-delà de la fenêtre", async () => {
    const riz = await article("Riz");
    en("resp");
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 1]] }));
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "PERTE", raisonSortie: "moisi", lignes: [[riz, 1]] }));
    en("resp2"); await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 1]] }));
    expect(await gestes()).toHaveLength(6); // 3 gestes distincts × 2 Directions
    // Notification vieille de 11 minutes : le geste suivant en crée une nouvelle.
    await prisma.notification.updateMany({ data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    en("resp"); await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 1]] }));
    expect(await gestes()).toHaveLength(8);
  }, 60_000);
});

describe("Une notification qui échoue n'annule rien et ne renvoie pas d'erreur", () => {
  it("push en panne : le mouvement est écrit, la cloche est posée, l'action réussit", async () => {
    const riz = await article("Riz", 10);
    PUSH.casser = true;
    en("resp");
    expect(await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 9.5]] }))).toMatchObject({ demande: false });
    expect(await stock(riz)).toBe(0.5);
    await uneParDirection();
  }, 60_000);

  it("échec pour UN compte Direction : les autres sont quand même notifiés (cloche et push)", async () => {
    const riz = await article("Riz", 10);
    const vraie = prisma.notification.create.bind(prisma.notification);
    const espion = vi.spyOn(prisma.notification, "create").mockImplementation(((args: { data: { destinataireUserId?: string } }) =>
      args.data.destinataireUserId === U.dir.id ? Promise.reject(new Error("panne")) : vraie(args as never)) as never);
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      en("resp"); await mouvementManuel(mvt({ type: "ENTREE", origine: "Correction", lignes: [[riz, 1]] }));
    } finally { espion.mockRestore(); console_.mockRestore(); }
    expect((await gestes()).map((x) => x.destinataireUserId)).toEqual([U.dir2.id]);
    expect(PUSH.appels.map((a) => a.userIds)).toEqual([[U.dir2.id]]);
  }, 60_000);

  it("base indisponible pour la cloche : le geste est écrit et annoncé écrit (mouvement, achat, facture)", async () => {
    const riz = await article("Riz", 10);
    const espion = vi.spyOn(prisma.notification, "create").mockRejectedValue(new Error("base indisponible"));
    const console_ = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      en("resp");
      expect(await mouvementManuel(mvt({ type: "ENTREE", origine: "Correction", lignes: [[riz, 1]] }))).toMatchObject({ demande: false });
      const f = new FormData(); f.set("date", DATE); f.append("articleId", riz); f.append("designation", ""); f.append("unite", ""); f.append("domaine", "NOURRITURE"); f.append("quantite", "2"); f.append("montant", "4"); f.append("fournisseurId", ""); f.append("fournisseurNom", ""); f.append("devise", "USD");
      expect(await entreeListeAchat(f)).toMatchObject({ crees: [] });
      await expect(creerFactureAvecLignes(facture({ entrerEnStock: false, lignes: [[riz, 1, 3]] }))).rejects.toThrow("NEXT_REDIRECT");
    } finally { espion.mockRestore(); console_.mockRestore(); }
    expect(await stock(riz)).toBe(13);
    expect(await prisma.factureFournisseur.count()).toBe(1);
  }, 60_000);
});

const facture = (o: { numero?: string; entrerEnStock: boolean; lignes: [string | null, number, number][] }) => {
  const f = new FormData();
  f.set("fournisseurNom", "Brasimba"); f.set("date", DATE); f.set("forcerDoublons", "on");
  if (o.numero) f.set("numero", o.numero);
  if (o.entrerEnStock) f.set("entrerEnStock", "on");
  for (const [id, q, p] of o.lignes) { f.append("ligne_articleId", id ?? ""); f.append("ligne_designation", "Ligne"); f.append("ligne_unite", ""); f.append("ligne_quantite", ecrireSaisieNombre(q)); f.append("ligne_prix", ecrireSaisieNombre(p)); }
  return f;
};

describe("Toute entrée de stock d'un compte non-Direction notifie la Direction — une fois par geste", () => {
  it("Liste d'achat : « Achat enregistré par Jean — 3 articles, 12,50 $ + 28 000 FC (1 ligne sans montant) »", async () => {
    const riz = await article("Riz"); const sel = await article("Sel"); const huile = await article("Huile");
    const f = new FormData(); f.set("date", DATE);
    for (const [id, q, m, d] of [[riz, 2, "12,5", "USD"], [sel, 1, "28000", "CDF"], [huile, 1, "0", "USD"]] as const) {
      f.append("articleId", id); f.append("designation", ""); f.append("unite", ""); f.append("domaine", "NOURRITURE"); f.append("quantite", String(q)); f.append("montant", m); f.append("fournisseurId", ""); f.append("fournisseurNom", ""); f.append("devise", d);
    }
    en("resp"); expect(await entreeListeAchat(f)).toMatchObject({ crees: [] });
    const n = await uneParDirection();
    expect(n.message).toBe("Achat enregistré par Jean — 3 articles, 12,50 $ + 28 000 FC (1 ligne sans montant)");
    expect(n.lien).toBe("/stock/entree");
  }, 60_000);

  it("Liste d'achat sans aucun montant : « — », jamais 0", async () => {
    const riz = await article("Riz");
    const f = new FormData(); f.set("date", DATE); f.append("articleId", riz); f.append("designation", ""); f.append("unite", ""); f.append("domaine", "NOURRITURE"); f.append("quantite", "2"); f.append("montant", "0"); f.append("fournisseurId", ""); f.append("fournisseurNom", ""); f.append("devise", "USD");
    en("resp"); await entreeListeAchat(f);
    expect((await uneParDirection()).message).toBe("Achat enregistré par Jean — 1 article, —");
  }, 60_000);

  it("Légumes frais : « Achat de légumes enregistré par Jean — 2 lignes, 15 000 FC »", async () => {
    const f = new FormData(); f.set("date", DATE);
    for (const [l, q, m] of [["Tomates", "3", "10000"], ["Oignons", "2", "5000"]]) { f.append("legume", l); f.append("unite", "kg"); f.append("quantite", q); f.append("montantCDF", m); }
    en("resp"); expect(await creerAchatsLegumes(f)).toBeUndefined();
    expect(await prisma.achatLegume.count()).toBe(2);
    const n = await uneParDirection();
    expect(n.message).toBe("Achat de légumes enregistré par Jean — 2 lignes, 15 000 FC");
    expect(n.lien).toBe("/stock/legumes");
  }, 60_000);

  it("Facture avec entrée en stock : « Facture n° F-12 de Brasimba enregistrée par Jean — 1 234,50 $ (entrée en stock : 2 articles) »", async () => {
    const riz = await article("Riz"); const sel = await article("Sel");
    en("resp");
    await expect(creerFactureAvecLignes(facture({ numero: "F-12", entrerEnStock: true, lignes: [[riz, 100, 10], [sel, 10, 23.45], [null, 1, 0]] }))).rejects.toThrow("NEXT_REDIRECT");
    const fac = await prisma.factureFournisseur.findFirstOrThrow();
    const n = await uneParDirection();
    expect(n.message).toBe("Facture n° F-12 de Brasimba enregistrée par Jean — 1 234,50 $ (entrée en stock : 2 articles)");
    expect(n.lien).toBe(`/stock/factures/${fac.id}`);
    expect(await stock(riz)).toBe(110);
  }, 60_000);

  it("Facture sans entrée en stock, sans numéro, sans prix : « montant : — »", async () => {
    const riz = await article("Riz");
    en("resp");
    await expect(creerFactureAvecLignes(facture({ entrerEnStock: false, lignes: [[riz, 1, 0]] }))).rejects.toThrow("NEXT_REDIRECT");
    expect((await uneParDirection()).message).toBe("Facture sans numéro de Brasimba enregistrée par Jean — montant : — (sans entrée en stock)");
    expect(await stock(riz)).toBe(10);
  }, 60_000);

  it("Réception d'un bon de commande : « Réception du bon de commande n° 001/PEF/OCT/26 (Brasimba) enregistrée par Jean — 1 ligne reçue, partielle »", async () => {
    const riz = await article("Riz"); const sel = await article("Sel");
    const four = await prisma.fournisseur.create({ data: { nom: "Brasimba" } });
    const bc = await prisma.bonDeCommande.create({ data: { numero: "001/PEF/OCT/26", sequence: 1, annee: 2026, mois: 10, fournisseurId: four.id, statut: "VALIDE",
      lignes: { create: [{ articleId: riz, designation: "Riz", quantite: 5, prixUnitaireUSD: 2, totalLigneUSD: 10 }, { articleId: sel, designation: "Sel", quantite: 2, prixUnitaireUSD: 1, totalLigneUSD: 2 }] } }, include: { lignes: true } });
    const f = new FormData(); f.append("recu_ligneId", bc.lignes.find((l) => l.articleId === riz)!.id); f.append("recu_quantite", "5");
    en("resp"); expect(await receptionnerBonCommande(bc.id, f)).toBeUndefined();
    const n = await uneParDirection();
    expect(n.message).toBe("Réception du bon de commande n° 001/PEF/OCT/26 (Brasimba) enregistrée par Jean — 1 ligne reçue, partielle");
    expect(n.lien).toBe(`/stock/commandes/${bc.id}`);
    await prisma.fournisseur.deleteMany();
  }, 60_000);

  it("les mêmes gestes faits par la Direction ne génèrent rien", async () => {
    const riz = await article("Riz");
    en("dir");
    const f = new FormData(); f.set("date", DATE); f.append("articleId", riz); f.append("designation", ""); f.append("unite", ""); f.append("domaine", "NOURRITURE"); f.append("quantite", "2"); f.append("montant", "4"); f.append("fournisseurId", ""); f.append("fournisseurNom", ""); f.append("devise", "USD");
    await entreeListeAchat(f);
    const l = new FormData(); l.set("date", DATE); l.append("legume", "Tomates"); l.append("unite", "kg"); l.append("quantite", "1"); l.append("montantCDF", "1000");
    await creerAchatsLegumes(l);
    await expect(creerFactureAvecLignes(facture({ entrerEnStock: true, lignes: [[riz, 1, 3]] }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await gestes()).toEqual([]);
    expect(PUSH.appels).toEqual([]);
  }, 60_000);
});

describe("Les autres validations sont INCHANGÉES", () => {
  it("paiement de facture hors Direction : toujours une demande à valider", async () => {
    const riz = await article("Riz");
    en("dir"); await expect(creerFactureAvecLignes(facture({ numero: "F-1", entrerEnStock: false, lignes: [[riz, 1, 10]] }))).rejects.toThrow("NEXT_REDIRECT");
    const fac = await prisma.factureFournisseur.findFirstOrThrow();
    en("resp"); await marquerPayee(fac.id, DATE);
    expect((await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: fac.id } })).statut).not.toBe("REGLEE");
    expect(await prisma.demandeValidationStock.findMany({ select: { nature: true } })).toEqual([{ nature: "PAIEMENT_FACTURE" }]);
  }, 60_000);

  it("réconciliation avec écart hors Direction : toujours une demande à valider", async () => {
    const riz = await article("Riz", 10);
    const f = new FormData(); f.append("recon_articleId", riz); f.append("recon_physique", "8"); f.append("recon_explication", "casse"); f.set("origine", "Comptage");
    en("resp"); await appliquerComptage(f);
    expect(await stock(riz)).toBe(10);
    expect(await prisma.demandeValidationStock.findMany({ select: { nature: true } })).toEqual([{ nature: "RECONCILIATION" }]);
  }, 60_000);
});

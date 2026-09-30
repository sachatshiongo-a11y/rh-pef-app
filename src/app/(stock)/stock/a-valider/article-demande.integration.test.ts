import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : modification d'article soumise à la
// validation de la Direction. Vraies actions serveur du catalogue et de « Demandes à valider ».
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

const C = await import("../catalogue/actions");
const { validerDemandes, refuserDemandes } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let cat1: string, cat2: string, four: string;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false }, autre: { id: "", role: "STOCK", nom: "Marie", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"], ["autre", "STOCK"]] as const) {
    const u = await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } });
    U[k].id = u.id;
  }
  cat1 = (await prisma.categorieStock.create({ data: { nom: "Épicerie", domaine: "NOURRITURE" } })).id;
  cat2 = (await prisma.categorieStock.create({ data: { nom: "Frais", domaine: "NOURRITURE" } })).id;
  four = (await prisma.fournisseur.create({ data: { nom: "Kathy" } })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const article = async (designation: string, o: { quantite?: number; prix?: number } = {}) => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Sac", prixUnitaireUSD: o.prix ?? 2, categorieId: cat1 } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: o.quantite ?? 10, stockMinimum: 1, seuilUrgent: 0 } });
  return a.id;
};
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
/** Tout ce qu'une modification peut toucher, sans l'identité ni les dates. */
const etat = async (id: string) => {
  const a = await prisma.articleStock.findUniqueOrThrow({ where: { id }, include: { stock: true } });
  return {
    code: a.code, nomCourt: a.nomCourt, unite: a.unite, prix: a.prixUnitaireUSD?.toString() ?? null, carton: a.uniteParCarton?.toString() ?? null,
    contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite, categorieId: a.categorieId, fournisseurId: a.fournisseurId,
    actif: a.actif, surFicheCommande: a.surFicheCommande,
    quantite: a.stock?.quantite.toString(), stockMinimum: a.stock?.stockMinimum.toString(), seuilUrgent: a.stock?.seuilUrgent.toString(),
  };
};
const demandes = () => prisma.demandeValidationStock.findMany({ include: { cibles: true }, orderBy: { createdAt: "asc" } });
const SAISIE_FICHE = { prixUnitaireUSD: "2,75", unite: "Kg", categorieId: "", fournisseurId: "", stockMinimum: "4", seuilUrgent: "1", contenance: "75", contenanceUnite: "cl", code: "137", nomCourt: "Riz" };

describe("Modification par le responsable stock : une proposition, l'article ne bouge pas", () => {
  it("fiche article : proposition avec l'avant/après des seuls champs changés", async () => {
    const riz = await article("Riz basmati");
    const avant = await etat(riz);
    en("resp");
    expect(await C.modifierArticle(riz, fd({ ...SAISIE_FICHE, categorieId: cat2, fournisseurId: four }))).toMatchObject({ proposition: true });
    expect(await etat(riz)).toEqual(avant);
    const [d] = await demandes();
    expect(d).toMatchObject({ nature: "MODIF_ARTICLE", statut: "EN_ATTENTE" });
    expect(d.cibles.map((c) => c.cle)).toEqual([`ARTICLE:${riz}`]);
    const ch = (d.charge as { articles: { changements: { champ: string; avantLibelle: string; apresLibelle: string }[] }[] }).articles[0].changements;
    expect(Object.fromEntries(ch.map((c) => [c.champ, `${c.avantLibelle} → ${c.apresLibelle}`]))).toEqual({
      code: "— → 137", nomCourt: "— → Riz", unite: "Sac → Kg", contenance: "— → 75", contenanceUnite: "— → cl",
      prixUnitaireUSD: "2 → 2,75", categorieId: "Épicerie → Frais", fournisseurId: "— → Kathy", stockMinimum: "1 → 4", seuilUrgent: "0 → 1",
    });
  }, 60_000);

  it("rien de changé : aucune proposition", async () => {
    const riz = await article("Riz");
    en("resp");
    expect(await C.modifierArticle(riz, fd({ prixUnitaireUSD: "2", unite: "Sac" }))).toMatchObject({ proposition: false });
    expect(await demandes()).toEqual([]);
  }, 60_000);

  it("une retouche du même auteur s'ajoute à SA proposition ; un autre compte est refusé", async () => {
    const riz = await article("Riz");
    en("resp");
    await C.modifierArticle(riz, fd({ prixUnitaireUSD: "3" }));
    await C.modifierArticle(riz, fd({ unite: "Kg" }));
    await C.modifierArticle(riz, fd({ prixUnitaireUSD: "3,5" }));
    const ds = await demandes();
    expect(ds).toHaveLength(1);
    const ch = (ds[0].charge as { articles: { changements: { champ: string; avant: unknown; apres: unknown }[] }[] }).articles[0].changements;
    expect(ch).toEqual([
      expect.objectContaining({ champ: "unite", avant: "Sac", apres: "Kg" }),
      expect.objectContaining({ champ: "prixUnitaireUSD", avant: "2", apres: "3.5" }),
    ]);
    // Revenir à la valeur d'origine retire le champ ; plus rien → la proposition est annulée.
    await C.modifierArticle(riz, fd({ prixUnitaireUSD: "2", unite: "Sac" }));
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: ds[0].id } })).statut).toBe("ANNULEE");
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
    await C.modifierArticle(riz, fd({ prixUnitaireUSD: "3" }));
    en("autre");
    expect(await C.modifierArticle(riz, fd({ unite: "Kg" }))).toMatchObject({ erreur: expect.stringMatching(/« Riz » a déjà une proposition en attente \(Jean\)/) });
  }, 60_000);

  it("actions groupées : UNE proposition pour la sélection ; rien ne change avant validation", async () => {
    const [a, b] = [await article("A"), await article("B")];
    en("resp");
    expect(await C.categoriserEnMasse([a, b], cat2)).toMatchObject({ proposition: true });
    expect((await etat(a)).categorieId).toBe(cat1);
    const [d] = await demandes();
    expect(d.resume).toBe("2 articles : Catégorie → Frais");
    en("dir"); await validerDemandes([d.id]);
    expect([(await etat(a)).categorieId, (await etat(b)).categorieId]).toEqual([cat2, cat2]);
  }, 60_000);
});

describe("Validation = EXACTEMENT la modification directe de la Direction", () => {
  it("fiche complète (prix, unité, contenance, catégorie, fournisseur, seuils)", async () => {
    const direct = await article("Riz A");
    const propose = await article("Riz B");
    const saisie = { ...SAISIE_FICHE, categorieId: cat2, fournisseurId: four };
    en("dir"); await C.modifierArticle(direct, fd(saisie));
    en("resp"); await C.modifierArticle(propose, fd(saisie));
    const [d] = await demandes();
    en("dir"); expect(await validerDemandes([d.id])).toEqual({ traitees: [d.id], echecs: [] });
    expect(await etat(propose)).toEqual(await etat(direct));
    expect((await etat(propose)).prix).toBe("2.75");
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("VALIDEE");
    expect(await prisma.notification.count({ where: { refId: `decision:${d.id}` } })).toBe(1);
  }, 60_000);

  it("chaque action groupée : seuil, fournisseur, activation, fiche commande", async () => {
    const cas: [string, (ids: string[]) => Promise<unknown>][] = [
      ["seuil", (ids) => C.definirSeuilEnMasse(ids, 6)],
      ["fournisseur", (ids) => C.definirFournisseurEnMasse(ids, four)],
      ["désactivation", (ids) => C.basculerActifArticles(ids, false)],
      ["fiche commande", (ids) => C.basculerFicheCommande(ids, true)],
    ];
    for (const [nom, geste] of cas) {
      const direct = await article(`${nom} D`);
      const propose = await article(`${nom} P`);
      en("dir"); await geste([direct]);
      en("resp"); expect(await geste([propose])).toMatchObject({ proposition: true });
      const d = (await demandes()).find((x) => x.statut === "EN_ATTENTE")!;
      en("dir"); expect(await validerDemandes([d.id])).toMatchObject({ traitees: [d.id] });
      expect({ nom, ...(await etat(propose)) }).toEqual({ nom, ...(await etat(direct)) });
    }
  }, 120_000);

  it("conflit : le champ proposé a été changé entre-temps → refus signalé, aucun écrasement", async () => {
    const riz = await article("Riz");
    en("resp"); await C.modifierArticle(riz, fd({ prixUnitaireUSD: "3", unite: "Kg" }));
    const [d] = await demandes();
    en("dir"); await C.modifierArticle(riz, fd({ prixUnitaireUSD: "2,5" })); // la Direction corrige le prix en direct
    expect(await validerDemandes([d.id])).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/« Riz » — Prix unitaire USD a changé depuis la proposition \(2 → aujourd'hui 2,5\)/) }] });
    expect(await etat(riz)).toMatchObject({ prix: "2.5", unite: "Sac" }); // l'unité non plus n'a pas été écrite
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  }, 60_000);

  it("refus : l'article ne bouge pas, la cible est libérée, le demandeur est notifié", async () => {
    const riz = await article("Riz");
    const avant = await etat(riz);
    en("resp"); await C.modifierArticle(riz, fd({ prixUnitaireUSD: "9" }));
    const [d] = await demandes();
    en("dir"); await refuserDemandes([d.id], "Prix hors marché");
    expect(await etat(riz)).toEqual(avant);
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
    expect((await prisma.notification.findFirstOrThrow({ where: { refId: `decision:${d.id}` } })).message).toMatch(/refusée.*Prix hors marché/);
  }, 60_000);
});

describe("Droits et gestes hors flux", () => {
  it("le responsable ne valide pas ; fusion et correction des stocks négatifs réservées à la Direction", async () => {
    const [a, b] = [await article("A"), await article("B")];
    en("resp");
    await C.modifierArticle(a, fd({ prixUnitaireUSD: "3" }));
    const [d] = await demandes();
    expect(await validerDemandes([d.id])).toMatchObject({ erreur: "Réservé à la Direction." });
    expect(await C.fusionnerArticles([a, b], a)).toMatchObject({ erreur: expect.stringMatching(/réservé à la Direction/) });
    await prisma.stock.update({ where: { articleId: b }, data: { quantite: -3 } });
    expect(await C.corrigerStocksNegatifs([b])).toMatchObject({ erreur: expect.stringMatching(/réservé à la Direction/) });
    expect(await prisma.articleStock.count()).toBe(2);
    expect((await etat(b)).quantite).toBe("-3");
    expect((await etat(a)).prix).toBe("2");
  }, 60_000);

  it("la quantité en stock proposée hors flux passe aussi par la Direction", async () => {
    const riz = await article("Riz", { quantite: 10 });
    en("resp"); await C.modifierArticle(riz, fd({ quantite: "12" }));
    expect((await etat(riz)).quantite).toBe("10");
    const [d] = await demandes();
    en("dir"); await validerDemandes([d.id]);
    expect((await etat(riz)).quantite).toBe("12");
  }, 60_000);

  it("création d'article : permise, signalée ; mais pas de stock initial hors Direction", async () => {
    en("resp");
    expect(await C.creerArticle(fd({ designation: "Farine", domaine: "NOURRITURE", quantite: "5" }))).toMatchObject({ erreur: expect.stringMatching(/stock initial/) });
    expect(await prisma.articleStock.count()).toBe(0);
    expect(await C.creerArticle(fd({ designation: "Farine", domaine: "NOURRITURE", quantite: "" }))).toBeUndefined();
    expect(await prisma.notification.findFirst({ where: { message: "Nouvel article « Farine » créé par Jean" } })).not.toBeNull();
  }, 60_000);
});

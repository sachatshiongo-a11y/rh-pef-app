import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Suppression GROUPÉE d'articles (Direction, 2026-10-14 : « on ne peut pas supprimer des articles de l'inventaire »).
// Postgres éphémère, vraies actions. Règle : les articles SANS historique sont supprimés (stock compris, journalisé) ;
// ceux qui en ont un sont CONSERVÉS et nommés avec leur raison ; seule la Direction supprime ; tout ou rien en cas d'erreur.
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
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { supprimerArticlesEnMasse, apercuSuppressionArticles, basculerActifArticles } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.sessionComptage.deleteMany();
  await prisma.ficheTechnique.deleteMany();
  await prisma.bonDeCommande.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.articleResto.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const art = async (designation: string, o: { quantite?: number; unite?: string } = {}) => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: o.unite ?? "kg", stock: { create: { quantite: o.quantite ?? 0 } } } });
  return a.id;
};
const mouvements = (articleId: string, n: number) => prisma.mouvementStock.createMany({ data: Array.from({ length: n }, () => ({ articleId, type: "ENTREE" as const, quantite: 1, date: new Date("2026-09-01") })) });
const existe = async (id: string) => (await prisma.articleStock.count({ where: { id } })) === 1;
const journal = (champ: string) => prisma.journalAudit.findMany({ where: { champ }, orderBy: { date: "asc" } });

/** Un article pour chaque sorte d'historique, plus deux articles vierges (l'un avec un stock non nul). */
async function jeu() {
  const vierge1 = await art("Cannelle");
  const vierge2 = await art("Muscade", { quantite: 5, unite: "g" }); // stock saisi à la création, aucun mouvement
  const farine = await art("Farine", { quantite: 12 });
  await mouvements(farine, 12);
  const facturee = await art("Sucre");
  const facture = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Kathy", mois: 9, annee: 2026 } });
  await prisma.ligneFacture.create({ data: { factureId: facture.id, articleId: facturee, designation: "Sucre", quantite: 3 } });
  const commande = await art("Huile");
  const bon = await prisma.bonDeCommande.create({ data: { numero: "001/PEF/SEPT/26", sequence: 1, annee: 2026, mois: 9 } });
  await prisma.ligneBonDeCommande.create({ data: { bonDeCommandeId: bon.id, articleId: commande, designation: "Huile", quantite: 2 } });
  const cmdResto = await art("Beurre");
  await prisma.commandeResto.create({ data: { articleId: cmdResto, date: new Date("2026-09-02"), quantite: 4 } });
  const compte = await art("Riz");
  const session = await prisma.sessionComptage.create({ data: {} });
  await prisma.ligneComptage.create({ data: { sessionId: session.id, articleId: compte, designation: "Riz", theorique: 1, physique: 1, ecart: 0 } });
  const enFiche = await art("Basilic");
  const fiche = await prisma.ficheTechnique.create({ data: { nom: "Coulis", nbPortions: 4 } });
  await prisma.ingredientFiche.create({ data: { ficheId: fiche.id, articleId: enFiche, unite: "g", quantite: 20 } });
  const enAttente = await art("Poivre");
  const demande = await prisma.demandeValidationStock.create({ data: { nature: "MODIF_ARTICLE", resume: "x", charge: { v: 1, libelle: "x", articles: [] }, auteurId: U.resp.id, auteurNom: "Jean" } });
  await prisma.cibleDemandeStock.create({ data: { cle: `ARTICLE:${enAttente}`, demandeId: demande.id } });
  return { vierge1, vierge2, farine, facturee, commande, cmdResto, compte, enFiche, enAttente };
}

describe("supprimerArticlesEnMasse — articles avec et sans historique", () => {
  it("supprime les vierges (stock compris), CONSERVE les autres en nommant la raison, journalise", async () => {
    const j = await jeu();
    const tous = Object.values(j);
    const r = await supprimerArticlesEnMasse(tous);
    expect(erreurDe(r)).toBeNull();
    const res = r as { supprimes: number; message: string; conserves: { id: string; designation: string; raison: string; attaches: string[] }[] };

    expect(res.supprimes).toBe(2);
    expect(res.message).toBe("2 supprimés · 7 conservés car ils ont un historique (désactivez-les ou fusionnez-les)");
    expect(await existe(j.vierge1)).toBe(false);
    expect(await existe(j.vierge2)).toBe(false);
    expect(await prisma.stock.count({ where: { articleId: { in: [j.vierge1, j.vierge2] } } })).toBe(0); // la ligne de stock part avec l'article
    for (const id of [j.farine, j.facturee, j.commande, j.cmdResto, j.compte, j.enFiche, j.enAttente]) expect(await existe(id), id).toBe(true);

    // Les raisons : le scénario réel (« Farine : 12 mouvements »), chaque sorte d'historique nommée.
    const raison = Object.fromEntries(res.conserves.map((c) => [c.designation, c.raison]));
    expect(raison["Farine"]).toBe("Farine : 12 mouvements");
    expect(raison["Sucre"]).toBe("Sucre : 1 ligne de facture");
    expect(raison["Huile"]).toBe("Huile : 1 ligne de bon de commande");
    expect(raison["Beurre"]).toBe("Beurre : 1 commande resto");
    expect(raison["Riz"]).toBe("Riz : 1 comptage");
    expect(raison["Basilic"]).toBe("Basilic : 1 ligne de fiche technique (« Coulis »)");
    expect(raison["Poivre"]).toBe("Poivre : une demande en attente de la Direction (À valider)");

    // L'historique n'a pas bougé : la cascade de MouvementStock n'a rien effacé.
    expect(await prisma.mouvementStock.count({ where: { articleId: j.farine } })).toBe(12);
    expect(await prisma.stock.findUniqueOrThrow({ where: { articleId: j.farine } })).toMatchObject({ quantite: expect.anything() });

    // Journal : une ligne par article supprimé (avec le stock effacé) + le résumé du lot.
    const lignes = await journal("suppression");
    expect(lignes.map((l) => l.ancienneValeur).sort()).toEqual(["Cannelle", "Muscade — stock effacé avec l'article : 5 g"]);
    expect(lignes.every((l) => l.userId === U.dir.id)).toBe(true);
    expect((await journal("suppression (masse)")).map((l) => l.nouvelleValeur)).toEqual(["2 supprimé(s) · 7 conservé(s) car ils ont un historique"]);
  }, 90_000);

  it("l'aperçu annonce la même chose AVANT d'effacer, y compris le stock non nul qui partira", async () => {
    const j = await jeu();
    const r = await apercuSuppressionArticles(Object.values(j));
    expect(erreurDe(r)).toBeNull();
    const ap = r as { supprimables: { designation: string; stock: string | null }[]; conserves: unknown[]; introuvables: number };
    expect(ap.supprimables.map((s) => [s.designation, s.stock])).toEqual([["Cannelle", null], ["Muscade", "5 g"]]);
    expect(ap.conserves).toHaveLength(7);
    expect(await prisma.articleStock.count()).toBe(9); // lecture seule : rien n'est supprimé
    expect(await journal("suppression")).toHaveLength(0);
  }, 90_000);

  it("tous conservés : rien n'est supprimé, le message le dit, la désactivation (action existante) prend le relais", async () => {
    const j = await jeu();
    const r = await supprimerArticlesEnMasse([j.farine, j.facturee]) as { supprimes: number; message: string; conserves: { id: string }[] };
    expect(r.supprimes).toBe(0);
    expect(r.message).toBe("Aucun article supprimé · 2 conservés car ils ont un historique (désactivez-les ou fusionnez-les)");
    expect(await journal("suppression")).toHaveLength(0);
    // Le bouton « Désactiver les conservés » appelle l'action existante avec les identifiants rendus.
    await basculerActifArticles(r.conserves.map((c) => c.id), false);
    expect((await prisma.articleStock.findMany({ where: { id: { in: [j.farine, j.facturee] } } })).map((a) => a.actif)).toEqual([false, false]);
  }, 90_000);

  it("un identifiant inconnu est compté « introuvable », sans bloquer les autres", async () => {
    const v = await art("Cannelle");
    const r = await supprimerArticlesEnMasse([v, "00000000-0000-0000-0000-000000000000"]) as { supprimes: number; message: string };
    expect(r.supprimes).toBe(1);
    expect(r.message).toBe("1 supprimé · 1 introuvable (déjà supprimé ou fusionné)");
    expect(await existe(v)).toBe(false);
  }, 60_000);

  it("une sélection vide est refusée", async () => {
    expect(erreurDe(await supprimerArticlesEnMasse([]))).toBe("Aucun article sélectionné.");
  }, 60_000);
});

describe("supprimerArticlesEnMasse — le volume d'un vrai inventaire", () => {
  it("600 articles cochés d'un coup (dont 3 avec historique) : une transaction, les 597 vierges partent, les 3 restent", async () => {
    await prisma.articleStock.createMany({ data: Array.from({ length: 597 }, (_, i) => ({ designation: `Vierge ${i}`, domaine: "NOURRITURE" as const })) });
    const vierges = await prisma.articleStock.findMany({ select: { id: true } });
    await prisma.stock.createMany({ data: vierges.map((a) => ({ articleId: a.id, quantite: 0 })) });
    const avec = [await art("Farine"), await art("Sucre"), await art("Riz")];
    for (const id of avec) await mouvements(id, 2);
    const t0 = Date.now();
    const r = await supprimerArticlesEnMasse([...vierges.map((a) => a.id), ...avec]) as { supprimes: number; message: string };
    expect(r.supprimes).toBe(597);
    expect(r.message).toBe("597 supprimés · 3 conservés car ils ont un historique (désactivez-les ou fusionnez-les)");
    expect(await prisma.articleStock.count()).toBe(3);
    expect(await prisma.stock.count()).toBe(3);
    expect(await journal("suppression")).toHaveLength(597);
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 90_000);
});

describe("supprimerArticlesEnMasse — seule la Direction supprime", () => {
  it("le responsable stock est refusé par le SERVEUR (aperçu compris) : rien n'est supprimé, rien n'est journalisé", async () => {
    const v = await art("Cannelle");
    en("resp");
    expect(erreurDe(await supprimerArticlesEnMasse([v]))).toBe("Supprimer est réservé à la Direction.");
    expect(erreurDe(await apercuSuppressionArticles([v]))).toBe("Supprimer est réservé à la Direction.");
    expect(await existe(v)).toBe(true);
    expect(await journal("suppression")).toHaveLength(0);
  }, 60_000);
});

describe("supprimerArticlesEnMasse — tout ou rien", () => {
  it("une erreur au journal annule TOUT : aucun article, aucune ligne de stock n'est perdue", async () => {
    const a = await art("Cannelle"), b = await art("Muscade", { quantite: 5 });
    A.user = { ...U.dir, id: "00000000-0000-0000-0000-00000000dead" }; // utilisateur inconnu : l'écriture du journal (FK) échoue APRÈS les suppressions
    expect(erreurDe(await supprimerArticlesEnMasse([a, b]))).not.toBeNull();
    expect(await existe(a)).toBe(true);
    expect(await existe(b)).toBe(true);
    expect(await prisma.stock.count({ where: { articleId: { in: [a, b] } } })).toBe(2);
  }, 60_000);

  it("un mouvement saisi pendant la suppression est ATTENDU puis vu : l'article est conservé, son historique intact", async () => {
    const a = await art("Cannelle");
    // Une transaction concurrente qui saisit un mouvement (verrou de clé sur l'article) et ne valide qu'après un instant.
    const saisie = prisma.$transaction(async (tx) => {
      await tx.mouvementStock.create({ data: { articleId: a, type: "ENTREE", quantite: 3, date: new Date("2026-09-03") } });
      await new Promise((r) => setTimeout(r, 1500));
    });
    await new Promise((r) => setTimeout(r, 300));
    const r = await supprimerArticlesEnMasse([a]) as { supprimes: number; conserves: { raison: string }[] };
    await saisie;
    expect(r.supprimes).toBe(0);
    expect(r.conserves[0].raison).toBe("Cannelle : 1 mouvement");
    expect(await prisma.mouvementStock.count({ where: { articleId: a } })).toBe(1);
  }, 60_000);
});

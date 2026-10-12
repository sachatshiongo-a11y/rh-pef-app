import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Plusieurs fournisseurs par article (2026-10-16) — test d'INTÉGRATION (Postgres éphémère, jamais la prod) :
//  - ALIMENTATION AUTOMATIQUE par un achat réel (Liste d'achat, facture, bon engagé, réception) : un fait constaté,
//    sans validation, sans habituel, sans rien retirer ;
//  - GESTES MANUELS : Direction = direct ; autre rôle = proposition, qui donne EXACTEMENT le même état à la validation ;
//  - habituel unique, copie de compatibilité `ArticleStock.fournisseurId` toujours synchronisée ;
//  - fusions d'articles et de fournisseurs (liens reportés sans doublon) ;
//  - dernier prix par fournisseur, calculé depuis l'historique réel (devise de saisie, unité de l'article).
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
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const C = await import("./actions");
const E = await import("../entree/actions");
const F = await import("../factures/actions");
const B = await import("../commandes/actions");
const FO = await import("../fournisseurs/actions");
const { validerDemandes } = await import("../a-valider/actions");
const L = await import("@/lib/article-fournisseurs");
const { corrigerEnteteFactureTx } = await import("@/lib/validations-stock/correction-facture");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let f1: string, f2: string, f3: string;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  f1 = (await prisma.fournisseur.create({ data: { nom: "Marché central" } })).id;
  f2 = (await prisma.fournisseur.create({ data: { nom: "Grossiste Nord" } })).id;
  f3 = (await prisma.fournisseur.create({ data: { nom: "Épicerie Kasa" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.reception.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.bonDeCommande.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const article = async (designation: string, plus: { unite?: string; fournisseurId?: string } = {}) =>
  (await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: plus.unite ?? "kg", ...(plus.fournisseurId ? { fournisseurId: plus.fournisseurId } : {}) } })).id;
/** Les fournisseurs d'un article (ids) + son habituel + la copie de compatibilité. */
const etat = async (articleId: string) => {
  const liens = await prisma.articleFournisseur.findMany({ where: { articleId }, orderBy: { fournisseurId: "asc" } });
  const a = await prisma.articleStock.findUniqueOrThrow({ where: { id: articleId }, select: { fournisseurId: true } });
  return { ids: liens.map((l) => l.fournisseurId).sort(), habituel: liens.filter((l) => l.habituel).map((l) => l.fournisseurId), colonne: a.fournisseurId, sources: Object.fromEntries(liens.map((l) => [l.fournisseurId, l.source])) };
};
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
const v = async (ids: string[]) => Object.fromEntries((await prisma.demandeValidationStock.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));

/** Formulaire de la Liste d'achat (une ligne par achat). */
const listeAchat = (lignes: { articleId: string; quantite: number; montant?: number; devise?: "USD" | "CDF"; fournisseurId?: string; fournisseurNom?: string }[], date = "2026-10-01") => {
  const f = new FormData();
  f.set("date", date);
  for (const l of lignes) {
    f.append("articleId", l.articleId); f.append("designation", ""); f.append("unite", ""); f.append("domaine", "NOURRITURE");
    f.append("quantite", String(l.quantite)); f.append("montant", String(l.montant ?? 0)); f.append("devise", l.devise ?? "USD");
    f.append("fournisseurId", l.fournisseurId ?? ""); f.append("fournisseurNom", l.fournisseurNom ?? "");
  }
  return f;
};
const facture = (o: { fournisseurId: string; fournisseurNom: string; numero: string; date?: string; devise?: "USD" | "CDF"; lignes: { articleId: string; unite?: string; quantite: number; prix: number }[] }) => {
  const f = new FormData();
  f.set("fournisseurNom", o.fournisseurNom); f.set("fournisseurId", o.fournisseurId); f.set("numero", o.numero); f.set("date", o.date ?? "2026-10-02"); f.set("devise", o.devise ?? "USD");
  for (const l of o.lignes) { f.append("ligne_articleId", l.articleId); f.append("ligne_designation", "Ligne"); f.append("ligne_unite", l.unite ?? ""); f.append("ligne_quantite", String(l.quantite)); f.append("ligne_prix", String(l.prix).replace(".", ",")); }
  return f;
};
const bonForm = (fournisseurId: string, lignes: { articleId: string; quantite: number; prix: string }[], extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("fournisseurId", fournisseurId);
  for (const [k, val] of Object.entries(extra)) f.set(k, val);
  for (const l of lignes) { f.append("ligne_articleId", l.articleId); f.append("ligne_designation", "Ligne"); f.append("ligne_quantite", String(l.quantite)); f.append("ligne_prix", l.prix.replace(".", ",")); f.append("ligne_uniteParCarton", ""); }
  return f;
};
const creerBon = (f: FormData) => expect(B.creerBonCommande(f)).rejects.toThrow("NEXT_REDIRECT");

describe("alimentation automatique — un achat réel ajoute le fournisseur à l'article", () => {
  it("Liste d'achat : le fournisseur de la ligne rejoint l'article ; pas de doublon ; ni habituel ni retrait", async () => {
    const a = await article("Farine"), b = await article("Sucre");
    expect(erreurDe(await E.entreeListeAchat(listeAchat([{ articleId: a, quantite: 5, montant: 10, fournisseurId: f1 }, { articleId: b, quantite: 2 }])))).toBeNull();
    expect(await etat(a)).toMatchObject({ ids: [f1], habituel: [], colonne: null, sources: { [f1]: "LISTE_ACHAT" } });
    expect((await etat(b)).ids).toEqual([]); // achat sans fournisseur : rien
    // Même couple une 2e fois : un seul lien. Autre fournisseur : s'ajoute à côté, l'existant reste.
    expect(erreurDe(await E.entreeListeAchat(listeAchat([{ articleId: a, quantite: 1, montant: 2, fournisseurId: f1 }, { articleId: a, quantite: 1, montant: 2, fournisseurId: f2 }], "2026-10-03")))).toBeNull();
    expect((await etat(a)).ids).toEqual([f1, f2].sort());
    const journal = await prisma.journalAudit.findMany({ where: { entite: "ArticleStock", entiteId: a, champ: "fournisseur ajouté" } });
    expect(journal).toHaveLength(2); // un par fournisseur réellement AJOUTÉ (le 2e achat chez f1 n'ajoute rien)
    expect(journal.map((j) => j.nouvelleValeur).join(" | ")).toMatch(/Marché central \(auto — achat de la Liste d'achat\)/);
  }, 60_000);

  it("Liste d'achat : un fournisseur tapé et NOUVEAU est créé puis rattaché à l'article", async () => {
    const a = await article("Poulet");
    expect(erreurDe(await E.entreeListeAchat(listeAchat([{ articleId: a, quantite: 3, montant: 9, fournisseurNom: "Ferme Zébu" }])))).toBeNull();
    const nouveau = await prisma.fournisseur.findFirstOrThrow({ where: { nom: "Ferme Zébu" } });
    expect((await etat(a)).ids).toEqual([nouveau.id]);
  }, 60_000);

  it("une Liste d'achat refusée n'ajoute aucun fournisseur (tout ou rien)", async () => {
    const a = await article("Riz");
    expect(erreurDe(await E.entreeListeAchat(listeAchat([{ articleId: a, quantite: 4, montant: 9, fournisseurId: f1 }], "2099-01-01")))).not.toBeNull(); // date future
    expect((await etat(a)).ids).toEqual([]);
  }, 60_000);

  it("facture : le fournisseur de la facture rejoint les articles facturés (ligne libre ignorée)", async () => {
    const a = await article("Huile");
    await expect(F.creerFactureAvecLignes(facture({ fournisseurId: f2, fournisseurNom: "Grossiste Nord", numero: "FA-1", lignes: [{ articleId: a, quantite: 2, prix: 10 }, { articleId: "", quantite: 1, prix: 5 }] }))).rejects.toThrow("NEXT_REDIRECT");
    expect(await etat(a)).toMatchObject({ ids: [f2], habituel: [], sources: { [f2]: "FACTURE" } });
  }, 60_000);

  it("bon de commande : un brouillon n'ajoute rien ; la validation de la Direction, si ; la réception ajoute les articles reçus", async () => {
    const a = await article("Lait"), b = await article("Beurre");
    en("resp");
    await creerBon(bonForm(f3, [{ articleId: a, quantite: 4, prix: "2" }]));
    const brouillon = await prisma.bonDeCommande.findFirstOrThrow({ where: { fournisseurId: f3 } });
    expect(brouillon.statut).toBe("BROUILLON");
    expect((await etat(a)).ids).toEqual([]);
    en("dir");
    await B.validerBonCommande(brouillon.id, new FormData());
    expect(await etat(a)).toMatchObject({ ids: [f3], sources: { [f3]: "BON_COMMANDE" } });
    // Bon créé validé par la Direction : l'article est lié d'emblée.
    await creerBon(bonForm(f1, [{ articleId: b, quantite: 1, prix: "3" }]));
    expect((await etat(b)).ids).toEqual([f1]);
  }, 60_000);

  it("réception : seules les lignes réceptionnées ajoutent le fournisseur du bon", async () => {
    const a = await article("Thé"), b = await article("Café");
    // Bon « envoyé » créé avant le déploiement (les liens ne viennent alors que de la reprise) : la réception les pose.
    const bon = await prisma.bonDeCommande.create({
      data: { numero: "001/PEF/TEST/OCT/26", sequence: 1, annee: 2026, mois: 10, statut: "ENVOYE", fournisseurId: f2, totalUSD: 20,
        lignes: { create: [{ designation: "Thé", articleId: a, quantite: 5, prixUnitaireUSD: 2, totalLigneUSD: 10 }, { designation: "Café", articleId: b, quantite: 5, prixUnitaireUSD: 2, totalLigneUSD: 10 }] } },
      include: { lignes: true },
    });
    const ligneThe = bon.lignes.find((l) => l.articleId === a)!;
    const f = new FormData(); f.append("recu_ligneId", ligneThe.id); f.append("recu_quantite", "3");
    expect(erreurDe(await B.receptionnerBonCommande(bon.id, f))).toBeNull();
    expect((await etat(a)).sources).toEqual({ [f2]: "RECEPTION" });
    expect((await etat(b)).ids).toEqual([]);
  }, 60_000);

  it("correction du fournisseur d'une facture : le bon fournisseur rejoint les articles facturés, l'ancien n'est PAS retiré en silence", async () => {
    const a = await article("Sel");
    await expect(F.creerFactureAvecLignes(facture({ fournisseurId: f1, fournisseurNom: "Marché central", numero: "FA-9", lignes: [{ articleId: a, quantite: 1, prix: 1 }] }))).rejects.toThrow("NEXT_REDIRECT");
    const fac = await prisma.factureFournisseur.findFirstOrThrow({ where: { numero: "FA-9" } });
    await prisma.$transaction((tx) => corrigerEnteteFactureTx(tx, U.dir.id, fac.id, { fournisseurId: f2 }));
    expect((await etat(a)).ids).toEqual([f1, f2].sort());
  }, 60_000);
});

describe("fournisseur habituel : un seul, copie de compatibilité toujours synchronisée", () => {
  it("définir l'habituel ajoute le fournisseur s'il manque, garde l'ancien non habituel, synchronise la colonne", async () => {
    const a = await article("Pâtes", { fournisseurId: f1 });
    await L.definirHabituelEnMasseTx(prisma, [a], f1); // lien d'avant la bascule recréé comme habituel
    expect(await etat(a)).toMatchObject({ ids: [f1], habituel: [f1], colonne: f1 });
    expect(await C.definirFournisseurHabituel(a, f2)).toMatchObject({ proposition: false });
    expect(await etat(a)).toMatchObject({ ids: [f1, f2].sort(), habituel: [f2], colonne: f2 });
    expect(await C.definirFournisseurHabituel(a, f1)).toMatchObject({ proposition: false });
    expect(await etat(a)).toMatchObject({ habituel: [f1], colonne: f1 });
  }, 60_000);

  it("retirer l'habituel de la liste laisse l'article SANS habituel (rien n'est choisi à sa place) et vide la colonne", async () => {
    const a = await article("Orge");
    await C.definirFournisseurHabituel(a, f1);
    await C.ajouterFournisseursArticle(a, [f2, f3]);
    expect(await C.retirerFournisseursArticle(a, [f1])).toMatchObject({ proposition: false });
    expect(await etat(a)).toMatchObject({ ids: [f2, f3].sort(), habituel: [], colonne: null });
  }, 60_000);

  it("« plus d'habituel » (vide) ne retire aucun fournisseur de la liste", async () => {
    const a = await article("Mil");
    await C.definirFournisseurHabituel(a, f1);
    await C.ajouterFournisseursArticle(a, [f2]);
    expect(await C.definirFournisseurEnMasse([a], "")).toMatchObject({ proposition: false });
    expect(await etat(a)).toMatchObject({ ids: [f1, f2].sort(), habituel: [], colonne: null });
  }, 60_000);

  it("fiche « Modifier » : liste ET habituel dans le même geste ; un habituel hors de la liste est refusé", async () => {
    const a = await article("Maïs");
    expect(erreurDe(await C.modifierArticle(a, fd({ fournisseursIds: [f1, f2].join(","), fournisseurId: f3 })))).toMatch(/habituel doit faire partie des fournisseurs/);
    expect((await etat(a)).ids).toEqual([]);
    expect(await C.modifierArticle(a, fd({ fournisseursIds: [f1, f2].join(","), fournisseurId: f2 }))).toBeUndefined();
    expect(await etat(a)).toMatchObject({ ids: [f1, f2].sort(), habituel: [f2], colonne: f2 });
    // Ancien formulaire (habituel seul) : le fournisseur est posé ET rejoint la liste, sans rien retirer.
    expect(await C.modifierArticle(a, fd({ fournisseurId: f3 }))).toBeUndefined();
    expect(await etat(a)).toMatchObject({ ids: [f1, f2, f3].sort(), habituel: [f3], colonne: f3 });
  }, 60_000);

  it("création d'un article avec un fournisseur : il est son habituel", async () => {
    const f = new FormData();
    f.set("designation", "Cacao"); f.set("domaine", "NOURRITURE"); f.set("fournisseurId", f2);
    expect(erreurDe(await C.creerArticle(f))).toBeNull();
    const id = (await prisma.articleStock.findFirstOrThrow({ where: { designation: "Cacao" } })).id;
    expect(await etat(id)).toMatchObject({ ids: [f2], habituel: [f2], colonne: f2 });
  }, 60_000);

  it("actions groupées de l'Inventaire : habituel, ajouter, retirer sur plusieurs articles", async () => {
    const [a, b, c] = [await article("A"), await article("B"), await article("C")];
    await C.definirFournisseurEnMasse([a, b, c], f1);
    expect([(await etat(a)).habituel, (await etat(b)).habituel, (await etat(c)).habituel]).toEqual([[f1], [f1], [f1]]);
    await C.ajouterFournisseurEnMasse([a, b], f2);
    expect([(await etat(a)).ids, (await etat(b)).ids, (await etat(c)).ids]).toEqual([[f1, f2].sort(), [f1, f2].sort(), [f1]]);
    expect(await C.retirerFournisseurEnMasse([a, c], f1)).toMatchObject({ proposition: false });
    expect(await etat(a)).toMatchObject({ ids: [f2], habituel: [], colonne: null });
    expect(await etat(b)).toMatchObject({ ids: [f1, f2].sort(), habituel: [f1], colonne: f1 }); // non sélectionné : intact
    expect(await etat(c)).toMatchObject({ ids: [], colonne: null });
  }, 60_000);
});

describe("hors Direction : proposition, et la validation donne EXACTEMENT le même état que le geste direct", () => {
  const gestes: [string, (id: string) => Promise<unknown>][] = [
    ["habituel", (id) => C.definirFournisseurHabituel(id, f2)],
    ["ajouter", (id) => C.ajouterFournisseursArticle(id, [f2, f3])],
    ["retirer", (id) => C.retirerFournisseursArticle(id, [f1])],
    ["habituel en lot", (id) => C.definirFournisseurEnMasse([id], f3)],
    ["ajouter en lot", (id) => C.ajouterFournisseurEnMasse([id], f3)],
    ["retirer en lot", (id) => C.retirerFournisseurEnMasse([id], f2)],
  ];
  for (const [nom, geste] of gestes) {
    it(`${nom}`, async () => {
      const direct = await article(`D ${nom}`), propose = await article(`P ${nom}`);
      for (const id of [direct, propose]) { await L.definirHabituelEnMasseTx(prisma, [id], f1); await L.ajouterFournisseursEnMasseTx(prisma, [id], [f2]); }
      en("dir"); await geste(direct);
      en("resp");
      const avant = await etat(propose);
      expect(await geste(propose)).toMatchObject({ proposition: true });
      expect(await etat(propose)).toEqual(avant); // RIEN ne bouge avant la décision
      const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { statut: "EN_ATTENTE" } });
      en("dir");
      expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ traitees: [d.id], echecs: [] });
      const fin = (x: Awaited<ReturnType<typeof etat>>) => ({ ids: x.ids, habituel: x.habituel, colonne: x.colonne });
      expect(fin(await etat(propose))).toEqual(fin(await etat(direct)));
    }, 60_000);
  }

  it("la proposition montre les NOMS avant → après, et un retrait n'efface rien tant que la Direction n'a pas décidé", async () => {
    const a = await article("Poivre");
    await C.ajouterFournisseursArticle(a, [f1, f2]);
    en("resp");
    await C.retirerFournisseursArticle(a, [f1]);
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { statut: "EN_ATTENTE" } });
    const ch = (d.charge as { articles: { changements: { champ: string; avantLibelle: string; apresLibelle: string }[] }[] }).articles[0].changements;
    expect(ch).toEqual([expect.objectContaining({ champ: "fournisseursIds", avantLibelle: "Grossiste Nord, Marché central", apresLibelle: "Grossiste Nord" })]);
    expect((await etat(a)).ids).toEqual([f1, f2].sort());
  }, 60_000);

  it("liste périmée : un achat a ajouté un fournisseur entre-temps → validation refusée, signalée, rien d'écrasé", async () => {
    const a = await article("Cumin");
    await C.ajouterFournisseursArticle(a, [f1]);
    en("resp");
    await C.ajouterFournisseursArticle(a, [f2]); // propose [f1, f2]
    const d = await prisma.demandeValidationStock.findFirstOrThrow({ where: { statut: "EN_ATTENTE" } });
    en("dir");
    expect(erreurDe(await E.entreeListeAchat(listeAchat([{ articleId: a, quantite: 1, montant: 1, fournisseurId: f3 }])))).toBeNull(); // fait constaté : f3 rejoint l'article
    const r = await validerDemandes([d.id], {}, await v([d.id]));
    expect(r).toMatchObject({ traitees: [], echecs: [{ erreur: expect.stringMatching(/Fournisseurs a changé depuis la proposition/) }] });
    expect((await etat(a)).ids).toEqual([f1, f3].sort()); // f3 gardé, f2 jamais posé
  }, 60_000);

  it("une même personne qui retouche sa proposition ne la double pas", async () => {
    const a = await article("Anis");
    en("resp");
    await C.ajouterFournisseursArticle(a, [f1]);
    await C.ajouterFournisseursArticle(a, [f2]);
    expect(await prisma.demandeValidationStock.count({ where: { statut: "EN_ATTENTE" } })).toBe(1);
  }, 60_000);
});

describe("fusions", () => {
  it("fusion d'articles : les fournisseurs des doublons passent à l'article conservé, sans doublon de couple", async () => {
    const garde = await article("Tomate"), d1 = await article("Tomates"), d2 = await article("Tomate fraîche");
    await C.definirFournisseurHabituel(garde, f1);
    await C.definirFournisseurHabituel(d1, f1); // le même habituel
    await C.ajouterFournisseursArticle(d1, [f2]);
    await C.ajouterFournisseursArticle(d2, [f2, f3]);
    expect(await C.fusionnerArticles([garde, d1, d2], garde)).toBeUndefined();
    expect(await etat(garde)).toMatchObject({ ids: [f1, f2, f3].sort(), habituel: [f1], colonne: f1 });
    expect(await prisma.articleFournisseur.count({ where: { articleId: garde, fournisseurId: f2 } })).toBe(1);
    expect(await prisma.articleFournisseur.count({ where: { articleId: { in: [d1, d2] } } })).toBe(0);
  }, 60_000);

  it("fusion d'articles : l'article conservé SANS habituel adopte celui d'un doublon", async () => {
    const garde = await article("Oignon"), d1 = await article("Oignons");
    await C.ajouterFournisseursArticle(garde, [f3]);
    await C.definirFournisseurHabituel(d1, f2);
    await C.fusionnerArticles([garde, d1], garde);
    expect(await etat(garde)).toMatchObject({ ids: [f2, f3].sort(), habituel: [f2], colonne: f2 });
  }, 60_000);

  it("fusion de fournisseurs : les liens passent à la cible sans doublon, l'habituel suit", async () => {
    const source = (await prisma.fournisseur.create({ data: { nom: "Maman Epiphanie" } })).id;
    const cible = (await prisma.fournisseur.create({ data: { nom: "Maman Épiphanie Kasa" } })).id;
    const seul = await article("Seul chez la source"), deux = await article("Chez les deux"), habCible = await article("Habituel de la cible");
    await C.definirFournisseurHabituel(seul, source);
    await C.ajouterFournisseursArticle(deux, [source, cible]);
    await C.definirFournisseurHabituel(deux, source); // l'habituel est la source
    await C.definirFournisseurHabituel(habCible, cible);
    await C.ajouterFournisseursArticle(habCible, [source]);
    await FO.fusionnerFournisseurs(source, cible);
    expect(await etat(seul)).toMatchObject({ ids: [cible], habituel: [cible], colonne: cible });
    expect(await etat(deux)).toMatchObject({ ids: [cible], habituel: [cible], colonne: cible });
    expect(await etat(habCible)).toMatchObject({ ids: [cible], habituel: [cible], colonne: cible });
    expect(await prisma.articleFournisseur.count({ where: { fournisseurId: source } })).toBe(0);
  }, 60_000);

  it("supprimer un fournisseur retire ses liens ; son habituel vide la colonne (jamais un lien orphelin)", async () => {
    const jetable = (await prisma.fournisseur.create({ data: { nom: "À supprimer" } })).id;
    const a = await article("Orphelin");
    await C.definirFournisseurHabituel(a, jetable);
    await FO.supprimerFournisseur(jetable);
    expect(await etat(a)).toMatchObject({ ids: [], habituel: [], colonne: null });
  }, 60_000);
});

describe("dernier prix par fournisseur — depuis l'historique réel", () => {
  it("devise de saisie, unité de l'article, bons engagés seulement, et classement « moins cher »", async () => {
    const a = await article("Farine T55", { unite: "kg" });
    await C.ajouterFournisseursArticle(a, [f1, f2, f3]);
    // f1 : achat direct payé en FRANCS : 28 000 FC pour 10 kg = 2 800 FC/kg (jamais repassé par un pivot en dollars).
    expect(erreurDe(await E.entreeListeAchat(listeAchat([{ articleId: a, quantite: 10, montant: 28000, devise: "CDF", fournisseurId: f1 }], "2026-09-01")))).toBeNull();
    // f2 : deux factures en dollars, la plus récente fait foi (1,20 $/kg).
    await expect(F.creerFactureAvecLignes(facture({ fournisseurId: f2, fournisseurNom: "Grossiste Nord", numero: "A", date: "2026-08-01", lignes: [{ articleId: a, unite: "kg", quantite: 1, prix: 1.5 }] }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(F.creerFactureAvecLignes(facture({ fournisseurId: f2, fournisseurNom: "Grossiste Nord", numero: "B", date: "2026-09-10", lignes: [{ articleId: a, unite: "kg", quantite: 1, prix: 1.2 }] }))).rejects.toThrow("NEXT_REDIRECT");
    // f3 : prix par GRAMME (0,0011 $/g = 1,10 $/kg ; la colonne garde 4 décimales).
    await expect(F.creerFactureAvecLignes(facture({ fournisseurId: f3, fournisseurNom: "Épicerie Kasa", numero: "C", date: "2026-09-05", lignes: [{ articleId: a, unite: "g", quantite: 1000, prix: 0.0011 }] }))).rejects.toThrow("NEXT_REDIRECT");
    // Bon BROUILLON de f2 à 0,50 $ : jamais compté (ce n'est pas une commande).
    en("resp"); await creerBon(bonForm(f2, [{ articleId: a, quantite: 1, prix: "0.5" }])); en("dir");

    const r = await L.chargerPrixParFournisseur(a, { unite: "kg" }, 2800);
    expect(r.etat).toBe("COMPARE");
    const p = Object.fromEntries(r.lignes.map((l) => [l.fournisseurId, l]));
    expect(p[f1]).toMatchObject({ devise: "CDF", prix: "2800", origine: "LISTE_ACHAT", moinsCher: true });
    expect(p[f1].autre).toEqual({ devise: "USD", valeur: 1 }); // ≈ 1 $ au taux du jour, pour comparer seulement
    expect(p[f2]).toMatchObject({ devise: "USD", prix: "1.2", origine: "FACTURE", refLibelle: "B", moinsCher: false });
    expect(p[f3]).toMatchObject({ devise: "USD", moinsCher: false });
    expect(Number(p[f3].prix)).toBeCloseTo(1.1, 10); // 0,0011 $/g ramené au kg de l'article
    expect(Math.round(p[f2].ecartPct!)).toBe(20);

    // Bon VALIDÉ de f2 à 1,15 $ daté après sa facture : c'est maintenant son dernier prix.
    await creerBon(bonForm(f2, [{ articleId: a, quantite: 1, prix: "1.15" }]));
    const apres = await L.chargerPrixParFournisseur(a, { unite: "kg" }, 2800);
    expect(apres.lignes.find((l) => l.fournisseurId === f2)).toMatchObject({ origine: "BON_COMMANDE", prix: "1.15" });

    // Sans taux du jour et devises mêlées : la comparaison est annoncée impossible, jamais supposée.
    const sansTaux = await L.chargerPrixParFournisseur(a, { unite: "kg" }, null);
    expect(sansTaux.etat).toBe("DEVISES_SANS_TAUX");
    expect(sansTaux.lignes.some((l) => l.moinsCher)).toBe(false);
  }, 120_000);
});

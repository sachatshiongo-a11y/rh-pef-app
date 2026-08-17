import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { creerBaseTest } from "@/lib/test/db";
import { classeurSynthetique } from "./_fixture-classeur-fiches";
import {
  analyserClasseur,
  ecrireFichesSeules,
  simulerFichesSeules,
  type ClientFichesSeules,
  type ClientFichesSeulesCreation,
  type ClientLectureSeule,
  type ResultatParse,
  type SessionLectureSeule,
} from "./import-fiches-plats";

/**
 * Mode `--fiches-seules` sur un PostgreSQL ÉPHÉMÈRE (embedded-postgres, jeté à la fin) — jamais
 * une base réelle, jamais le `.env` du dépôt. Ce que ces tests verrouillent :
 *   - le catalogue `ArticleStock` est RIGOUREUSEMENT INTACT (comparé CHAMP PAR CHAMP, pas
 *     seulement compté) ;
 *   - une fiche à laquelle il manque un ingrédient n'est PAS créée, et le rapport la nomme ;
 *   - une sous-recette non créée fait tomber, en cascade, les fiches qui la citent ;
 *   - la simulation en lecture seule n'écrit rien — et sa transaction READ ONLY est réelle,
 *     PostgreSQL refusant physiquement l'écriture (SQLSTATE 25006).
 */

let prisma: PrismaClient;
let url: string;
let fermer: () => Promise<void>;
let res: ResultatParse;

beforeAll(async () => {
  ({ prisma, url, fermer } = await creerBaseTest());
  res = analyserClasseur(classeurSynthetique());
}, 240_000);

afterAll(async () => {
  await fermer?.();
});

/** Les 8 articles consommés par le classeur synthétique, tels qu'ils existeraient DÉJÀ en base. */
const CATALOGUE_CIBLE = [
  { designation: "20 PENNE RIGATE LM CHEF 12 X 1KG", unite: "Kg", prixUnitaireUSD: "3.5" }, // prix corrigé DANS L'APP
  { designation: "LAIT ELLE & VIRE ENTIER RED 1LTR", unite: "L", prixUnitaireUSD: "2.5" },
  { designation: "Viande Hachée", unite: "Kg", prixUnitaireUSD: "8.07" },
  { designation: "Tomates pêlées 240g", unite: "Pièce", prixUnitaireUSD: "1.34" },
  { designation: "Tomates concentrées", unite: "Pièce", prixUnitaireUSD: "0.21" },
  { designation: "Vin rouge", unite: "Bouteille", prixUnitaireUSD: "9" },
  { designation: "Huile 1L régina", unite: "L", prixUnitaireUSD: "2.492" },
  { designation: "Carottes", unite: "kg", prixUnitaireUSD: "4.58" },
];

/** Repart d'une base vide (l'ordre respecte les clés étrangères). */
async function vider() {
  await prisma.ingredientFiche.deleteMany({});
  await prisma.ficheTechnique.deleteMany({});
  await prisma.articleStock.deleteMany({});
}

/** Sème le catalogue cible, éventuellement amputé de quelques désignations. */
async function semerCatalogue(sauf: string[] = []) {
  for (const a of CATALOGUE_CIBLE) {
    if (sauf.includes(a.designation)) continue;
    await prisma.articleStock.create({ data: { ...a, domaine: "NOURRITURE" } });
  }
}

/**
 * Photo CHAMP PAR CHAMP du catalogue (toutes les colonnes, `updatedAt` compris — c'est lui qui
 * trahirait une mise à jour « neutre »). Sérialisée pour comparer Decimal et Date à l'identique.
 */
async function photoCatalogue() {
  const articles = await prisma.articleStock.findMany({ orderBy: { designation: "asc" } });
  return JSON.parse(JSON.stringify(articles)) as Record<string, unknown>[];
}

async function etat() {
  const [articles, fiches, ingredients] = await Promise.all([
    prisma.articleStock.count(),
    prisma.ficheTechnique.count(),
    prisma.ingredientFiche.count(),
  ]);
  return { articles, fiches, ingredients };
}

type TxAutorisee = Parameters<Parameters<ClientFichesSeules["$transaction"]>[0]>[0];

/** Ce qu'une transaction du mode fiches seules a le droit de toucher. Rien d'autre. */
function gardeTransaction(tx: unknown): TxAutorisee {
  return new Proxy({} as TxAutorisee, {
    get(_cible, prop) {
      if (prop === "ficheTechnique" || prop === "ingredientFiche") {
        return (tx as Record<string, unknown>)[prop];
      }
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw new Error(
        `Le mode fiches seules a tenté d'accéder à « ${String(prop)} » dans sa transaction : interdit.`,
      );
    },
  });
}

/**
 * Client VERROUILLÉ : `articleStock` n'y répond QU'À `findMany`, et toute autre propriété
 * (`create`, `update`, `upsert`, `updateMany`, `deleteMany`…) lève immédiatement. Si un chemin de
 * code du mode fiches seules touchait un jour au catalogue, ce client le ferait ÉCHOUER — au lieu
 * de laisser l'écriture passer en silence. C'est la garantie « par construction », vérifiée à
 * l'exécution et pas seulement au type.
 */
function clientVerrouille(): ClientFichesSeules {
  const articleStockLectureSeule = new Proxy({} as Record<string, unknown>, {
    get(_cible, prop) {
      if (prop === "findMany") return (args: unknown) => prisma.articleStock.findMany(args as never);
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw new Error(`Le mode fiches seules a tenté « articleStock.${String(prop)} » : ÉCRITURE INTERDITE.`);
    },
  });

  return {
    ficheTechnique: {
      findMany: (args: unknown) => prisma.ficheTechnique.findMany(args as never),
      deleteMany: (args: unknown) => prisma.ficheTechnique.deleteMany(args as never),
    },
    ingredientFiche: { findMany: (args: unknown) => prisma.ingredientFiche.findMany(args as never) },
    articleStock: articleStockLectureSeule,
    $transaction: (fn: (tx: TxAutorisee) => Promise<unknown>, options?: unknown) =>
      prisma.$transaction((tx) => fn(gardeTransaction(tx)), options as never),
  } as unknown as ClientFichesSeules;
}

describe("le catalogue ArticleStock est INTACT", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogue();
  });

  it("le verrou de test MORD vraiment (sinon les tests suivants ne prouveraient rien)", () => {
    // Sans cette vérification, « aucune écriture détectée » pourrait simplement vouloir dire que
    // le garde-fou ne garde rien. Il doit refuser TOUTE méthode d'écriture, y compris déguisée.
    const client = clientVerrouille() as unknown as Record<string, Record<string, unknown>>;
    for (const methode of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      expect(() => client.articleStock![methode]).toThrow(/ÉCRITURE INTERDITE/);
    }
    expect(typeof client.articleStock!.findMany).toBe("function"); // la lecture, elle, passe
  });

  it("aucune création, aucune mise à jour : même nombre d'articles ET mêmes colonnes, champ par champ", async () => {
    const avant = await photoCatalogue();
    expect(avant).toHaveLength(8);

    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: false });
    expect(r.statut).toBe("IMPORTE");

    const apres = await photoCatalogue();
    expect(apres).toHaveLength(avant.length);
    expect(apres).toEqual(avant); // id, designation, domaine, unite, prix, actif, createdAt, updatedAt…
  });

  it("le prix corrigé dans l'application n'est PAS ramené à la valeur du classeur", async () => {
    // C'est tout l'objet du mode : le classeur donne 0,35 $, la base garde ses 3,50 $.
    const penne = await prisma.articleStock.findFirstOrThrow({ where: { designation: { startsWith: "20 PENNE" } } });
    expect(penne.prixUnitaireUSD?.toString()).toBe("3.5");
  });

  it("aucun des 63 articles du classeur absents de la base n'a été créé", async () => {
    // « Sauce bolognaise » (fausse ligne du classeur) n'apparaît pas davantage au catalogue.
    const designations = (await prisma.articleStock.findMany({ select: { designation: true } })).map((a) => a.designation);
    expect(designations.sort()).toEqual(CATALOGUE_CIBLE.map((a) => a.designation).sort());
  });
});

describe("une fiche complète EST créée, avec tous ses ingrédients", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogue();
    await ecrireFichesSeules(clientVerrouille(), res, { force: false });
  });

  it("crée la sous-recette puis le plat, et pose le lien de sous-recette", async () => {
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });

    const sauce = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Sauce bolognaise" } });
    expect(sauce.estSousRecette).toBe(true);
    expect(sauce.rendementUnite).toBe("g"); // jamais « kg » : cf. doctrine du moteur de coût
    expect(sauce.rendementQuantite?.toString()).toBe("4600");
    expect(await prisma.ingredientFiche.count({ where: { ficheId: sauce.id } })).toBe(7);

    const lignes = await prisma.ingredientFiche.findMany({
      where: { fiche: { nom: "Bolognaise" } },
      orderBy: { ordre: "asc" },
      include: { article: true, sousFiche: true },
    });
    expect(lignes).toHaveLength(2);
    expect(lignes[0]!.sousFiche?.nom).toBe("Sauce bolognaise");
    expect(lignes[1]!.article?.designation).toBe("20 PENNE RIGATE LM CHEF 12 X 1KG");
  });

  it("aucun ingrédient orphelin : chaque ligne pointe un article OU une sous-fiche", async () => {
    const muettes = await prisma.ingredientFiche.count({ where: { articleId: null, sousFicheId: null } });
    expect(muettes).toBe(0);
  });

  it("relancer ne duplique rien (DEJA_FAIT), et --force reconstruit à l'identique", async () => {
    const rechute = await ecrireFichesSeules(clientVerrouille(), res, { force: false });
    expect(rechute.statut).toBe("DEJA_FAIT");
    expect(rechute.fichesCreees).toBe(0);
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });

    const avant = await photoCatalogue();
    const force = await ecrireFichesSeules(clientVerrouille(), res, { force: true });
    expect(force.statut).toBe("IMPORTE");
    expect(force.fichesSupprimees.sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });
    expect(await photoCatalogue()).toEqual(avant); // --force ne touche toujours pas au catalogue
  });

  it("une fiche homonyme saisie à la main bloque l'import au lieu de l'écraser", async () => {
    await vider();
    await semerCatalogue();
    await prisma.ficheTechnique.create({ data: { nom: "Bolognaise", nbPortions: 4, categorie: "Ma carte" } });

    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: true });
    expect(r.statut).toBe("ABANDON");
    expect(r.fichesProtegees).toEqual(["Bolognaise"]);
    expect(r.message).toContain('--supprimer "Bolognaise"');
    const survivante = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Bolognaise" } });
    expect(survivante.nbPortions).toBe(4); // intacte
  });
});

describe("RÈGLE CARDINALE : une fiche à qui il manque un ingrédient n'est PAS créée", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogue(["20 PENNE RIGATE LM CHEF 12 X 1KG"]);
  });

  it("la fiche n'existe pas en base, et le rapport la nomme AVEC l'article introuvable", async () => {
    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: false });
    expect(r.statut).toBe("IMPORTE");

    // « Bolognaise » n'est PAS créée — surtout pas amputée de ses pennes, ce qui lui donnerait un
    // coût sous-évalué à l'apparence d'un coût complet (IngredientFiche n'a aucun libellé).
    expect(await prisma.ficheTechnique.count({ where: { nom: "Bolognaise" } })).toBe(0);
    expect(await etat()).toEqual({ articles: 7, fiches: 1, ingredients: 7 });

    const refusee = r.fichesRefusees.find((f) => f.nom === "Bolognaise")!;
    expect(refusee.articlesManquants).toEqual(["20 PENNE RIGATE LM CHEF 12 X 1KG"]);
    expect(r.articlesManquants.map((a) => a.designation)).toEqual(["20 PENNE RIGATE LM CHEF 12 X 1KG"]);
    expect(r.message).toContain("1 fiche(s) NON importée(s)");
  });

  it("aucune ligne muette n'a été créée pour la fiche refusée", async () => {
    expect(await prisma.ingredientFiche.count({ where: { articleId: null, sousFicheId: null } })).toBe(0);
  });
});

describe("une sous-recette non créée fait tomber, EN CASCADE, les fiches qui la citent", () => {
  beforeAll(async () => {
    await vider();
    // « Carottes » n'est consommée que par la SOUS-RECETTE. « Bolognaise », elle, a tous ses
    // propres articles — et ne doit pourtant pas être créée : sa sauce n'existera pas.
    await semerCatalogue(["Carottes"]);
  });

  it("ni la sous-recette, ni le plat qui la cite", async () => {
    const avant = await photoCatalogue();
    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: false });

    expect(r.statut).toBe("ABANDON");
    expect(r.fichesCreees).toBe(0);
    expect(await etat()).toEqual({ articles: 7, fiches: 0, ingredients: 0 });
    expect(await photoCatalogue()).toEqual(avant); // même en ABANDON, le catalogue n'a pas bougé

    expect(r.fichesRefusees.map((f) => f.nom).sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    const bolo = r.fichesRefusees.find((f) => f.nom === "Bolognaise")!;
    expect(bolo.articlesManquants).toEqual([]);
    expect(bolo.sousRecettesRefusees).toEqual(["Sauce bolognaise"]);
    expect(r.message).toContain("aucune des 2 fiche(s) du classeur n'est créable");
  });
});

describe("simulation EN LECTURE SEULE (--fiches-seules --dry-run)", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogue(["Carottes"]);
  });

  it("se connecte, rapporte… et ne crée RIEN", async () => {
    const avant = await photoCatalogue();
    const etatAvant = await etat();

    const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res);

    expect(sim.lectureSeuleVerifiee).toBe(true);
    expect(sim.nbArticlesCatalogue).toBe(7);
    expect(sim.plan.creables).toEqual([]);
    expect(sim.plan.refusees.map((f) => f.nom).sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    expect(sim.plan.articlesManquants.map((a) => a.designation)).toEqual(["Carottes"]);

    expect(await etat()).toEqual(etatAvant);
    expect(await photoCatalogue()).toEqual(avant);
  });

  it("chiffre le coût complet / partiel des fiches qui SERAIENT créées", async () => {
    await vider();
    await semerCatalogue();
    // Un article du catalogue sans prix : la fiche reste créable, mais son coût sera partiel.
    await prisma.articleStock.updateMany({ where: { designation: "Carottes" }, data: { prixUnitaireUSD: null } });

    const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res);
    expect(sim.plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(sim.couts).toHaveLength(2);
    const sauce = sim.couts.find((c) => c.nom === "Sauce bolognaise")!;
    expect(sauce.incomplet).toBe(true);
    expect(sauce.motifs.join(" ")).toContain("Carottes");
    expect(await etat()).toEqual({ articles: 8, fiches: 0, ingredients: 0 }); // toujours rien d'écrit
  });

  it("signale les fiches homonymes déjà en base, sans y toucher", async () => {
    await prisma.ficheTechnique.create({ data: { nom: "bolognaise", nbPortions: 9 } });
    const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res);
    expect(sim.homonymesEnBase).toEqual(["bolognaise"]);
    const intacte = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "bolognaise" } });
    expect(intacte.nbPortions).toBe(9);
  });

  it("la transaction READ ONLY n'est pas décorative : PostgreSQL refuse physiquement l'écriture", async () => {
    // Le drapeau vérifié par la simulation est celui-ci. On prouve ici qu'il MORD vraiment,
    // au lieu de se contenter de croire à un « SHOW ».
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.articleStock.create({ data: { designation: "NE DOIT PAS EXISTER", domaine: "NOURRITURE" } });
      }),
    ).rejects.toThrow();
    expect(await prisma.articleStock.count({ where: { designation: "NE DOIT PAS EXISTER" } })).toBe(0);
  });
});

describe("repli de niveau 2 sur un VRAI PostgreSQL — session dédiée en lecture seule", () => {
  /**
   * Session dédiée telle que `main()` la fabrique : UNE seule connexion physique (pool de taille
   * 1, jamais recyclée sur inactivité), pour que l'état « read only » survive d'une requête à
   * l'autre. `pg_backend_pid()` le vérifie ensuite — le pool ne fait pas foi à lui seul.
   */
  const sessionDediee = async () => {
    const dedie = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url, max: 1, idleTimeoutMillis: 0 }),
    });
    return { session: dedie as unknown as SessionLectureSeule, fermer: () => dedie.$disconnect() };
  };

  /** Client dont la transaction interactive est refusée, comme le pooler Supabase le fait (P2028). */
  const poolerSansTransaction = (): ClientLectureSeule => ({
    $transaction: () =>
      Promise.reject(
        Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), {
          code: "P2028",
        }),
      ),
  });

  beforeAll(async () => {
    await vider();
    await semerCatalogue(["Carottes"]);
  });

  it("quand la transaction interactive est refusée, la simulation aboutit QUAND MÊME, en session dédiée", async () => {
    const avant = await photoCatalogue();
    const journal: string[] = [];

    const sim = await simulerFichesSeules(poolerSansTransaction(), res, {
      journal: (m) => journal.push(m),
      sessionDediee,
    });

    // C'est le chiffre qui manquait à la Direction : combien de fiches sont réellement créables.
    expect(sim.protection).toBe("SESSION_READ_ONLY");
    expect(sim.lectureSeuleVerifiee).toBe(true);
    expect(sim.backendPid).toMatch(/^[0-9]+$/); // un vrai backend PostgreSQL, relevé et comparé
    expect(sim.motifRepli).toContain("Unable to start a transaction");
    expect(sim.nbArticlesCatalogue).toBe(7);
    expect(sim.plan.articlesManquants.map((a) => a.designation)).toEqual(["Carottes"]);
    expect(sim.plan.refusees.map((f) => f.nom).sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);

    // Le journal DIT laquelle des deux protections a joué (le lecteur doit le savoir).
    expect(journal.join("\n")).toContain("SESSION DÉDIÉE");
    expect(journal.join("\n")).toContain("backend PostgreSQL");

    // Et rien n'a bougé.
    expect(await photoCatalogue()).toEqual(avant);
    expect(await etat()).toEqual({ articles: 7, fiches: 0, ingredients: 0 });
  });

  it("la lecture seule de SESSION mord vraiment : PostgreSQL refuse l'écriture après le SET", async () => {
    // Sans cette preuve, « SHOW transaction_read_only = on » ne serait qu'une chaîne de caractères.
    const { session, fermer: fermerSession } = await sessionDediee();
    const dedie = session as unknown as PrismaClient;
    try {
      await dedie.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      const drapeau = await dedie.$queryRawUnsafe<{ transaction_read_only: string }[]>(
        "SHOW transaction_read_only",
      );
      expect(drapeau[0]!.transaction_read_only).toBe("on");
      await expect(
        dedie.articleStock.create({ data: { designation: "NE DOIT PAS EXISTER", domaine: "NOURRITURE" } }),
      ).rejects.toThrow();
    } finally {
      await fermerSession();
    }
    expect(await prisma.articleStock.count({ where: { designation: "NE DOIT PAS EXISTER" } })).toBe(0);
  });

  it("la session dédiée est jetée : son « read only » ne contamine pas la connexion ordinaire", async () => {
    await simulerFichesSeules(poolerSansTransaction(), res, { journal: () => {}, sessionDediee });
    // La connexion de travail doit rester parfaitement écrivable après la simulation.
    const temoin = await prisma.articleStock.create({ data: { designation: "Témoin", domaine: "NOURRITURE" } });
    await prisma.articleStock.delete({ where: { id: temoin.id } });
    expect(await etat()).toEqual({ articles: 7, fiches: 0, ingredients: 0 });
  });

  it("niveau 1 quand il est disponible : c'est la TRANSACTION qui protège, et elle est annoncée", async () => {
    const journal: string[] = [];
    const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res, {
      journal: (m) => journal.push(m),
      sessionDediee,
    });
    expect(sim.protection).toBe("TRANSACTION_READ_ONLY");
    expect(sim.motifRepli).toBeNull();
    expect(sim.backendPid).toBeNull(); // pas nécessaire : la transaction épingle déjà la connexion
    expect(journal.join("\n")).toContain("transaction READ ONLY vérifiée");
  });

  it("les délais de la transaction sont surchargeables (c'est eux que le P2028 met en cause)", async () => {
    const vus: { maxWait?: number; timeout?: number }[] = [];
    const espion: ClientLectureSeule = {
      $transaction: (fn, options) => {
        vus.push(options as { maxWait?: number; timeout?: number });
        return prisma.$transaction((tx) => fn(tx as never), options as never);
      },
    };
    await simulerFichesSeules(espion, res, { journal: () => {}, maxWaitMs: 45_000, timeoutMs: 90_000 });
    expect(vus[0]).toMatchObject({ maxWait: 45_000, timeout: 90_000 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CORRESPONDANCES ARBITRÉES + CRÉATION CIBLÉE (`--creer-articles-manquants`)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Client de la création CIBLÉE : `articleStock` répond à `findMany` ET à `create`, et lève sur
 * TOUT le reste — `update`, `upsert`, `updateMany`, `createMany`, `delete`, `deleteMany`. C'est la
 * garantie centrale du drapeau, vérifiée À L'EXÉCUTION et pas seulement au type : si un chemin de
 * code tentait un jour de METTRE À JOUR un article, ce client le ferait échouer bruyamment.
 */
function clientVerrouilleCreation(): ClientFichesSeulesCreation {
  const articleStockCreationSeule = new Proxy({} as Record<string, unknown>, {
    get(_cible, prop) {
      if (prop === "findMany") return (args: unknown) => prisma.articleStock.findMany(args as never);
      if (prop === "create") return (args: unknown) => prisma.articleStock.create(args as never);
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw new Error(`Le mode fiches seules a tenté « articleStock.${String(prop)} » : MISE À JOUR INTERDITE.`);
    },
  });

  return {
    ficheTechnique: {
      findMany: (args: unknown) => prisma.ficheTechnique.findMany(args as never),
      deleteMany: (args: unknown) => prisma.ficheTechnique.deleteMany(args as never),
    },
    ingredientFiche: { findMany: (args: unknown) => prisma.ingredientFiche.findMany(args as never) },
    articleStock: articleStockCreationSeule,
    $transaction: (fn: (tx: TxAutorisee) => Promise<unknown>, options?: unknown) =>
      prisma.$transaction((tx) => fn(gardeTransaction(tx)), options as never),
  } as unknown as ClientFichesSeulesCreation;
}

/** Le catalogue tel qu'il est en PRODUCTION : sans conditionnement dans les désignations. */
const CATALOGUE_SANS_CONDITIONNEMENT = [
  { designation: "Penne Rigate Lm Chef 12 X 1KG", unite: "Kg", prixUnitaireUSD: "3.5" },
  { designation: "Tomates pêlées", unite: "Pièce", prixUnitaireUSD: "1.9" },
  { designation: "LAIT ELLE & VIRE ENTIER RED 1LTR", unite: "L", prixUnitaireUSD: "2.5" },
  { designation: "Viande Hachée", unite: "Kg", prixUnitaireUSD: "8.07" },
  { designation: "Tomates concentrées", unite: "Pièce", prixUnitaireUSD: "0.21" },
  { designation: "Vin rouge", unite: "Bouteille", prixUnitaireUSD: "9" },
  { designation: "Huile 1L régina", unite: "L", prixUnitaireUSD: "2.492" },
  { designation: "Carottes", unite: "kg", prixUnitaireUSD: "4.58" },
];

const ARBITRAGES = [
  {
    classeur: "20 PENNE RIGATE LM CHEF 12 X 1KG",
    catalogue: "Penne Rigate Lm Chef 12 X 1KG",
    motif: "Code article « 20 » en préfixe dans le classeur.",
  },
  {
    classeur: "Tomates pêlées 240g",
    catalogue: "Tomates pêlées",
    motif: "Conditionnement « 240g » précisé dans le classeur ; le catalogue ne le porte pas.",
  },
];

async function semerCatalogueProd(sauf: string[] = []) {
  for (const a of CATALOGUE_SANS_CONDITIONNEMENT) {
    if (sauf.includes(a.designation)) continue;
    await prisma.articleStock.create({ data: { ...a, domaine: "NOURRITURE" } });
  }
}

describe("une correspondance rattache à l'article EXISTANT, sans en bouger une seule colonne", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogueProd();
  });

  it("le verrou de test MORD : seuls findMany et create passent, toute mise à jour lève", () => {
    const client = clientVerrouilleCreation() as unknown as Record<string, Record<string, unknown>>;
    for (const methode of ["update", "updateMany", "upsert", "createMany", "delete", "deleteMany"]) {
      expect(() => client.articleStock![methode]).toThrow(/MISE À JOUR INTERDITE/);
    }
    expect(typeof client.articleStock!.findMany).toBe("function");
    expect(typeof client.articleStock!.create).toBe("function");
  });

  it("les fiches sont créées, et le catalogue est IDENTIQUE champ par champ (updatedAt compris)", async () => {
    const avant = await photoCatalogue();
    expect(avant).toHaveLength(8);

    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: false, correspondances: ARBITRAGES });
    expect(r.statut).toBe("IMPORTE");
    expect(r.fichesCreees).toBe(2);
    expect(r.articlesCrees).toEqual([]); // sans le drapeau, aucune création n'est même possible

    // Rien, absolument rien, n'a bougé : ni le prix, ni l'unité, ni updatedAt.
    expect(await photoCatalogue()).toEqual(avant);
  });

  it("l'ingrédient pointe bien l'article du CATALOGUE, dont le prix fait foi", async () => {
    const lignes = await prisma.ingredientFiche.findMany({
      where: { fiche: { nom: "Bolognaise" } },
      orderBy: { ordre: "asc" },
      include: { article: true },
    });
    expect(lignes[1]!.article?.designation).toBe("Penne Rigate Lm Chef 12 X 1KG");
    expect(lignes[1]!.article?.prixUnitaireUSD?.toString()).toBe("3.5"); // celui de la base, pas 0,35 $
    expect(lignes[1]!.unite).toBe("Kg"); // le conditionnement vit ICI, dans la ligne d'ingrédient

    const sauce = await prisma.ingredientFiche.findMany({
      where: { fiche: { nom: "Sauce bolognaise" }, article: { designation: "Tomates pêlées" } },
    });
    expect(sauce).toHaveLength(1);
    expect(sauce[0]!.unite).toBe("Pièce");
    expect(sauce[0]!.quantite.toString()).toBe("5");
  });

  it("SANS correspondance, les mêmes fiches sont REFUSÉES : c'est bien elle qui les débloque", async () => {
    await vider();
    await semerCatalogueProd();
    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: false });
    expect(r.statut).toBe("ABANDON");
    expect(await etat()).toEqual({ articles: 8, fiches: 0, ingredients: 0 });
    expect(r.articlesManquants.map((a) => a.designation).sort()).toEqual([
      "20 PENNE RIGATE LM CHEF 12 X 1KG",
      "Tomates pêlées 240g",
    ]);
  });
});

describe("une correspondance dont la cible n'existe pas fait ÉCHOUER le script, en la nommant", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogueProd(["Tomates pêlées"]); // la cible arbitrée a disparu du catalogue
  });

  it("l'import lève, nomme l'entrée fautive, et n'écrit RIEN", async () => {
    const avant = await photoCatalogue();
    await expect(
      ecrireFichesSeules(clientVerrouille(), res, { force: false, correspondances: ARBITRAGES }),
    ).rejects.toThrow(/« Tomates pêlées 240g » → « Tomates pêlées » \(INTROUVABLE au catalogue\)/);

    expect(await etat()).toEqual({ articles: 7, fiches: 0, ingredients: 0 });
    expect(await photoCatalogue()).toEqual(avant);
  });

  it("même avec --creer-articles-manquants : on refuse AVANT de créer le doublon", async () => {
    // C'est tout l'objet du refus : sans lui, « Tomates pêlées 240g » serait créé en double.
    const avant = await photoCatalogue();
    await expect(
      ecrireFichesSeules(clientVerrouilleCreation(), res, {
        force: false,
        correspondances: ARBITRAGES,
        creerArticlesManquants: true,
      }),
    ).rejects.toThrow(/INTROUVABLE au catalogue/);
    expect(await photoCatalogue()).toEqual(avant);
    expect(await prisma.articleStock.count({ where: { designation: "Tomates pêlées 240g" } })).toBe(0);
  });
});

describe("--creer-articles-manquants : SEULS les absents sont créés, AUCUN existant n'est modifié", () => {
  beforeAll(async () => {
    await vider();
    // Deux articles absents du catalogue : ils seront créés. Les six autres ne doivent PAS bouger.
    await semerCatalogueProd(["Carottes", "Vin rouge"]);
  });

  it("crée exactement les 2 absents, avec les valeurs DU CLASSEUR, sans catégorie ni fournisseur", async () => {
    const avant = await photoCatalogue();
    expect(avant).toHaveLength(6);

    const r = await ecrireFichesSeules(clientVerrouilleCreation(), res, {
      force: false,
      correspondances: ARBITRAGES,
      creerArticlesManquants: true,
    });

    expect(r.statut).toBe("IMPORTE");
    expect(r.articlesCrees.map((a) => a.designation).sort()).toEqual(["Carottes", "Vin rouge"]);
    expect(await prisma.articleStock.count()).toBe(8);

    const carottes = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Carottes" } });
    expect(carottes.domaine).toBe("NOURRITURE");
    expect(carottes.unite).toBe("kg");
    expect(carottes.prixUnitaireUSD?.toString()).toBe("4.58"); // valeur du classeur
    expect(carottes.categorieId).toBeNull(); // rien n'est inventé : la Direction complétera
    expect(carottes.fournisseurId).toBeNull();
  });

  it("les SIX articles préexistants sont INTACTS, champ par champ (updatedAt compris)", async () => {
    const nouvelles = new Set(["Carottes", "Vin rouge"]);
    const apres = (await photoCatalogue()).filter((a) => !nouvelles.has(a.designation as string));
    // On recompose la photo d'avant : les six anciens, dans le même ordre.
    const attendu = CATALOGUE_SANS_CONDITIONNEMENT.filter((a) => !nouvelles.has(a.designation)).map((a) => a.designation);
    expect(apres.map((a) => a.designation).sort()).toEqual(attendu.sort());

    // Aucun prix ramené à la valeur du classeur : « Penne » vaut 3,50 $ en base contre 0,35 $ au
    // classeur, et c'est la base qui gagne — la mise à jour n'est même pas exprimable.
    const penne = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Penne Rigate Lm Chef 12 X 1KG" } });
    expect(penne.prixUnitaireUSD?.toString()).toBe("3.5");
    expect(penne.unite).toBe("Kg");
    const tomates = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Tomates pêlées" } });
    expect(tomates.prixUnitaireUSD?.toString()).toBe("1.9");
  });

  it("les fiches deviennent créables et sont créées avec TOUS leurs ingrédients", async () => {
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });
    const sauce = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Sauce bolognaise" } });
    expect(await prisma.ingredientFiche.count({ where: { ficheId: sauce.id } })).toBe(7);
    expect(await prisma.ingredientFiche.count({ where: { articleId: null, sousFicheId: null } })).toBe(0);

    // Les lignes pointent les articles FRAÎCHEMENT CRÉÉS, avec de vrais identifiants (jamais les
    // identifiants factices « (à créer) … » de la projection).
    const carotte = await prisma.ingredientFiche.findFirstOrThrow({
      where: { article: { designation: "Carottes" } },
      include: { article: true },
    });
    expect(carotte.article!.id).not.toContain("à créer");
  });

  it("relancer ne crée RIEN de plus : la création est idempotente", async () => {
    const avant = await photoCatalogue();
    const r = await ecrireFichesSeules(clientVerrouilleCreation(), res, {
      force: false,
      correspondances: ARBITRAGES,
      creerArticlesManquants: true,
    });
    expect(r.statut).toBe("DEJA_FAIT");
    expect(r.articlesCrees).toEqual([]);
    expect(await photoCatalogue()).toEqual(avant);
  });
});

describe("SANS le drapeau : rien n'est créé, et les fiches concernées restent refusées", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogueProd(["Carottes"]);
  });

  it("le catalogue est intact et les deux fiches tombent (cascade sur la sous-recette)", async () => {
    const avant = await photoCatalogue();
    const r = await ecrireFichesSeules(clientVerrouille(), res, { force: false, correspondances: ARBITRAGES });

    expect(r.statut).toBe("ABANDON");
    expect(r.articlesCrees).toEqual([]);
    expect(r.articlesManquants.map((a) => a.designation)).toEqual(["Carottes"]);
    expect(r.fichesRefusees.map((f) => f.nom).sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    expect(await etat()).toEqual({ articles: 7, fiches: 0, ingredients: 0 });
    expect(await photoCatalogue()).toEqual(avant);
  });

  it("le même appel AVEC le drapeau, lui, débloque tout — la différence ne tient qu'à lui", async () => {
    const r = await ecrireFichesSeules(clientVerrouilleCreation(), res, {
      force: false,
      correspondances: ARBITRAGES,
      creerArticlesManquants: true,
    });
    expect(r.statut).toBe("IMPORTE");
    expect(r.articlesCrees.map((a) => a.designation)).toEqual(["Carottes"]);
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });
  });
});

describe("simulation EN LECTURE SEULE de la création (--dry-run --creer-articles-manquants)", () => {
  beforeAll(async () => {
    await vider();
    await semerCatalogueProd(["Carottes", "Vin rouge"]);
  });

  it("dit combien de correspondances résolvent, ce qui serait créé, et ce que ça débloque — sans rien écrire", async () => {
    const avant = await photoCatalogue();
    const etatAvant = await etat();

    const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res, {
      correspondances: ARBITRAGES,
      creerArticlesManquants: true,
    });

    expect(sim.lectureSeuleVerifiee).toBe(true);
    expect(sim.creationSimulee).toBe(true);
    expect(sim.plan.correspondancesAppliquees).toHaveLength(2);
    expect(sim.articlesQuiSeraientCrees.map((a) => a.designation).sort()).toEqual(["Carottes", "Vin rouge"]);
    expect(sim.articlesSansValeurs).toEqual([]);

    // Avant création : aucune fiche créable. Après : les deux.
    expect(sim.planAvantCreation.creables).toEqual([]);
    expect(sim.plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(sim.couts).toHaveLength(2);
    expect(sim.couts.every((c) => !c.incomplet)).toBe(true);

    // Et absolument rien n'a été écrit.
    expect(await etat()).toEqual(etatAvant);
    expect(await photoCatalogue()).toEqual(avant);
  });

  it("sans le drapeau, la simulation ne projette aucune création", async () => {
    const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res, {
      correspondances: ARBITRAGES,
    });
    expect(sim.creationSimulee).toBe(false);
    expect(sim.articlesQuiSeraientCrees).toEqual([]);
    expect(sim.plan).toBe(sim.planAvantCreation);
    expect(sim.plan.creables).toEqual([]);
  });

  it("une correspondance morte arrête AUSSI la simulation, en la nommant", async () => {
    await expect(
      simulerFichesSeules(prisma as unknown as ClientLectureSeule, res, {
        correspondances: [{ classeur: "Huile 1L régina", catalogue: "Huile 5L régina", motif: "test." }],
        creerArticlesManquants: true,
      }),
    ).rejects.toThrow(/« Huile 1L régina » → « Huile 5L régina » \(INTROUVABLE au catalogue\)/);
  });
});

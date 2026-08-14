import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { classeurSynthetique } from "./_fixture-classeur-fiches";
import {
  analyserClasseur,
  ecrireEnBase,
  SELECT_FICHE_SIGNATURE,
  type ClientEcriture,
  type ResultatParse,
} from "./import-fiches-plats";

/**
 * Tests du CHEMIN D'ÉCRITURE sur un PostgreSQL ÉPHÉMÈRE (embedded-postgres, jeté à la fin) —
 * jamais une base réelle, jamais le `.env` du dépôt. Ils couvrent ce qu'aucun test de parseur ne
 * peut atteindre :
 *   - l'ordre de suppression imposé par `IngredientFiche.sousFicheId` en `onDelete: Restrict`,
 *     que PostgreSQL vérifie IMMÉDIATEMENT (contrainte non déférable) ;
 *   - l'idempotence réelle (relancer ne duplique pas) ;
 *   - la protection des fiches saisies à la main portant un nom du classeur ;
 *   - l'écrasement des prix d'articles par le classeur.
 */

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let res: ResultatParse;

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest());
  res = analyserClasseur(classeurSynthetique());
}, 240_000);

afterAll(async () => {
  await fermer?.();
});

const client = () => prisma as unknown as ClientEcriture;

/** Repart d'une base vide entre deux scénarios (l'ordre respecte les clés étrangères). */
async function vider() {
  await prisma.ingredientFiche.deleteMany({});
  await prisma.ficheTechnique.deleteMany({});
  await prisma.articleStock.deleteMany({});
}

async function etat() {
  const [articles, fiches, ingredients] = await Promise.all([
    prisma.articleStock.count(),
    prisma.ficheTechnique.count(),
    prisma.ingredientFiche.count(),
  ]);
  return { articles, fiches, ingredients };
}

describe("import en base — premier passage", () => {
  beforeAll(vider);

  it("crée articles, sous-recette puis plat, et pose le lien de sous-recette", async () => {
    const r = await ecrireEnBase(client(), res, { force: false });
    expect(r.statut).toBe("IMPORTE");
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });

    const sauce = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Sauce bolognaise" } });
    expect(sauce.estSousRecette).toBe(true);
    // Le piège n°1 : jamais « kg » en base, sinon toutes les fiches utilisatrices basculent en
    // coût indéterminé (uniteRendementIncoherente).
    expect(sauce.rendementUnite).toBe("g");
    expect(sauce.rendementQuantite?.toString()).toBe("4600");

    const lignes = await prisma.ingredientFiche.findMany({
      where: { fiche: { nom: "Bolognaise" } },
      orderBy: { ordre: "asc" },
      include: { article: true, sousFiche: true },
    });
    expect(lignes).toHaveLength(2);
    expect(lignes[0]!.sousFiche?.nom).toBe("Sauce bolognaise"); // la sous-recette existait déjà
    expect(lignes[1]!.article?.designation).toBe("20 PENNE RIGATE LM CHEF 12 X 1KG");
  });

  it("n'importe PAS la fausse ligne « Sauce bolognaise » comme article", async () => {
    const articles = await prisma.articleStock.findMany({ select: { designation: true } });
    expect(articles.map((a) => a.designation)).not.toContain("Sauce bolognaise");
  });

  it("importe le prix des pennes tel quel, erreur de saisie comprise", async () => {
    const penne = await prisma.articleStock.findFirstOrThrow({ where: { designation: { startsWith: "20 PENNE" } } });
    expect(penne.prixUnitaireUSD?.toString()).toBe("0.35");
    expect(penne.prixCartonUSD?.toString()).toBe("42");
  });
});

describe("idempotence", () => {
  beforeAll(async () => {
    await vider();
    await ecrireEnBase(client(), res, { force: false });
  });

  it("relancer sans --force ne duplique rien et le dit correctement", async () => {
    const r = await ecrireEnBase(client(), res, { force: false });
    expect(r.statut).toBe("DEJA_FAIT");
    expect(r.fichesCreees).toBe(0);
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });
  });

  it("relancer avec --force supprime puis recrée, SANS violer la contrainte Restrict", async () => {
    // C'est le chemin critique : supprimer « Sauce bolognaise » alors que « Bolognaise » la cite
    // encore échouerait immédiatement (onDelete: Restrict, non déférable en PostgreSQL).
    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("IMPORTE");
    expect(r.fichesSupprimees.sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });
  });

  it("après --force, le lien de sous-recette est reconstruit (pas d'orphelin)", async () => {
    const ligne = await prisma.ingredientFiche.findFirstOrThrow({
      where: { fiche: { nom: "Bolognaise" }, sousFicheId: { not: null } },
      include: { sousFiche: true },
    });
    expect(ligne.sousFiche?.nom).toBe("Sauce bolognaise");
  });
});

describe("protection des fiches saisies à la main (FicheTechnique.nom n'est PAS unique)", () => {
  beforeAll(vider);

  it("une fiche homonyme préexistante fait ABANDONNER l'import au lieu de tout avaler", async () => {
    // « Bolognaise » est un nom de carte ordinaire : un cuisinier le ressaisira spontanément.
    await prisma.ficheTechnique.create({ data: { nom: "Bolognaise", nbPortions: 4, categorie: "Ma carte" } });

    const r = await ecrireEnBase(client(), res, { force: false });
    expect(r.statut).toBe("ABANDON");
    expect(r.fichesProtegees).toEqual(["Bolognaise"]);
    // Ni fiche, ni ARTICLE : l'ancien code renvoyait « déjà importé » et n'écrivait rien du tout.
    expect(await etat()).toEqual({ articles: 0, fiches: 1, ingredients: 0 });
  });

  it("--force seul ne la détruit PAS et dit nommément ce qui serait perdu", async () => {
    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("ABANDON");
    expect(r.message).toContain('--supprimer "Bolognaise"');
    const survivante = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Bolognaise" } });
    expect(survivante.nbPortions).toBe(4); // intacte
    expect(survivante.categorie).toBe("Ma carte");
  });

  it("--supprimer \"<nom>\" autorise nommément le remplacement", async () => {
    const r = await ecrireEnBase(client(), res, { force: true, supprimerNommement: ["Bolognaise"] });
    expect(r.statut).toBe("IMPORTE");
    expect(await etat()).toEqual({ articles: 8, fiches: 2, ingredients: 9 });
    const remplacee = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Bolognaise" } });
    expect(remplacee.nbPortions).toBe(1); // valeur du classeur
  });
});

describe("l'homonymie se détecte par DÉSIGNATION NORMALISÉE (comme les articles), pas au caractère près", () => {
  beforeAll(vider);

  it("une « BOLOGNAISE » (majuscules) saisie à la main bloque l'import au lieu de créer un doublon en silence", async () => {
    await prisma.ficheTechnique.create({ data: { nom: "BOLOGNAISE", nbPortions: 6, categorie: "Ma carte" } });
    const r = await ecrireEnBase(client(), res, { force: false });
    expect(r.statut).toBe("ABANDON");
    expect(r.fichesProtegees).toEqual(["BOLOGNAISE"]);
    // Un seul « bolognaise », sous quelque casse que ce soit : pas de doublon créé en silence
    // (c'était le bug : `where: nom: in [...]` exact ne trouvait pas « BOLOGNAISE » et laissait
    // passer l'import, qui créait alors une seconde fiche « Bolognaise »).
    const toutes = await prisma.ficheTechnique.findMany({
      where: { nom: { contains: "olognaise", mode: "insensitive" } },
    });
    expect(toutes).toHaveLength(1);
  });

  it("--force ne la détruit pas non plus : le contenu diffère (nom et portions), l'empreinte le voit", async () => {
    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("ABANDON");
    expect(r.message).toContain('--supprimer "BOLOGNAISE"');
    const survivante = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "BOLOGNAISE" } });
    expect(survivante.nbPortions).toBe(6); // intacte
  });
});

describe("l'empreinte est sensible à `type` et `actif` (angles morts corrigés)", () => {
  beforeAll(async () => {
    await vider();
    await ecrireEnBase(client(), res, { force: false });
  });

  it("une fiche typée BAR mais au contenu par ailleurs identique n'est PAS conforme — --force ABANDONNE, ne détruit pas", async () => {
    await prisma.ficheTechnique.updateMany({ where: { nom: "Bolognaise" }, data: { type: "BAR" } });
    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("ABANDON");
    expect(r.fichesProtegees).toEqual(["Bolognaise"]);
    const survivante = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Bolognaise" } });
    expect(survivante.type).toBe("BAR"); // intacte : pas ramenée à PLAT en silence
  });

  it("une fiche DÉSACTIVÉE mais au contenu par ailleurs identique n'est pas non plus conforme", async () => {
    await prisma.ficheTechnique.updateMany({ where: { nom: "Bolognaise" }, data: { type: "PLAT", actif: false } });
    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("ABANDON");
    expect(r.fichesProtegees).toEqual(["Bolognaise"]);
    const survivante = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Bolognaise" } });
    expect(survivante.actif).toBe(false); // intacte : pas réactivée en silence
  });
});

describe("une fiche HORS classeur qui cite une sous-recette bloque proprement", () => {
  beforeAll(async () => {
    await vider();
    await ecrireEnBase(client(), res, { force: false });
  });

  it("refuse de supprimer la sous-recette et explique, au lieu d'une erreur de clé étrangère", async () => {
    const sauce = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Sauce bolognaise" } });
    const maison = await prisma.ficheTechnique.create({ data: { nom: "Lasagne du chef", nbPortions: 2 } });
    await prisma.ingredientFiche.create({
      data: { ficheId: maison.id, sousFicheId: sauce.id, unite: "cl", quantite: 100, ordre: 1 },
    });

    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("ABANDON");
    expect(r.message).toContain("onDelete: Restrict");
    expect(r.fichesProtegees).toEqual(["Sauce bolognaise"]);
    // La fiche maison et sa ligne sont intactes.
    expect(await prisma.ingredientFiche.count({ where: { ficheId: maison.id } })).toBe(1);
  });
});

describe("écrasement des prix d'articles par le classeur", () => {
  beforeAll(async () => {
    await vider();
    await ecrireEnBase(client(), res, { force: false });
    // La Direction corrige les pennes DANS L'APPLICATION (0,35 → 3,50 $/kg).
    await prisma.articleStock.updateMany({
      where: { designation: { startsWith: "20 PENNE" } },
      data: { prixUnitaireUSD: "3.5" },
    });
  });

  it("--force ramène le prix corrigé à la valeur du classeur, mais le LISTE avant/après", async () => {
    const r = await ecrireEnBase(client(), res, { force: true });
    expect(r.statut).toBe("IMPORTE");
    const ecrase = r.ecrasementsPrix.find((e) => e.designation.startsWith("20 PENNE"))!;
    expect(ecrase).toMatchObject({ champ: "prix à l'unité", avant: "3.5", apres: "0.35" });
    const penne = await prisma.articleStock.findFirstOrThrow({ where: { designation: { startsWith: "20 PENNE" } } });
    expect(penne.prixUnitaireUSD?.toString()).toBe("0.35");
  });

  it("--conserver-prix-existants préserve la correction de la Direction ET LE DIT (pas de silence)", async () => {
    await prisma.articleStock.updateMany({
      where: { designation: { startsWith: "20 PENNE" } },
      data: { prixUnitaireUSD: "3.5" },
    });
    const r = await ecrireEnBase(client(), res, { force: true, conserverPrixExistants: true });
    expect(r.statut).toBe("IMPORTE");
    // Le prix n'est plus écrasé...
    expect(r.ecrasementsPrix.filter((e) => e.champ === "prix à l'unité")).toEqual([]);
    // ...mais l'écart base ≠ classeur n'est pas pour autant passé sous silence : il est listé
    // ailleurs, sous un intitulé distinct.
    const conserve = r.prixConserves.find((p) => p.designation.startsWith("20 PENNE") && p.champ === "prix à l'unité");
    expect(conserve).toMatchObject({ base: "3.5", classeur: "0.35" });
    const penne = await prisma.articleStock.findFirstOrThrow({ where: { designation: { startsWith: "20 PENNE" } } });
    expect(penne.prixUnitaireUSD?.toString()).toBe("3.5");
  });
});

describe("articles préexistants", () => {
  beforeAll(vider);

  it("ne reclasse jamais le domaine d'un article déjà au catalogue", async () => {
    await prisma.articleStock.create({ data: { designation: "Vin rouge", domaine: "BOISSON", unite: "Bouteille" } });
    const r = await ecrireEnBase(client(), res, { force: false });
    expect(r.statut).toBe("IMPORTE");
    expect(r.articlesCrees).toBe(7);
    expect(r.articlesMisAJour).toBe(1);
    const vin = await prisma.ficheTechnique.count(); // sanity
    expect(vin).toBe(2);
    const article = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Vin rouge" } });
    expect(article.domaine).toBe("BOISSON"); // conservé
    expect(article.prixUnitaireUSD?.toString()).toBe("9"); // prix mis à jour, lui
  });

  it("l'empreinte de conformité colle à ce que l'import écrit (sinon --force refuserait tout)", async () => {
    const enBase = await prisma.ficheTechnique.findMany({ select: SELECT_FICHE_SIGNATURE });
    expect(enBase).toHaveLength(2);
    const r = await ecrireEnBase(client(), res, { force: false });
    expect(r.statut).toBe("DEJA_FAIT"); // conformes ⇒ pas d'abandon, pas de doublon
  });
});

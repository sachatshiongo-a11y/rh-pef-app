import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import {
  analyserClasseur,
  articlesACreer,
  chargerCorrespondances,
  distanceChaine,
  indexerCorrespondances,
  planifierFichesSeules,
  projeterCatalogue,
  simulerCoutsFichesSeules,
  simulerFichesSeules,
  uniteSeConvertit,
  validerCorrespondances,
  type ArticleCatalogue,
  type ClientLectureSeule,
  type SessionLectureSeule,
} from "./import-fiches-plats";
import { BOLOGNAISE, feuille, LISTE_ARTICLES, SAUCE_BOLOGNAISE } from "./_fixture-classeur-fiches";

/**
 * Tests PURS du mode `--fiches-seules` : aucune base, aucune connexion. Ils portent sur la
 * DÉCISION (quelles fiches sont créables, lesquelles sont refusées et pourquoi, quels articles
 * manquent et dans quel ordre), que le test d'intégration se contente ensuite d'exécuter.
 *
 * Le catalogue est ici celui de la BASE CIBLE — délibérément différent de la liste d'articles du
 * classeur : c'est tout l'objet du mode. Le classeur ne sert qu'à décrire les fiches.
 */

/** Catalogue cible « idéal » : tous les articles consommés par le classeur synthétique. */
const CATALOGUE_COMPLET: ArticleCatalogue[] = [
  { id: "a1", designation: "20 PENNE RIGATE LM CHEF 12 X 1KG", unite: "Kg", prixUnitaireUSD: new Decimal("0.35") },
  { id: "a2", designation: "LAIT ELLE & VIRE ENTIER RED 1LTR", unite: "L", prixUnitaireUSD: new Decimal("2.5") },
  { id: "a3", designation: "Viande Hachée", unite: "Kg", prixUnitaireUSD: new Decimal("8.07") },
  { id: "a4", designation: "Tomates pêlées 240g", unite: "Pièce", prixUnitaireUSD: new Decimal("1.34") },
  { id: "a5", designation: "Tomates concentrées", unite: "Pièce", prixUnitaireUSD: new Decimal("0.21") },
  { id: "a6", designation: "Vin rouge", unite: "Bouteille", prixUnitaireUSD: new Decimal("9") },
  { id: "a7", designation: "Huile 1L régina", unite: "L", prixUnitaireUSD: new Decimal("2.492") },
  { id: "a8", designation: "Carottes", unite: "kg", prixUnitaireUSD: new Decimal("4.58") },
];

const sans = (...designations: string[]) =>
  CATALOGUE_COMPLET.filter((a) => !designations.includes(a.designation));

const res = () => analyserClasseur({
  SheetNames: ["Sauce bolognaise", "Bolognaise", "Liste des articles"],
  Sheets: { "Sauce bolognaise": SAUCE_BOLOGNAISE, Bolognaise: BOLOGNAISE, "Liste des articles": LISTE_ARTICLES },
});

describe("planifierFichesSeules — quelles fiches sont créables", () => {
  it("catalogue complet : toutes les fiches sont créables, sous-recettes en tête", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET);
    expect(plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(plan.refusees).toEqual([]);
    expect(plan.articlesManquants).toEqual([]);
  });

  it("le rattachement se fait sur le CATALOGUE CIBLE, pas sur la liste d'articles du classeur", () => {
    // Le classeur donne les pennes à 0,35 $ ; la base, elle, les a corrigées à 3,50 $. C'est la
    // base qui doit servir — le mode fiches seules ne réimporte JAMAIS un prix du classeur.
    const catalogue = CATALOGUE_COMPLET.map((a) =>
      a.designation.startsWith("20 PENNE") ? { ...a, prixUnitaireUSD: new Decimal("3.5") } : a,
    );
    const plan = planifierFichesSeules(res(), catalogue);
    const ligne = plan.lignes.find((l) => l.ingredient.designation.startsWith("20 PENNE"))!;
    expect(ligne.rattachement.type).toBe("ARTICLE");
    expect(
      ligne.rattachement.type === "ARTICLE" ? ligne.rattachement.article.prixUnitaireUSD?.toString() : null,
    ).toBe("3.5");
  });

  it("un article introuvable fait refuser SA fiche, nommément", () => {
    const plan = planifierFichesSeules(res(), sans("20 PENNE RIGATE LM CHEF 12 X 1KG"));
    expect(plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise"]);
    expect(plan.refusees).toEqual([
      {
        nom: "Bolognaise",
        onglet: "Bolognaise",
        articlesManquants: ["20 PENNE RIGATE LM CHEF 12 X 1KG"],
        sousRecettesRefusees: [],
      },
    ]);
  });

  it("une sous-recette refusée fait refuser, EN CASCADE, les fiches qui la citent", () => {
    // « Carottes » n'appartient qu'à la sous-recette. « Bolognaise » a pourtant tous SES articles.
    const plan = planifierFichesSeules(res(), sans("Carottes"));
    expect(plan.creables).toEqual([]);
    expect(plan.refusees.map((f) => f.nom).sort()).toEqual(["Bolognaise", "Sauce bolognaise"]);
    const bolo = plan.refusees.find((f) => f.nom === "Bolognaise")!;
    expect(bolo.articlesManquants).toEqual([]); // ses propres articles sont bien là
    expect(bolo.sousRecettesRefusees).toEqual(["Sauce bolognaise"]);
  });

  it("deux articles du catalogue de même désignation normalisée : signalés, jamais fusionnés en silence", () => {
    const plan = planifierFichesSeules(res(), [
      ...CATALOGUE_COMPLET,
      { id: "z9", designation: "carottes", unite: "kg", prixUnitaireUSD: new Decimal("99") },
    ]);
    expect(plan.ambiguitesCatalogue).toHaveLength(1);
    expect(plan.ambiguitesCatalogue[0]!.cle).toBe("carottes");
    expect(plan.ambiguitesCatalogue[0]!.designations.sort()).toEqual(["Carottes", "carottes"]);
    expect(plan.creables).toHaveLength(2); // l'ambiguïté ne bloque pas, elle se dit

    // Le rattachement est DÉTERMINISTE (tri désignation puis id) : deux exécutions de suite
    // choisissent le même article, jamais l'un puis l'autre.
    const choisi = () => {
      const p = planifierFichesSeules(res(), [
        { id: "z9", designation: "carottes", unite: "kg", prixUnitaireUSD: new Decimal("99") },
        ...CATALOGUE_COMPLET,
      ]);
      const l = p.lignes.find((x) => x.ingredient.cle === "carottes")!;
      return l.rattachement.type === "ARTICLE" ? l.rattachement.article.id : null;
    };
    expect(choisi()).toBe(choisi());
  });
});

describe("liste de travail des articles manquants", () => {
  /** Troisième fiche, qui consomme « Carottes » elle aussi : de quoi trier par usage. */
  const POULET = feuille({
    B9: "FICHE TECHNIQUE",
    B11: "Volailles",
    B13: "Poulet aux carottes",
    B15: "Nombre de portions :", C15: 4,
    B20: "Article", C20: "Unité", D20: "Unités nécessaires",
    B21: "Carottes", C21: "kg", D21: 0.5,
    B22: "Vin rouge", C22: "Bouteille", D22: 1,
    B25: "Total prix de revient HT", F25: 0,
  });

  const resTrois = () => analyserClasseur({
    SheetNames: ["Sauce bolognaise", "Bolognaise", "Poulet aux carottes", "Liste des articles"],
    Sheets: {
      "Sauce bolognaise": SAUCE_BOLOGNAISE,
      Bolognaise: BOLOGNAISE,
      "Poulet aux carottes": POULET,
      "Liste des articles": LISTE_ARTICLES,
    },
  } as XLSX.WorkBook);

  it("dédoublonne et trie DU PLUS UTILISÉ AU MOINS UTILISÉ", () => {
    const plan = planifierFichesSeules(resTrois(), sans("Carottes", "Vin rouge"));
    // « Carottes » : 2 lignes (sauce + poulet). « Vin rouge » : 2 lignes aussi… donc on départage
    // à la désignation. Un article n'apparaît qu'UNE fois, avec le compte de ses occurrences.
    expect(plan.articlesManquants.map((a) => [a.designation, a.occurrences])).toEqual([
      ["Carottes", 2],
      ["Vin rouge", 2],
    ]);
    expect(plan.articlesManquants[0]!.fiches).toEqual(["Sauce bolognaise", "Poulet aux carottes"]);
  });

  it("le plus utilisé passe devant, quel que soit l'ordre alphabétique", () => {
    const plan = planifierFichesSeules(resTrois(), sans("Carottes", "Tomates concentrées"));
    expect(plan.articlesManquants.map((a) => a.designation)).toEqual(["Carottes", "Tomates concentrées"]);
    expect(plan.articlesManquants.map((a) => a.occurrences)).toEqual([2, 1]);
  });
});

describe("sosies — une SUGGESTION à vérifier, jamais une décision", () => {
  it("propose l'article le plus proche quand il en existe un", () => {
    const catalogue = [...sans("Carottes"), { id: "x1", designation: "Carotte", unite: "kg", prixUnitaireUSD: new Decimal("4.5") }];
    const plan = planifierFichesSeules(res(), catalogue);
    const manquant = plan.articlesManquants.find((a) => a.designation === "Carottes")!;
    expect(manquant.sosie?.designation).toBe("Carotte");
    expect(manquant.sosie?.distance).toBe(1);
    expect(manquant.sosie?.conditionnementDifferent).toBe(false);
    // La suggestion ne rattache RIEN : la fiche reste refusée tant qu'un humain n'a pas tranché.
    expect(plan.creables).toEqual([]);
  });

  it("« Huile 1L régina » et « Huile 5L régina » : un caractère d'écart, DEUX conditionnements", () => {
    const catalogue = [
      ...sans("Huile 1L régina"),
      { id: "x2", designation: "Huile 5L régina", unite: "L", prixUnitaireUSD: new Decimal("11") },
    ];
    const plan = planifierFichesSeules(res(), catalogue);
    const manquant = plan.articlesManquants.find((a) => a.designation === "Huile 1L régina")!;
    expect(manquant.sosie?.designation).toBe("Huile 5L régina");
    expect(manquant.sosie?.distance).toBe(1);
    expect(manquant.sosie?.conditionnementDifferent).toBe(true); // 1 L ≠ 5 L : pas le même article
  });

  it("un préfixe de code ne change pas le conditionnement (le sosie reste proposable sans alerte)", () => {
    // Cas réel : « 15 SPAGHETTI LM CHEF 12 X 1KG » (classeur) contre « Spaghetti Lm Chef 12 X 1KG »
    // (base). Même conditionnement (1 kg) : c'est très probablement le même article — à confirmer.
    const SPAGHETTI = feuille({
      B9: "FICHE TECHNIQUE",
      B13: "Spaghetti nature",
      B15: "Nombre de portions :", C15: 1,
      B20: "Article", C20: "Unité", D20: "Unités nécessaires",
      B21: "15 SPAGHETTI LM CHEF 12 X 1KG", C21: "Kg", D21: 0.2,
      B24: "Total prix de revient HT", F24: 0,
    });
    const r = analyserClasseur({
      SheetNames: ["Spaghetti nature", "Liste des articles"],
      Sheets: { "Spaghetti nature": SPAGHETTI, "Liste des articles": LISTE_ARTICLES },
    } as XLSX.WorkBook);
    const plan = planifierFichesSeules(r, [
      { id: "s1", designation: "Spaghetti Lm Chef 12 X 1KG", unite: "Kg", prixUnitaireUSD: new Decimal("1.2") },
    ]);
    const manquant = plan.articlesManquants[0]!;
    expect(manquant.sosie?.designation).toBe("Spaghetti Lm Chef 12 X 1KG");
    expect(manquant.sosie?.conditionnementDifferent).toBe(false);
    expect(plan.creables).toEqual([]); // suggéré, PAS rattaché
  });

  it("ne propose rien quand rien ne ressemble", () => {
    const catalogue = [...sans("Carottes"), { id: "x3", designation: "Papier aluminium", unite: "Rouleau", prixUnitaireUSD: new Decimal("3") }];
    const plan = planifierFichesSeules(res(), catalogue);
    expect(plan.articlesManquants.find((a) => a.designation === "Carottes")!.sosie).toBeNull();
  });

  it("distanceChaine reste une distance de Levenshtein ordinaire", () => {
    expect(distanceChaine("carottes", "carottes")).toBe(0);
    expect(distanceChaine("carottes", "carotte")).toBe(1);
    expect(distanceChaine("", "abc")).toBe(3);
    expect(distanceChaine("abc", "")).toBe(3);
    expect(distanceChaine("chat", "chien")).toBe(3);
  });
});

describe("coût des fiches créables, chiffré par le VRAI moteur sur le catalogue cible", () => {
  it("catalogue complet et prix renseignés : coût complet", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET);
    const couts = simulerCoutsFichesSeules(plan);
    expect(couts.map((c) => c.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(couts.every((c) => !c.incomplet)).toBe(true);
  });

  it("un article du catalogue SANS prix sort en coût partiel, avec le motif", () => {
    const catalogue = CATALOGUE_COMPLET.map((a) =>
      a.designation === "Carottes" ? { ...a, prixUnitaireUSD: null } : a,
    );
    const plan = planifierFichesSeules(res(), catalogue);
    const sauce = simulerCoutsFichesSeules(plan).find((c) => c.nom === "Sauce bolognaise")!;
    expect(sauce.incomplet).toBe(true);
    expect(sauce.motifs.join(" ")).toContain("Carottes");
    // La fiche est tout de même CRÉÉE : l'ingrédient existe et sera visible à l'écran, seul son
    // prix manque — c'est le cas que l'application sait annoncer (« coût incomplet »).
    expect(plan.creables.map((f) => f.nom)).toContain("Sauce bolognaise");
  });

  it("le coût suit le prix DE LA BASE et non celui du classeur", () => {
    const cher = CATALOGUE_COMPLET.map((a) =>
      a.designation.startsWith("20 PENNE") ? { ...a, prixUnitaireUSD: new Decimal("3.5") } : a,
    );
    const auClasseur = simulerCoutsFichesSeules(planifierFichesSeules(res(), CATALOGUE_COMPLET))
      .find((c) => c.nom === "Bolognaise")!;
    const enBase = simulerCoutsFichesSeules(planifierFichesSeules(res(), cher))
      .find((c) => c.nom === "Bolognaise")!;
    expect(new Decimal(enBase.coutParPortion!).greaterThan(auClasseur.coutParPortion!)).toBe(true);
  });
});

// ─── La vérification de lecture seule doit MORDRE ────────────────────────────
//
// Ces tests-là ne touchent aucune base : ils remplacent PostgreSQL par des doublures qui MENTENT
// (le `SET` ne fait rien, le `SHOW` répond « off », la session change de backend d'une requête à
// l'autre). Sans eux, la garantie de lecture seule ne vaudrait rien : on ne saurait pas que la
// vérification refuse — seulement qu'elle passe quand tout va bien.

type TxLecture = Parameters<Parameters<ClientLectureSeule["$transaction"]>[0]>[0];

/** Transaction menteuse : le `SET TRANSACTION READ ONLY` n'a aucun effet, `SHOW` l'avoue. */
function clientTransaction(drapeau: string, lectures: string[]): ClientLectureSeule {
  const tx = {
    $executeRawUnsafe: async () => 0, // le SET ne fait RIEN
    $queryRawUnsafe: async (sql: string) =>
      sql.includes("transaction_read_only") ? [{ transaction_read_only: drapeau }] : [{ pid: "4242" }],
    articleStock: {
      findMany: async () => {
        lectures.push("articleStock");
        return [];
      },
    },
    ficheTechnique: {
      findMany: async () => {
        lectures.push("ficheTechnique");
        return [];
      },
    },
  } as unknown as TxLecture;
  return { $transaction: async (fn) => fn(tx) as never };
}

/** Session menteuse : drapeau paramétrable, et backend PID paramétrable requête après requête. */
function sessionStub(options: { drapeaux: string[]; pids: string[]; lectures: string[] }): SessionLectureSeule {
  let iDrapeau = 0;
  let iPid = 0;
  const suivant = (liste: string[], i: number) => liste[Math.min(i, liste.length - 1)]!;
  return {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: (async (sql: string) =>
      sql.includes("transaction_read_only")
        ? [{ transaction_read_only: suivant(options.drapeaux, iDrapeau++) }]
        : [{ pid: suivant(options.pids, iPid++) }]) as SessionLectureSeule["$queryRawUnsafe"],
    articleStock: {
      findMany: async () => {
        options.lectures.push("articleStock");
        return [];
      },
    },
    ficheTechnique: {
      findMany: async () => {
        options.lectures.push("ficheTechnique");
        return [];
      },
    },
  };
}

const silence = () => {};

/** Renvoie le message du refus attendu — et échoue si la simulation NE refuse PAS. */
async function messageDeRefus(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("La simulation aurait dû REFUSER de tourner, elle a abouti.");
}

describe("la vérification du drapeau de lecture seule REFUSE de continuer", () => {
  it("niveau 1 : « SHOW transaction_read_only » ≠ on ⇒ refus, AVANT la moindre lecture", async () => {
    const lectures: string[] = [];
    const refus = await messageDeRefus(
      simulerFichesSeules(clientTransaction("off", lectures), res(), { journal: silence }),
    );
    expect(refus).toContain("REFUS :");
    expect(refus).toContain("« SHOW transaction_read_only » vaut « off »");
    expect(lectures).toEqual([]); // rien n'a été lu : on s'arrête avant
  });

  it("un REFUS de la base n'ouvre AUCUN repli — on ne contourne pas un « non »", async () => {
    const lectures: string[] = [];
    let repliTente = false;
    await expect(
      simulerFichesSeules(clientTransaction("off", lectures), res(), {
        journal: silence,
        sessionDediee: async () => {
          repliTente = true;
          throw new Error("le repli n'aurait jamais dû être tenté");
        },
      }),
    ).rejects.toThrow(/REFUS/);
    expect(repliTente).toBe(false);
    expect(lectures).toEqual([]);
  });

  it("niveau 1 indisponible et AUCUNE session dédiée fournie ⇒ refus, pas de lecture nue", async () => {
    const client: ClientLectureSeule = { $transaction: () => Promise.reject(new Error("P2028 pooler")) };
    const refus = await messageDeRefus(simulerFichesSeules(client, res(), { journal: silence }));
    expect(refus).toContain("aucune session dédiée n'est disponible");
    expect(refus).toContain("On ne lit pas sans garantie de lecture seule");
  });
});

describe("repli de niveau 2 — la session dédiée est vérifiée, pas supposée", () => {
  /** Client dont la transaction interactive est refusée par le pooler, comme en production. */
  const poolerSansTransaction = (): ClientLectureSeule => ({
    $transaction: () =>
      Promise.reject(
        Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), {
          code: "P2028",
        }),
      ),
  });

  it("session bien en lecture seule et backend STABLE : la simulation aboutit, et le dit", async () => {
    const lectures: string[] = [];
    const journal: string[] = [];
    const sim = await simulerFichesSeules(poolerSansTransaction(), res(), {
      journal: (m) => journal.push(m),
      sessionDediee: async () => ({
        session: sessionStub({ drapeaux: ["on"], pids: ["7777"], lectures }),
        fermer: async () => {},
      }),
    });
    expect(sim.protection).toBe("SESSION_READ_ONLY");
    expect(sim.backendPid).toBe("7777");
    expect(sim.motifRepli).toContain("Unable to start a transaction");
    expect(lectures).toEqual(["articleStock", "ficheTechnique"]);
    expect(journal.join("\n")).toContain("SESSION DÉDIÉE");
  });

  it("le `SET SESSION` n'a pas pris (drapeau « off ») ⇒ refus, AVANT la moindre lecture", async () => {
    const lectures: string[] = [];
    const refus = await messageDeRefus(
      simulerFichesSeules(poolerSansTransaction(), res(), {
        journal: silence,
        sessionDediee: async () => ({
          session: sessionStub({ drapeaux: ["off"], pids: ["7777"], lectures }),
          fermer: async () => {},
        }),
      }),
    );
    expect(refus).toContain("REFUS :");
    expect(refus).toContain("session dédiée");
    expect(refus).toContain("vaut « off »");
    expect(lectures).toEqual([]);
  });

  it("le backend CHANGE entre le SET et la vérification (pooler en mode transaction) ⇒ refus", async () => {
    // C'est le piège annoncé : le SET s'applique à une session, les lectures à une autre. Le
    // « SHOW » dirait « on » et ne prouverait pourtant RIEN. Le PID, lui, le trahit.
    const lectures: string[] = [];
    const refus = await messageDeRefus(
      simulerFichesSeules(poolerSansTransaction(), res(), {
        journal: silence,
        sessionDediee: async () => ({
          session: sessionStub({ drapeaux: ["on"], pids: ["1000", "2000"], lectures }),
          fermer: async () => {},
        }),
      }),
    );
    expect(refus).toContain("REFUS :");
    expect(refus).toContain("CHANGÉ de session serveur");
    expect(refus).toContain("backend 1000 puis 2000");
    expect(lectures).toEqual([]); // refus AVANT de lire
  });

  it("le backend change PENDANT les lectures ⇒ refus (aucun rapport sur une protection discontinue)", async () => {
    const lectures: string[] = [];
    const refus = await messageDeRefus(
      simulerFichesSeules(poolerSansTransaction(), res(), {
        journal: silence,
        sessionDediee: async () => ({
          session: sessionStub({ drapeaux: ["on"], pids: ["1000", "1000", "3000"], lectures }),
          fermer: async () => {},
        }),
      }),
    );
    expect(refus).toContain("REFUS :");
    expect(refus).toContain("PENDANT les lectures");
  });

  it("le drapeau retombe APRÈS les lectures ⇒ refus (il devait tenir de bout en bout)", async () => {
    const lectures: string[] = [];
    const refus = await messageDeRefus(
      simulerFichesSeules(poolerSansTransaction(), res(), {
        journal: silence,
        sessionDediee: async () => ({
          session: sessionStub({ drapeaux: ["on", "off"], pids: ["1000"], lectures }),
          fermer: async () => {},
        }),
      }),
    );
    expect(refus).toContain("REFUS :");
    expect(refus).toContain("contrôle final");
  });

  it("la session dédiée est TOUJOURS fermée, même quand la vérification refuse", async () => {
    let fermee = 0;
    await expect(
      simulerFichesSeules(poolerSansTransaction(), res(), {
        journal: silence,
        sessionDediee: async () => ({
          session: sessionStub({ drapeaux: ["off"], pids: ["1"], lectures: [] }),
          fermer: async () => {
            fermee++;
          },
        }),
      }),
    ).rejects.toThrow(/REFUS/);
    expect(fermee).toBe(1); // rien ne survit à la simulation, pas même une session refusée
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CORRESPONDANCES ARBITRÉES + CRÉATION CIBLÉE — tests PURS (aucune base)
// ═════════════════════════════════════════════════════════════════════════════

describe("table de correspondances — validation, et refus de tout ce qui est ambigu", () => {
  const une = (classeur: string, catalogue: string) => ({ classeur, catalogue, motif: "parce que." });

  it("accepte une table bien formée et rend les entrées nettoyées", () => {
    const entrees = validerCorrespondances(
      { correspondances: [{ classeur: "  A  ", catalogue: " B ", motif: " parce que. " }] },
      "test",
    );
    expect(entrees).toEqual([{ classeur: "A", catalogue: "B", motif: "parce que." }]);
  });

  it("refuse une racine qui n'est pas un objet avec un tableau « correspondances »", () => {
    expect(() => validerCorrespondances([], "test")).toThrow(/tableau « correspondances »/);
    expect(() => validerCorrespondances(null, "test")).toThrow(/tableau « correspondances »/);
    expect(() => validerCorrespondances({ correspondances: {} }, "test")).toThrow(/tableau/);
  });

  it("refuse une entrée sans motif : une correspondance sans raison écrite n'est pas relisible", () => {
    expect(() =>
      validerCorrespondances({ correspondances: [{ classeur: "A", catalogue: "B" }] }, "test"),
    ).toThrow(/n'a pas de « motif »/);
    expect(() =>
      validerCorrespondances({ correspondances: [{ classeur: "A", catalogue: "B", motif: "   " }] }, "test"),
    ).toThrow(/motif/);
  });

  it("refuse une entrée incomplète, en la SITUANT", () => {
    expect(() =>
      validerCorrespondances({ correspondances: [une("A", "B"), { classeur: "C" }] }, "test"),
    ).toThrow(/entrée n°2/);
  });

  it("refuse une correspondance vers elle-même (sans effet, donc probablement une faute)", () => {
    expect(() => validerCorrespondances({ correspondances: [une("Lard Fumé", "LARD FUME")] }, "test")).toThrow(
      /pointe « Lard Fumé » sur lui-même/,
    );
  });

  it("refuse DEUX entrées pour la même désignation de classeur : on ne tranche pas à la place de la Direction", () => {
    expect(() =>
      validerCorrespondances({ correspondances: [une("A", "B"), une("a", "C")] }, "test"),
    ).toThrow(/figure DEUX FOIS/);
  });

  it("refuse un chaînage A → B → C : les correspondances ne se résolvent jamais en chaîne", () => {
    expect(() =>
      validerCorrespondances({ correspondances: [une("A", "B"), une("B", "C")] }, "test"),
    ).toThrow(/JAMAIS en\s+chaîne|jamais en chaîne|chaîne/);
  });

  it("le FICHIER VERSIONNÉ du dépôt est valide, et porte les 15 arbitrages de la Direction", () => {
    // Il est relu par la Direction : ce test le protège d'une faute de saisie qui passerait
    // inaperçue jusqu'à l'import.
    const entrees = chargerCorrespondances();
    expect(entrees).toHaveLength(15);
    expect(entrees.every((e) => e.motif.length > 10)).toBe(true);
    const parClasseur = new Map(entrees.map((e) => [e.classeur, e.catalogue]));
    expect(parClasseur.get("Vinaigre Bamsamique")).toBe("Vinaigre Balsamique");
    expect(parClasseur.get("JAMBON CUIT 1KG")).toBe("Jambon Cuit Épaule");
    expect(parClasseur.get("Tomates pêlées 240g")).toBe("Tomates pêlées");
    // Aucune des cibles ne réintroduit un conditionnement que la Direction a explicitement retiré.
    expect(parClasseur.get("FILET DE CAPITAINE 1KG")).toBe("Filet de Capitaine");
  });

  it("indexerCorrespondances rapproche par désignation NORMALISÉE (accents et casse indifférents)", () => {
    const index = indexerCorrespondances([une("LARD FUMÉ 1KG", "Lard Fumé")]);
    expect(index.get("lard fume 1kg")?.catalogue).toBe("Lard Fumé");
  });
});

describe("correspondances appliquées au rattachement — l'ARTICLE DU CATALOGUE fait foi", () => {
  /** Le catalogue de la base : pas de conditionnement dans les noms, et des prix à lui. */
  const CATALOGUE_SANS_CONDITIONNEMENT: ArticleCatalogue[] = [
    ...sans("Tomates pêlées 240g", "20 PENNE RIGATE LM CHEF 12 X 1KG"),
    { id: "b1", designation: "Tomates pêlées", unite: "Pièce", prixUnitaireUSD: new Decimal("1.9") },
    { id: "b2", designation: "Penne Rigate Lm Chef 12 X 1KG", unite: "Kg", prixUnitaireUSD: new Decimal("3.5") },
  ];

  const ARBITRAGES = [
    { classeur: "Tomates pêlées 240g", catalogue: "Tomates pêlées", motif: "conditionnement précisé au classeur." },
    {
      classeur: "20 PENNE RIGATE LM CHEF 12 X 1KG",
      catalogue: "Penne Rigate Lm Chef 12 X 1KG",
      motif: "code article en préfixe.",
    },
  ];

  it("l'ingrédient pointe l'article EXISTANT, avec SON unité et SON prix", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_SANS_CONDITIONNEMENT, { correspondances: ARBITRAGES });
    expect(plan.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
    expect(plan.articlesManquants).toEqual([]);

    const ligne = plan.lignes.find((l) => l.ingredient.designation.startsWith("Tomates pêlées"))!;
    expect(ligne.rattachement.type).toBe("ARTICLE");
    const article = ligne.rattachement.type === "ARTICLE" ? ligne.rattachement.article : null;
    expect(article?.designation).toBe("Tomates pêlées"); // celui de la BASE, pas celui du classeur
    expect(article?.prixUnitaireUSD?.toString()).toBe("1.9"); // le prix de la BASE fait foi
    expect(article?.id).toBe("b1");
  });

  it("le rapport dit QUELLE correspondance a servi, combien de fois, et pourquoi", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_SANS_CONDITIONNEMENT, { correspondances: ARBITRAGES });
    const penne = plan.correspondancesAppliquees.find((c) => c.entree.classeur.startsWith("20 PENNE"))!;
    expect(penne.article.designation).toBe("Penne Rigate Lm Chef 12 X 1KG");
    expect(penne.occurrences).toBe(1);
    expect(penne.entree.motif).toBe("code article en préfixe.");
    expect(penne.unitesRecette).toEqual(["Kg"]);
  });

  it("une correspondance dont la CIBLE N'EXISTE PAS fait ÉCHOUER le plan, en la nommant", () => {
    // C'est la protection contre le doublon : sans elle, l'ingrédient retomberait dans les
    // « manquants » et --creer-articles-manquants créerait un second « Tomates pêlées ».
    expect(() =>
      planifierFichesSeules(res(), sans("Tomates pêlées 240g"), {
        correspondances: [
          { classeur: "Tomates pêlées 240g", catalogue: "Tomates pêlées", motif: "conditionnement." },
        ],
      }),
    ).toThrow(/« Tomates pêlées 240g » → « Tomates pêlées » \(INTROUVABLE au catalogue\)/);
  });

  it("une correspondance INUTILISÉE ne bloque rien, mais elle est SIGNALÉE", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET, {
      correspondances: [{ classeur: "Ceci n'est dans aucune fiche", catalogue: "Carottes", motif: "test." }],
    });
    expect(plan.creables).toHaveLength(2);
    expect(plan.correspondancesInutilisees).toEqual([
      {
        entree: { classeur: "Ceci n'est dans aucune fiche", catalogue: "Carottes", motif: "test." },
        cibleAuCatalogue: true,
      },
    ]);
  });

  it("une correspondance dont la cible est absente ET la source inutilisée : signalée, pas fatale", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET, {
      correspondances: [{ classeur: "Inexistant au classeur", catalogue: "Inexistant en base", motif: "test." }],
    });
    expect(plan.correspondancesInutilisees[0]!.cibleAuCatalogue).toBe(false);
  });

  it("la sous-recette garde la PRIORITÉ : une correspondance ne la détourne pas", () => {
    const plan = planifierFichesSeules(res(), CATALOGUE_COMPLET, {
      correspondances: [{ classeur: "Sauce bolognaise", catalogue: "Carottes", motif: "piège." }],
    });
    const ligne = plan.lignes.find((l) => l.ingredient.cle === "sauce bolognaise")!;
    expect(ligne.rattachement.type).toBe("SOUS_RECETTE");
    expect(plan.correspondancesInutilisees).toHaveLength(1); // et l'entrée est signalée comme inerte
  });
});

describe("unités qui ne se convertiront pas — SIGNALÉES, jamais devinées", () => {
  it("catalogue en « Pièce » contre recette en « g » : coût partiel annoncé, motif nommé", () => {
    // Exactement le risque de la règle « le conditionnement disparaît du nom » : « Tomates pêlées
    // 240g » consommé à la pièce, mais un catalogue qui compterait en grammes (ou l'inverse).
    const catalogue = CATALOGUE_COMPLET.map((a) =>
      a.designation === "Carottes" ? { ...a, unite: "Pièce" } : a,
    );
    const plan = planifierFichesSeules(res(), catalogue);
    expect(plan.unitesNonConvertibles).toHaveLength(1);
    expect(plan.unitesNonConvertibles[0]).toMatchObject({
      designationClasseur: "Carottes",
      uniteRecette: "kg",
      uniteCatalogue: "Pièce",
      parCorrespondance: false,
      occurrences: 1,
    });

    // Et le moteur de coût, lui aussi, refuse de supposer un facteur.
    const sauce = simulerCoutsFichesSeules(plan).find((c) => c.nom === "Sauce bolognaise")!;
    expect(sauce.incomplet).toBe(true);
    expect(sauce.motifs.join(" ")).toContain("Carottes");
  });

  it("le signalement dit quand le rattachement vient d'une CORRESPONDANCE arbitrée", () => {
    const catalogue = [
      ...sans("Tomates pêlées 240g"),
      { id: "b1", designation: "Tomates pêlées", unite: "kg", prixUnitaireUSD: new Decimal("2") },
    ];
    const plan = planifierFichesSeules(res(), catalogue, {
      correspondances: [{ classeur: "Tomates pêlées 240g", catalogue: "Tomates pêlées", motif: "cond." }],
    });
    const alerte = plan.unitesNonConvertibles.find((u) => u.designationClasseur === "Tomates pêlées 240g")!;
    expect(alerte.uniteRecette).toBe("Pièce"); // la recette compte à la pièce
    expect(alerte.uniteCatalogue).toBe("kg"); // le catalogue vend au kilo
    expect(alerte.parCorrespondance).toBe(true);
  });

  it("aucune alerte quand l'unité se convertit — y compris par unité-emballage (« 500 GR » → kg)", () => {
    expect(uniteSeConvertit("g", "kg")).toBe(true);
    expect(uniteSeConvertit("kg", "500 GR")).toBe(true); // emballage ramené au kilo
    expect(uniteSeConvertit("Pièce", "Pièce")).toBe(true);
    expect(uniteSeConvertit("Pièce", "kg")).toBe(false);
    expect(uniteSeConvertit("cl", "L")).toBe(true);
    expect(uniteSeConvertit("500 GR", "500 GR")).toBe(false); // ni masse, ni volume, ni comptage
    expect(uniteSeConvertit("g", null)).toBe(false);
    expect(uniteSeConvertit("g", "  ")).toBe(false);
  });
});

describe("articlesACreer — valeurs DU CLASSEUR, et rien d'inventé", () => {
  it("reprend unité, prix et conditionnement du classeur, en NOURRITURE, sans catégorie ni fournisseur", () => {
    const plan = planifierFichesSeules(res(), sans("Carottes", "Vin rouge"));
    const { aCreer, sansValeurs } = articlesACreer(plan);
    expect(sansValeurs).toEqual([]);
    expect(aCreer.map((a) => a.designation).sort()).toEqual(["Carottes", "Vin rouge"]);

    const carottes = aCreer.find((a) => a.designation === "Carottes")!;
    expect(carottes).toMatchObject({
      domaine: "NOURRITURE",
      unite: "kg",
      prixUnitaireUSD: "4.58",
      prixCartonUSD: "0",
      uniteParCarton: null,
      unitesRecette: ["kg"],
    });
    // Aucun champ « categorie » ni « fournisseur » : la Direction complètera.
    expect(Object.keys(carottes).sort()).toEqual(
      ["cle", "designation", "domaine", "fiches", "occurrences", "prixCartonUSD", "prixUnitaireUSD", "unite", "uniteParCarton", "unitesRecette"],
    );
  });

  it("un article introuvable ABSENT AUSSI de la liste du classeur n'est PAS créé : rien n'est deviné", () => {
    const INVENTE = feuille({
      B9: "FICHE TECHNIQUE",
      B13: "Plat mystère",
      B15: "Nombre de portions :", C15: 2,
      B20: "Article", C20: "Unité", D20: "Unités nécessaires",
      B21: "Poudre de perlimpinpin", C21: "g", D21: 10,
      B24: "Total prix de revient HT", F24: 0,
    });
    const r = analyserClasseur({
      SheetNames: ["Plat mystère", "Liste des articles"],
      Sheets: { "Plat mystère": INVENTE, "Liste des articles": LISTE_ARTICLES },
    } as XLSX.WorkBook);
    const { aCreer, sansValeurs } = articlesACreer(planifierFichesSeules(r, CATALOGUE_COMPLET));
    expect(aCreer).toEqual([]);
    expect(sansValeurs.map((a) => a.designation)).toEqual(["Poudre de perlimpinpin"]);
  });

  it("projeterCatalogue rend le catalogue TEL QU'IL SERAIT, avec des identifiants qui se disent factices", () => {
    const plan = planifierFichesSeules(res(), sans("Carottes"));
    const { aCreer } = articlesACreer(plan);
    const projete = projeterCatalogue(sans("Carottes"), aCreer);
    expect(projete).toHaveLength(8);
    const ajoute = projete.find((a) => a.designation === "Carottes")!;
    expect(ajoute.id).toBe("(à créer) carottes");
    expect(ajoute.prixUnitaireUSD?.toString()).toBe("4.58");

    // Et sur ce catalogue projeté, la fiche redevient créable.
    const apres = planifierFichesSeules(res(), projete);
    expect(apres.creables.map((f) => f.nom)).toEqual(["Sauce bolognaise", "Bolognaise"]);
  });
});

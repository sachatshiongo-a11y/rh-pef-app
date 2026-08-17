import { existsSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import { creerBaseTest } from "@/lib/test/db";
import { arrondirCentime, calculerCout, type ResultatCout } from "@/lib/fiches/cout";
import { construireContexte, type ArticleOption, type FicheVue } from "@/app/(stock)/stock/fiches/_data/fiche-calc";
import {
  analyserClasseur,
  ecrireEnBase,
  simulerCouts,
  type ClientEcriture,
  type RapportEcriture,
  type ResultatParse,
} from "../../../scripts/import-fiches-plats";
import {
  CHEMIN_CLASSEUR_REEL,
  classeurDepuisFixture,
  extraireCellules,
  lireClasseurReel,
  type FixtureClasseur,
} from "../../../scripts/_fixture-golden-fiches";
import fixtureJson from "./__fixtures__/fiches-plats.json";

/**
 * TEST GOLDEN DU MODULE FICHES TECHNIQUES — le filet des chiffres remis à la Direction.
 *
 * Il déroule la CHAÎNE COMPLÈTE, sans maquette d'aucun maillon :
 *   classeur réel (figé en fixture) → `analyserClasseur` → `ecrireEnBase` (PostgreSQL ÉPHÉMÈRE)
 *   → `chargerFichesVues` / `chargerArticlesDesFiches` (les lectures de l'écran Stock, en DEUX
 *   requêtes) → `construireContexte` → `calculerCout`.
 * Rien n'est reconstruit à la main : si demain une lecture oublie un prix, si une migration change
 * une précision, si le moteur réintroduit un arrondi intermédiaire, un chiffre ci-dessous bouge.
 *
 * ÉGALITÉ EXACTE, JAMAIS DE TOLÉRANCE. Aucun `toBeCloseTo`, aucun ±0,01 : c'est précisément
 * l'ordre de grandeur des bugs d'arrondi que ce test existe pour attraper. Un golden « à un
 * centime près » ne prouverait rien.
 *
 * VALEUR DE RÉFÉRENCE — BOLOGNAISE = 2,54 $, PAS 2,53 $. La cellule F34 du classeur affiche
 * 2,53 $ : c'est un ARTEFACT D'ARRONDI INTERMÉDIAIRE de la Direction (coût de la sauce tronqué à
 * 0,0123 $/g dans la liste des articles → 0,0123 × 200 + 0,07 = 2,53). En pleine précision, la
 * sauce revient à 0,012353… $/g → 2,4706 + 0,07 = 2,54 $. Le moteur ne « corrige » pas le
 * classeur : il ne tronque simplement jamais en cours de route (cf. l'en-tête de cout.ts et
 * §12 de la spec de conception). L'écart d'un centime est ASSUMÉ et verrouillé ici.
 *
 * BASE DE DONNÉES : `creerBaseTest()` uniquement (embedded-postgres jeté à la fin). Ni le `.env`
 * du dépôt, ni la moindre base réelle — `DATABASE_URL` pointe la PRODUCTION.
 */

const fixture = fixtureJson as unknown as FixtureClasseur;

// Le client Prisma des lectures d'écran est celui de la base éphémère (`@/lib/prisma` pointe la
// prod : il est remplacé, jamais joint).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { chargerFichesVues, chargerArticlesDesFiches } = await import(
  "@/app/(stock)/stock/fiches/_data/charger-fiche"
);

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let res: ResultatParse;
let rapport: RapportEcriture;
let vues: FicheVue[];
let articles: ArticleOption[];
/** Résultat du moteur pour chaque fiche, indexé par NOM (les noms du classeur sont distincts). */
const couts = new Map<string, ResultatCout>();

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma;
  fermer = db.fermer;
  H.client = prisma;

  // 1. Classeur → parseur → base (le vrai chemin d'import, pas un seed écrit pour l'occasion).
  res = analyserClasseur(classeurDepuisFixture(fixture));
  rapport = await ecrireEnBase(prisma as unknown as ClientEcriture, res, { force: false });

  // 2. Base → vues d'écran (deux requêtes) → contexte du moteur → coûts.
  [vues, articles] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches()]);
  const parId = new Map(articles.map((a) => [a.id, a]));
  const contexte = construireContexte(vues, parId);
  for (const v of vues) couts.set(v.nom, calculerCout(contexte.fiches.get(v.id)!, contexte));
  // Index par NOM : une homonymie future écraserait une entrée en silence et ferait échouer, plus
  // loin, un décompte incompréhensible. On veut que la VRAIE cause s'affiche ici.
  if (couts.size !== vues.length) {
    throw new Error(`Noms de fiches en double après import : ${vues.length} fiches, ${couts.size} noms distincts`);
  }
}, 240_000);

afterAll(async () => {
  await fermer?.();
});

const cout = (nom: string): ResultatCout => {
  const r = couts.get(nom);
  if (!r) throw new Error(`Fiche « ${nom} » absente de la base après import : ${[...couts.keys()].join(", ")}`);
  return r;
};

// ─── 1. La chaîne d'import elle-même ─────────────────────────────────────────

describe("chaîne complète : classeur → import → base → chargement", () => {
  it("importe 108 articles distincts et 29 fiches, sans rien laisser en rade", () => {
    expect(rapport.statut).toBe("IMPORTE");
    expect(rapport.articlesCrees).toBe(108); // « CAILLES » et « Cailles » = un seul article
    expect(rapport.fichesCreees).toBe(29);
    expect(rapport.ingredientsCrees).toBe(121);
    expect(res.nonRattaches).toEqual([]); // aucun ingrédient orphelin : tout est chiffrable ou dit
  });

  it("les lectures d'écran retrouvent les 29 fiches et les 51 articles qu'elles utilisent", () => {
    expect(vues).toHaveLength(29);
    expect(couts.size).toBe(29); // aucun nom de fiche en double : l'index par nom reste fidèle
    expect(vues.filter((v) => v.estSousRecette).map((v) => v.nom).sort()).toEqual([
      "Bisque de cossas", "Béchamel", "Coulis de tomate", "Jus de cuisson", "Sauce bolognaise",
    ]);
    // Les articles chargés sont exactement ceux cités par une fiche : 51 sur les 108 du catalogue.
    // Valeur FIGÉE, pas encadrée : un `chargerArticlesDesFiches` devenu trop large (catalogue
    // entier) ou trop étroit (articles désactivés perdus) ne se verrait sinon qu'indirectement,
    // le jour où un coût bouge.
    expect(articles).toHaveLength(51);
    expect(rapport.articlesCrees).toBe(108);
  });
});

// ─── 2. Les deux chiffres de référence, au centime EXACT ─────────────────────

describe("Bolognaise — le chiffre de référence (2,54 $, jamais 2,53 $)", () => {
  it("coût par portion = 2,54 $ exactement", () => {
    const r = cout("Bolognaise");
    expect(arrondirCentime(r.coutParPortion)).toBe(2.54);
    // Et ce n'est PAS un 2,535 arrondi de justesse : la pleine précision est verrouillée telle
    // quelle. Elle est lue depuis la BASE (prix à 4 décimales, quantités à 3) ; sur les valeurs
    // brutes du classeur, non arrondies par le schéma, la même chaîne donne 2,5405938417… — les
    // deux tombent sur 2,54, et cet écart de schéma est chiffré au §4 ci-dessous.
    expect(r.coutParPortion.toFixed(10)).toBe("2.5405580870");
  });

  it("la fiche est complète : le chiffre n'est pas un minorant", () => {
    const r = cout("Bolognaise");
    expect(r.incomplet).toBe(false);
    expect(r.ingredientsSansPrix).toEqual([]);
    expect(r.cycle).toBe(false);
  });

  it("elle vaut sa sauce (200 g) plus ses pennes (0,2 kg), sans conversion parasite du « cl »", () => {
    const r = cout("Bolognaise");
    expect(r.lignes.map((l) => l.label)).toEqual(["Sauce bolognaise", "20 PENNE RIGATE LM CHEF 12 X 1KG"]);
    // « cl » d'une sous-recette = GRAMME (densité 1) : convertir multiplierait le coût par 10.
    expect(arrondirCentime(r.lignes[0]!.cout!)).toBe(2.47);
    expect(arrondirCentime(r.lignes[1]!.cout!)).toBe(0.07);
    expect(r.lignes.every((l) => l.partiel === false)).toBe(true);
  });

  it("une portion : le coût par portion est le coût total", () => {
    const r = cout("Bolognaise");
    expect(vues.find((v) => v.nom === "Bolognaise")!.nbPortions).toBe(1);
    expect(r.coutTotal.equals(r.coutParPortion)).toBe(true);
  });
});

describe("Sauce bolognaise — la sous-recette (56,82 $ pour 23 portions)", () => {
  it("coût total = 56,82 $ et coût par portion = 2,47 $ exactement", () => {
    const r = cout("Sauce bolognaise");
    expect(vues.find((v) => v.nom === "Sauce bolognaise")!.nbPortions).toBe(23);
    expect(arrondirCentime(r.coutTotal)).toBe(56.82);
    expect(arrondirCentime(r.coutParPortion)).toBe(2.47);
    // Valeur lue en base : 56,822836 $. Le classeur, en valeurs brutes, donne 56,82365836 $ —
    // 0,0008 $ d'écart dû aux précisions du schéma (§4), sans effet sur le centime.
    expect(r.coutTotal.toFixed(8)).toBe("56.82283600");
  });

  it("son rendement est en GRAMMES (4600), jamais en kg — sinon toutes ses utilisatrices tombent", () => {
    const v = vues.find((f) => f.nom === "Sauce bolognaise")!;
    expect(v.rendementUnite).toBe("g");
    expect(v.rendementQuantite).toBe("4600");
    // C'est ce qui permet à la Bolognaise d'être chiffrée : rendement en kg ⇒
    // UNITE_RENDEMENT_INCOHERENTE ⇒ coût indéterminé.
    expect(cout("Bolognaise").incomplet).toBe(false);
  });

  it("elle est complète, et le coût au gramme est celui qui fait 2,54 (0,0123… et non 0,0123)", () => {
    const r = cout("Sauce bolognaise");
    expect(r.incomplet).toBe(false);
    const auGramme = r.coutTotal.div(4600);
    expect(auGramme.toFixed(10)).toBe("0.0123527904");
    // Le classeur, lui, a figé 0,0123 $/g dans sa liste d'articles — une TRONCATURE à 4
    // décimales (0,012352… → 0,0123), pas un arrondi (qui aurait donné 0,0124). D'où son
    // 0,0123 × 200 + 0,07 = 2,53 $. Rejouer cette troncature ici RÉAPPARAÎT le 2,53 : c'est la
    // preuve, chiffrée, que le centime d'écart vient de là et de nulle part ailleurs.
    const tronque = auGramme.toDecimalPlaces(4, Decimal.ROUND_DOWN);
    expect(tronque.toString()).toBe("0.0123");
    expect(arrondirCentime(tronque.times(200).plus(new Decimal("0.07")))).toBe(2.53);
  });
});

// ─── 3. Le décompte complètes / incomplètes, avec ses motifs ─────────────────

/** Une ligne par fiche incomplète : « nom : ingrédient manquant ». Verrouillé nommément. */
const INCOMPLETES_ATTENDUES = [
  // Manque propagé depuis une sous-recette : le chemin est conservé (« mère › ligne »).
  "Arrabbiata : Coulis de tomate › Basilic séché 170g",
  "Bisque de cossas : Maizena blanc", // quantité absente du classeur (colonne vide)
  "Coulis de tomate : Basilic séché 170g", // article sans prix au catalogue
  // Sous-recettes SANS rendement (Bisque, Jus de cuisson, Béchamel) : leurs utilisatrices ne
  // peuvent pas ramener le coût à la quantité consommée — la ligne entière est indéterminée,
  // le manque ne se propage donc pas ligne à ligne.
  "Gratiné de cossas de Mayombe au beurre de corail : Bisque de cossas",
  // « Hamburger de pâtes » a QUITTÉ cette liste le 2026-08-16 : sa ligne « 15 SPAGHETTI 24 X
  // 500G » consomme en « 500 GR », exactement l'unité du catalogue — même unité rapportée à
  // elle-même, donc facteur 1 par construction (corrigé dans conversion.ts : `facteur` renvoyait
  // à tort `null` sur deux unités strictement identiques dès qu'elles étaient inconnues du
  // système). Le hamburger est désormais chiffré de bout en bout (18 → 19 complètes).
  "Jus de cuisson : Crème balsamique | Vinaigre Bamsamique",
  "Lasagne de capitaine aux épinards : Béchamel",
  "Moelleux au chocolat : Sucre Glace 500gr Daddy Icing",
  "Pièce de bœuf de Goma : Jus de cuisson",
  "Poêlée de cossas comme au bon vieux temps : Bisque de cossas",
  "Sauté de blanc de poulet aux champignons, lait de coco et de curry : Curry",
];

/**
 * Le MOTIF TECHNIQUE de chaque ligne non valorisée, fiche par fiche — et pas seulement le nom de
 * l'ingrédient. C'est lui qui dit à la Direction QUOI FAIRE, et ce sont trois gestes différents :
 *   • PRIX_ABSENT ............ renseigner un prix d'achat au catalogue ;
 *   • PRIX_NUL ............... corriger un 0 saisi à tort (ce n'est pas « gratuit ») ;
 *   • UNITE_INCONVERTIBLE .... corriger l'unité (recette ↔ achat incompatibles) ;
 *   • QUANTITE_ABSENTE ....... saisir la quantité oubliée dans le classeur ;
 *   • RENDEMENT_ABSENT ....... donner le rendement de la sous-recette.
 * `ingredientsSansPrix` (liste ci-dessus) ne porte QUE des libellés : un motif renommé, ou remplacé
 * par un autre, y resterait totalement invisible. On verrouille donc `lignes[].motif`.
 * `PARTIEL` = la ligne EST valorisée, mais depuis une sous-recette elle-même incomplète : le
 * chiffre est un minorant, et la cause se lit dans l'entrée de la sous-recette.
 */
const MOTIFS_ATTENDUS = [
  "Arrabbiata : Coulis de tomate[PARTIEL]",
  "Bisque de cossas : Maizena blanc[QUANTITE_ABSENTE]",
  "Coulis de tomate : Basilic séché 170g[PRIX_ABSENT]",
  "Gratiné de cossas de Mayombe au beurre de corail : Bisque de cossas[RENDEMENT_ABSENT]",
  // Motif « Hamburger de pâtes […][UNITE_INCONVERTIBLE] » retiré le 2026-08-16 pour la même
  // raison que ci-dessus (voir le commentaire sur INCOMPLETES_ATTENDUES) : cf. conversion.ts.
  "Jus de cuisson : Crème balsamique[PRIX_ABSENT] | Vinaigre Bamsamique[PRIX_ABSENT]",
  "Lasagne de capitaine aux épinards : Béchamel[RENDEMENT_ABSENT]",
  "Moelleux au chocolat : Sucre Glace 500gr Daddy Icing[PRIX_ABSENT]",
  "Pièce de bœuf de Goma : Jus de cuisson[RENDEMENT_ABSENT]",
  "Poêlée de cossas comme au bon vieux temps : Bisque de cossas[RENDEMENT_ABSENT]",
  "Sauté de blanc de poulet aux champignons, lait de coco et de curry : Curry[PRIX_ABSENT]",
];

// 19/10 depuis le 2026-08-16 (était 18/11) : « Hamburger de pâtes » est devenu complet, cf. les
// commentaires sur INCOMPLETES_ATTENDUES et MOTIFS_ATTENDUS ci-dessus.
describe("état de chiffrage des 29 fiches (19 complètes / 10 incomplètes)", () => {
  const parFiche = (rendu: (r: ResultatCout) => string) =>
    [...couts.entries()]
      .filter(([, r]) => r.incomplet)
      .map(([nom, r]) => `${nom} : ${rendu(r)}`)
      .sort((a, b) => a.localeCompare(b, "fr"));

  const resume = () => parFiche((r) => r.ingredientsSansPrix.join(" | "));

  const motifs = () =>
    parFiche((r) =>
      r.lignes
        .filter((l) => l.motif !== null || l.partiel)
        .map((l) => `${l.label}[${l.motif ?? "PARTIEL"}]`)
        .join(" | "),
    );

  it("19 fiches sont chiffrées de bout en bout", () => {
    expect([...couts.values()].filter((r) => !r.incomplet)).toHaveLength(19);
  });

  it("10 fiches restent incomplètes, et l'on sait NOMMÉMENT quel ingrédient manque", () => {
    // Le décompte seul ne suffirait pas : une fiche qui deviendrait silencieusement « complète »
    // pendant qu'une autre casse laisserait le total inchangé. On verrouille donc la LISTE.
    expect(resume()).toEqual(INCOMPLETES_ATTENDUES);
  });

  it("et POURQUOI il manque : le motif technique de chaque ligne est verrouillé", () => {
    // Sans ceci, un motif changé (« prix saisi à 0 » là où il faut lire « aucun prix au
    // catalogue ») passe inaperçu : les libellés, eux, ne bougent pas. Or ce sont deux
    // corrections différentes pour la Direction.
    expect(motifs()).toEqual(MOTIFS_ATTENDUS);
  });

  it("aucune fiche incomplète n'est présentée comme un prix arrêté (prix conseillé = minorant)", () => {
    for (const [nom, r] of couts) {
      if (!r.incomplet || r.prixConseille === null) continue;
      expect(r.prixConseille.minorant, `« ${nom} » annonce un prix conseillé sans dire qu'il est un plancher`).toBe(true);
    }
  });

  it("un manque ne vaut JAMAIS zéro : chaque motif correspond à une ligne sans coût", () => {
    for (const [nom, r] of couts) {
      if (!r.incomplet) continue;
      const sansCout = r.lignes.filter((l) => l.cout === null || l.partiel);
      expect(sansCout.length, `« ${nom} » est incomplète sans aucune ligne indéterminée`).toBeGreaterThan(0);
    }
  });
});

// ─── 4. Le passage en base ne déplace aucun chiffre ──────────────────────────

describe("aller-retour en base : les arrondis du schéma sont les seuls écarts, et ils sont connus", () => {
  it("chaque fiche retrouve, à la lecture, le coût simulé sur les valeurs telles qu'écrites", () => {
    // `simulerCouts(..., { arrondiSchema: true })` chiffre le classeur avec les précisions du
    // schéma (prix 4 décimales, quantités 3) SANS toucher la base : les deux doivent coïncider à
    // la dernière décimale. Un écart = une perte d'information entre l'écriture et la lecture.
    const simulees = simulerCouts(res, { arrondiSchema: true });
    expect(simulees).toHaveLength(29);
    for (const s of simulees) {
      const r = cout(s.nom);
      const attendu = s.coutTotal === null ? null : s.coutTotal.toFixed(12);
      const obtenu = s.coutTotal === null && r.coutTotal.isZero() ? null : r.coutTotal.toFixed(12);
      expect(obtenu, `« ${s.nom} » : coût en base ≠ coût simulé`).toBe(attendu);
      expect(r.incomplet, `« ${s.nom} » : incomplétude différente entre simulation et base`).toBe(s.incomplet);
    }
  });
});

// ─── 5. La fixture EST le classeur de la Direction ───────────────────────────

const classeurReelPresent = existsSync(CHEMIN_CLASSEUR_REEL);

// L'état est porté par le NOM du test (comme dans import-fiches-plats.test.ts) : le rapport de
// vitest dit lui-même si la fixture a été confrontée au classeur réel sur cette machine.
describe("confrontation au classeur RÉEL de la Direction", () => {
  it(
    classeurReelPresent
      ? "classeur présent : la fixture est confrontée à l'original (voir le bloc suivant)"
      : "classeur ABSENT de cette machine : PARITÉ NON VÉRIFIÉE — le golden tourne sur la fixture figée (57 Mo non versionnés) ; poser EXIGER_CLASSEUR_REEL=1 pour en faire un échec",
    () => {
      if (process.env.EXIGER_CLASSEUR_REEL === "1") {
        expect(classeurReelPresent, `Classeur réel introuvable : ${CHEMIN_CLASSEUR_REEL}`).toBe(true);
      }
      expect(typeof classeurReelPresent).toBe("boolean");
    },
  );
});

describe.skipIf(!classeurReelPresent)("fixture ↔ classeur réel", () => {
  it("la fixture reproduit le classeur CELLULE PAR CELLULE (sinon : régénérer)", () => {
    const reel = extraireCellules(lireClasseurReel(), fixture.source);
    // Égalité stricte : le jour où la Direction modifie son classeur, ce test tombe et dit quoi
    // faire — `npx tsx scripts/_fixture-golden-fiches.ts`, puis relire les chiffres ci-dessus.
    expect(reel).toEqual(fixture);
  });

  it("et le moteur en tire les mêmes coûts que depuis la fixture", () => {
    const surReel = simulerCouts(analyserClasseur(lireClasseurReel()));
    expect(surReel.find((s) => s.nom === "Bolognaise")!.coutParPortion).toBe("2.5406");
    for (const s of surReel) {
      const r = cout(s.nom);
      expect(r.incomplet, `« ${s.nom} »`).toBe(s.incomplet);
    }
  });
});

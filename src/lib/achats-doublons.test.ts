import { describe, it, expect } from "vitest";
import {
  cleArticleExacte, doublonsDansListe, erreurDlc, joursAvantDlc, libelleJoursDlc, lireDlc, memeDesignation, type ArticleCandidat,
} from "@/lib/achats-doublons";
import { articlesProches, decisionArticle, prochesDansListe, SEUIL_ARTICLE_PROCHE } from "@/lib/article-proche";
import { sansContenance } from "@/lib/fiches/conversion";

// Liste d'achat — anti-doublon d'ARTICLE (règle de l'Atelier, portée) et DLC (Direction, 2026-10-08) : les règles pures.

describe("clé exacte d'une désignation — accents, casse, espaces, séparateurs, écriture de la contenance", () => {
  it("mêmes lettres aux accents, à la casse, aux espaces et aux séparateurs près", () => {
    expect(cleArticleExacte("Crème  fraîche")).toBe(cleArticleExacte("creme-fraiche"));
    expect(cleArticleExacte("Huile d'olive")).toBe(cleArticleExacte("HUILE D OLIVE"));
  });
  it("contenance canonique : 1L = 1 LTR = 100cl = 1000 ml ; 33cl = 330ml", () => {
    expect(cleArticleExacte("Coca-Cola 33cl")).toBe(cleArticleExacte("coca cola 330 ML"));
    expect(cleArticleExacte("Eau 1L")).toBe(cleArticleExacte("eau 1 LTR"));
    expect(cleArticleExacte("Eau 1L")).toBe(cleArticleExacte("Eau 100cl"));
    expect(cleArticleExacte("Eau 1,5 L")).toBe(cleArticleExacte("eau 150cl"));
  });
  it("une contenance d'un seul côté, ou différente, n'est PAS exacte", () => {
    expect(cleArticleExacte("Coca")).not.toBe(cleArticleExacte("Coca 33cl"));
    expect(cleArticleExacte("Coca 33cl")).not.toBe(cleArticleExacte("Coca 1L"));
  });
  it("ni le pluriel ni l'ordre des mots ne font un exact (ce sont des PROCHES)", () => {
    expect(cleArticleExacte("Tomates")).not.toBe(cleArticleExacte("Tomate"));
    expect(cleArticleExacte("palme huile")).not.toBe(cleArticleExacte("huile palme"));
  });
  it("un nombre collé n'est pas une contenance (« V8 », « B52cl ») ; sans lettre ni chiffre : clé vide", () => {
    expect(sansContenance("V8 1L")).toContain("V8");
    expect(cleArticleExacte("--")).toBe("");
  });
  it("deux contenances LUES et différentes ne sont jamais le même article : « Eau 1,5L » n'est pas « Eau 15L »", () => {
    expect(memeDesignation("Eau 1,5L", "Eau 15L")).toBe(false);
    expect(memeDesignation("Huile 2.5L", "Huile 25L")).toBe(false);
    expect(memeDesignation("Eau 1,5L", "eau 150 cl")).toBe(true);
  });
  it("l'égalité stricte d'avant (cleAlnum) reste une correspondance exacte (« Coca33cl » = « coca 33cl »)", () => {
    expect(memeDesignation("Coca33cl", "coca 33cl")).toBe(true);
    expect(memeDesignation("Sucre", "Sel")).toBe(false);
  });
});

const art = (id: string, designation: string, actif = true): ArticleCandidat => ({ id, designation, unite: "kg", domaine: "NOURRITURE", prix: null, actif });
const noms = (l: readonly { article: { designation: string } }[]) => l.map((p) => p.article.designation);

// Les couples de l'application Atelier (article-saisie.test.ts), dans les deux sens : même règle ici.
const ATELIER = [art("a1", "Tomates"), art("a2", "Oignons"), art("a3", "Huile de palme"), art("a4", "Sel"), art("a5", "Couverts jetables")];

describe("articles PROCHES — la règle de l'Atelier, portée telle quelle", () => {
  it("« Tomate » fait remonter « Tomates » — le cas même de la demande", () => {
    expect(noms(articlesProches("Tomate", ATELIER))).toContain("Tomates");
  });
  it.each([
    ["Oignon", "Oignons"],
    ["Huile palme", "Huile de palme"],
    ["Huile de palm", "Huile de palme"],
    ["Sels", "Sel"],
    ["Couvert jetable", "Couverts jetables"],
    ["palme huile", "Huile de palme"], // ordre des mots
    ["HUILE-DE-PALMES", "Huile de palme"], // casse, séparateurs, pluriel
  ])("« %s » fait remonter « %s »", (tape, attendu) => {
    expect(noms(articlesProches(tape, ATELIER))).toContain(attendu);
  });
  it.each([
    ["Sucre", "Sel"],
    ["Miel", "Sel"],
    ["Poisson", "Tomates"],
    ["Farine de manioc", "Huile de palme"],
    ["Bougies", "Couverts jetables"],
  ])("« %s » ne fait JAMAIS remonter « %s »", (tape, interdit) => {
    expect(noms(articlesProches(tape, ATELIER))).not.toContain(interdit);
  });
  it("LA LIMITE, dite plutôt que cachée (la même qu'à l'Atelier) : un mot commun de 4 lettres et plus suffit à proposer", () => {
    // « vertes » ≈ « verts » : jeton distinctif partagé → 0,8. Ce n'est qu'une proposition de trop
    // (« Créer quand même » d'un geste) ; se tromper dans l'autre sens créerait un doublon en base.
    expect(noms(articlesProches("Courgettes vertes", [art("c", "Citrons verts")]))).toEqual(["Citrons verts"]);
  });
  it("pluriel en -x : « Chou » fait remonter « Choux »", () => {
    expect(noms(articlesProches("Chou", [art("c", "Choux")]))).toEqual(["Choux"]);
  });
  it("l'article EXACTEMENT du même nom (accents, casse, espaces) n'est pas un proche : c'est le même", () => {
    expect(noms(articlesProches("  TOMATES ", ATELIER))).not.toContain("Tomates");
    expect(noms(articlesProches("tomàtes", ATELIER))).not.toContain("Tomates");
  });
  it("un nom sans lettre ni chiffre ne propose rien", () => {
    expect(articlesProches("", ATELIER)).toEqual([]);
    expect(articlesProches(" -- ", ATELIER)).toEqual([]);
  });
  it("meilleurs scores d'abord, au plus `max`, ordre STABLE à égalité ; tous au-dessus du seuil (0,65, celui de l'Atelier)", () => {
    const beaucoup = [art("1", "Tomates"), art("2", "Tomate cerise"), art("3", "Tomate concentrée"), art("4", "Sucre")];
    const p = articlesProches("Tomate", beaucoup, { max: 2 });
    expect(noms(p)).toEqual(["Tomates", "Tomate cerise"]);
    for (const x of articlesProches("Tomate", beaucoup)) expect(x.score).toBeGreaterThanOrEqual(SEUIL_ARTICLE_PROCHE);
    expect(SEUIL_ARTICLE_PROCHE).toBe(0.65);
  });
  it("ajout PEF : la contenance n'entre pas dans la ressemblance — même nom, autre contenance : proche ; autre nom, même contenance : JAMAIS", () => {
    const cat = [art("c33", "Coca-Cola 33cl"), art("c1", "Coca-Cola 1L"), art("f33", "Fanta 33cl"), art("eau", "Eau 1,5L"), art("huile", "Huile de palme 5L"), art("riz", "Riz parfumé 25kg")];
    expect(noms(articlesProches("Coca-Cola 50cl", cat)).sort()).toEqual(["Coca-Cola 1L", "Coca-Cola 33cl"]);
    expect(noms(articlesProches("Coca-Cola", cat))).toHaveLength(2);
    // Mesuré par la relecture : le « 50cl » ou le « 5kg » commun faisait remonter n'importe quoi.
    expect(noms(articlesProches("Fanta 50cl", cat))).toEqual(["Fanta 33cl"]);
    expect(noms(articlesProches("Bière Primus 33cl", cat))).toEqual([]);
    expect(noms(articlesProches("Riz parfumé 5kg", cat))).toEqual(["Riz parfumé 25kg"]);
    expect(noms(articlesProches("Sucre 5kg", cat))).toEqual([]);
  });

  it("ligature : « Oeufs » fait remonter « Œufs » (et « Œuf » aussi)", () => {
    expect(noms(articlesProches("Oeuf", [art("o", "Œufs")]))).toEqual(["Œufs"]);
    expect(memeDesignation("Oeufs", "Œufs")).toBe(true);
  });
});

const CATALOGUE = [
  art("tom", "Tomates fraîches"),
  art("coca33", "Coca-Cola 33cl"),
  art("coca1l", "Coca-Cola 1L"),
  art("huile", "Huile de palme"),
  art("farine", "Farine T55"),
  art("vieux", "Sucre roux", false),
];

describe("sort d'une ligne LIBRE — exact unique : automatique ; proche : choix obligatoire", () => {
  it("exact normalisé UNIQUE (accents, casse, contenance) → rattachement automatique", () => {
    expect(decisionArticle("COCA COLA 330 ml", CATALOGUE)).toEqual({ type: "auto", article: CATALOGUE[1] });
    expect(decisionArticle("tomates fraiches", CATALOGUE)).toEqual({ type: "auto", article: CATALOGUE[0] });
  });
  it("un article INACTIF du même nom exact est retrouvé (on ne recrée pas un article mis de côté)", () => {
    expect(decisionArticle("sucre roux", CATALOGUE)).toEqual({ type: "auto", article: CATALOGUE[5] });
  });
  it("DEUX exacts → choix entre eux, sans « Créer quand même »", () => {
    const d = decisionArticle("Farine T55", [...CATALOGUE, art("farine2", "FARINE-T55")]);
    expect(d.type).toBe("choix");
    if (d.type !== "choix") return;
    expect(d.creationPossible).toBe(false);
    expect(d.candidats.map((c) => c.id).sort()).toEqual(["farine", "farine2"]);
  });
  it("« Tomate fraîche » face à « Tomates fraîches » → choix (Utiliser / Créer quand même), jamais rattaché d'office", () => {
    expect(decisionArticle("Tomate fraîche", CATALOGUE)).toMatchObject({ type: "choix", creationPossible: true, candidats: [CATALOGUE[0]] });
    expect(decisionArticle("Palme huile", CATALOGUE)).toMatchObject({ type: "choix", candidats: [CATALOGUE[3]] });
  });
  it("rien d'approchant → nouvel article ; un inactif n'est jamais proposé comme PROCHE", () => {
    expect(decisionArticle("Levure boulangère", CATALOGUE)).toEqual({ type: "nouveau" });
    expect(decisionArticle("Sucres roux", CATALOGUE)).toEqual({ type: "nouveau" });
  });
});

describe("noms NOUVEAUX et proches dans la même liste (« Poivrons » puis « Poivron »)", () => {
  const tous = () => true;
  it("la SECONDE ligne est rapprochée de la première ; la première, non", () => {
    expect(Object.fromEntries(prochesDansListe(["Poivrons", "Sel", "Poivron"], tous))).toEqual({ 2: [0] });
  });
  it("le même nom exact n'est pas « proche » (il ne crée qu'un article) ; une ligne qui ne crée rien ne compte pas", () => {
    expect(prochesDansListe(["Poivrons", "POIVRONS"], tous).size).toBe(0);
    expect(prochesDansListe(["Poivrons", "Poivron"], (i) => i !== 0).size).toBe(0);
  });
});

describe("doublons DANS la liste", () => {
  it("même article sur deux lignes → signalé sur les DEUX ; même désignation libre normalisée aussi", () => {
    const m = doublonsDansListe([
      { articleId: "a", designation: "Farine" },
      { articleId: "", designation: "Sel fin" },
      { articleId: "a", designation: "Farine" },
      { articleId: "", designation: "SEL-FIN" },
      { articleId: "b", designation: "Autre" },
    ]);
    expect(Object.fromEntries(m)).toEqual({ 0: [2], 2: [0], 1: [3], 3: [1] });
  });
  it("une ligne libre RATTACHÉE d'office compte pour son article ; une ligne ignorée ne compte pas", () => {
    const m = doublonsDansListe([{ articleId: "a", designation: "Farine" }, { articleId: "", designation: "farine t55" }, { articleId: "a", designation: "Farine", ignoree: true }], (i) => (i === 1 ? "a" : null));
    expect(Object.fromEntries(m)).toEqual({ 0: [1], 1: [0] });
  });
});

describe("DLC facultative", () => {
  it("vide : permise ; égale ou après la date de l'achat : permise", () => {
    expect(lireDlc("", "2026-10-05", { rang: 1, designation: "Lait" })).toBeNull();
    expect(lireDlc("2026-10-05", "2026-10-05", { rang: 1, designation: "Lait" })).toBe("2026-10-05");
    expect(lireDlc(" 2026-12-01 ", "2026-10-05", { rang: 1, designation: "Lait" })).toBe("2026-12-01");
  });
  it("antérieure à la date de l'achat : refus lisible qui nomme la ligne", () => {
    expect(() => lireDlc("2026-10-04", "2026-10-05", { rang: 2, designation: "Lait" })).toThrow("Ligne 2 (« Lait ») : La DLC (04/10/2026) est antérieure à la date de l'achat (05/10/2026). Corrigez-la ou videz-la ; rien n'a été enregistré.");
  });
  it("plus de 10 ans après l'achat (année mal tapée) : refus", () => {
    expect(erreurDlc("2062-10-01", "2026-10-05")).toBe("La DLC (01/10/2062) est à plus de 10 ans de l'achat : vérifiez l'année.");
    expect(erreurDlc("2036-12-31", "2026-10-05")).toBeNull();
  });
  it("illisible ou hors calendrier : refus", () => {
    expect(erreurDlc("2026-02-30", "2026-01-01")).toMatch(/illisible/);
    expect(erreurDlc("12/10/2026", "2026-01-01")).toMatch(/illisible/);
  });
  it("jours restants (dates pures) et leur libellé", () => {
    expect(joursAvantDlc("2026-10-12", "2026-10-08")).toBe(4);
    expect(joursAvantDlc("2026-10-05", "2026-10-08")).toBe(-3);
    expect([libelleJoursDlc(-3), libelleJoursDlc(0), libelleJoursDlc(1), libelleJoursDlc(5)]).toEqual(["dépassée de 3 j", "aujourd'hui", "demain", "dans 5 j"]);
  });
});

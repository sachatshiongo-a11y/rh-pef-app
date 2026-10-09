// Garde-fou de source : le nom d'un article du catalogue s'AFFICHE par `libelleArticle` (désignation +
// contenance si le nom ne la porte pas — demande de la Direction du 2026-10-09), jamais par la
// désignation brute ; et la désignation brute reste la CLÉ (classeurs, anti-doublon, imports, audit).
//
// Trois vérifications :
//  1. RECENSEMENT : dans les écrans (tout src/app), composants et PDF, chaque lecture de la désignation
//     restante (`a.designation`, `a["designation"]`, `const { designation } = a`) est comptée fichier
//     par fichier, avec sa raison. Une lecture de plus fait échouer le test : il faut
//     décider — nom affiché : `libelleArticle` (ou `libelleLigneArticle` pour une ligne de document) ;
//     clé, import, champ modifiable, nom déjà calculé en amont : la recenser ici avec sa raison ;
//  2. LECTURES PRISMA : partout dans src/, une sélection qui lit la désignation d'un article
//     (`article: { select: { … } }`, `articleStock: { select: … }`, `articleStock.findMany({ select: … })`,
//     sous-objets compris) lit aussi la contenance (ou `CHAMPS_LIBELLE`) — sans elle, le libellé ne peut
//     pas être complet — sauf les fichiers recensés (clés, imports, actions), avec leur nombre ;
//  3. BRANCHEMENTS : les écrans, PDF, exports et notifications branchés appellent toujours le libellé
//     (un retour en arrière silencieux fait échouer le test).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../..");
const RACINES_AFFICHAGE = ["src/app", "src/components", "src/lib/pdf"];

type Raison = "CLE" | "IMPORT" | "AUDIT_ACTION" | "FORMULAIRE" | "AMONT" | "RESTO" | "FIGE" | "LEGUMES" | "VENTES" | "AUTRE_MODELE";
const RAISONS: Record<Raison, string> = {
  CLE: "clé : rapprochement, tri, recherche, classeur de la Direction, articles proches (anti-doublon)",
  IMPORT: "import (classeur, PDF, CSV) : le nom lu se compare à la désignation brute",
  AUDIT_ACTION: "action serveur : clés d'anti-doublon, écriture, journal d'audit « avant → après » (la vraie désignation)",
  FORMULAIRE: "champ modifiable ou donnée transportée vers l'écran (qui calcule le libellé) : y écrire la contenance la réécrirait en base",
  AMONT: "le champ porte DÉJÀ le libellé, calculé en amont par `libelleArticle` (chargeur, lib, page serveur)",
  RESTO: "article du RESTAURANT (ArticleResto), qui a son propre nom",
  FIGE: "document figé : comptage archivé, ligne libre de bon (sans article), palmarès des lignes de bon",
  LEGUMES: "légumes frais : liste fixe, pas des articles du catalogue",
  VENTES: "plats vendus (fiches), pas des articles du catalogue",
  AUTRE_MODELE: "une autre « désignation » que celle d'un article (jour férié…)",
};

/** Lectures `.designation` restantes, par fichier : nombre exact et raison(s). */
const RECENSES: Record<string, { n: number; raisons: Raison[] }> = {
  "src/app/(app)/parametres/page.tsx": { n: 1, raisons: ["AUTRE_MODELE"] }, // jours fériés
  "src/app/(stock)/stock/_tableau-de-bord/bloc-dlc-proches.tsx": { n: 1, raisons: ["AMONT"] }, // lib/dlc-stock
  "src/app/(stock)/stock/a-valider/detail-demande.tsx": { n: 3, raisons: ["AMONT"] }, // validations-stock/apercu
  "src/app/(stock)/stock/archives/[id]/page.tsx": { n: 1, raisons: ["FIGE"] },
  "src/app/(stock)/stock/catalogue/[id]/editer-article.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/catalogue/[id]/page.tsx": { n: 2, raisons: ["FORMULAIRE"] }, // valeur du formulaire + infobulle « nom enregistré »
  "src/app/(stock)/stock/catalogue/_view.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/catalogue/actions.ts": { n: 8, raisons: ["AUDIT_ACTION"] },
  "src/app/(stock)/stock/catalogue/catalogue-table.tsx": { n: 1, raisons: ["CLE"] }, // tri par nom (le nom affiché est `libelleArticle`, en lien vers la fiche)
  "src/app/(stock)/stock/commandes/[id]/modifier/page.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/commandes/[id]/page.tsx": { n: 1, raisons: ["FIGE"] },
  "src/app/(stock)/stock/commandes/[id]/reception-client.tsx": { n: 2, raisons: ["AMONT"] },
  "src/app/(stock)/stock/commandes/actions.ts": { n: 5, raisons: ["AUDIT_ACTION"] },
  "src/app/(stock)/stock/commandes/nouveau/nouveau-client.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/commandes/nouveau/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/entree/actions.ts": { n: 24, raisons: ["AUDIT_ACTION"] },
  "src/app/(stock)/stock/entree/alertes-ligne.tsx": { n: 2, raisons: ["FORMULAIRE"] }, // nom tapé d'un nouvel article
  "src/app/(stock)/stock/entree/entree-client.tsx": { n: 5, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/entree/entree-telephone.tsx": { n: 5, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/entree/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/factures/[id]/page.tsx": { n: 5, raisons: ["CLE", "FIGE"] }, // clé du rapprochement bon/facture, ligne libre
  "src/app/(stock)/stock/factures/actions.ts": { n: 6, raisons: ["IMPORT", "AUDIT_ACTION"] },
  "src/app/(stock)/stock/factures/nouveau/nouveau-client.tsx": { n: 4, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/factures/nouveau/page.tsx": { n: 2, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/fiches/[id]/disponibilite-fiche.tsx": { n: 2, raisons: ["AMONT"] }, // lib/fiches/disponibilite
  "src/app/(stock)/stock/fiches/_data/charger-fiche.ts": { n: 2, raisons: ["FORMULAIRE", "RESTO"] },
  "src/app/(stock)/stock/fiches/import-bar-actions.ts": { n: 6, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/fiches/import-bar.tsx": { n: 9, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/imports/import-client.tsx": { n: 1, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/journalier/commande-grid.tsx": { n: 9, raisons: ["AMONT"] }, // journalier/page
  "src/app/(stock)/stock/journalier/comparaison-jour.tsx": { n: 3, raisons: ["AMONT"] },
  "src/app/(stock)/stock/journalier/comparaison-semaine.tsx": { n: 3, raisons: ["AMONT"] },
  "src/app/(stock)/stock/journalier/conso-jour.tsx": { n: 3, raisons: ["AMONT", "RESTO"] },
  "src/app/(stock)/stock/journalier/fiches-data.ts": { n: 3, raisons: ["CLE", "LEGUMES", "RESTO"] }, // fiche « Commande journalière » = classeur de la Direction
  "src/app/(stock)/stock/journalier/import-classeur-actions.ts": { n: 1, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/journalier/import-commande-actions.ts": { n: 1, raisons: ["IMPORT"] },
  "src/app/(stock)/stock/journalier/table-conso.tsx": { n: 3, raisons: ["AMONT", "RESTO"] },
  "src/app/(stock)/stock/journalier/ventes-grid.tsx": { n: 9, raisons: ["VENTES"] },
  "src/app/(stock)/stock/mouvements/actions.ts": { n: 4, raisons: ["CLE"] }, // articles proches
  "src/app/(stock)/stock/mouvements/mouvements-client.tsx": { n: 5, raisons: ["AMONT", "CLE"] }, // mouvements/page (versLite) + articles proches
  "src/app/(stock)/stock/mouvements/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/page.tsx": { n: 3, raisons: ["AMONT", "FIGE"] }, // indicateurs/stock + palmarès des lignes de bon
  "src/app/(stock)/stock/recherche/page.tsx": { n: 2, raisons: ["CLE"] },
  "src/app/(stock)/stock/reconciliation/fiche/charger-articles.ts": { n: 1, raisons: ["CLE"] },
  "src/app/(stock)/stock/reconciliation/page.tsx": { n: 1, raisons: ["FORMULAIRE"] },
  "src/app/(stock)/stock/reconciliation/reconciliation-client.tsx": { n: 2, raisons: ["CLE"] },
  "src/app/(stock)/stock/restaurant/actions.ts": { n: 3, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/bandeau-livraisons.tsx": { n: 6, raisons: ["AMONT", "RESTO"] }, // stock-restaurant-charger, rattachement-auto
  "src/app/(stock)/stock/restaurant/choix-article.tsx": { n: 2, raisons: ["AMONT"] }, // restaurant/page
  "src/app/(stock)/stock/restaurant/export-data.ts": { n: 1, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/page.tsx": { n: 1, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/restaurant-client.tsx": { n: 12, raisons: ["RESTO"] },
  "src/app/(stock)/stock/restaurant/restaurant-ecran.tsx": { n: 2, raisons: ["AMONT"] },
  "src/app/(exploitation)/exploitation/page.tsx": { n: 2, raisons: ["AMONT"] }, // indicateurs/stock
  "src/lib/pdf/fiche-achat-legumes.tsx": { n: 1, raisons: ["LEGUMES"] },
  "src/lib/pdf/fiche-inventaire-resto.tsx": { n: 2, raisons: ["RESTO"] },
};

/** Sélections Prisma de la désignation SANS la contenance : seulement là où le nom sert de clé (nombre exact). */
const SELECTS_SANS_CONTENANCE: Record<string, { n: number; raison: string }> = {
  "src/app/(stock)/stock/catalogue/actions.ts": { n: 3, raison: "anti-doublon à la création, messages et journal d'audit (vraie désignation)" },
  "src/app/(stock)/stock/entree/actions.ts": { n: 1, raison: "anti-doublon de la Liste d'achat, sous verrou" },
  "src/app/(stock)/stock/factures/actions.ts": { n: 1, raison: "import PDF d'une facture : rapprochement des lignes avec le catalogue" },
  "src/app/(stock)/stock/journalier/fiches-data.ts": { n: 1, raison: "fiche « Commande journalière » : noms du classeur de la Direction (clé)" },
  "src/app/(stock)/stock/journalier/import-commande-actions.ts": { n: 2, raison: "import du classeur Commande : rapprochement par nom" },
  "src/lib/doublons-imports.ts": { n: 1, raison: "doublons d'import : rapprochement des mouvements importés" },
  "src/lib/import-inventaire.ts": { n: 3, raison: "import d'inventaire : rapprochement et messages d'import" },
  "src/lib/import-mouvements.ts": { n: 1, raison: "import de mouvements : rapprochement par nom et code" },
  "src/lib/rattachement-auto.ts": { n: 2, raison: "rattachement au restaurant : la règle (homonymes, « rattaché à ») compare des noms" },
  "src/lib/validations-stock/article.ts": { n: 2, raison: "modification d'article : message d'erreur et contrôle de domaine ; désignation actuelle comparée au renommage (jamais affichée)" },
  "src/lib/validations-stock/demandes.ts": { n: 2, raison: "demandes à valider : noms figés dans la demande et contrôle d'unicité de la désignation" },
};

/** Fichiers branchés sur le libellé : ils doivent l'appeler (écrans, PDF, exports, notifications, recherche). */
const BRANCHES = [
  // Inventaire / catalogue
  "src/app/(stock)/stock/catalogue/[id]/page.tsx", "src/app/(stock)/stock/catalogue/[id]/pdf/route.ts",
  "src/app/(stock)/stock/catalogue/catalogue-table.tsx", "src/app/(stock)/stock/catalogue/export/route.ts",
  "src/app/(stock)/stock/catalogue/imprimer/page.tsx", "src/app/(stock)/stock/catalogue/pdf/route.ts",
  "src/app/(stock)/stock/cloture/inventaire/route.ts", "src/lib/filtre-inventaire.ts",
  // Liste d'achat
  "src/app/(stock)/stock/entree/page.tsx", "src/app/(stock)/stock/entree/entree-client.tsx", "src/app/(stock)/stock/entree/entree-telephone.tsx",
  "src/app/(stock)/stock/entree/alertes-ligne.tsx", "src/components/stock/choix-article-proche.tsx", "src/lib/achats-liste-serveur.ts",
  // Mouvements + notifications
  "src/app/(stock)/stock/mouvements/page.tsx", "src/app/(stock)/stock/mouvements/mouvements-client.tsx",
  "src/lib/validations-stock/mouvement.ts", "src/lib/validations-stock/date-sortie.ts", "src/lib/validations-stock/stock-positif.ts", "src/lib/alerte-stock.ts",
  // Bons de commande, factures
  "src/app/(stock)/stock/commandes/[id]/page.tsx", "src/lib/pdf/bon-commande.tsx", "src/app/(stock)/stock/commandes/nouveau/nouveau-client.tsx",
  "src/app/(stock)/stock/factures/[id]/page.tsx", "src/app/(stock)/stock/factures/nouveau/nouveau-client.tsx", "src/app/(stock)/stock/factures/actions.ts",
  // Fiches techniques
  "src/app/(stock)/stock/fiches/[id]/editer-fiche.tsx", "src/app/(stock)/stock/fiches/_data/fiche-calc.ts", "src/lib/fiches/disponibilite.ts",
  // Réconciliation
  "src/app/(stock)/stock/reconciliation/reconciliation-client.tsx", "src/app/(stock)/stock/reconciliation/fiche/comptage-data.ts",
  "src/app/(stock)/stock/reconciliation/fiche/charger-articles.ts",
  // Conso. journalière
  "src/app/(stock)/stock/journalier/page.tsx", "src/app/(stock)/stock/journalier/export-data.ts", "src/app/(stock)/stock/journalier/donnees-restaurant.ts",
  // Stock restaurant
  "src/app/(stock)/stock/restaurant/page.tsx", "src/lib/stock-restaurant-charger.ts", "src/lib/rattachement-auto.ts",
  // À valider
  "src/lib/validations-stock/apercu.ts",
  // Tableau de bord, fournisseurs, recherche, rapports
  "src/app/(stock)/stock/page.tsx", "src/lib/indicateurs/stock.ts", "src/lib/dlc-stock.ts",
  "src/app/(stock)/stock/fournisseurs/[id]/page.tsx", "src/app/(stock)/stock/recherche/page.tsx", "src/lib/rapports.ts",
  // Choix d'article partagé (ChoixRecherche)
  "src/lib/recherche-options.ts",
];

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/\.fixture\.ts$/.test(n) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RACINE, p).split(path.sep).join("/");
/** Source sans commentaires (les mots des commentaires ne comptent pas). */
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** Lectures de la désignation : `x.designation`, `x?.designation`, `x["designation"]`, `const { designation } = x`. */
const lecturesDesignation = (src: string) =>
  (sansCommentaires(src).match(/\.designation\b|[\w)\]]\s*\[\s*["'`]designation["'`]\s*\]|\b(?:const|let|var)\s*\{[^}=]*\bdesignation\b[^}=]*\}\s*=/g) ?? []).length;
/** Le bloc `{ … }` (accolades équilibrées) qui commence à `i`. */
function bloc(s: string, i: number): string {
  let n = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") n++;
    else if (s[j] === "}" && --n === 0) return s.slice(i, j + 1);
  }
  return s.slice(i);
}
/** Le premier niveau d'un bloc (sans ses sous-objets) : `{ designation: true, categorie: { … } }` → « designation: true, categorie: ». */
const premierNiveau = (b: string) => { let n = 0, out = ""; for (const c of b) { if (c === "{") n++; else if (c === "}") n--; else if (n === 1) out += c; } return out; };
/** Le bloc `select: { … }` de PREMIER niveau d'un objet d'arguments (`{ where, select: { … } }`), ou null. */
function selectDe(arg: string): string | null {
  let n = 0;
  for (let j = 0; j < arg.length; j++) {
    const c = arg[j];
    if (c === "{") n++;
    else if (c === "}") n--;
    else if (n === 1 && /^select\s*:\s*\{/.test(arg.slice(j, j + 40)) && !/[\w$]/.test(arg[j - 1] ?? "")) return bloc(arg, arg.indexOf("{", j));
  }
  return null;
}
/** Sélections Prisma d'un article (relation ou modèle) qui lisent la désignation sans la contenance. */
function selectsSansContenance(src: string): string[] {
  const s = sansCommentaires(src);
  const blocs: string[] = [];
  for (const m of s.matchAll(/\b(?:article|articleStock)\s*:\s*\{\s*select\s*:\s*(?=\{)/g)) blocs.push(bloc(s, m.index! + m[0].length));
  for (const m of s.matchAll(/\barticleStock\.find(?:Many|Unique|UniqueOrThrow|First|FirstOrThrow)\(\s*(?=\{)/g)) {
    const sel = selectDe(bloc(s, m.index! + m[0].length));
    if (sel) blocs.push(sel);
  }
  return blocs.map(premierNiveau).filter((haut) => /\bdesignation\s*:\s*true\b/.test(haut) && !/contenance|CHAMPS_LIBELLE/.test(haut));
}
/** Variables qui reçoivent un libellé (« const nom = libelleArticle(a) ») : elles ne s'écrivent jamais dans `designation`. */
function ecritLeLibelle(src: string): boolean {
  if (!/libelle(?:Article|LigneArticle)\(/.test(src)) return false; // rien à écrire : lecture rapide
  const s = sansCommentaires(src);
  if (/data\s*:\s*\{[^}]*designation\s*:\s*libelle(?:Article|LigneArticle)\(/.test(s)) return true;
  const vars = [...s.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=[^;\n]*\blibelle(?:Article|LigneArticle)\(/g)].map((m) => m[1]!);
  return vars.some((v) => new RegExp(`data\\s*:\\s*\\{[^}]*\\bdesignation\\s*(?::\\s*${v}\\b|[,}])`).test(s) && (v === "designation" || new RegExp(`designation\\s*:\\s*${v}\\b`).test(s)));
}
/** Appelle-t-il le libellé ? */
const appelleLeLibelle = (src: string) => /\b(?:libelleArticle|libelleLigneArticle|optionsArticles|complementLibelle)\s*\(/.test(sansCommentaires(src));

const lire = (f: string) => readFileSync(path.join(RACINE, f), "utf8");

describe("garde-fou : le nom d'un article s'affiche par libelleArticle (contenance comprise)", () => {
  it("chaque lecture `.designation` des écrans, composants et PDF est recensée (nombre exact) avec sa raison", () => {
    const releve: Record<string, number> = {};
    for (const r of RACINES_AFFICHAGE) for (const p of fichiers(path.join(RACINE, r))) {
      const n = lecturesDesignation(readFileSync(p, "utf8"));
      if (n > 0) releve[rel(p)] = n;
    }
    const attendu = Object.fromEntries(Object.entries(RECENSES).map(([f, v]) => [f, v.n]));
    expect(releve, "nom affiché : libelleArticle(a) ; sinon recenser la lecture ici avec sa raison").toEqual(attendu);
    for (const v of Object.values(RECENSES)) for (const r of v.raisons) expect(RAISONS[r]).toBeTruthy();
  }, 60_000);

  it("une sélection Prisma de la désignation d'un article lit aussi sa contenance (sauf clés recensées, nombre exact)", () => {
    const releve: Record<string, number> = {};
    for (const p of fichiers(path.join(RACINE, "src"))) {
      const n = selectsSansContenance(readFileSync(p, "utf8")).length;
      if (n > 0) releve[rel(p)] = n;
    }
    const attendu = Object.fromEntries(Object.entries(SELECTS_SANS_CONTENANCE).map(([f, v]) => [f, v.n]));
    expect(releve, "afficher le nom : sélectionner CHAMPS_LIBELLE (designation + contenance) ; une clé : la recenser ici").toEqual(attendu);
  }, 60_000);

  it("les écrans, PDF, exports, notifications et la recherche branchés appellent toujours le libellé", () => {
    const debranches = BRANCHES.filter((f) => !existsSync(path.join(RACINE, f)) || !appelleLeLibelle(lire(f)));
    expect(debranches).toEqual([]);
  });

  it("les clés restent sur la désignation BRUTE : anti-doublon, imports, classeurs, audit", () => {
    // Anti-doublon et rapprochements : aucune trace du libellé.
    for (const f of ["src/lib/article-proche.ts", "src/lib/achats-doublons.ts", "src/lib/article-match.ts", "src/lib/import-inventaire.ts",
      "src/lib/import-mouvements.ts", "src/lib/classeur-commande.ts", "src/lib/fiches/classeur-bar.ts", "src/lib/fiches/rattachement-resto.ts",
      "src/lib/fiches-conso.ts", "src/lib/modeles-journaliers/index.ts", "src/lib/audit.ts"]) {
      expect(/libelle-article|libelleArticle|libelleLigneArticle/.test(sansCommentaires(lire(f))), f).toBe(false);
    }
    // Le journal d'audit d'une création, d'une fusion, d'une suppression écrit la vraie désignation.
    const actions = sansCommentaires(lire("src/app/(stock)/stock/catalogue/actions.ts"));
    expect(actions).toMatch(/champ: "suppression", ancienneValeur: a\.designation/);
    expect(actions).not.toMatch(/libelleArticle/);
    // La désignation n'est jamais réécrite avec le libellé (ni `designation: libelleArticle(…)`, ni par une variable qui le porte).
    for (const p of fichiers(path.join(RACINE, "src"))) expect(ecritLeLibelle(readFileSync(p, "utf8")), rel(p)).toBe(false);
  }, 60_000);

  it("l'heuristique reconnaît une lecture brute, une sélection sans contenance et un branchement — et elles seules", () => {
    expect(lecturesDesignation("<td>{a.designation}</td>")).toBe(1);
    expect(lecturesDesignation("<td>{a?.designation ?? '—'}</td> {b!.designation}")).toBe(2);
    expect(lecturesDesignation("// a.designation\n/* b.designation */ <td>{libelleArticle(a)}</td>")).toBe(0);
    expect(lecturesDesignation('orderBy: { designation: "asc" }, select: { designation: true }, by: ["designation"]')).toBe(0);
    expect(lecturesDesignation('a["designation"]; const { id, designation } = a;')).toBe(2);
    expect(selectsSansContenance("include: { article: { select: { designation: true, unite: true } } }")).toHaveLength(1);
    expect(selectsSansContenance("include: { article: { select: { designation: true, categorie: { select: { nom: true } } } } }")).toHaveLength(1);
    expect(selectsSansContenance("prisma.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true } })")).toHaveLength(1);
    expect(selectsSansContenance("prisma.articleStock.findMany({ select: { id: true, ...CHAMPS_LIBELLE, categorie: { select: { designation: true } } } })")).toHaveLength(0);
    expect(ecritLeLibelle("const nom = libelleArticle(a); await tx.articleStock.create({ data: { designation: nom } });")).toBe(true);
    expect(ecritLeLibelle("const designation = libelleArticle(a); await tx.articleStock.create({ data: { designation, domaine } });")).toBe(true);
    expect(ecritLeLibelle("const t = libelleArticle(a); await tx.articleStock.create({ data: { designation: d } });")).toBe(false);
    expect(selectsSansContenance("include: { article: { select: { ...CHAMPS_LIBELLE, unite: true } } }")).toHaveLength(0);
    expect(selectsSansContenance("include: { article: { select: { designation: true, contenance: true, contenanceUnite: true } } }")).toHaveLength(0);
    expect(selectsSansContenance("include: { article: { select: { unite: true } } }")).toHaveLength(0);
    expect(appelleLeLibelle("const t = libelleArticle(a);")).toBe(true);
    expect(appelleLeLibelle("// libelleArticle(a)\nconst t = a.designation;")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : AUCUNE LECTURE DU PRIX D'UN ARTICLE N'IGNORE LE PRIX EN FRANCS (2026-10-08).
 *
 * Depuis la demande de la Direction (« prix unitaire des articles en francs congolais aussi »), un
 * article a son prix soit en dollars (`prixUnitaireUSD`), soit en francs (`prixUnitaireCDF`,
 * `devisePrix` CDF) — et alors `prixUnitaireUSD` est NUL. Un écran qui ne lirait que
 * `prixUnitaireUSD` verrait un article en francs « sans prix » : coût de fiche partiel, valeur du
 * stock amputée, prix proposé vide — en silence. La porte de lecture est src/lib/prix-article.ts.
 *
 * Ce test parcourt `src/` À CHAQUE PASSAGE et relit chaque SÉLECTION Prisma du prix d'un ARTICLE
 * (`prixUnitaireUSD: true` dans un `select` de `articleStock.find…`, dans `article: { select: … }`,
 * ou dans `SELECT_ARTICLE`) : elle doit sélectionner AUSSI `devisePrix` et `prixUnitaireCDF`. Le SQL
 * brut qui lit `a."prixUnitaireUSD"` doit lire aussi `"prixUnitaireCDF"`.
 *
 * UNION PLATE de deux détections indépendantes (sélection Prisma ; SQL brut) — ne pas « simplifier »
 * en une seule : l'une ne voit pas l'autre.
 *
 * Ce qu'il ne couvre PAS : un `include: { article: true }` ou un `findMany` sans `select` (tous les
 * champs reviennent, rien à vérifier dans le texte) ; et il prouve que les deux prix sont LUS, pas
 * qu'ils sont bien utilisés — ce sont les tests d'intégration (prix-francs.integration.test.ts,
 * indicateurs) qui le vérifient. Les lignes de facture / de bon de commande (`prixUnitaireUSD` d'une
 * LIGNE, toujours en dollars) ne sont pas concernées et ne le déclenchent pas.
 */

const SRC = path.join(__dirname, "..");

/** Exceptions NOMMÉES : fichiers qui lisent le prix en dollars d'un article SANS en avoir besoin en francs. */
const EXCEPTIONS: Record<string, string> = {
  "lib/import-inventaire.ts": "Écrivain de l'import d'inventaire (classeur en dollars) : il lit la devise pour NE PAS écrire de dollars sur un article en francs, et garde l'ancien prix en dollars pour l'annulation.",
};

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "test") out.push(...fichiers(p)); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

/** L'objet `{ … }` qui contient la position `i` (accolades équilibrées), avec le texte qui le précède. */
function objetEnglobant(src: string, i: number): { objet: string; avant: string } {
  let d = 0, debut = i;
  for (; debut >= 0; debut--) {
    if (src[debut] === "}") d++;
    else if (src[debut] === "{") { if (d === 0) break; d--; }
  }
  let f = i, p = 0;
  for (; f < src.length; f++) {
    if (src[f] === "{") p++;
    else if (src[f] === "}") { if (p === 0) break; p--; }
  }
  return { objet: src.slice(debut, f + 1), avant: src.slice(Math.max(0, debut - 400), debut) };
}

/** Sélection du prix d'un ARTICLE (et non d'une ligne de facture / de bon) ? */
export function estSelectionArticle(avant: string): boolean {
  if (/\barticle:\s*\{\s*select:\s*$/.test(avant)) return true;
  if (/\bSELECT_ARTICLE\s*=\s*$/.test(avant)) return true;
  if (!/\bselect:\s*$/.test(avant)) return false;
  // Le `select` de premier niveau d'un appel `articleStock.find…({ … select: {`, et pas celui d'un objet imbriqué (`lignes: { select: {`).
  const appels = [...avant.matchAll(/\b(\w+)\.(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow)\(\{/g)];
  const dernier = appels.at(-1);
  if (!dernier || dernier[1] !== "articleStock") return false;
  const suite = avant.slice(dernier.index! + dernier[0].length);
  // Entre l'appel et ce `select`, aucune clé imbriquée ouverte (profondeur 0).
  let prof = 0;
  for (const c of suite) { if (c === "{") prof++; else if (c === "}") prof--; }
  return prof === 0;
}

/** Fautes d'un source : sélections du prix d'un article sans la devise ni le prix en francs ; SQL brut idem. */
export function fautesPrix(src: string): string[] {
  const fautes: string[] = [];
  for (const m of src.matchAll(/\bprixUnitaireUSD:\s*true\b/g)) {
    const { objet, avant } = objetEnglobant(src, m.index!);
    if (!estSelectionArticle(avant)) continue;
    if (!/\bdevisePrix:\s*true\b/.test(objet) || !/\bprixUnitaireCDF:\s*true\b/.test(objet)) fautes.push(objet.replace(/\s+/g, " ").slice(0, 140));
  }
  if (/\b\w+\."prixUnitaireUSD"/.test(src) && !/"prixUnitaireCDF"/.test(src)) fautes.push("SQL brut : prixUnitaireUSD d'un article lu sans prixUnitaireCDF");
  return fautes;
}

/** Nombre de sélections du prix d'un article reconnues dans un source (pour le plancher anti-silence). */
const selectionsArticle = (src: string) => [...src.matchAll(/\bprixUnitaireUSD:\s*true\b/g)].filter((m) => estSelectionArticle(objetEnglobant(src, m.index!).avant)).length;

describe("lecture du prix d'un article : toujours avec sa devise et son prix en francs", () => {
  const tous = fichiers(SRC).map((p) => ({ f: rel(p), src: fs.readFileSync(p, "utf8") }));

  it("aucune sélection du prix d'un article sans devisePrix ni prixUnitaireCDF (hors exceptions nommées)", () => {
    const fautes = tous.filter(({ f }) => !(f in EXCEPTIONS)).flatMap(({ f, src }) => fautesPrix(src).map((x) => `${f} → ${x}`));
    expect(fautes).toEqual([]);
  });

  it("exceptions non périmées : chaque fichier existe et lit toujours le prix d'un article", () => {
    for (const f of Object.keys(EXCEPTIONS)) {
      const t = tous.find((x) => x.f === f);
      expect(t, f).toBeDefined();
      expect(selectionsArticle(t!.src), f).toBeGreaterThan(0);
    }
  });

  it("plancher anti-silence : l'énumération reconnaît bien les lectures connues du dépôt", () => {
    const total = tous.reduce((n, { src }) => n + selectionsArticle(src), 0);
    expect(total).toBeGreaterThanOrEqual(12);
    // Les écrans repérés à la livraison (2026-10-08) sont bien vus par la détection.
    for (const f of ["app/(stock)/stock/entree/page.tsx", "app/(stock)/stock/commandes/nouveau/page.tsx", "app/(stock)/stock/factures/nouveau/page.tsx", "lib/indicateurs/stock.ts", "app/(stock)/stock/fiches/_data/charger-fiche.ts", "app/(stock)/stock/mouvements/page.tsx"]) {
      expect(selectionsArticle(tous.find((x) => x.f === f)!.src), f).toBeGreaterThan(0);
    }
  });

  it("falsification : les formes HISTORIQUES (avant le 2026-10-08) sont refusées, une ligne de facture ne l'est pas", () => {
    // Indicateurs du Stock, tels qu'avant :
    expect(fautesPrix("prisma.stock.findMany({ include: { article: { select: { designation: true, prixUnitaireUSD: true } } } }),")).toHaveLength(1);
    // Nouveau bon de commande, tel qu'avant :
    expect(fautesPrix('prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, nomCourt: true, code: true, prixUnitaireUSD: true, uniteParCarton: true } }),')).toHaveLength(1);
    // Fiches techniques (constante de sélection), telle qu'avant :
    expect(fautesPrix("const SELECT_ARTICLE = {\n  id: true,\n  prixUnitaireUSD: true,\n  actif: true,\n} satisfies X;")).toHaveLength(1);
    // Consommation du mois en SQL brut, telle qu'avant :
    expect(fautesPrix('SELECT SUM(COALESCE(m."montantUSD", m."quantite" * a."prixUnitaireUSD"))')).toHaveLength(1);
    // Sens inverse : les lignes de facture / de bon (toujours en dollars) ne déclenchent rien.
    expect(fautesPrix("prisma.ligneFacture.findMany({ where: { x: 1 }, select: { articleId: true, prixUnitaireUSD: true, quantite: true, facture: { select: { id: true } } } }),")).toEqual([]);
    expect(fautesPrix("prisma.bonDeCommande.findMany({ select: { id: true, lignes: { select: { articleId: true, quantite: true, prixUnitaireUSD: true } } } }),")).toEqual([]);
    expect(fautesPrix("prisma.articleStock.findMany({ select: { id: true, lignesFacture: { select: { prixUnitaireUSD: true } } } })")).toEqual([]);
    // …et la forme corrigée passe.
    expect(fautesPrix("prisma.stock.findMany({ include: { article: { select: { designation: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } } } })")).toEqual([]);
  });
});

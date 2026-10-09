import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : AUCUNE LECTURE DU MONTANT OU DU RESTE D'UNE FACTURE N'IGNORE SA DEVISE (2026-10-09).
 *
 * Depuis la demande de la Direction (« les factures fournisseurs doivent aussi être en francs
 * congolais au choix »), une facture est soit en dollars (`montantUSD`, `montantRegleUSD`,
 * `resteAPayerUSD`), soit en francs (`montantCDF`, `montantRegleCDF`, `resteAPayerCDF`, `devise`
 * CDF) — et alors ses colonnes en dollars sont NULLES. Un écran qui ne lirait que les dollars verrait
 * une facture en francs « à 0 » : reste dû oublié, total amputé, statut faux — EN SILENCE (Number(null)
 * vaut 0, et une somme SQL ignore les NULL). La porte de lecture est src/lib/facture-devise.ts.
 *
 * Ce test parcourt `src/` À CHAQUE PASSAGE. UNION PLATE de quatre détections indépendantes — ne pas
 * « simplifier » en une seule, aucune ne voit ce que voient les autres :
 *  1. SÉLECTION Prisma d'un montant de facture (`resteAPayerUSD: true`, `montantRegleUSD: true`, ou
 *     `montantUSD: true` dans un appel `factureFournisseur.…` / un `facture: { select: … }`) : l'objet
 *     sélectionné doit lire aussi `devise: true` ou la colonne en francs correspondante.
 *  2. FILTRE Prisma sur le reste en dollars (`resteAPayerUSD: { gt: … }`) : la même expression doit
 *     filtrer aussi `resteAPayerCDF` (sinon les factures en francs disparaissent du filtre).
 *  3. SQL BRUT sur "FactureFournisseur" qui lit "montantUSD" / "resteAPayerUSD" / "montantRegleUSD" :
 *     le fichier doit lire aussi la colonne en francs ("…CDF").
 *  4. LECTURE DIRECTE d'un champ (`x.resteAPayerUSD`, `x.montantRegleUSD`) : le fichier doit passer
 *     par la porte (`montantsFacture`, `resteFacture`, `totalFactures`, `deviseFacture`) ou lire la
 *     devise de l'objet (`x.devise`) — le simple MOT « devise » ne suffit pas.
 *  5. SÉLECTION Prisma du prix ou du total d'une LIGNE de facture (`ligneFacture.find…`,
 *     `lignesFacture: { select`, `lignes: { select` dans un appel `factureFournisseur.…`) : doit lire
 *     aussi `prixUnitaireCDF` / `totalLigneCDF`.
 *  6. SÉLECTION Prisma du montant d'un PAIEMENT (`paiement.…`, `paiements: { select`) : doit lire
 *     aussi `devise` ou `montantCDF` (le montant en dollars d'un paiement sur facture en francs est NUL).
 *
 * Relecture du 2026-10-09 : la détection SQL juge chaque gabarit À PART (un gabarit qui lit les francs
 * ne couvre pas son voisin) ; la détection 4 n'accepte plus le mot « devise » n'importe où.
 *
 * Ce qu'il ne couvre PAS : un `include: { factures: true }`, `include: { lignes: true }` ou un
 * `findMany` sans `select` (tous les champs reviennent, rien à vérifier dans le texte) suivi d'une
 * lecture `Number(f.montantUSD)` / `Number(l.totalLigneUSD)` — `montantUSD`, `prixUnitaireUSD` et
 * `totalLigneUSD` sont aussi des champs des mouvements, des paiements, des bons de commande (en
 * dollars) : trop ambigus en lecture directe. Ni un `orderBy` / `where` sur `montantUSD` d'une facture.
 * Et il prouve que la devise est LUE, pas qu'elle est bien utilisée : ce sont les tests d'intégration
 * (factures-francs.integration.test.ts) qui le vérifient.
 */

const SRC = path.join(__dirname, "..");

/** Exceptions NOMMÉES : fichiers qui lisent les colonnes en dollars d'une facture sans en avoir besoin en francs. */
const EXCEPTIONS: Record<string, string> = {
  "lib/facture-devise.ts": "La porte de lecture elle-même.",
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
  return { objet: src.slice(debut, f + 1), avant: src.slice(Math.max(0, debut - 500), debut) };
}

/**
 * Le tableau `OR: [ … ]` / `AND: [ … ]` dont l'objet qui contient la position `i` est un ÉLÉMENT
 * direct ; chaîne vide sinon. On remonte en sautant les paires équilibrées : le premier ouvrant non
 * apparié est l'objet du filtre (`{`), le suivant doit être le `[` du tableau.
 */
function tableauEnglobant(src: string, i: number): string {
  const OUVRANT: Record<string, string> = { "}": "{", "]": "[", ")": "(" };
  const pile: string[] = [];
  const nonApparies: number[] = [];
  for (let k = i; k >= 0 && nonApparies.length < 2; k--) {
    const c = src[k];
    if (c in OUVRANT) pile.push(OUVRANT[c]);
    else if (c === "{" || c === "[" || c === "(") { if (pile.length > 0) pile.pop(); else nonApparies.push(k); }
  }
  if (nonApparies.length < 2 || src[nonApparies[0]] !== "{" || src[nonApparies[1]] !== "[") return "";
  const debut = nonApparies[1];
  if (!/\b(?:OR|AND):\s*$/.test(src.slice(Math.max(0, debut - 20), debut))) return "";
  let f = debut + 1, p = 0;
  for (; f < src.length; f++) { if (src[f] === "[") p++; else if (src[f] === "]") { if (p === 0) break; p--; } }
  return src.slice(debut, f + 1);
}

/** `montantUSD: true` est-il celui d'une FACTURE (appel factureFournisseur.…, ou `facture(s): { select:`) ? */
export function estSelectionFacture(avant: string): boolean {
  if (/\bfactures?:\s*\{\s*select:\s*$/.test(avant)) return true;
  if (!/\b(?:select|_sum):\s*$/.test(avant)) return false;
  const appels = [...avant.matchAll(/\b(\w+)\.(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|aggregate|groupBy)\(\{/g)];
  const dernier = appels.at(-1);
  if (!dernier || dernier[1] !== "factureFournisseur") return false;
  let prof = 0;
  for (const c of avant.slice(dernier.index! + dernier[0].length)) { if (c === "{") prof++; else if (c === "}") prof--; }
  return prof === 0;
}

/** Sélection du prix/total d'une LIGNE DE FACTURE ? */
export function estSelectionLigneFacture(avant: string): boolean {
  if (/\blignesFacture:\s*\{\s*select:\s*$/.test(avant)) return true;
  const appels = [...avant.matchAll(/\b(\w+)\.(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|aggregate|groupBy)\(\{/g)];
  const dernier = appels.at(-1);
  if (!dernier) return false;
  if (dernier[1] === "factureFournisseur" && /\blignes:\s*\{\s*select:\s*$/.test(avant)) return true;
  if (dernier[1] !== "ligneFacture" || !/\bselect:\s*$/.test(avant)) return false;
  let prof = 0;
  for (const c of avant.slice(dernier.index! + dernier[0].length)) { if (c === "{") prof++; else if (c === "}") prof--; }
  return prof === 0;
}

/** Sélection du montant d'un PAIEMENT ? */
export function estSelectionPaiement(avant: string): boolean {
  if (/\bpaiements:\s*\{\s*select:\s*$/.test(avant)) return true;
  if (!/\b(?:select|_sum):\s*$/.test(avant)) return false;
  const appels = [...avant.matchAll(/\b(\w+)\.(?:findMany|findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|aggregate|groupBy)\(\{/g)];
  const dernier = appels.at(-1);
  if (!dernier || dernier[1] !== "paiement") return false;
  let prof = 0;
  for (const c of avant.slice(dernier.index! + dernier[0].length)) { if (c === "{") prof++; else if (c === "}") prof--; }
  return prof === 0;
}

const CDF_DE: Record<string, string> = { montantUSD: "montantCDF", montantRegleUSD: "montantRegleCDF", resteAPayerUSD: "resteAPayerCDF" };

/** Fautes d'un source (quatre détections réunies). */
export function fautesDevise(src: string): string[] {
  const fautes: string[] = [];
  // 1. Sélections Prisma.
  for (const m of src.matchAll(/\b(montantUSD|montantRegleUSD|resteAPayerUSD):\s*true\b/g)) {
    const { objet, avant } = objetEnglobant(src, m.index!);
    if (m[1] === "montantUSD" && !estSelectionFacture(avant)) continue;
    if (!/\bdevise:\s*true\b/.test(objet) && !new RegExp(`\\b${CDF_DE[m[1]]}:\\s*true\\b`).test(objet)) fautes.push(`sélection : ${objet.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  // 2. Filtres sur le reste en dollars : l'objet du filtre lui-même, ou le tableau `OR: [ … ]` qui le
  //    contient, doit filtrer aussi le reste en francs (une simple MENTION voisine, dans un `select`
  //    par exemple, ne suffit pas).
  for (const m of src.matchAll(/\bresteAPayerUSD:\s*\{\s*(?:gt|gte|lt|lte|not)\b/g)) {
    const { objet } = objetEnglobant(src, m.index!);
    if (/\bresteAPayerCDF\b/.test(objet)) continue;
    if (/\bresteAPayerCDF\b/.test(tableauEnglobant(src, m.index!))) continue;
    fautes.push(`filtre : ${objet.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  // 3. SQL brut : CHAQUE gabarit (`…`) qui vise "FactureFournisseur" ou "Paiement", jugé à part —
  //    pas une chaîne quelconque (un nom de champ de formulaire « montantRegleUSD » n'est pas du SQL).
  for (const m of src.matchAll(/`[^`]*`/g)) {
    const t = m[0];
    if (!/"(?:FactureFournisseur|Paiement)"/.test(t)) continue;
    if (/"(?:montantUSD|resteAPayerUSD|montantRegleUSD)"/.test(t) && !/"(?:montantCDF|resteAPayerCDF|montantRegleCDF|devise)"/.test(t)) fautes.push(`SQL brut : montants d'une facture lus sans les colonnes en francs (${t.replace(/\s+/g, " ").slice(0, 80)})`);
  }
  // 4. Lectures directes du réglé / du reste.
  if (/\.(?:resteAPayerUSD|montantRegleUSD)\b/.test(src) && !/\b(?:montantsFacture|resteFacture|totalFactures|deviseFacture)\(|\.devise\b/.test(src)) fautes.push("lecture directe du réglé/reste en dollars sans la devise");
  // 5. Lignes de facture.
  for (const m of src.matchAll(/\b(prixUnitaireUSD|totalLigneUSD):\s*true\b/g)) {
    const { objet, avant } = objetEnglobant(src, m.index!);
    if (!estSelectionLigneFacture(avant)) continue;
    const cdf = m[1] === "prixUnitaireUSD" ? "prixUnitaireCDF" : "totalLigneCDF";
    if (!new RegExp(`\\b${cdf}:\\s*true\\b`).test(objet)) fautes.push(`ligne de facture : ${objet.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  // 6. Paiements.
  for (const m of src.matchAll(/\bmontantUSD:\s*true\b/g)) {
    const { objet, avant } = objetEnglobant(src, m.index!);
    if (!estSelectionPaiement(avant)) continue;
    if (!/\b(?:devise|montantCDF):\s*true\b/.test(objet)) fautes.push(`paiement : ${objet.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  return fautes;
}

const lectures = (src: string) => [...src.matchAll(/\b(?:montantRegleUSD|resteAPayerUSD):\s*true\b|\.(?:resteAPayerUSD|montantRegleUSD)\b|"(?:resteAPayerUSD|montantRegleUSD)"/g)].length
  + [...src.matchAll(/\bmontantUSD:\s*true\b/g)].filter((m) => estSelectionFacture(objetEnglobant(src, m.index!).avant)).length;

describe("lecture du montant d'une facture : toujours avec sa devise", () => {
  const tous = fichiers(SRC).map((p) => ({ f: rel(p), src: fs.readFileSync(p, "utf8") }));

  it("aucune lecture du montant, du réglé ou du reste d'une facture sans sa devise (hors exceptions nommées)", () => {
    const fautes = tous.filter(({ f }) => !(f in EXCEPTIONS)).flatMap(({ f, src }) => fautesDevise(src).map((x) => `${f} → ${x}`));
    expect(fautes).toEqual([]);
  });

  it("exceptions non périmées : chaque fichier existe et lit toujours les montants d'une facture", () => {
    for (const f of Object.keys(EXCEPTIONS)) {
      const t = tous.find((x) => x.f === f);
      expect(t, f).toBeDefined();
      expect(t!.src, f).toMatch(/resteAPayerUSD/);
    }
  });

  it("plancher anti-silence : l'énumération reconnaît bien les lectures connues du dépôt", () => {
    const total = tous.reduce((n, { src }) => n + lectures(src), 0);
    expect(total).toBeGreaterThanOrEqual(15);
    // Les écrans repérés à la livraison (2026-10-09) sont bien vus par la détection.
    for (const f of ["app/(stock)/stock/factures/page.tsx", "app/(stock)/stock/fournisseurs/[id]/page.tsx", "lib/indicateurs/stock.ts", "lib/alertes.ts", "lib/rapports.ts", "lib/validations-stock/reglement.ts"]) {
      expect(lectures(tous.find((x) => x.f === f)!.src), f).toBeGreaterThan(0);
    }
  });

  it("falsification : les formes HISTORIQUES (avant le 2026-10-09) sont refusées, les lectures légitimes passent", () => {
    // Indicateurs du Stock, tels qu'avant :
    expect(fautesDevise('prisma.factureFournisseur.aggregate({ where: { statut: "ECHUE_NON_REGLEE" }, _sum: { resteAPayerUSD: true }, _count: true }),')).toHaveLength(1);
    // Filtre en dollars seul, mais sélection qui lit les francs : le filtre reste fautif.
    expect(fautesDevise('prisma.factureFournisseur.findMany({ where: { resteAPayerUSD: { gt: 0 } }, select: { devise: true, resteAPayerUSD: true, resteAPayerCDF: true } })')).toHaveLength(1);
    // Alertes, telles qu'avant (filtre ET sélection) :
    expect(fautesDevise('prisma.factureFournisseur.findMany({ where: { statut: { in: ["A_REGLER"] }, resteAPayerUSD: { gt: 0 }, dateEcheance: { not: null } }, select: { resteAPayerUSD: true, statut: true } }),')).toHaveLength(2);
    // Rapport mensuel, tel qu'avant :
    expect(fautesDevise("prisma.factureFournisseur.findMany({ where: { mois: 1 }, select: { montantUSD: true, montantRegleUSD: true, statut: true } }),")).toHaveLength(2);
    // KPIs de l'écran Factures en SQL brut, tels qu'avant :
    expect(fautesDevise('prisma.$queryRaw`SELECT COALESCE(SUM("montantUSD" - "resteAPayerUSD"), 0) FROM "stock"."FactureFournisseur"`')).toHaveLength(1);
    // Sens inverse : un nom de champ de formulaire n'est pas du SQL.
    expect(fautesDevise('formData.get("montantRegleUSD"); tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" FOR UPDATE`')).toEqual([]);
    // Fiche facture, telle qu'avant :
    expect(fautesDevise("<Info label=\"Reste\" val={usd(Number(facture.resteAPayerUSD))} />")).toHaveLength(1);
    // Historique des prix (inventaire-export), tel qu'avant : prix d'une LIGNE de facture sans les francs.
    expect(fautesDevise("prisma.ligneFacture.findMany({ where: { x: 1 }, select: { articleId: true, prixUnitaireUSD: true, quantite: true, facture: { select: { id: true } } } }),")).toHaveLength(1);
    expect(fautesDevise("prisma.factureFournisseur.findMany({ select: { id: true, lignes: { select: { totalLigneUSD: true } } } })")).toHaveLength(1);
    // Paiements en dollars seuls :
    expect(fautesDevise("prisma.paiement.aggregate({ where: { x: 1 }, _sum: { montantUSD: true } })")).toHaveLength(1);
    // Relecture : deux gabarits SQL, l'un lit les francs, l'autre non → l'autre reste fautif.
    expect(fautesDevise('a`SELECT "montantCDF" FROM "stock"."FactureFournisseur"`; b`SELECT "resteAPayerUSD" FROM "stock"."FactureFournisseur"`')).toHaveLength(1);
    // Relecture : le mot « devise » dans un commentaire ne couvre pas une lecture directe.
    expect(fautesDevise("// devise ignorée\nconst r = Number(f.resteAPayerUSD);")).toHaveLength(1);
    // Sens inverse : les lignes d'un BON DE COMMANDE (en dollars) ne déclenchent rien.
    expect(fautesDevise("prisma.bonDeCommande.findMany({ select: { id: true, lignes: { select: { articleId: true, prixUnitaireUSD: true, totalLigneUSD: true } } } })")).toEqual([]);
    // Sens inverse : un mouvement, un achat de légumes, un paiement ne déclenchent rien…
    expect(fautesDevise("prisma.mouvementStock.findMany({ where: { x: 1 }, select: { montantUSD: true, quantite: true } })")).toEqual([]);
    expect(fautesDevise("prisma.achatLegume.aggregate({ where: { x: 1 }, _sum: { montantUSD: true }, _count: true })")).toEqual([]);
    // …et les formes corrigées passent.
    expect(fautesDevise('prisma.factureFournisseur.aggregate({ where: { x: 1 }, _sum: { resteAPayerUSD: true, resteAPayerCDF: true }, _count: true })')).toEqual([]);
    expect(fautesDevise("prisma.factureFournisseur.findMany({ where: { OR: [{ resteAPayerUSD: { gt: 0 } }, { resteAPayerCDF: { gt: 0 } }] }, select: { devise: true, resteAPayerUSD: true, resteAPayerCDF: true } })")).toEqual([]);
    expect(fautesDevise("const m = montantsFacture(f); Number(f.resteAPayerUSD)")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : CHAQUE `page.tsx` D'UN ESPACE APPELLE LA GARDE DE CET ESPACE, AVANT TOUTE LECTURE.
 *
 * Next rend le layout et la page EN PARALLÈLE : le `redirect("/entree")` du layout n'empêche pas la
 * page de s'exécuter, et son rendu part dans le CORPS de la réponse 307 (mesuré le 2026-09-28 sur
 * Next 16.2.9 : un compte refusé par le layout lisait la page entière avec un simple `curl`).
 * Toutes les pages RH et Stock ne comptaient que sur leur layout. Ce test parcourt `src/app` à
 * chaque passage : une nouvelle page sans garde le fait échouer.
 *
 * Règle, par emplacement :
 *   (app)/…          → exigerPageRH           (`@/lib/garde-page`)
 *   (stock)/…        → exigerPageStock        (`@/lib/garde-page`)
 *   (exploitation)/… → exigerPageExploitation (`@/lib/garde-page`)
 *   espace/…         → chargerSalarie         (`app/espace/garde.ts`)
 *   HORS_ESPACE      → liste fermée, chaque entrée justifiée
 *   ailleurs         → ÉCHEC.
 * La garde est le PREMIER `await` de la page (hors `await params` / `await searchParams`, qui ne
 * lisent rien) : appelée après une requête, elle ne protégerait plus ce que la requête a lu.
 */

const APP = path.join(__dirname);

const HORS_ESPACE: Record<string, string> = {
  "page.tsx": "Racine : redirige vers /accueil, ne lit rien.",
  "login/page.tsx": "Écran de connexion, public.",
  "mot-de-passe-oublie/page.tsx": "Formulaire public de réinitialisation, ne lit rien.",
  "reinitialiser/page.tsx": "Formulaire public (jeton dans l'URL, vérifié par l'action), ne lit rien.",
  "hors-ligne/page.tsx": "Page de secours du service worker, statique.",
  "entree/page.tsx": "Résolveur d'espace : ne lit que le compte connecté, puis redirige.",
  "choix-espace/page.tsx": "Sélecteur d'espace : ne montre que les espaces du compte connecté.",
  "scan/page.tsx": "Scan de l'affiche QR : ne lit que le compte connecté (pointage toujours pour soi).",
  "espace/mot-de-passe/page.tsx":
    "Changement du mot de passe : a sa propre règle (formulaireMotDePasseOuvert, y compris hors espace salarié ouvert) et ne lit que le compte connecté.",
};

const GARDES: [prefixe: string, garde: string, source: RegExp][] = [
  ["(app)/", "exigerPageRH", /from\s*"@\/lib\/garde-page"/],
  ["(stock)/", "exigerPageStock", /from\s*"@\/lib\/garde-page"/],
  ["(exploitation)/", "exigerPageExploitation", /from\s*"@\/lib\/garde-page"/],
  ["espace/", "chargerSalarie", /from\s*"(?:\.\.?\/)+garde"/],
];

function pagesDuDepot(dir: string = APP): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...pagesDuDepot(p));
    else if (/^page\.(tsx|ts|jsx|js)$/.test(e.name)) out.push(path.relative(APP, p).split(path.sep).join("/"));
  }
  return out.sort();
}

function sansCommentaires(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Corps de la fonction exportée par défaut (de l'accolade ouvrante à la fin du fichier). */
function corpsParDefaut(src: string): string | null {
  const m = /export\s+default\s+(?:async\s+)?function\s*\w*\s*\(/.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let prof = 1;
  while (prof > 0 && i < src.length) {
    const c = src[i++];
    if (c === "(") prof++;
    else if (c === ")") prof--;
  }
  const ouv = src.indexOf("{", i);
  return ouv < 0 ? null : src.slice(ouv + 1);
}

/** Manquements d'une page (vide = conforme). */
function manquements(rel: string, source: string): string[] {
  if (rel in HORS_ESPACE) return [];
  const regle = GARDES.find(([p]) => rel.startsWith(p));
  if (!regle) return [`${rel} : page hors de tout espace — la garder ou la classer dans HORS_ESPACE avec une justification`];
  const [, garde, source_] = regle;
  const src = sansCommentaires(source);
  const erreurs: string[] = [];
  if (!new RegExp(`import\\s*\\{[^}]*\\b${garde}\\b[^}]*\\}\\s*${source_.source}`).test(src))
    erreurs.push(`${rel} : ${garde} doit être importée de sa source (${source_.source})`);
  const corps = corpsParDefaut(src);
  if (!corps) return [...erreurs, `${rel} : pas de \`export default function\` analysable`];
  const neutre = corps.replace(/await\s+(?:params|searchParams)\b/g, "PARAMS");
  const premierAwait = /\bawait\s+([\w.]+)\s*\(/.exec(neutre);
  if (!premierAwait || premierAwait[1] !== garde)
    erreurs.push(`${rel} : ${garde}() doit être le PREMIER await de la page (trouvé : ${premierAwait?.[1] ?? "aucun"})`);
  return erreurs;
}

describe("chaque page.tsx appelle la garde de son espace", () => {
  const pages = pagesDuDepot();

  it("le parcours trouve bien les pages (garde contre un faux vert)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(75);
    expect(pages).toContain("(app)/paie/page.tsx");
    expect(pages).toContain("(stock)/stock/factures/page.tsx");
    expect(pages).toContain("espace/paie/page.tsx");
  });

  it.each(pages)("%s", (rel) => {
    expect(manquements(rel, fs.readFileSync(path.join(APP, rel), "utf8"))).toEqual([]);
  });

  it("la liste HORS_ESPACE est fermée : chaque entrée existe encore", () => {
    for (const rel of Object.keys(HORS_ESPACE)) expect(pages).toContain(rel);
  });
});

describe("le garde-fou des pages mord (falsification en mémoire)", () => {
  const rel = "(app)/paie/page.tsx";
  const vrai = fs.readFileSync(path.join(APP, rel), "utf8");

  it("la page réelle est conforme", () => {
    expect(manquements(rel, vrai)).toEqual([]);
  });

  it("garde remplacée par verifySession seul → refusé", () => {
    const f = vrai.replace("await exigerPageRH()", "await verifySession()");
    expect(f).not.toBe(vrai);
    expect(manquements(rel, f).join("\n")).toMatch(/PREMIER await/);
  });

  it("garde appelée APRÈS une lecture de la base → refusé", () => {
    const f = vrai.replace(/(export default async function PaiePage\([\s\S]*?\)\s*\{)/, "$1\n  await prisma.payrollRun.findFirst();");
    expect(f).not.toBe(vrai);
    expect(manquements(rel, f).join("\n")).toMatch(/PREMIER await.*prisma\.payrollRun\.findFirst/);
  });

  it("garde d'un AUTRE espace (Stock sur une page RH) → refusé", () => {
    const f = vrai.replaceAll("exigerPageRH", "exigerPageStock");
    expect(manquements(rel, f).join("\n")).toMatch(/exigerPageRH/);
  });

  it("page nouvelle hors de tout espace → refusée", () => {
    expect(manquements("rapport-secret/page.tsx", "export default async function P() { return null; }").join("\n")).toMatch(/hors de tout espace/);
  });

  it("page salarié sans chargerSalarie → refusée", () => {
    const relE = "espace/paie/page.tsx";
    const vraiE = fs.readFileSync(path.join(APP, relE), "utf8");
    expect(manquements(relE, vraiE)).toEqual([]);
    expect(manquements(relE, vraiE.replace("await chargerSalarie()", "await verifySession()")).join("\n")).toMatch(/PREMIER await/);
  });
});

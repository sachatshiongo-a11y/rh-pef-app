import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : CHAQUE `route.ts` DU DÉPÔT APPELLE LA GARDE DE SON ESPACE.
 *
 * Un Route Handler n'hérite PAS de la garde du layout de son groupe. Le 2026-09-28, on a mesuré
 * que `(app)/paie/bulletins-zip`, `(app)/paie/bulletin/[id]`, `(app)/employes/[id]/fiche`,
 * `(app)/declarations/export`… n'appelaient que `verifySession()` : un salarié connecté
 * téléchargeait les bulletins de toute la brigade. Ce test parcourt `src/app` À CHAQUE PASSAGE —
 * un nouveau `route.ts` sans garde le fait échouer, sans que personne ait à penser à l'ajouter ici.
 *
 * Règle, par emplacement :
 *   (app)/…          → exigerEspaceRH            (layout RH : estRH)
 *   (stock)/…        → exigerEspaceStock         (layout Stock : estStock)
 *   (exploitation)/… → exigerEspaceExploitation  (layout Exploitation : estExploitation)
 *   espace/…         → exigerEspaceSalarie       (layout salarié : espace ouvert + fiche liée)
 *   fichiers/…       → exigerAccesFichier        (propriétaire lu en base)
 *   liste PUBLIQUES  → fermée, chaque entrée justifiée
 *   ailleurs         → ÉCHEC : une route qui n'est dans aucun espace doit être classée ici.
 *
 * Et pour chaque handler exporté (GET, POST…) : la garde, importée de `@/lib/garde-route`, est le
 * PREMIER `await` (hormis `await params`), et son refus est rendu tel quel à l'instruction suivante
 * (`if (!g.ok) return g.reponse;`). Une garde appelée APRÈS avoir lu la base, ou dont le résultat
 * est ignoré, ne protège rien.
 */

const APP = path.join(__dirname);

type Regle = { garde: string } | { publique: string; jeton?: string };

/** Routes PUBLIQUES (sans session). Liste FERMÉE : ajouter une entrée exige une justification. */
const PUBLIQUES: Record<string, { justification: string; jeton?: string }> = {
  "api/version/route.ts": {
    justification:
      "Renvoie seulement l'identifiant court du commit déployé, interrogé par le bandeau « Nouvelle version » de la PWA — y compris sur l'écran de connexion. Aucune donnée.",
  },
  "api/cron/alertes/route.ts": {
    justification: "Déclencheur GitHub Actions (rappels quotidiens) : pas de session, gardé par le jeton CRON_SECRET.",
    jeton: "jetonCronValide",
  },
  "api/cron/rapport-mensuel/route.ts": {
    justification: "Déclencheur GitHub Actions (rapport du 1er du mois) : pas de session, gardé par le jeton CRON_SECRET.",
    jeton: "jetonCronValide",
  },
};

const GARDES_PAR_ESPACE: [prefixe: string, garde: string][] = [
  ["(app)/", "exigerEspaceRH"],
  ["(stock)/", "exigerEspaceStock"],
  ["(exploitation)/", "exigerEspaceExploitation"],
  ["espace/", "exigerEspaceSalarie"],
  ["fichiers/", "exigerAccesFichier"],
];

const METHODES = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

function routesDuDepot(dir: string = APP): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routesDuDepot(p));
    else if (/^route\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(path.relative(APP, p).split(path.sep).join("/"));
  }
  return out.sort();
}

function regleDe(rel: string): Regle | null {
  const pub = PUBLIQUES[rel];
  if (pub) return { publique: pub.justification, jeton: pub.jeton };
  const trouve = GARDES_PAR_ESPACE.find(([prefixe]) => rel.startsWith(prefixe));
  return trouve ? { garde: trouve[1] } : null;
}

/** Retire commentaires et chaînes simples pour que « verifySession() » dans un commentaire ne compte pas. */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Corps de chaque handler exporté, du `export` jusqu'au suivant. */
function handlers(src: string): { methode: string; corps: string }[] {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODES})\\b`, "g");
  const debuts = [...src.matchAll(re)].map((m) => ({ methode: m[1], index: m.index! }));
  return debuts.map((d, i) => {
    const fin = i + 1 < debuts.length ? debuts[i + 1].index : src.length;
    const suivantExport = src.slice(d.index + 1, fin).search(/\nexport\s/);
    return { methode: d.methode, corps: src.slice(d.index, suivantExport >= 0 ? d.index + 1 + suivantExport : fin) };
  });
}

/** Liste des manquements d'un fichier de route (vide = conforme). Exportée pour la falsification. */
function manquements(rel: string, source: string): string[] {
  const regle = regleDe(rel);
  if (!regle) return [`${rel} : route hors de tout espace connu — la classer (garde d'espace ou PUBLIQUES justifiée)`];
  const src = sansCommentaires(source);
  const erreurs: string[] = [];

  if (new RegExp(`export\\s+(?:const|let|var)\\s+(${METHODES})\\b`).test(src) || /export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/.test(src)) {
    erreurs.push(`${rel} : handler exporté sous une forme non vérifiable (écrire \`export async function GET\`)`);
  }
  const hs = handlers(src);
  if (hs.length === 0) erreurs.push(`${rel} : aucun handler \`export async function <MÉTHODE>\` trouvé`);

  if ("publique" in regle) {
    if (regle.jeton) {
      if (!new RegExp(`import\\s*\\{[^}]*\\b${regle.jeton}\\b[^}]*\\}\\s*from\\s*"@/lib/jeton-cron"`).test(src))
        erreurs.push(`${rel} : ${regle.jeton} doit venir de @/lib/jeton-cron`);
      for (const h of hs) {
        const premierAwait = h.corps.search(/\bawait\b/);
        const jeton = h.corps.search(new RegExp(`if\\s*\\(\\s*!${regle.jeton}\\(`));
        if (jeton < 0 || (premierAwait >= 0 && premierAwait < jeton))
          erreurs.push(`${rel} ${h.methode} : le jeton (${regle.jeton}) doit être vérifié avant toute autre opération`);
      }
    }
    return erreurs;
  }

  const garde = regle.garde;
  if (!new RegExp(`import\\s*\\{[^}]*\\b${garde}\\b[^}]*\\}\\s*from\\s*"@/lib/garde-route"`).test(src)) {
    erreurs.push(`${rel} : ${garde} doit être importée de @/lib/garde-route`);
  }
  for (const h of hs) {
    const corps = h.corps.replace(/await\s+params\b/g, "PARAMS");
    const appel = new RegExp(`const\\s+(\\w+)\\s*=\\s*await\\s+${garde}\\(`).exec(corps);
    const premierAwait = corps.search(/\bawait\b/);
    if (!appel) {
      erreurs.push(`${rel} ${h.methode} : n'appelle pas ${garde}()`);
      continue;
    }
    if (premierAwait !== appel.index + appel[0].indexOf("await")) {
      erreurs.push(`${rel} ${h.methode} : ${garde}() doit être le PREMIER await du handler (hors \`await params\`)`);
    }
    const g = appel[1];
    const apres = corps.slice(appel.index + appel[0].length);
    const finAppel = apres.indexOf(";");
    const suite = apres.slice(finAppel + 1);
    if (!new RegExp(`^\\s*if\\s*\\(\\s*!${g}\\.ok\\s*\\)\\s*return\\s+${g}\\.reponse\\s*;`).test(suite)) {
      erreurs.push(`${rel} ${h.methode} : le refus doit être rendu juste après la garde (\`if (!${g}.ok) return ${g}.reponse;\`)`);
    }
  }
  return erreurs;
}

describe("chaque route.ts appelle la garde de son espace", () => {
  const routes = routesDuDepot();

  it("le parcours trouve bien les routes (garde contre un faux vert)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(46);
    expect(routes).toContain("(app)/paie/bulletins-zip/route.ts");
    expect(routes).toContain("fichiers/[...chemin]/route.ts");
  });

  it.each(routes)("%s", (rel) => {
    const source = fs.readFileSync(path.join(APP, rel), "utf8");
    expect(manquements(rel, source)).toEqual([]);
  });

  it("la liste des routes publiques est fermée : chaque entrée existe encore", () => {
    for (const rel of Object.keys(PUBLIQUES)) expect(routes).toContain(rel);
  });
});

describe("le garde-fou mord (falsification en mémoire)", () => {
  const rel = "(app)/paie/bulletins-zip/route.ts";
  const vrai = fs.readFileSync(path.join(APP, rel), "utf8");

  it("la route réelle est conforme", () => {
    expect(manquements(rel, vrai)).toEqual([]);
  });

  it("garde retirée (retour à verifySession seul) → refusé", () => {
    const falsifie = vrai
      .replace(/const g = await exigerEspaceRH\([^)]*\);\s*if \(!g\.ok\) return g\.reponse;/, "await verifySession();");
    expect(falsifie).not.toBe(vrai);
    expect(manquements(rel, falsifie).join("\n")).toMatch(/n'appelle pas exigerEspaceRH/);
  });

  it("résultat de la garde ignoré → refusé", () => {
    const falsifie = vrai.replace(/\s*if \(!g\.ok\) return g\.reponse;/, "");
    expect(manquements(rel, falsifie).join("\n")).toMatch(/refus doit être rendu/);
  });

  it("garde d'un AUTRE espace (Stock sur une route RH) → refusé", () => {
    const falsifie = vrai.replaceAll("exigerEspaceRH", "exigerEspaceStock");
    expect(manquements(rel, falsifie).join("\n")).toMatch(/exigerEspaceRH/);
  });

  it("garde appelée APRÈS une lecture de la base → refusé", () => {
    const falsifie = vrai.replace(
      /(export async function GET\([^)]*\)\s*\{)/,
      "$1\n  await prisma.payrollRun.findFirst();"
    );
    expect(manquements(rel, falsifie).join("\n")).toMatch(/PREMIER await/);
  });

  it("route nouvelle hors de tout espace → refusée", () => {
    expect(manquements("api/nouvelle/route.ts", "export async function GET() { return new Response('x'); }").join("\n")).toMatch(/hors de tout espace/);
  });
});

describe("chaque garde reprend EXACTEMENT le prédicat du layout de son espace", () => {
  const lire = (p: string) => sansCommentaires(fs.readFileSync(path.join(APP, p), "utf8"));
  const garde = sansCommentaires(fs.readFileSync(path.join(APP, "../lib/garde-route.ts"), "utf8"));
  const corpsDe = (nom: string) => {
    const i = garde.indexOf(`export async function ${nom}(`);
    expect(i).toBeGreaterThanOrEqual(0);
    const j = garde.indexOf("\nexport ", i + 1);
    return garde.slice(i, j < 0 ? undefined : j);
  };

  it.each([
    ["(app)/layout.tsx", "if (!estRH(user.role)) redirect(", "exigerEspaceRH", "if (!estRH(user.role)) return refus("],
    ["(stock)/layout.tsx", "if (!estStock(user)) redirect(", "exigerEspaceStock", "if (!estStock(user)) return refus("],
    ["(exploitation)/layout.tsx", "if (!estExploitation(user)) redirect(", "exigerEspaceExploitation", "if (!estExploitation(user)) return refus("],
    ["espace/layout.tsx", "if (!salarieActif || !estSalarie(user)) redirect(", "exigerEspaceSalarie", "if (!(await espaceEmployeActif()) || !estSalarie(user)"],
  ])("%s ↔ %s", (layout, regleLayout, nomGarde, regleGarde) => {
    expect(lire(layout)).toContain(regleLayout);
    expect(corpsDe(nomGarde)).toContain(regleGarde);
  });
});

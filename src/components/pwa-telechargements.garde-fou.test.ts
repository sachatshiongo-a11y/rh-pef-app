import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : AUCUN LIEN NE FAIT NAVIGUER LA FENÊTRE VERS UN FICHIER.
 *
 * « UN DOCUMENT SE RÉCUPÈRE, IL NE SE VISITE PAS. » Dans l'application installée (mode autonome :
 * ni barre d'adresse, ni bouton retour), l'attribut `download` d'une ancre est IGNORÉ et
 * `target="_blank"` n'ouvre aucun onglet : le clic fait naviguer la fenêtre ENTIÈRE vers le PDF.
 * Sur iPhone il n'y a plus aucune sortie, il faut tuer l'application. Signalé par la Direction le
 * 2026-09-30 sur le bon de commande (« piégé dans le logiciel quand on veut télécharger un bon de
 * commande ») ; le même défaut se trouvait sur ~60 liens des espaces Stock, Exploitation et RH
 * (factures, exports Excel, fiches, planning, rapports…).
 *
 * Il n'existe que DEUX chemins sûrs, et ce test refuse tout le reste :
 *   • un TÉLÉCHARGEMENT → `TelechargerLien` / `TelechargerFormulaire` (src/components/telecharger-lien.tsx) :
 *     `fetch` puis feuille de partage ou blob, la fenêtre ne bouge pas ;
 *   • un APERÇU → `ApercuDocumentBouton` (src/components/apercu-document.tsx) : `VisionneuseDocument`
 *     en superposition, qui se referme.
 *
 * CE QUE LE TEST PARCOURT : tout `src/` (hors tests) et refuse, hors des fichiers listés dans
 * `EXCEPTIONS` :
 *   1. l'attribut `download` sur une ancre, et `x.download = …` / `setAttribute("download", …)` ;
 *   2. `target="_blank"` sur une ancre dont l'adresse n'est PAS un site externe (`https://…`) ;
 *   3. `window.open(…)` (quelle que soit l'adresse) et `location.href = …` / `.assign(` / `.replace(` ;
 *   4. une ancre, un `Link`, un formulaire, une iframe dont l'adresse est une route de FICHIER du
 *      dépôt — la liste des routes est LUE dans les `route.ts` réels, jamais recopiée ici ;
 *   5. une ancre dont l'adresse vient d'un champ de fichier stocké (`documentUrl`, `fichierUrl`,
 *      `certificatUrl`…) ou d'un assistant nommé pdf/excel/export/fiche ;
 *   6. `router.push/replace` et `redirect` vers une route de fichier.
 *
 * Un lien externe légitime (mail, téléphone, site : `https://…`) n'est pas concerné.
 * Un nouveau lien vers un fichier qui échoue ici doit passer par l'un des deux composants — PAS
 * par une entrée de `EXCEPTIONS`, qui exige une justification écrite.
 */

const SRC = path.resolve(__dirname, "..");

/** Fichiers qui IMPLÉMENTENT le chemin sûr : eux seuls peuvent poser un lien blob ou manipuler `download`. */
const EXCEPTIONS: Record<string, string> = {
  "components/telecharger-lien.tsx":
    "Implémente `enregistrerFichier` : le lien blob invisible (`a.download`) est le SEUL geste d'enregistrement autorisé, posé sur une URL `blob:` locale (jamais sur une route) après un `fetch`.",
};

// ── Lecture du dépôt ────────────────────────────────────────────────────────────────────────

function fichiersSource(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiersSource(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

/**
 * Les routes qui servent un FICHIER : tous les `route.ts`, sauf les déclencheurs et la version.
 * Le chemin du dossier devient un motif (`(groupe)` retiré, `[id]` = un segment, `[...x]` = le reste).
 */
const ROUTES_NON_FICHIER = new Set(["api/cron/alertes", "api/cron/rapport-mensuel", "api/version"]);

function motifDeRoute(dossier: string): RegExp {
  const segments = dossier
    .split("/")
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return new RegExp(`^/${segments.join("/")}$`);
}

function routesDeFichier(): { dossier: string; motif: RegExp }[] {
  return fichiersSource()
    .filter((f) => /\/route\.(ts|tsx)$/.test(f))
    .map((f) => path.dirname(rel(f)).replace(/^app\//, ""))
    .filter((d) => !ROUTES_NON_FICHIER.has(d))
    .map((dossier) => ({ dossier, motif: motifDeRoute(dossier) }));
}

// ── Analyse d'un source ─────────────────────────────────────────────────────────────────────

function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type Balise = { nom: string; texte: string; masque: string; ligne: number };

/** Corps d'une expression entre accolades / d'une chaîne, à partir de `debut` (l'ouvrante). */
function lireDelimite(s: string, debut: number): { fin: number } {
  const ouvrante = s[debut];
  if (ouvrante === '"' || ouvrante === "'" || ouvrante === "`") {
    let i = debut + 1;
    while (i < s.length && !(s[i] === ouvrante && s[i - 1] !== "\\")) i++;
    return { fin: i };
  }
  // accolade : équilibrée, en sautant les chaînes
  let profondeur = 0;
  let q: string | null = null;
  for (let i = debut; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") profondeur++;
    else if (c === "}" && --profondeur === 0) return { fin: i };
  }
  return { fin: s.length - 1 };
}

const NOMS_BALISES = "a|Link|form|iframe|embed|object";

function balises(src: string): Balise[] {
  const out: Balise[] = [];
  const re = new RegExp(`<(${NOMS_BALISES})(?=[\\s>])`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let masque = "";
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "{") {
        const { fin } = lireDelimite(src, i);
        masque += c + " ".repeat(Math.max(0, fin - i - 1)) + (c === "{" ? "}" : c);
        i = fin + 1;
        continue;
      }
      if (c === ">") break;
      masque += c;
      i++;
    }
    out.push({
      nom: m[1],
      texte: src.slice(m.index, i + 1),
      masque: m[0] + masque + ">",
      ligne: src.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** Valeur brute d'un attribut (`href="…"`, `href={…}`), ou null. */
function attribut(texte: string, nom: string): string | null {
  const re = new RegExp(`(?:^|\\s)${nom}\\s*=\\s*`, "g");
  const m = re.exec(texte);
  if (!m) return null;
  const debut = m.index + m[0].length;
  if (!/["'{]/.test(texte[debut] ?? "")) return null;
  const { fin } = lireDelimite(texte, debut);
  return texte.slice(debut, fin + 1);
}

/** Variantes testables d'une adresse en source : gabarit `${…}` retiré / remplacé, requête coupée. */
function variantesDAdresse(expression: string): string[] {
  const litteraux = [...expression.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
  const out: string[] = [];
  for (const l of litteraux) {
    for (const v of [l.replace(/\$\{[^}]*\}/g, ""), l.replace(/\$\{[^}]*\}/g, "X")]) {
      out.push(v.split("?")[0]);
    }
  }
  return out;
}

function estRouteDeFichier(expression: string, motifs: RegExp[]): boolean {
  return variantesDAdresse(expression).some((v) => motifs.some((mo) => mo.test(v)));
}

/**
 * Les identifiants qui COMPOSENT une adresse en source : le texte des chaînes est écarté, sauf ce
 * qui est entre `${…}` dans un gabarit. `{`/planning/pdf${qs}`}` → [qs] ; `{exportHref("pdf")}` → [exportHref].
 */
function identifiants(expression: string): string[] {
  const sansChaines = expression.replace(/`((?:\\.|[^`\\])*)`/g, (_, corps: string) => [...corps.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(" "))
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
  return sansChaines.match(/[A-Za-z_$][\w$]*/g) ?? [];
}

const ADRESSE_EXTERNE = /^\s*["'`{]*\s*["'`]?https?:\/\//;

export function violations(fichier: string, sourceBrute: string, motifs: RegExp[]): string[] {
  const src = sansCommentaires(sourceBrute);
  const exception = fichier in EXCEPTIONS;
  const v: string[] = [];
  const ajouter = (ligne: number, msg: string) => v.push(`${fichier}:${ligne}: ${msg}`);
  const ligneDe = (index: number) => src.slice(0, index).split("\n").length;

  for (const b of balises(src)) {
    const href = attribut(b.texte, b.nom === "form" ? "action" : b.nom === "iframe" || b.nom === "embed" ? "src" : b.nom === "object" ? "data" : "href");
    const externe = href !== null && ADRESSE_EXTERNE.test(href.replace(/^\{/, ""));

    if (b.nom === "a" && /(?:^|\s)download(?=[\s=>/])/.test(b.masque)) {
      ajouter(b.ligne, "ancre `download` : ignorée en application installée, la fenêtre navigue vers le fichier → TelechargerLien");
    }
    if (b.nom === "a" || b.nom === "Link" || b.nom === "form") {
      const cible = attribut(b.texte, "target");
      if (cible && /_blank/.test(cible) && !externe) {
        ajouter(b.ligne, "`target=\"_blank\"` vers une adresse interne : en application installée il n'y a pas d'onglet → TelechargerLien (fichier) ou ApercuDocumentBouton (aperçu)");
      }
    }
    if (href !== null && !externe && estRouteDeFichier(href, motifs)) {
      ajouter(b.ligne, `<${b.nom}> vers une route de FICHIER (${href.slice(0, 60)}) → TelechargerLien / TelechargerFormulaire / ApercuDocumentBouton`);
    }
    if (href !== null && !externe) {
      if (/(?:documentUrl|fichierUrl|certificatUrl|pdfAccepteUrl|fichePosteFichierUrl)\b/.test(href) && (b.nom === "a" || b.nom === "Link")) {
        ajouter(b.ligne, "adresse issue d'un champ de fichier stocké (…Url) → ApercuDocumentBouton (aperçu) ou TelechargerLien");
      }
      if (b.nom === "a" && identifiants(href).some((id) => /^(?:pdf|excel|export|fiche)|(?:Pdf|Excel|Export|Fiche)/.test(id))) {
        ajouter(b.ligne, `adresse issue d'un assistant de fichier (${href.slice(0, 60)}) → TelechargerLien`);
      }
    }
  }

  {
    for (const m of src.matchAll(/\bwindow\.open\s*\(/g)) {
      ajouter(ligneDe(m.index!), "`window.open` : en application installée, ouvre la fenêtre entière sur le fichier → TelechargerLien / ApercuDocumentBouton");
    }
    for (const m of src.matchAll(/(?:window\.|document\.)?location\.(?:href\s*=(?!=)|assign\s*\(|replace\s*\()|window\.location\s*=(?!=)/g)) {
      ajouter(ligneDe(m.index!), "navigation programmée (`location`) : un fichier ne se visite pas → TelechargerLien / ApercuDocumentBouton");
    }
    for (const m of exception ? [] : src.matchAll(/\.download\s*=(?!=)|setAttribute\(\s*["']download["']/g)) {
      ajouter(ligneDe(m.index!), "`download` posé à la main : passer par `enregistrerFichier` (src/components/telecharger-lien.tsx)");
    }
    for (const m of src.matchAll(/(?:router\.(?:push|replace)|(?<![\w.])(?:permanentR|r)edirect)\s*\(([^)]*)\)/g)) {
      if (estRouteDeFichier(m[1], motifs)) ajouter(ligneDe(m.index!), "navigation vers une route de FICHIER → TelechargerLien / ApercuDocumentBouton");
    }
  }
  return v;
}

// ── Le test ─────────────────────────────────────────────────────────────────────────────────

describe("garde-fou : aucun lien ne fait naviguer la fenêtre vers un fichier", () => {
  const routes = routesDeFichier();
  const motifs = routes.map((r) => r.motif);
  const fichiers = fichiersSource();

  it("PLANCHER — le parcours voit bien le dépôt (un garde-fou muet est pire qu'absent)", () => {
    expect(fichiers.length).toBeGreaterThan(300);
    expect(routes.length).toBeGreaterThanOrEqual(40);
    // les routes de fichier les plus attendues sont bien reconnues
    for (const url of ["/stock/commandes/X/pdf", "/paie/bulletin/X", "/fichiers/contrats/a.pdf", "/planning/excel", "/stock/journalier/fiche"]) {
      expect(motifs.some((m) => m.test(url)), url).toBe(true);
    }
    // et une page ordinaire n'en est pas une
    for (const url of ["/stock/commandes/X", "/stock/fiches/X", "/fiches-poste", "/employes/X"]) {
      expect(motifs.some((m) => m.test(url)), url).toBe(false);
    }
    // le composant sûr est réellement employé : le test ne vérifie pas un dépôt qui l'ignore
    const usages = fichiers.filter((f) => /<(TelechargerLien|TelechargerFormulaire|ApercuDocumentBouton|ContratViewerButton)\b/.test(fs.readFileSync(f, "utf8")));
    expect(usages.length).toBeGreaterThanOrEqual(30);
  });

  it("aucune violation dans src/", () => {
    const toutes = fichiers.flatMap((f) => violations(rel(f), fs.readFileSync(f, "utf8"), motifs));
    expect(toutes).toEqual([]);
  });

  it("chaque exception est justifiée et désigne un fichier qui existe", () => {
    for (const [f, motif] of Object.entries(EXCEPTIONS)) {
      expect(fs.existsSync(path.join(SRC, f)), f).toBe(true);
      expect(motif.length, f).toBeGreaterThan(40);
    }
  });

  // ── Le garde-fou se falsifie lui-même : chaque forme de piège est reconnue ────────────────
  describe("reconnaît chaque forme du piège", () => {
    const rouge: Record<string, string> = {
      "ancre download": `<a href={\`/stock/commandes/\${bc.id}/pdf\`} download className="x">PDF</a>`,
      "ancre download sur une variable": `<a href={pdfHref} download className="x">PDF</a>`,
      "target _blank interne": `<a href="/stock/factures/imprimer" target="_blank" rel="noopener">PDF</a>`,
      "target _blank vers une variable": `<a href={c.lien} target="_blank">x</a>`,
      "ancre vers une route de fichier": `<a href="/presences/export" className="x">Excel</a>`,
      "route de fichier avec paramètres": `<a href={\`/paie/bulletin/\${l.id}?devise=USD&dl=1\`}>$</a>`,
      "route de fichier + suffixe variable": `<a href={\`/planning/pdf\${qs}\`}>PDF</a>`,
      "Link vers une route de fichier": `<Link href="/planning/excel">Excel</Link>`,
      "pièce jointe (…Url)": `<a href={c.documentUrl} className="x">Pièce jointe</a>`,
      "pièce jointe (fichierUrl, target)": `<a href={d.fichierUrl} target="_blank">Ouvrir</a>`,
      "assistant de fichier": `<a href={exportHref("pdf")} className="x">PDF</a>`,
      "assistant de fiche": `<a href={ficheHref("BOISSON")} className="x">Fiche</a>`,
      "formulaire GET vers un fichier": `<form action="/stock/journalier/fiche" method="get"><button>PDF</button></form>`,
      "iframe sur un fichier": `<iframe src="/paie/bulletin/abc" />`,
      "window.open": `window.open(href, "_blank", "noopener,noreferrer");`,
      "location.href": `window.location.href = "/stock/commandes/abc/pdf";`,
      "location.assign": `location.assign(url);`,
      "download posé à la main": `const a = document.createElement("a"); a.download = "x.csv"; a.click();`,
      "setAttribute download": `a.setAttribute("download", "x.pdf");`,
      "router.push vers un fichier": `router.push(\`/stock/commandes/\${id}/pdf\`);`,
      "redirect vers un fichier": `redirect("/planning/excel");`,
    };
    for (const [nom, code] of Object.entries(rouge)) {
      it(`refuse : ${nom}`, () => {
        expect(violations("x/faux.tsx", code, motifs).length).toBeGreaterThan(0);
      });
    }

    const vert: Record<string, string> = {
      "TelechargerLien": `<TelechargerLien href={\`/stock/commandes/\${bc.id}/pdf\`} className="x">PDF</TelechargerLien>`,
      "ApercuDocumentBouton": `<ApercuDocumentBouton href={c.documentUrl} titre="x" libelle="PDF" />`,
      "site externe en nouvel onglet": `<a href={\`https://www.google.com/maps?q=\${lat},\${lng}\`} target="_blank" rel="noopener noreferrer">Carte</a>`,
      "site externe (chaîne)": `<a href="https://exemple.org" target="_blank">Site</a>`,
      "mail": `<a href="mailto:a@b.cd">Écrire</a>`,
      "lien de page": `<Link href={\`/stock/commandes/\${c.id}\`}>Bon</Link>`,
      "page fiches (pas un fichier)": `<Link href={\`/stock/fiches/\${f.id}\`}>Fiche</Link>`,
      "ancre de page avec paramètres": `<a href={lienEspace(e)} className="rounded-full">Cuisine</a>`,
      "page d'impression (page, pas fichier)": `<Link href="/stock/factures/imprimer">PDF</Link>`,
      "formulaire GET de filtre": `<form method="GET" action="/paie"><button>Filtrer</button></form>`,
      "location.reload": `window.location.reload();`,
      "lecture de location.pathname": `const p = window.location.pathname;`,
      "commentaire qui parle de window.open": `// jamais window.open(href) ici\n/* <a download href="/x/pdf"> */`,
    };
    for (const [nom, code] of Object.entries(vert)) {
      it(`accepte : ${nom}`, () => {
        expect(violations("x/bon.tsx", code, motifs)).toEqual([]);
      });
    }

    it("le fichier d'exception n'est exempté que pour ce qu'il implémente", () => {
      const f = Object.keys(EXCEPTIONS)[0];
      expect(violations(f, `a.download = nom;`, motifs)).toEqual([]);
      // … mais une ancre vers une route de fichier, une ancre `download` et `window.open` y restent refusés
      expect(violations(f, `<a href="/planning/excel">x</a>`, motifs).length).toBeGreaterThan(0);
      expect(violations(f, `<a href={href} download>x</a>`, motifs).length).toBeGreaterThan(0);
      expect(violations(f, `window.open(href, "_blank");`, motifs).length).toBeGreaterThan(0);
    });
  });
});

// GARDE-FOU « LE MENU DIT CE QUE LA PAGE DIT » (plan d'ergonomie du 2026-10-12, annexe C).
//
// Deux défauts qu'il empêche de revenir :
//   1. une entrée de menu dont le libellé n'est pas le titre (`<h1>`) de la page qu'elle ouvre
//      (« Documents » → « Documents & archives », « Conso. journalière » → « Consommation
//      journalière »…) : on ne sait plus où l'on est. Neuf écarts de ce genre ont été relevés ;
//   2. un lien interne écrit en toutes lettres vers une page qui n'existe pas, ou qui n'est qu'un
//      simple renvoi (`redirect(...)` : « /heures-supp » → Présences) — un détour de rechargement,
//      et le signe que le lien n'a pas suivi un déplacement.
//
// Ce qu'il ne couvre PAS : les liens construits (`/employes/${id}`, `?vue=` calculé) — seuls les
// littéraux sont lisibles sans exécuter la page ; les pages de l'espace salarié (leurs libellés
// « Mes congés » sont des intitulés de tuile, pas des titres) ; la valeur d'un h1 calculé.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NAV_GROUPS as NAV_RH } from "./(app)/navigation";
import { NAV_GROUPS as NAV_STOCK } from "./(stock)/navigation";
import { NAV_GROUPS as NAV_EXPLOITATION } from "./(exploitation)/navigation";
import { SOUS_ONGLETS_ACHATS } from "@/lib/achats-liste";

const APP = __dirname;
const SRC = path.join(APP, "..");
const PUBLIC = path.join(SRC, "..", "public");

/** Tous les fichiers sources (hors tests) sous un dossier. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

/** L'adresse d'un dossier de l'application : les groupes de routes `(app)`… ne comptent pas. */
function adresseDe(dossier: string): string {
  const segs = path.relative(APP, dossier).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

type Route = { adresse: string; dossier: string; fichier: "page" | "route" };
const routes: Route[] = [];
(function parcourir(dir: string) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { parcourir(p); continue; }
    if (n === "page.tsx") routes.push({ adresse: adresseDe(dir), dossier: dir, fichier: "page" });
    else if (n === "route.ts") routes.push({ adresse: adresseDe(dir), dossier: dir, fichier: "route" });
  }
})(APP);

/** La route qui sert cette adresse (les segments `[id]` acceptent n'importe quoi). */
function routeDe(adresse: string): Route | undefined {
  const segs = adresse.split("/").filter(Boolean);
  return routes.find((r) => {
    const rs = r.adresse.split("/").filter(Boolean);
    return rs.length === segs.length && rs.every((s, i) => /^\[.*\]$/.test(s) || s === segs[i]);
  });
}

/** Une page qui ne fait que renvoyer ailleurs (aucun titre, un `redirect(`). */
function estUnRenvoi(r: Route): boolean {
  if (r.fichier !== "page") return false;
  const src = readFileSync(path.join(r.dossier, "page.tsx"), "utf8");
  return /\bredirect\(|\bpermanentRedirect\(/.test(src) && !/<h1\b/.test(src);
}

const decoder = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Les titres `<h1>` écrits en toutes lettres dans le dossier d'une page (la page et ses écrans voisins). */
function titresDe(dossier: string): string[] {
  const titres: string[] = [];
  for (const n of readdirSync(dossier)) {
    if (!/\.tsx$/.test(n) || /\.test\.tsx$/.test(n)) continue;
    const src = readFileSync(path.join(dossier, n), "utf8");
    for (const m of src.matchAll(/<h1\b[^>]*>([^<{]+)<\/h1>/g)) titres.push(decoder(m[1]));
  }
  return titres;
}

/**
 * Les trois « Tableau de bord » s'ouvrent sur une salutation (« Bonjour {prénom} ») : exception NOMMÉE.
 * Leur renommage en « Accueil » relève du lot 4 du plan ; la salutation reste leur titre.
 */
const ACCUEILS_AVEC_SALUTATION = new Set(["/accueil", "/stock", "/exploitation"]);

const MENUS = [
  { espace: "RH", groupes: NAV_RH },
  { espace: "Stock", groupes: NAV_STOCK },
  { espace: "Exploitation", groupes: NAV_EXPLOITATION },
];

describe("menus — le libellé de chaque entrée est le titre de la page qu'elle ouvre", () => {
  for (const { espace, groupes } of MENUS) {
    for (const g of groupes) {
      for (const entree of g.items) {
        if (ACCUEILS_AVEC_SALUTATION.has(entree.href)) continue;
        it(`${espace} · « ${entree.label} » (${entree.href})`, () => {
          const r = routeDe(entree.href);
          expect(r, `aucune page pour ${entree.href}`).toBeTruthy();
          expect(titresDe(r!.dossier), `le <h1> de ${entree.href} doit être « ${entree.label} »`).toContain(entree.label);
        });
      }
    }
  }

  it("les trois sous-onglets d'« Achats & mouvements » portent tous le titre de l'entrée de menu", () => {
    for (const o of SOUS_ONGLETS_ACHATS) {
      const r = routeDe(o.href);
      expect(r, o.href).toBeTruthy();
      expect(titresDe(r!.dossier), o.href).toContain("Achats & mouvements");
    }
  });

  it("les exceptions nommées s'ouvrent bien sur une salutation (sinon elles n'ont plus lieu d'être)", () => {
    for (const href of ACCUEILS_AVEC_SALUTATION) {
      const r = routeDe(href)!;
      const src = readdirSync(r.dossier).filter((n) => /\.tsx$/.test(n)).map((n) => readFileSync(path.join(r.dossier, n), "utf8")).join("\n");
      expect(src, href).toMatch(/Bonjour \{prenom\}/);
    }
  });
});

describe("liens internes — tout lien écrit en toutes lettres vise une page qui existe, sans renvoi", () => {
  // `href="/x"`, `href='/x'`, `href: "/x"`, `href={"/x"}` et `href={`/x`}` sans interpolation.
  const MOTIFS = [
    /\bhref\s*[:=]\s*\{?\s*"(\/[^"${}\s]*)"/g,
    /\bhref\s*[:=]\s*\{?\s*'(\/[^'${}\s]*)'/g,
    /\bhref\s*[:=]\s*\{?\s*`(\/[^`${}\s]*)`/g,
  ];

  /** Chaque lien littéral, avec le fichier qui l'écrit. */
  const liens: { fichier: string; href: string }[] = [];
  for (const f of [...sources(APP), ...sources(path.join(SRC, "components")), ...sources(path.join(SRC, "lib"))]) {
    const src = readFileSync(f, "utf8");
    for (const re of MOTIFS) for (const m of src.matchAll(re)) if (!m[1].includes("…")) liens.push({ fichier: path.relative(SRC, f), href: m[1] }); // « … » = exemple dans un commentaire
  }

  const cible = (href: string) => href.split(/[?#]/)[0].replace(/\/$/, "") || "/";

  it("le garde-fou lit bien des liens (une regex cassée ne doit pas passer pour un succès)", () => {
    expect(liens.length).toBeGreaterThan(100);
  });

  it("aucun lien littéral ne mène à une adresse inexistante", () => {
    const inconnus = liens.filter((l) => {
      const c = cible(l.href);
      if (c === "/" || c.startsWith("//")) return false;
      if (routeDe(c)) return false;
      return !existsSync(path.join(PUBLIC, c)); // /manifest.json, /sw.js, /icons/… : fichiers publics
    }).map((l) => `${l.fichier} → ${l.href}`);
    expect([...new Set(inconnus)]).toEqual([]);
  });

  it("aucun lien littéral ne passe par une page de simple renvoi (il vise la destination directement)", () => {
    const renvois = liens.filter((l) => {
      const r = routeDe(cible(l.href));
      return r && estUnRenvoi(r);
    }).map((l) => `${l.fichier} → ${l.href}`);
    expect([...new Set(renvois)]).toEqual([]);
  });
});

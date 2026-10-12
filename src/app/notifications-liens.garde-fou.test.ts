// GARDE-FOU « UN LIEN DE NOTIFICATION MÈNE QUELQUE PART » (plan d'ergonomie, annexe C ; lot 5).
//
// Une notification est STOCKÉE avec son lien (colonne `lien`) et le lien peut être cliqué des semaines plus
// tard : il doit viser une page qui existe, et pas une page qui n'est qu'un renvoi (`redirect(...)`) — un
// déplacement d'écran (ici : Archives > Comptages devenu Réconciliation > Comptages passés, Utilisateurs
// devenu une rubrique de Paramètres) doit suivre dans les liens écrits, pas seulement dans le menu.
// La fiche d'un comptage (/stock/archives/<id>) GARDE son adresse : des notifications déjà envoyées y mènent.
//
// Couvre les liens écrits en toutes lettres (`lien: "/x"`, `lien: `/x/${id}``, `url: "/x"` des envois push).
// Ne couvre PAS les liens passés par une constante ou une fonction (`LIEN_A_PAYER`, `lienMouvements(g)`) :
// seul le texte est lisible sans exécuter le code.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = __dirname;
const SRC = path.join(APP, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const adresseDe = (dossier: string) => "/" + path.relative(APP, dossier).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)).join("/");

type Route = { adresse: string; dossier: string };
const routes: Route[] = [];
(function parcourir(dir: string) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) parcourir(p);
    else if (n === "page.tsx") routes.push({ adresse: adresseDe(dir), dossier: dir });
  }
})(APP);

function routeDe(adresse: string): Route | undefined {
  const segs = adresse.split("/").filter(Boolean);
  return routes.find((r) => {
    const rs = r.adresse.split("/").filter(Boolean);
    return rs.length === segs.length && rs.every((s, i) => /^\[.*\]$/.test(s) || s === segs[i]);
  });
}

const estUnRenvoi = (r: Route) => {
  const src = readFileSync(path.join(r.dossier, "page.tsx"), "utf8");
  return /\bredirect\(|\bpermanentRedirect\(/.test(src) && !/<h1\b/.test(src);
};

/** Les adresses déplacées : une notification écrite aujourd'hui ne doit jamais y mener. */
const ADRESSES_DEPLACEES = ["/stock/utilisateurs", "/stock/archives", "/stock/parametres"];

// `lien:` (colonne de Notification) et `url:` d'un envoi push (même ligne qu'un `title:`, pour ne pas lire les icônes du manifeste).
const MOTIF = /(?:\blien|\btitle\s*:[^\n]*?\burl)\s*:\s*(?:"(\/[^"\n]*)"|'(\/[^'\n]*)'|`(\/[^`\n]*)`)/g;
const liens: { fichier: string; lien: string }[] = [];
for (const f of [...sources(APP), ...sources(path.join(SRC, "lib"))]) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(MOTIF)) liens.push({ fichier: path.relative(SRC, f), lien: m[1] ?? m[2] ?? m[3] });
}
/** `/stock/commandes/${id}?x=1` → `/stock/commandes/x` : le chemin, sans requête ni ancre, interpolations neutralisées. */
const chemin = (lien: string) => lien.replace(/\$\{[^}]*\}/g, "x").split(/[?#]/)[0].replace(/\/$/, "") || "/";

describe("liens de notification — chacun mène à une page qui existe", () => {
  it("le scanner lit bien des liens (une regex cassée ne doit pas passer pour un succès)", () => {
    expect(liens.length).toBeGreaterThan(30);
    expect(liens.some((l) => l.lien.startsWith("/stock/archives/"))).toBe(true); // la fiche d'un comptage (comptage.ts, demandes.ts)
  });

  it("aucun lien ne vise une adresse inexistante", () => {
    const morts = liens.filter((l) => !routeDe(chemin(l.lien))).map((l) => `${l.fichier} → ${l.lien}`);
    expect([...new Set(morts)]).toEqual([]);
  });

  it("aucun lien ne passe par une page de simple renvoi", () => {
    const renvois = liens.filter((l) => { const r = routeDe(chemin(l.lien)); return r && estUnRenvoi(r); }).map((l) => `${l.fichier} → ${l.lien}`);
    expect([...new Set(renvois)]).toEqual([]);
  });

  it("aucun lien n'écrit une adresse déplacée (Utilisateurs, Archives nues, Paramètres du Stock)", () => {
    const anciens = liens.filter((l) => ADRESSES_DEPLACEES.includes(chemin(l.lien))).map((l) => `${l.fichier} → ${l.lien}`);
    expect(anciens).toEqual([]);
  });

  it("la fiche d'un comptage garde son adresse /stock/archives/<id>", () => {
    expect(routeDe("/stock/archives/abc")).toBeTruthy();
  });
});

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
import { exemplesDeLiens, LIENS } from "@/lib/envois-stock/liens";
import { BOITES_A_VALIDER } from "@/lib/a-valider-compteur";

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
const ADRESSES_DEPLACEES = ["/stock/utilisateurs", "/stock/archives", "/stock/parametres", "/exploitation/graphiques"];

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

  it("le lien des demandes de ratios (passé par une constante, que le scanner ne lit pas) mène à « À valider » de l'Exploitation", () => {
    const src = readFileSync(path.join(SRC, "lib", "exploitation", "demandes-ratios.ts"), "utf8");
    const lien = /export const LIEN_DEMANDES_RATIOS = "([^"]+)"/.exec(src)?.[1];
    expect(lien).toBe("/exploitation/a-valider");
    const r = routeDe(chemin(lien!));
    expect(r).toBeTruthy();
    expect(estUnRenvoi(r!)).toBe(false);
    // Les notifications (Direction : demande reçue ; auteur : réponse) sont écrites avec CE lien, dans le domaine EXPLOITATION.
    expect(src.match(/domaine: "EXPLOITATION"[^}]*lien: LIEN_DEMANDES_RATIOS/g)).toHaveLength(2);
  });

  it("la clôture du stock (lot 8, V8) : aucune notification ne mène aux Paramètres pour elle, et sa page est un vrai écran", () => {
    expect(liens.filter((l) => /cloture-stock/.test(l.lien))).toEqual([]);
    // Les actions de clôture ne notifient personne : ni lien, ni envoi vers Paramètres.
    const actions = readFileSync(path.join(APP, "(stock)", "stock", "cloture", "actions.ts"), "utf8");
    expect(actions).not.toMatch(/\blien\s*:/);
    expect(actions).not.toMatch(/["'`]\/parametres/);
    const page = routeDe("/stock/cloture");
    expect(page).toBeTruthy();
    expect(estUnRenvoi(page!)).toBe(false);
    // L'ancienne adresse, elle, n'est plus qu'un renvoi : aucun lien écrit ne doit y mener (ADRESSES_DEPLACEES).
    expect(estUnRenvoi(routeDe("/stock/parametres")!)).toBe(true);
    expect(ADRESSES_DEPLACEES).toContain("/stock/parametres");
  });

  it("la fiche d'un comptage garde son adresse /stock/archives/<id>", () => {
    expect(routeDe("/stock/archives/abc")).toBeTruthy();
  });
});

// « À VALIDER » EST UNE SEULE PAGE (2026-10-12), montée à TROIS adresses — une par coquille d'espace. Les notifications déjà
// stockées visent `/a-valider` (RH), `/stock/a-valider` ou `/exploitation/a-valider` : aucune ne doit casser, et un
// lien neuf doit rester dans l'espace de son destinataire (un compte Stock ne peut pas ouvrir la coquille RH : sa garde
// le renverrait à l'entrée). Pas de renvoi 307 d'une adresse à l'autre : la Direction serait éjectée de la coquille d'où elle vient.
describe("« À valider » unique — trois adresses, une seule page", () => {
  const ADRESSES = ["/a-valider", "/stock/a-valider", "/exploitation/a-valider"];
  const PAGE_PARTAGEE = "(app)/a-valider/page-a-valider.tsx";

  it("le registre des boîtes porte exactement ces trois adresses", () => {
    expect(BOITES_A_VALIDER.map((b) => b.href)).toEqual(ADRESSES);
  });

  it("chaque adresse est une vraie page (jamais un simple renvoi) qui monte la MÊME page partagée", () => {
    expect(readFileSync(path.join(APP, PAGE_PARTAGEE), "utf8")).toMatch(/export async function PageAValider\b/);
    for (const adresse of ADRESSES) {
      const r = routeDe(adresse);
      expect(r, adresse).toBeTruthy();
      expect(estUnRenvoi(r!), `${adresse} ne doit pas être un renvoi`).toBe(false);
      const src = readFileSync(path.join(r!.dossier, "page.tsx"), "utf8");
      expect(src, adresse).toMatch(/\bPageAValider\(\{/); // la page partagée, pas une copie
      expect(src, adresse).toMatch(/page-a-valider"/);
      expect(src, adresse).not.toMatch(/\bredirect\(/);
    }
  });

  it("chaque adresse garde la garde de SON espace (le layout ne suffit pas) et déclare son espace courant", () => {
    const GARDES: Record<string, [string, string]> = {
      "/a-valider": ["exigerPageRH", "rh"], "/stock/a-valider": ["exigerPageStock", "stock"], "/exploitation/a-valider": ["exigerPageExploitation", "exploitation"],
    };
    for (const [adresse, [garde, courant]] of Object.entries(GARDES)) {
      const src = readFileSync(path.join(routeDe(adresse)!.dossier, "page.tsx"), "utf8");
      expect(src, adresse).toContain(`await ${garde}()`);
      expect(src, adresse).toContain(`courant: "${courant}"`);
    }
  });

  // Les liens écrits en toutes lettres : le domaine de la notification et l'espace de l'adresse vont ensemble.
  const ESPACE_DE_ADRESSE = (a: string) => (a.startsWith("/stock/") ? "STOCK" : a.startsWith("/exploitation/") ? "EXPLOITATION" : "RH");
  const ecrits: { fichier: string; adresse: string; domaine: string }[] = [];
  for (const f of [...sources(APP), ...sources(path.join(SRC, "lib"))]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\blien\s*:\s*"(\/(?:stock\/|exploitation\/)?a-valider)(?:[#?][^"]*)?"/g)) {
      // Le domaine se lit dans le MÊME appel (creerNotification / notification.create), sinon c'est le domaine par défaut : RH.
      const debut = Math.max(src.lastIndexOf("creerNotification(", m.index), src.lastIndexOf("notification.create(", m.index), src.lastIndexOf("notifier", m.index));
      const fenetre = src.slice(debut < 0 ? Math.max(0, m.index! - 300) : debut, m.index);
      const domaine = /domaine:\s*"(STOCK|EXPLOITATION|RH|SALARIE)"/.exec(fenetre)?.[1] ?? "RH";
      ecrits.push({ fichier: path.relative(SRC, f), adresse: m[1], domaine });
    }
  }

  it("le scanner lit bien des liens vers « À valider » en RH et au Stock (une regex cassée ne doit pas passer pour un succès) ; ceux de l'Exploitation passent par une constante, vérifiée plus haut", () => {
    expect(new Set(ecrits.map((e) => e.adresse))).toEqual(new Set(["/a-valider", "/stock/a-valider"]));
    expect(ecrits.length).toBeGreaterThan(8);
  });

  it("tout lien écrit vers « À valider » reste dans l'espace de la notification : RH → /a-valider, STOCK → /stock/a-valider, EXPLOITATION → /exploitation/a-valider", () => {
    const hors = ecrits.filter((e) => ESPACE_DE_ADRESSE(e.adresse) !== e.domaine).map((e) => `${e.fichier} : ${e.domaine} → ${e.adresse}`);
    expect([...new Set(hors)]).toEqual([]);
  });

  it("falsification : un lien Stock écrit vers la coquille RH serait signalé", () => {
    expect(ESPACE_DE_ADRESSE("/a-valider")).not.toBe("STOCK");
    expect(ESPACE_DE_ADRESSE("/stock/a-valider")).toBe("STOCK");
    expect(ESPACE_DE_ADRESSE("/exploitation/a-valider")).toBe("EXPLOITATION");
    expect(estUnRenvoi({ adresse: "/x", dossier: path.join(APP, "(app)", "a-valider") })).toBe(false); // vraie page
  });
});

// Les courriels automatiques du Stock (envois quotidien et mensuel, 2026-10-12) écrivent leurs liens par des
// constructeurs (`LIENS.article(id)`…), que le scanner ci-dessus ne lit pas : on les vérifie ici, un par un.
describe("liens des courriels automatiques du Stock — chacun mène à une vraie page", () => {
  const exemples = exemplesDeLiens();

  it("le catalogue d'exemples couvre bien tous les constructeurs (un constructeur ajouté sans exemple échoue ici)", () => {
    expect(exemples.length).toBeGreaterThanOrEqual(Object.keys(LIENS).length);
  });

  it("aucun lien ne vise une adresse inexistante, un simple renvoi ou une adresse déplacée", () => {
    const morts = exemples.filter((l) => !routeDe(chemin(l)));
    expect(morts).toEqual([]);
    expect(exemples.filter((l) => { const r = routeDe(chemin(l)); return r && estUnRenvoi(r); })).toEqual([]);
    expect(exemples.filter((l) => ADRESSES_DEPLACEES.includes(chemin(l)))).toEqual([]);
  });

  it("tous visent l'espace Stock", () => {
    expect(exemples.filter((l) => !l.startsWith("/stock"))).toEqual([]);
  });

  it("falsification : une adresse inventée ou déplacée serait refusée", () => {
    expect(routeDe(chemin("/stock/n-existe-pas"))).toBeUndefined();
    expect(ADRESSES_DEPLACEES).toContain(chemin("/stock/utilisateurs"));
  });
});

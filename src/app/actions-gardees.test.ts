import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : AUCUNE SERVER ACTION EXPORTÉE NE SE CONTENTE D'UNE SESSION.
 *
 * Une Server Action est un point d'entrée HTTP à part entière : n'importe quel compte connecté peut
 * l'appeler avec les arguments de son choix, sans passer par aucun layout ni aucune page. Le
 * 2026-09-28, `marquerNotificationsLues`, `supprimerNotification` et `supprimerPush` n'exigeaient
 * que `verifySession()` : un salarié vidait la cloche de la Direction.
 *
 * Règle : chaque fonction exportée d'un fichier `"use server"` appelle — elle-même, ou par une
 * fonction du MÊME fichier qu'elle appelle (`garde()`, `exigerSalarie()`, une autre action gardée…) —
 * au moins une garde du vocabulaire ci-dessous : un droit d'ESPACE / de RÔLE, ou une vérification de
 * PROPRIÉTÉ lue en base. Sinon elle figure dans la liste fermée SANS_GARDE, avec sa justification.
 *
 * LIMITE ASSUMÉE : le test prouve qu'une garde est APPELÉE, pas qu'elle est la bonne ni qu'elle
 * précède l'écriture (les actions mêlent lectures préalables, `formulaireLisible`, transactions :
 * exiger « premier await » produirait des faux positifs à la pelle). Il attrape l'oubli pur — le
 * défaut réellement observé —, la relecture reste juge du reste.
 */

const APP = path.join(__dirname);

const VOCABULAIRE_GARDES = [
  // droits d'espace / de rôle (`lib/auth`, `lib/espaces`, gardes locales qui les appellent)
  "requireRole", "requireModule", "estRH", "estStock", "estExploitation", "estSalarie",
  // propriété lue en base
  "peutGererDomaine", "peutToucherNotification", "peutReprendreAbonnement", "abonnementDuCompte", // lib/acces-notification
  "peutChangerSonMotDePasse", // lib/mot-de-passe-temporaire : son propre mot de passe, sous conditions
  "employeLieAuCompte", // lib/pointage-presences : le pointage est toujours pour le compte connecté
];

/** Actions sans garde de droit, PAR CONCEPTION. Liste fermée : chaque entrée se justifie. */
const SANS_GARDE: Record<string, string> = {
  "login/actions.ts#login": "Connexion : publique par nature.",
  "login/actions.ts#logout": "Déconnexion : ne touche que la session de l'appelant.",
  "login/actions.ts#demanderReinitialisation": "Mot de passe oublié : public, réponse identique que le compte existe ou non.",
  "login/actions.ts#reinitialiserMotDePasse": "Réinitialisation : publique, gardée par le jeton à usage unique (verifierJeton).",
};

function fichiersServeur(dir: string = APP): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiersServeur(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && /^\s*["']use server["']/.test(fs.readFileSync(p, "utf8")))
      out.push(path.relative(APP, p).split(path.sep).join("/"));
  }
  return out.sort();
}

function sansCommentaires(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

type Decl = { nom: string; exporte: boolean; corps: string };

/** Déclarations de premier niveau (fonctions et constantes), chacune jusqu'à la suivante. */
function declarations(src: string): Decl[] {
  const re = /^(export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=)/gm;
  const debuts = [...src.matchAll(re)].map((m) => ({ exporte: !!m[1], nom: (m[2] ?? m[3])!, i: m.index! }));
  return debuts.map((d, k) => ({ nom: d.nom, exporte: d.exporte, corps: src.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : src.length) }));
}

const GARDE_RE = new RegExp(`\\b(?:${VOCABULAIRE_GARDES.join("|")})\\s*\\(`);

/** Actions exportées sans garde (ni directe, ni via une fonction du même fichier). */
function actionsNonGardees(source: string): string[] {
  const decls = declarations(sansCommentaires(source));
  const parNom = new Map(decls.map((d) => [d.nom, d]));
  const memo = new Map<string, boolean>();
  const gardee = (nom: string, pile: Set<string> = new Set()): boolean => {
    if (memo.has(nom)) return memo.get(nom)!;
    const d = parNom.get(nom);
    if (!d || pile.has(nom)) return false;
    pile.add(nom);
    // L'en-tête (nom, paramètres) ne compte pas : seuls les appels du corps.
    const corps = d.corps.slice(d.corps.indexOf("{") >= 0 ? d.corps.indexOf("{") : 0);
    const r =
      GARDE_RE.test(corps) ||
      decls.some((o) => o.nom !== nom && new RegExp(`\\b${o.nom}\\s*\\(`).test(corps) && gardee(o.nom, pile));
    memo.set(nom, r);
    return r;
  };
  return decls.filter((d) => d.exporte && !/^(?:type|interface)\b/.test(d.corps)).filter((d) => !gardee(d.nom)).map((d) => d.nom);
}

describe("chaque Server Action exportée appelle une garde de droit ou de propriété", () => {
  const fichiers = fichiersServeur();

  it("le parcours trouve bien les fichiers d'actions (garde contre un faux vert)", () => {
    expect(fichiers.length).toBeGreaterThanOrEqual(40);
    expect(fichiers).toContain("(app)/notifications-actions.ts");
    expect(fichiers).toContain("(stock)/stock/factures/actions.ts");
  });

  it.each(fichiers)("%s", (rel) => {
    const manquantes = actionsNonGardees(fs.readFileSync(path.join(APP, rel), "utf8"))
      .map((nom) => `${rel}#${nom}`)
      .filter((cle) => !(cle in SANS_GARDE));
    expect(manquantes).toEqual([]);
  });

  it("la liste SANS_GARDE est fermée : chaque entrée existe encore et reste sans garde", () => {
    for (const cle of Object.keys(SANS_GARDE)) {
      const [rel, nom] = cle.split("#");
      expect(fichiers).toContain(rel);
      expect(actionsNonGardees(fs.readFileSync(path.join(APP, rel), "utf8"))).toContain(nom);
    }
  });
});

describe("le garde-fou des actions mord (falsification en mémoire)", () => {
  const lire = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

  it("les fichiers réels sont conformes", () => {
    expect(actionsNonGardees(lire("(app)/notifications-actions.ts"))).toEqual([]);
    expect(actionsNonGardees(lire("(app)/conges/actions.ts"))).toEqual([]);
  });

  it("notification : garde de domaine retirée → signalée (retour à la session seule)", () => {
    const f = lire("(app)/notifications-actions.ts").replace(/\s*if \(!peutGererDomaine\(user, dom\)\)[^\n]*/, "");
    expect(actionsNonGardees(f)).toEqual(["marquerNotificationsLues"]);
  });

  it("action RH : requireRole retiré → signalée", () => {
    const f = lire("(app)/conges/actions.ts").replace(/(export async function approuverConge[\s\S]*?)requireRole\(user, \["ADMIN"\]\);/, "$1");
    expect(actionsNonGardees(f)).toEqual(["approuverConge"]);
  });

  it("garde locale vidée (`garde()` du Stock) → toutes les actions qui en dépendent sont signalées", () => {
    const vrai = lire("(stock)/stock/fiches/actions.ts");
    expect(actionsNonGardees(vrai)).toEqual([]);
    const f = vrai.replace(/requireModule\(user, "stock"\);/, "");
    expect(actionsNonGardees(f).length).toBeGreaterThan(0);
  });

  it("un appel à verifySession ne compte pas comme une garde", () => {
    const src = `"use server";\nexport async function x(id: string) { const u = await verifySession(); await prisma.a.delete({ where: { id } }); }`;
    expect(actionsNonGardees(src)).toEqual(["x"]);
  });

  it("une garde citée dans un commentaire ne compte pas", () => {
    const src = `"use server";\nexport async function x() {\n  // requireRole(user, ["ADMIN"]);\n  await verifySession();\n}`;
    expect(actionsNonGardees(src)).toEqual(["x"]);
  });
});

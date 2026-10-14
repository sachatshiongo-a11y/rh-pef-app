import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import config from "../../next.config";

/**
 * GARDE-FOU : LE CACHE DE NAVIGATION DU NAVIGATEUR NE MONTRE JAMAIS UNE DONNÉE QUE L'ON VIENT DE CHANGER.
 *
 * `next.config.ts` garde 30 s, dans le navigateur, une page déjà vue (`experimental.staleTimes.dynamic`) :
 * revenir sur Présences après un détour par Paie ne repasse plus par le serveur (0,1 vCPU sur Render, et
 * un aller-retour Kinshasa ↔ Francfort par clic). Ce cache est vidé EN ENTIER — toutes les pages — dès
 * qu'une action serveur appelle `revalidatePath` / `revalidateTag` / `updateTag` / `refresh` (Next 16.3 :
 * server-action-reducer → invalidateBfCache + invalidateEntirePrefetchCache, quel que soit le chemin
 * passé), ou que la page appelle `router.refresh()`. Un simple `redirect()` NE le vide PAS.
 *
 * Règle : chaque fonction exportée d'un fichier `"use server"` appelle l'une de ces fonctions — elle-même,
 * ou par une fonction du MÊME fichier qu'elle appelle. Sinon elle figure dans SANS_REVALIDATION, justifiée
 * (lecture seule, ou revalidation faite ailleurs). Une action qui ÉCRIT sans revalider laisserait, pendant
 * 30 s, l'ancienne valeur sur les pages déjà vues : c'est ce que ce test empêche d'oublier.
 * LIMITE ASSUMÉE (comme actions-gardees) : le test prouve que la revalidation est APPELÉE, pas qu'elle
 * suit toutes les écritures ; la relecture reste juge.
 */

const APP = path.join(__dirname);
const REVALIDATIONS = ["revalidatePath", "revalidateTag", "updateTag", "refresh", "revaliderApresChangementDeMois" /* lib/changement-mois */];

const SANS_REVALIDATION: Record<string, string> = {
  "(app)/push-actions.ts#enregistrerPush": "Abonnement aux notifications de l'appareil : rien de ce qui est affiché ne change.",
  "(app)/push-actions.ts#supprimerPush": "Idem (désabonnement de l'appareil).",
  "(app)/employes/[id]/dossier-actions.ts#proposerSoldeConges": "Lecture seule : propose un solde, n'écrit rien.",
  "(app)/planning/decisions-lot-actions.ts#approuverChangementsEnLot": "Délègue à l'action individuelle de ./actions, qui revalide.",
  "(app)/planning/decisions-lot-actions.ts#refuserChangementsEnLot": "Délègue à l'action individuelle de ./actions, qui revalide.",
  "(app)/planning/decisions-lot-actions.ts#approuverEchangesEnLot": "Délègue à l'action individuelle de ./actions, qui revalide.",
  "(app)/planning/decisions-lot-actions.ts#refuserEchangesEnLot": "Délègue à l'action individuelle de ./actions, qui revalide.",
  "(app)/presences/import-actions.ts#analyserPointageIVMS": "Lecture seule : analyse un fichier avant import.",
  "(exploitation)/exploitation/journal/actions.ts#exporterJournalExcel": "Lecture seule : export.",
  "(stock)/stock/catalogue/actions.ts#apercuSuppressionArticles": "Lecture seule : aperçu de la suppression en masse (ce qui partirait, ce qui serait conservé) ; la suppression elle-même revalide.",
  "(stock)/stock/entree/actions.ts#verifierDoublonsListe": "Lecture seule : recherche de doublons.",
  "(stock)/stock/journalier/actions.ts#saisirCommandeResto": "Saisie case par case : la grille appelle rafraichirJournalier (qui revalide) au repos et en quittant l'écran.",
  "(stock)/stock/journalier/actions.ts#saisirCommandeLegume": "Idem.",
  "(stock)/stock/journalier/ventes-actions.ts#saisirVente": "Idem (grille Ventes).",
  "(stock)/stock/journalier/import-commande-actions.ts#analyserClasseurCommande": "Lecture seule : analyse d'un classeur.",
  "(stock)/stock/journalier/import-classeur-actions.ts#analyserClasseurVentes": "Lecture seule : analyse d'un classeur.",
  "(stock)/stock/imports/actions.ts#analyserInventaireAction": "Lecture seule : analyse avant import.",
  "(stock)/stock/imports/actions.ts#analyserFacturesAction": "Lecture seule : analyse avant import.",
  "(stock)/stock/imports/actions.ts#analyserMouvementsAction": "Lecture seule : analyse avant import.",
  "(stock)/stock/imports/actions.ts#detecterDoublonsAction": "Lecture seule : recherche de doublons.",
  "(stock)/stock/fiches/import-bar-actions.ts#analyserFichesBar": "Lecture seule : analyse avant import.",
  "(stock)/stock/factures/actions.ts#analyserFacturePDF": "Lecture seule : lit un PDF de facture.",
  "espace/actions.ts#changerMonMotDePasse": "Mot de passe du compte : aucune page déjà vue ne l'affiche (puis redirection).",
  "login/actions.ts#demanderReinitialisation": "Public : envoie un courriel, n'affiche rien.",
  "login/actions.ts#reinitialiserMotDePasse": "Public, sans session : aucun cache de page à vider.",
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

const sansCommentaires = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

type Decl = { nom: string; exporte: boolean; corps: string };
function declarations(src: string): Decl[] {
  const re = /^(export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=)/gm;
  const debuts = [...src.matchAll(re)].map((m) => ({ exporte: !!m[1], nom: (m[2] ?? m[3])!, i: m.index! }));
  return debuts.map((d, k) => ({ nom: d.nom, exporte: d.exporte, corps: src.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : src.length) }));
}
const REVALIDE_RE = new RegExp(`\\b(?:${REVALIDATIONS.join("|")})\\s*\\(`);

/** Actions exportées qui ne vident pas le cache de navigation (ni directement, ni via une fonction du même fichier). */
function actionsSansRevalidation(source: string): string[] {
  const decls = declarations(sansCommentaires(source));
  const parNom = new Map(decls.map((d) => [d.nom, d]));
  const memo = new Map<string, boolean>();
  const revalide = (nom: string, pile: Set<string> = new Set()): boolean => {
    if (memo.has(nom)) return memo.get(nom)!;
    const d = parNom.get(nom);
    if (!d || pile.has(nom)) return false;
    pile.add(nom);
    const corps = d.corps.slice(Math.max(0, d.corps.indexOf("{")));
    const r = REVALIDE_RE.test(corps) || decls.some((o) => o.nom !== nom && new RegExp(`\\b${o.nom}\\s*\\(`).test(corps) && revalide(o.nom, pile));
    memo.set(nom, r);
    return r;
  };
  return decls.filter((d) => d.exporte && !/^(?:type|interface)\b/.test(d.corps)).filter((d) => !revalide(d.nom)).map((d) => d.nom);
}

describe("cache de navigation du navigateur (staleTimes)", () => {
  it("next.config.ts : 30 s au plus pour une page dynamique déjà vue", () => {
    const st = (config.experimental as { staleTimes?: { dynamic?: number } } | undefined)?.staleTimes;
    expect(st?.dynamic).toBeGreaterThan(0);
    expect(st?.dynamic).toBeLessThanOrEqual(30);
  });

  const fichiers = fichiersServeur();
  it("le parcours trouve bien les fichiers d'actions (garde contre un faux vert)", () => {
    expect(fichiers.length).toBeGreaterThanOrEqual(40);
    expect(fichiers).toContain("(app)/conges/actions.ts");
  });

  it.each(fichiers)("%s : chaque action vide le cache de navigation, ou est justifiée", (rel) => {
    const manquantes = actionsSansRevalidation(fs.readFileSync(path.join(APP, rel), "utf8"))
      .map((nom) => `${rel}#${nom}`)
      .filter((cle) => !(cle in SANS_REVALIDATION));
    expect(manquantes).toEqual([]);
  });

  it("la liste SANS_REVALIDATION est fermée : chaque entrée existe encore et ne revalide toujours pas", () => {
    for (const cle of Object.keys(SANS_REVALIDATION)) {
      const [rel, nom] = cle.split("#");
      expect(fichiers).toContain(rel);
      expect(actionsSansRevalidation(fs.readFileSync(path.join(APP, rel), "utf8"))).toContain(nom);
    }
  });

  it("le garde-fou mord : une action dont on retire la revalidation est signalée", () => {
    const vrai = fs.readFileSync(path.join(APP, "(app)/conges/actions.ts"), "utf8");
    expect(actionsSansRevalidation(vrai)).toEqual([]);
    const f = vrai.replace(/function revaliderConges\(\) \{[\s\S]*?\n\}/, "function revaliderConges() {}");
    expect(actionsSansRevalidation(f).length).toBeGreaterThan(0);
  });

  it("connexion et déconnexion vident le cache (un autre compte ne revoit jamais les pages du précédent)", () => {
    const login = fs.readFileSync(path.join(APP, "login/actions.ts"), "utf8");
    expect(actionsSansRevalidation(login)).not.toContain("login");
    expect(actionsSansRevalidation(login)).not.toContain("logout");
  });
});

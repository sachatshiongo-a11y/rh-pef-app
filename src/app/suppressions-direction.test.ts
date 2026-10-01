import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : SEULE LA DIRECTION SUPPRIME.
 *
 * Règle de Sacha (2026-10-01) : « un autre utilisateur que la direction ne peut et ne doit rien
 * supprimer, articles, fiches techniques, salarié, etc ». Masquer le bouton ne protège rien : une
 * Server Action ou un `route.ts` s'appelle directement, avec les arguments de son choix.
 *
 * Règle vérifiée : chaque fonction EXPORTÉE d'un fichier `"use server"` ou d'un `route.ts` qui
 * atteint une suppression appelle une garde DIRECTION identifiable — elle-même, ou par une fonction
 * NON exportée du même fichier (`gardeDirection()`…). Une garde posée dans un AUTRE export du
 * fichier ne compte pas : chaque export est un point d'entrée à part. Sinon l'action figure dans la
 * liste fermée EXCEPTIONS, avec sa raison.
 *
 * « Atteint une suppression » : un appel de suppression écrit dans la fonction ou dans une fonction
 * locale non exportée qu'elle appelle — `x.y.delete(`, `.deleteMany(`, `DELETE FROM`, `.remove(`
 * (stockage), `method: "DELETE"` (API du stockage) — OU l'appel d'une fonction de `src/lib` qui en
 * contient une (liste calculée ci-dessous, pas tenue à la main : une suppression ajoutée dans une
 * bibliothèque est vue d'office chez tous ses appelants).
 *
 * LIMITES ASSUMÉES (comme `actions-gardees.test.ts`) : le test prouve qu'une garde Direction est
 * APPELÉE dans l'action, pas qu'elle précède l'écriture ni qu'elle couvre la bonne branche (une garde
 * dans un `if` compte). Il ne voit pas les suppressions « douces » : désactivation (`actif: false`),
 * statut ANNULE/RESILIE, URL de document remise à null, cascades Prisma (`onDelete: Cascade`). Il
 * attrape l'oubli pur ; les tests d'intégration (`suppressions-direction.integration.test.ts`)
 * prouvent le refus sans effet sur les suppressions importantes.
 */

const SRC = path.join(__dirname, "..");
const APP = __dirname;
const LIB = path.join(SRC, "lib");

/** Gardes Direction reconnues (lib/suppression-direction.ts, requireRole ADMIN seul, estDirection de validations-stock). */
const GARDE_DIRECTION = [
  /\bexigerDirectionPourSupprimer\s*\(/,
  /\brefusSuppression\s*\(/,
  /\brequireRole\s*\(\s*\w+\s*,\s*\[\s*["']ADMIN["']\s*\]\s*\)/,
  /\bif\s*\(\s*!\s*estDirection\s*\(\s*\w+\s*\)\s*\)\s*throw\b/,
];

/** Appels de suppression écrits en toutes lettres. */
const SUPPRESSION_DIRECTE = [
  /\b\w+\.\w+\.delete\s*\(/, // prisma.modele.delete( / tx.modele.delete( — pas un Map/Set (`cache.delete(`)
  /\.deleteMany\s*\(/,
  /\bDELETE\s+FROM\b/i,
  /\.remove\s*\(/, // stockage Supabase : storage.from(bucket).remove([...])
  /method\s*:\s*["']DELETE["']/, // API REST du stockage
];

/**
 * Fonctions de `src/lib` dont la suppression est TECHNIQUE (pas un geste de l'utilisateur sur une
 * donnée métier) : elles ne rendent pas leurs appelants « suppresseurs ». Liste fermée.
 */
const TECHNIQUES_LIB: Record<string, string> = {
  supprimerNotificationsPour: "Nettoie les notifications d'une demande une fois traitée (la cloche, pas la donnée).",
  envoyerPush: "Purge les abonnements push expirés (410) renvoyés par le service.",
  effacerEchecs: "Remet à zéro le compteur d'échecs de connexion d'un compte (anti-force brute).",
  supprimerUtilisateurAuth: "Annule la création d'un compte d'authentification quand la suite a échoué (rien d'existant).",
  rafraichirPaieDuMois: "Recalcul de la paie : les lignes NON figées sont recalculées (supprimées puis recréées) ; les figées ne bougent pas.",
};

/**
 * Actions qui suppriment SANS garde Direction, PAR CONCEPTION. Liste fermée : chaque entrée existe
 * encore, supprime encore, et n'a toujours pas de garde (sinon elle doit sortir de la liste).
 */
const EXCEPTIONS: Record<string, string> = {
  // ── Technique / personnel : pas une donnée métier d'autrui ───────────────────────────────────
  "(app)/notifications-actions.ts#supprimerNotification": "Notification de la cloche (un message, pas une donnée) ; propriété vérifiée (peutToucherNotification).",
  "(app)/push-actions.ts#supprimerPush": "Désabonnement des notifications push de SON appareil.",
  "espace/actions.ts#supprimerMaNotification": "Le salarié efface une notification de SA cloche.",
  "espace/actions.ts#annulerChangement": "« Retirer ma demande » : le salarié retire SA demande de changement de shift encore EN_ATTENTE (pas de statut ANNULEE dans LeaveStatus ; schéma inchangé).",
  "pointage/actions.ts#annulerPointage": "Le salarié annule SON scan dans les 5 minutes : le scan est marqué annulé (jamais effacé) ; seules les présences posées par ce scan reviennent à leur état d'avant.",
  // ── Conséquence d'une décision de la Direction ──────────────────────────────────────────────
  "(app)/conges/actions.ts#demanderConge": "Les codes congé ne sont posés (et les heures pré-remplies retirées) que si l'auteur est la Direction (congé auto-validé).",
  // ── Modification d'une saisie de grille (0 / vide = « rien ce jour-là »), pas une suppression ─
  "(app)/heures-supp/actions.ts#saisirHeures": "Heures du jour : vider la case = 0 heure (quantité), modification de la grille.",
  "(app)/heures-supp/actions.ts#saisirHeuresEnLot": "Idem en lot (Appliquer des heures). « Supprimer » du lot est réservé à la Direction côté présences.",
  "(stock)/stock/journalier/actions.ts#saisirCommandeResto": "Quantité commandée du jour : 0 = rien commandé (case de grille).",
  "(stock)/stock/journalier/actions.ts#saisirCommandeLegume": "Idem pour un légume.",
  "(stock)/stock/journalier/ventes-actions.ts#saisirVente": "Quantité vendue du jour : vider la case (journalisé, avant → après).",
  "(stock)/stock/restaurant/actions.ts#majComptage": "Comptage du jour au restaurant : vider la case (case de grille).",
  "(app)/planning/actions.ts#definirBesoin": "Effectif requis : 0 = aucun besoin (case de grille).",
  // ── Planning : un brouillon de travail, journalisé case par case (avant → après) ────────────
  "(app)/planning/actions.ts#saisirCreneau": "Créneau du planning remis à vide : modification du planning, journalisée.",
  "(app)/planning/actions.ts#saisirCreneauxEnLot": "Idem en lot (« Vider » la sélection).",
  "(app)/planning/actions.ts#saisirModele": "Modèle hebdo : jour remis à vide, journalisé.",
  "(app)/planning/actions.ts#approuverChangementShift": "Validation d'une demande : le créneau est REMPLACÉ par le shift demandé.",
  "(app)/planning/actions.ts#approuverEchange": "Validation d'un échange : les deux créneaux sont permutés.",
  "espace/actions.ts#repondreEchange": "Le collègue accepte l'échange ; s'il était déjà validé, les créneaux sont permutés.",
  "(app)/planning/actions.ts#depublierSemaine": "Dépublier = retirer la marque « publiée » de la semaine (le planning reste).",
  // ── « Remplacer les lignes » d'un document qu'on a le droit de modifier ─────────────────────
  "(stock)/stock/fiches/photo-actions.ts#envoyerPhotoFiche": "Remplacer la photo d'une fiche : l'ancien fichier est retiré du stockage (remplacement, pas retrait).",
};

function lister(dir: string, filtre: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...lister(p, filtre));
    else if (filtre(p)) out.push(p);
  }
  return out;
}

function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

type Decl = { nom: string; exporte: boolean; corps: string };

/** Déclarations de premier niveau (fonctions et constantes), chacune jusqu'à la suivante. */
function declarations(src: string): Decl[] {
  const re = /^(export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=)/gm;
  const debuts = [...src.matchAll(re)].map((m) => ({ exporte: !!m[1], nom: (m[2] ?? m[3])!, i: m.index! }));
  return debuts.map((d, k) => {
    const brut = src.slice(d.i, k + 1 < debuts.length ? debuts[k + 1].i : src.length);
    // L'en-tête (nom, paramètres) ne compte pas : seuls les appels du corps.
    const i = brut.indexOf("{");
    return { nom: d.nom, exporte: d.exporte, corps: i >= 0 ? brut.slice(i) : brut };
  });
}

const appelle = (corps: string, nom: string) => new RegExp(`\\b${nom}\\s*\\(`).test(corps);

/** Pour un fichier : quelles déclarations atteignent une suppression, lesquelles ont une garde. */
function analyser(source: string, deleteursLib: Set<string>) {
  const decls = declarations(sansCommentaires(source));
  const locales = decls.filter((d) => !d.exporte);
  const parcourir = (d: Decl, direct: (corps: string) => boolean, pile = new Set<string>()): boolean => {
    if (pile.has(d.nom)) return false;
    pile.add(d.nom);
    if (direct(d.corps)) return true;
    return locales.some((l) => l.nom !== d.nom && appelle(d.corps, l.nom) && parcourir(l, direct, pile));
  };
  const supprimeDirect = (corps: string) =>
    SUPPRESSION_DIRECTE.some((re) => re.test(corps)) || [...deleteursLib].some((n) => appelle(corps, n));
  const gardeDirect = (corps: string) => GARDE_DIRECTION.some((re) => re.test(corps));
  return decls.map((d) => ({ ...d, supprime: parcourir(d, supprimeDirect), garde: parcourir(d, gardeDirect) }));
}

/** Fonctions EXPORTÉES de src/lib qui suppriment (directement ou par une autre de src/lib) — point fixe. */
function deleteursDeLib(exclus: Record<string, string> = TECHNIQUES_LIB): Set<string> {
  const fichiers = lister(LIB, (p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)).map((p) => fs.readFileSync(p, "utf8"));
  const noms = new Set<string>();
  for (let change = true; change; ) {
    change = false;
    for (const src of fichiers) {
      for (const d of analyser(src, noms)) {
        if (d.exporte && d.supprime && !(d.nom in exclus) && !noms.has(d.nom)) { noms.add(d.nom); change = true; }
      }
    }
  }
  return noms;
}

function pointsEntree(): string[] {
  return lister(APP, (p) => {
    if (!/\.(ts|tsx)$/.test(p) || /\.test\./.test(p)) return false;
    if (path.basename(p) === "route.ts") return true;
    return /^\s*["']use server["']/.test(fs.readFileSync(p, "utf8"));
  }).map((p) => path.relative(APP, p).split(path.sep).join("/")).sort();
}

/** Exports qui suppriment sans garde Direction, pour un fichier source. */
function nonGardees(source: string, deleteurs: Set<string>): string[] {
  return analyser(source, deleteurs).filter((d) => d.exporte && d.supprime && !d.garde).map((d) => d.nom);
}

const DELETEURS = deleteursDeLib();
const FICHIERS = pointsEntree();
const lire = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");

describe("seule la Direction supprime : chaque action qui supprime appelle une garde Direction", () => {
  it("le parcours trouve les points d'entrée et les suppressions des bibliothèques (garde contre un faux vert)", () => {
    expect(FICHIERS.length).toBeGreaterThanOrEqual(50);
    expect(FICHIERS).toContain("(stock)/stock/catalogue/actions.ts");
    expect(FICHIERS.some((f) => f.endsWith("route.ts"))).toBe(true);
    // Suppressions indirectes : écritures du journal, photo du stockage, annulation d'import.
    for (const n of ["supprimerEcritures", "supprimerPhoto", "annulerImport", "retirerDoublons"]) expect(DELETEURS).toContain(n);
    // Un Map/Set n'est pas une base : `invaliderProfil` (cache.delete) n'est pas une suppression.
    expect(DELETEURS).not.toContain("invaliderProfil");
  });

  it.each(FICHIERS)("%s", (rel) => {
    const manquantes = nonGardees(lire(rel), DELETEURS).map((nom) => `${rel}#${nom}`).filter((cle) => !(cle in EXCEPTIONS));
    expect(manquantes).toEqual([]);
  });

  it("la liste TECHNIQUES_LIB est fermée : chaque fonction existe dans src/lib et supprime encore", () => {
    const tous = deleteursDeLib({});
    for (const [nom, raison] of Object.entries(TECHNIQUES_LIB)) {
      expect(raison.length, nom).toBeGreaterThan(10);
      expect(tous, nom).toContain(nom);
      expect(DELETEURS, nom).not.toContain(nom);
    }
  });

  it("la liste EXCEPTIONS est fermée : chaque entrée existe, supprime encore et reste sans garde", () => {
    for (const [cle, raison] of Object.entries(EXCEPTIONS)) {
      const [rel, nom] = cle.split("#");
      expect(raison.length, `${cle} : raison manquante`).toBeGreaterThan(10);
      expect(FICHIERS, cle).toContain(rel);
      expect(nonGardees(lire(rel), DELETEURS), cle).toContain(nom);
    }
  });
});

describe("le garde-fou des suppressions mord (falsification en mémoire)", () => {
  it("garde Direction retirée d'une vraie action → signalée", () => {
    const vrai = lire("(stock)/stock/fiches/actions.ts");
    expect(nonGardees(vrai, DELETEURS)).toEqual([]);
    const f = vrai.replace(/(export const supprimerFiches[\s\S]*?)exigerDirectionPourSupprimer\(user\);/, "$1");
    expect(f).not.toBe(vrai);
    expect(nonGardees(f, DELETEURS)).toEqual(["supprimerFiches"]);
  });

  it("requireRole élargi à un autre rôle → ce n'est plus une garde Direction", () => {
    const vrai = lire("(app)/paie/remuneration-actions.ts");
    const f = vrai.replace(/(export async function supprimerPrime[\s\S]*?)requireRole\(user, \["ADMIN"\]\)/, '$1requireRole(user, ["ADMIN", "MANAGER"])');
    expect(f).not.toBe(vrai);
    expect(nonGardees(f, DELETEURS)).toContain("supprimerPrime");
  });

  it("garde posée dans un AUTRE export du fichier → ne compte pas", () => {
    const src = `"use server";
export async function a(user) { exigerDirectionPourSupprimer(user); }
export async function b(id) { await a(user); await prisma.article.delete({ where: { id } }); }`;
    expect(nonGardees(src, DELETEURS)).toEqual(["b"]);
  });

  it("garde dans une fonction locale NON exportée → compte (gardeDirection())", () => {
    const src = `"use server";
async function gardeDirection() { const user = await verifySession(); requireRole(user, ["ADMIN"]); return user; }
export const x = actionLisible(async (id) => { await gardeDirection(); await prisma.article.deleteMany({ where: { id } }); });`;
    expect(nonGardees(src, DELETEURS)).toEqual([]);
  });

  it("suppression cachée dans une fonction locale ou dans une bibliothèque → vue", () => {
    const local = `"use server";
async function effacer(id) { await tx.ligne.deleteMany({ where: { id } }); }
export async function x(id) { requireRole(user, ["ADMIN", "MANAGER"]); await effacer(id); }`;
    expect(nonGardees(local, DELETEURS)).toEqual(["x"]);
    const lib = `"use server";
export const y = actionLisible(async (ids) => { await ecriture.supprimerEcritures(ids); });`;
    expect(nonGardees(lib, DELETEURS)).toEqual(["y"]);
  });

  it("une garde citée en commentaire ne compte pas ; un Map.delete n'est pas une suppression", () => {
    const src = `"use server";
export async function x(id) {
  // exigerDirectionPourSupprimer(user);
  await prisma.fiche.delete({ where: { id } });
}
export async function y(k) { cache.delete(k); }`;
    expect(nonGardees(src, DELETEURS)).toEqual(["x"]);
  });

  it("suppression SQL brute et stockage → vues", () => {
    expect(nonGardees(`"use server";\nexport async function x() { await tx.$executeRaw\`DELETE FROM "stock"."Stock"\`; }`, DELETEURS)).toEqual(["x"]);
    expect(nonGardees(`"use server";\nexport async function x(c) { await supabase.storage.from("b").remove([c]); }`, DELETEURS)).toEqual(["x"]);
  });
});

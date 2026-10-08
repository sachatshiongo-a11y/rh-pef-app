// ─────────────────────────────────────────────────────────────────────────────
// DOUBLONS DE FICHES EMPLOYÉS — demande de la Direction (2026-10-08) : « éviter les doublons dans
// les fiches employés ». Avant : rien n'empêchait de recréer « Tshiongo Sacha » quand « Sacha
// Tshiongo » existait (actif, ou sorti puis revenu) — deux dossiers, deux matricules, deux lignes de
// paie possibles.
//
// Module PUR (ni base, ni session) : l'écran l'applique en direct pendant la saisie, le serveur le
// RÉAPPLIQUE à l'enregistrement sur les fiches lues en base (l'écran seul ne protège rien).
//
// D'où vient la ressemblance des noms. `article-proche.ts` (règle de l'Atelier) n'est pas dans main ;
// on part donc de la recherche commune (`recherche-options.ts`, le champ `ChoixRecherche`) : mêmes
// mots (`motsDe` : sans accents ni casse, coupés sur tout ce qui n'est pas lettre ou chiffre — le
// tiret « Jean-Pierre » et l'apostrophe comptent comme un espace), dans N'IMPORTE QUEL ORDRE,
// chaque mot du plus court se retrouvant dans le plus long. Adaptation aux noms de PERSONNES :
//   - mot ENTIER, jamais une sous-chaîne (« An » ne doit pas trouver « Jean ») ;
//   - une faute de frappe tolérée par mot de 4 lettres ou plus (distance 1, celle des fournisseurs :
//     « Tshiongo »/« Tshiyongo ») ; une initiale (« J. ») vaut le mot qui commence par elle ;
//   - inclusion dans les DEUX sens : un nom ou un prénom MANQUANT reste proche (« Tshiongo » /
//     « Sacha Tshiongo »), un mot de trop aussi (« Marie Kabila » / « Marie-Claire Kabila ») ;
//   - un espace oublié (« Mbuyikabedi » / « Mbuyi Kabedi ») : noms collés à une faute près.
// Ce que la règle NE rapproche PAS : deux personnes qui ne partagent qu'un prénom (« Sacha
// Tshiongo » / « Sacha Mukendi ») — c'est le cas courant d'une brigade, pas un doublon. Le score de
// `similariteNom` (fournisseurs) les rapprochait à 0,8 : impropre aux personnes.
//
// Autres signaux, indépendants du nom :
//   - même TÉLÉPHONE (9 derniers chiffres : « +243 81 234 5678 » = « 0812345678 ») ;
//   - même DATE DE NAISSANCE + au moins un mot du nom en commun (nom de jeune fille / d'épouse).
// Le schéma n'a ni numéro CNSS du salarié ni pièce d'identité (`cnssMontant` est un montant) : ces
// deux signaux n'existent pas encore, il faudrait d'abord les ajouter à la fiche.
//
// Aucun rapprochement ne décide : il MONTRE les fiches proches et exige un choix (ouvrir la fiche
// existante, la réactiver, ou « c'est une autre personne »). Ce choix est journalisé
// (`DOUBLON_ECARTE`) et la paire ne se représente plus.
// ─────────────────────────────────────────────────────────────────────────────

import { motsDe } from "@/lib/recherche-options";
import { lev } from "@/lib/fournisseur-match";

export type IdentiteFiche = {
  nom: string;
  telephone?: string | null;
  dateNaissance?: Date | string | null;
};
export type FicheIdentifiee = IdentiteFiche & { id: string };

export type MotifDoublon = "nom" | "telephone" | "naissance";

/** Une fiche existante qui ressemble à la saisie, et pourquoi. `memeNom` : mêmes mots exactement (ordre, accents, casse près). */
export type FicheProche<T> = { fiche: T; motifs: MotifDoublon[]; memeNom: boolean };

/** Champ caché du formulaire : ids des fiches proches déclarées « autre personne » (séparés par des virgules). */
export const CHAMP_DOUBLONS_ECARTES = "doublonsEcartes";
/** `JournalAudit.champ` d'une paire déclarée « deux personnes différentes » (entiteId = une fiche, nouvelleValeur = les autres ids). */
export const JOURNAL_DOUBLON_ECARTE = "doublon-ecarte";

/** Mots d'un nom de personne ; une précision entre parenthèses n'en fait pas partie (« César (jardinier) »). */
export function motsNom(nom: string | null | undefined): string[] {
  return motsDe(String(nom ?? "").replace(/\([^)]*\)?/g, " "));
}

function motsProches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0]; // initiale : « J » ↔ « Jean »
  return Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1;
}

/** Chaque mot de `court` retrouvé dans `long`, chacun à un mot DISTINCT (le mot identique d'abord, sinon le proche). */
function inclus(court: string[], long: string[]): boolean {
  const libres = [...long];
  for (const m of court) {
    let i = libres.indexOf(m);
    if (i < 0) i = libres.findIndex((x) => motsProches(m, x));
    if (i < 0) return false;
    libres.splice(i, 1);
  }
  return true;
}

const cleTriee = (mots: string[]) => [...mots].sort().join(" ");

/** Mêmes mots, exactement (dans n'importe quel ordre, accents, casse, tirets près). */
export function memeNom(a: string, b: string): boolean {
  const A = motsNom(a), B = motsNom(b);
  return A.length > 0 && cleTriee(A) === cleTriee(B);
}

/** Deux noms de personnes proches (voir l'en-tête : ordre, nom/prénom manquant, faute, espace oublié). */
export function nomsProches(a: string, b: string): boolean {
  const A = motsNom(a), B = motsNom(b);
  // Rien d'autre que des initiales (ou rien du tout) : on ne peut rien affirmer.
  if (!A.some((m) => m.length > 1) || !B.some((m) => m.length > 1)) return false;
  const [court, long] = A.length <= B.length ? [A, B] : [B, A];
  if (inclus(court, long)) return true;
  const collesA = A.join(""), collesB = B.join("");
  if (Math.min(collesA.length, collesB.length) < 8) return false;
  return lev(collesA, collesB) <= 1 || lev([...A].sort().join(""), [...B].sort().join("")) <= 1;
}

/** Clé d'un téléphone : ses 9 derniers chiffres (« +243 81 234 5678 » = « 0812345678 ») ; null s'il en a moins. */
export function cleTelephone(tel: string | null | undefined): string | null {
  const chiffres = String(tel ?? "").replace(/\D/g, "");
  return chiffres.length >= 9 ? chiffres.slice(-9) : null;
}

/** Jour civil d'une date de naissance (colonne DATE : lue en UTC), « AAAA-MM-JJ » ; null si absente ou illisible. */
export function jourNaissance(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(d).trim());
  return m ? m[1] : null;
}

/** Au moins un mot (hors initiale) commun, à une faute près. */
function unMotCommun(a: string, b: string): boolean {
  const B = motsNom(b).filter((m) => m.length > 1);
  return motsNom(a).some((m) => m.length > 1 && B.some((x) => motsProches(m, x)));
}

/** Pourquoi deux identités se ressemblent ; [] si rien. */
export function motifsDoublon(a: IdentiteFiche, b: IdentiteFiche): MotifDoublon[] {
  const motifs: MotifDoublon[] = [];
  if (nomsProches(a.nom, b.nom)) motifs.push("nom");
  const ta = cleTelephone(a.telephone);
  if (ta && ta === cleTelephone(b.telephone)) motifs.push("telephone");
  const na = jourNaissance(a.dateNaissance);
  if (na && na === jourNaissance(b.dateNaissance) && unMotCommun(a.nom, b.nom)) motifs.push("naissance");
  return motifs;
}

/** Clé d'une paire de fiches, indépendante de l'ordre. */
export const clePaire = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Les fiches EXISTANTES (actives et inactives) qui ressemblent à la saisie, de la plus sûre à la
 * moins sûre : même nom exact d'abord, puis le plus de motifs, puis l'ordre reçu. `exclureId` : la
 * fiche en cours de modification ; `ecartees` : paires déjà déclarées « deux personnes » (clés
 * `clePaire`), qui ne se représentent plus.
 */
export function fichesProches<T extends FicheIdentifiee>(
  saisie: IdentiteFiche,
  fiches: readonly T[],
  { exclureId, ecartees }: { exclureId?: string; ecartees?: ReadonlySet<string> } = {},
): FicheProche<T>[] {
  const trouvees: (FicheProche<T> & { ordre: number })[] = [];
  fiches.forEach((fiche, ordre) => {
    if (exclureId && fiche.id === exclureId) return;
    if (exclureId && ecartees?.has(clePaire(exclureId, fiche.id))) return;
    const motifs = motifsDoublon(saisie, fiche);
    if (motifs.length) trouvees.push({ fiche, motifs, memeNom: memeNom(saisie.nom, fiche.nom), ordre });
  });
  trouvees.sort((a, b) => Number(b.memeNom) - Number(a.memeNom) || b.motifs.length - a.motifs.length || a.ordre - b.ordre);
  return trouvees.map(({ fiche, motifs, memeNom }) => ({ fiche, motifs, memeNom }));
}

/** Les paires de fiches DÉJÀ en base qui semblent en double (même règle), hors paires écartées. */
export function doublonsProbables<T extends FicheIdentifiee>(
  fiches: readonly T[],
  ecartees: ReadonlySet<string> = new Set(),
): { a: T; b: T; motifs: MotifDoublon[]; memeNom: boolean }[] {
  const paires: { a: T; b: T; motifs: MotifDoublon[]; memeNom: boolean }[] = [];
  for (let i = 0; i < fiches.length; i++) {
    for (let j = i + 1; j < fiches.length; j++) {
      const a = fiches[i], b = fiches[j];
      if (ecartees.has(clePaire(a.id, b.id))) continue;
      const motifs = motifsDoublon(a, b);
      if (motifs.length) paires.push({ a, b, motifs, memeNom: memeNom(a.nom, b.nom) });
    }
  }
  return paires.sort((x, y) => Number(y.memeNom) - Number(x.memeNom) || y.motifs.length - x.motifs.length);
}

/** Le nom, le téléphone ou la date de naissance ont-ils changé (au sens de la règle) ? Sinon, une modification ne repose pas la question. */
export function identiteModifiee(avant: IdentiteFiche, apres: IdentiteFiche): boolean {
  return (
    cleTriee(motsNom(avant.nom)) !== cleTriee(motsNom(apres.nom)) ||
    cleTelephone(avant.telephone) !== cleTelephone(apres.telephone) ||
    jourNaissance(avant.dateNaissance) !== jourNaissance(apres.dateNaissance)
  );
}

/** Libellé d'un motif, tel qu'affiché à côté de la fiche proche. */
export function libelleMotif(m: MotifDoublon, memeNomExact = false): string {
  if (m === "nom") return memeNomExact ? "même nom" : "nom proche";
  return m === "telephone" ? "même téléphone" : "même date de naissance";
}

/** Ids lus dans le champ caché `doublonsEcartes`. */
export function lireIdsEcartes(brut: FormDataEntryValue | null | undefined): Set<string> {
  return new Set(String(brut ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** Paires écartées lues au journal (`JOURNAL_DOUBLON_ECARTE`) : une entrée = une fiche et les ids déclarés « autre personne ». */
export function pairesEcartees(entrees: readonly { entiteId: string; nouvelleValeur: string | null }[]): Set<string> {
  const paires = new Set<string>();
  for (const e of entrees) for (const autre of lireIdsEcartes(e.nouvelleValeur)) if (autre !== e.entiteId) paires.add(clePaire(e.entiteId, autre));
  return paires;
}

/** Refus lisible du serveur quand une fiche proche n'a pas été tranchée. */
export function messageDoublons(proches: readonly FicheProche<FicheIdentifiee & { actif?: boolean }>[]): string {
  const liste = proches
    .map((p) => `« ${p.fiche.nom} »${p.fiche.actif === false ? " (inactive)" : ""} — ${p.motifs.map((m) => libelleMotif(m, p.memeNom)).join(", ")}`)
    .join(" ; ");
  return `${proches.length > 1 ? "Des fiches proches existent déjà" : "Une fiche proche existe déjà"} : ${liste}. Ouvrez la fiche existante (ou réactivez-la), ou confirmez « C'est une autre personne » pour enregistrer quand même.`;
}

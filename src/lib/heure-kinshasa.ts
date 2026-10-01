import { normaliserEspaces } from "@/lib/montant";

// L'HEURE DE KINSHASA — le seul endroit du dépôt qui convertit un INSTANT en date locale.
//
// Le serveur (Render) tourne en UTC, Kinshasa en UTC+1 sans heure d'été : un instant entre minuit
// et une heure du matin, formaté à l'heure du serveur, tombe sur la VEILLE. Ces fonctions valent
// pour les instants (signature, acceptation, « aujourd'hui ») ; les dates métier PURES stockées à
// minuit UTC (`@db.Date` : début de contrat, jour de congé…) se formatent en UTC, pas ici.
//
// Module pur (ni base, ni `server-only`) : les écrans, les PDF et `lib/signature.ts` l'importent.
//
// ⚠️ Construit morceau par morceau (`formatToParts`), et JAMAIS par la méthode `toLocaleString`
// avec la locale fr-FR (écrite ici séparément à dessein : le garde-fou
// `lib/pdf/glyphes-manquants.test.ts` cherche cette chaîne littérale dans tout fichier qui
// alimente un PDF) : depuis ICU 72, Intl fr-FR insère une ESPACE FINE INSÉCABLE (U+202F) entre
// l'heure et les minutes comme entre les milliers d'un montant. Optima, la police embarquée dans
// nos PDF, n'a aucun glyphe pour ce caractère : react-pdf se rabat sur Helvetica, qui dessine une
// barre noire en travers. La sortie repasse malgré tout par `normaliserEspaces` : ceinture ET
// bretelles, un changement de version d'ICU peut réintroduire l'espace fine.

function morceauxKinshasa(d: Date, avecHeure: boolean) {
  const morceaux = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Kinshasa",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(avecHeure ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}), // minuit = « 00 h 00 »
  }).formatToParts(d);
  return (type: Intl.DateTimeFormatPartTypes) => morceaux.find((m) => m.type === type)?.value ?? "";
}

/** Date et heure de Kinshasa, `JJ/MM/AAAA à HH h MM`. */
export function dateHeureKinshasa(d: Date): string {
  const p = morceauxKinshasa(d, true);
  return normaliserEspaces(`${p("day")}/${p("month")}/${p("year")} à ${p("hour")} h ${p("minute")}`);
}

/**
 * L'heure seule, heure de Kinshasa, `H h MM` sans zéro devant l'heure (« 8 h 02 », « 0 h 30 ») —
 * la forme des écrans de pointage (« Arrivée pointée à 8 h 02. »).
 */
export function heureKinshasa(d: Date): string {
  const p = morceauxKinshasa(d, true);
  return normaliserEspaces(`${Number(p("hour"))} h ${p("minute")}`);
}

/**
 * « généré le » des pieds de rapport et aperçus : `JJ/MM/AAAA à HH:MM` (heure de Kinshasa, 24 h,
 * deux chiffres : « 05:28 »). Le serveur étant en UTC, l'heure brute retardait d'une heure.
 */
export function dateHeureGenerationKinshasa(d: Date): string {
  const p = morceauxKinshasa(d, true);
  return normaliserEspaces(`${p("day")}/${p("month")}/${p("year")} à ${p("hour")}:${p("minute")}`);
}

/** Le seul jour, heure de Kinshasa, `JJ/MM/AAAA`. */
export function jourKinshasa(d: Date): string {
  const p = morceauxKinshasa(d, false);
  return normaliserEspaces(`${p("day")}/${p("month")}/${p("year")}`);
}

/**
 * Le jour civil de Kinshasa d'un instant, rendu comme une date PURE (minuit UTC de ce jour) — pour
 * les formateurs du dépôt qui écrivent les dates en UTC (« 23 septembre 2026 » des PDF).
 */
export function jourCivilKinshasa(d: Date): Date {
  const p = morceauxKinshasa(d, false);
  return new Date(Date.UTC(Number(p("year")), Number(p("month")) - 1, Number(p("day"))));
}

// ── Le « MAINTENANT » civil : jour, mois, année courants à Kinshasa ───────────────────────────────
//
// Un écran qui demande « le mois courant », « aujourd'hui » ou « l'année en cours » à l'horloge du
// serveur (UTC) se trompe entre 00 h et 01 h à Kinshasa : le 1er octobre à 00 h 19 WAT, il est
// encore le 30 septembre 23 h 19 UTC — l'écran affichait septembre, alors que les sorties de stock,
// les pointages et le journal sont déjà datés du 1er octobre (jour civil de Kinshasa). Ces trois
// fonctions sont l'UNIQUE façon de déduire le jour/mois/année courants de l'horloge ; elles ne
// touchent PAS aux dates STOCKÉES (minuit UTC d'un jour civil), qui se lisent toujours en UTC.
// Garde-fou : `lib/horloge-kinshasa.garde-fou.test.ts`.

/** Aujourd'hui, heure de Kinshasa, en `AAAA-MM-JJ`. */
export function jourCourantKinshasaISO(maintenant: Date = new Date()): string {
  return jourCivilKinshasa(maintenant).toISOString().slice(0, 10);
}

/** Le mois civil de Kinshasa en cours, en `AAAA-MM` (valeur d'un input type="month"). */
export function moisCourantKinshasa(maintenant: Date = new Date()): string {
  return jourCourantKinshasaISO(maintenant).slice(0, 7);
}

/** L'année civile de Kinshasa en cours. */
export function anneeCouranteKinshasa(maintenant: Date = new Date()): number {
  return jourCivilKinshasa(maintenant).getUTCFullYear();
}

/** Le numéro du mois civil de Kinshasa en cours (1 à 12) — le repli d'un `Config` absent. */
export function numeroMoisCourantKinshasa(maintenant: Date = new Date()): number {
  return jourCivilKinshasa(maintenant).getUTCMonth() + 1;
}

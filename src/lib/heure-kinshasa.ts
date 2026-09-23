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

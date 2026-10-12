/**
 * Erreurs MÉTIER vs erreurs INATTENDUES (audit du 10/10/2026, sécurité 6).
 *
 * Seules les erreurs métier — écrites POUR être lues par la personne à l'écran (« Le montant dépasse
 * le reste à payer ») — remontent telles quelles. Toute autre erreur (base de données, réseau,
 * bibliothèque, bogue : TypeError, PrismaClient…Error, DatabaseError de pg, [DecimalError]…)
 * révélerait des détails internes (requêtes, noms de tables, chemins) sans rien apprendre
 * d'utile à la personne : elle reçoit « Erreur inattendue, réessayez » avec une référence, et
 * l'erreur complète part au journal du serveur (Render) sous cette même référence.
 *
 * Est métier :
 *  - une `Error` SIMPLE (`throw new Error("…")`) : c'est la convention de tout le dépôt pour un
 *    refus lisible — sauf le message technique de decimal.js (« [DecimalError] … »), lui aussi
 *    une Error simple ;
 *  - toute instance d'`ErreurMetier` (les classes de refus du dépôt en héritent).
 * Le nom de classe n'est pas un critère : il est minifié dans le build de production.
 *
 * Module sans dépendance, importable côté client comme côté serveur.
 */
export class ErreurMetier extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ErreurMetier";
  }
}

export const MESSAGE_ERREUR_INATTENDUE = "Erreur inattendue, réessayez.";

export function estErreurMetier(e: unknown): e is Error {
  if (e instanceof ErreurMetier) return !!e.message;
  if (!(e instanceof Error) || Object.getPrototypeOf(e) !== Error.prototype || !e.message) return false;
  return !e.message.startsWith("[DecimalError]");
}

/** Référence courte, à rapprocher du journal du serveur. */
export function referenceErreur(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
}

/**
 * Message à montrer pour `e`. Une erreur inattendue est JOURNALISÉE (console.error = journal Render
 * côté serveur) avec son contexte et une référence, rappelée dans le message affiché.
 */
export function messageLisible(e: unknown, contexte: string): string {
  if (estErreurMetier(e)) return e.message;
  const ref = referenceErreur();
  console.error(`[${contexte}] erreur inattendue (réf. ${ref}) :`, e);
  return `${MESSAGE_ERREUR_INATTENDUE} (réf. ${ref})`;
}

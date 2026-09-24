import type { Role } from "@prisma/client";

// Qui peut remplacer son mot de passe par /espace/mot-de-passe, et qui doit y être envoyé.
// Fonctions PURES : l'action, la page et les gardes (entrée, espace salarié, espace Stock) lisent
// la même règle. Ce formulaire ne demande PAS l'ancien mot de passe et n'est pas journalisé : il
// n'est fait que pour remplacer le mot de passe TEMPORAIRE d'une fiche de connexion.

export type CompteMotDePasse = {
  role: Role;
  employeeId: string | null;
  motDePasseTemporaire: boolean;
  /** Interrupteur global de l'espace salarié (Config.espaceEmployeActif). */
  espaceOuvert: boolean;
};

/**
 * Un compte EMPLOYE : comme avant, toujours accepté. Tout autre compte (Stock, Direction…) :
 * seulement s'il est relié à une fiche employé, que son mot de passe est temporaire (reçu par
 * « Nouvelle fiche ») et que l'espace salarié est ouvert. Hors de ce cas, un compte à e-mail
 * change son mot de passe par les chemins qui exigent 8 caractères et laissent une trace.
 */
export function peutChangerSonMotDePasse(c: CompteMotDePasse): boolean {
  if (c.role === "EMPLOYE") return true;
  return !!c.employeeId && c.motDePasseTemporaire && c.espaceOuvert;
}

/** La page /espace/mot-de-passe affiche son formulaire : espace ouvert, fiche liée, règle ci-dessus. */
export function formulaireMotDePasseOuvert(c: CompteMotDePasse): boolean {
  return c.espaceOuvert && !!c.employeeId && peutChangerSonMotDePasse(c);
}

/**
 * Faut-il envoyer ce compte changer son mot de passe avant tout accès ? Seulement si la page
 * l'accueillera : sinon elle le renverrait vers /entree, qui le renverrait vers elle (boucle).
 */
export function doitChangerSonMotDePasse(c: CompteMotDePasse): boolean {
  return c.motDePasseTemporaire && formulaireMotDePasseOuvert(c);
}

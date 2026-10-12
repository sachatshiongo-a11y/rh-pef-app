/**
 * Longueur minimale d'un mot de passe, la MÊME pour tous les comptes (audit du 10/10/2026,
 * sécurité 14 : le salarié pouvait choisir 6 caractères, quand la Direction et la réinitialisation
 * par e-mail en exigeaient 8).
 */
export const MOT_DE_PASSE_MIN = 8;
export const MESSAGE_MOT_DE_PASSE_COURT = `Le mot de passe doit faire au moins ${MOT_DE_PASSE_MIN} caractères.`;

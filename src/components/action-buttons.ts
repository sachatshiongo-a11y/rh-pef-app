// Styles partagés des boutons d'action de validation (B7 / D).
// Vert = accepter/valider, rouge = refuser/annuler, neutre = étapes intermédiaires.
// Couleurs 600 + texte blanc : contraste AA respecté (WCAG 2.2, ≥ 4,5:1).
export const BTN_VALIDER =
  "inline-flex items-center gap-1 rounded-md bg-success px-3 py-1 text-xs font-medium text-white hover:bg-success/90";
export const BTN_REFUSER =
  "inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1 text-xs font-medium text-white hover:bg-destructive/90";
export const BTN_NEUTRE =
  "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent";

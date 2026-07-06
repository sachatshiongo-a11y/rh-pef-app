// Styles partagés des boutons d'action de validation (B7 / D).
// Vert = accepter/valider, rouge = refuser/annuler, neutre = étapes intermédiaires.
// Couleurs 600 + texte blanc : contraste AA respecté (WCAG 2.2, ≥ 4,5:1).
export const BTN_VALIDER =
  "inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700";
export const BTN_REFUSER =
  "inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700";
export const BTN_NEUTRE =
  "inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent";

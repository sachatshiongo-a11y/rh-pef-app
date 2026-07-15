// Lecture des nombres saisis dans les formulaires (virgule française acceptée).
// Avant : la même fonction `dec` était copiée dans 7 fichiers d'actions, en deux variantes.

/** Nombre décimal d'un champ de formulaire — 0 si vide ou illisible. */
export const dec = (v: FormDataEntryValue | null | undefined): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Variante « champ facultatif » : null si vide ou illisible. */
export const decOptionnel = (v: FormDataEntryValue | null | undefined): number | null => {
  const s = String(v ?? "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

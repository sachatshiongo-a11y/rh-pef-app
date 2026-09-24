// Suivi, pour toute la page, des cases de tableur dont la saisie n'est pas (encore) en base :
// enregistrement en cours, ou échec affiché en rouge. Tant qu'il en reste, quitter ou recharger
// la page demande confirmation au navigateur — une saisie ne se perd pas en silence.

let enCours = 0;
let enErreur = 0;
let ecoute = false;

function avantDechargement(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = ""; // anciens navigateurs : la présence d'une valeur déclenche la confirmation
}

function actualiser() {
  if (typeof window === "undefined") return;
  const besoin = enCours + enErreur > 0;
  if (besoin && !ecoute) window.addEventListener("beforeunload", avantDechargement);
  if (!besoin && ecoute) window.removeEventListener("beforeunload", avantDechargement);
  ecoute = besoin;
}

export const suivi = {
  debut() { enCours++; actualiser(); },
  fin() { enCours = Math.max(0, enCours - 1); actualiser(); },
  erreur(plus: boolean) { enErreur = Math.max(0, enErreur + (plus ? 1 : -1)); actualiser(); },
  /** Pour les tests. */
  etat: () => ({ enCours, enErreur, ecoute }),
};

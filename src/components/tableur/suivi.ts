// Suivi, pour toute la page, des cases de tableur dont la saisie n'est pas (encore) en base :
//  - MODIFIÉES : une frappe n'a pas encore été validée (on n'a pas quitté la case) ;
//  - EN COURS : l'enregistrement est parti, la réponse n'est pas revenue ;
//  - EN ERREUR : l'enregistrement a échoué, la case est affichée en rouge.
//
// Tant qu'il en reste, quitter ou recharger la page demande confirmation au navigateur. Et quand
// la page passe en arrière-plan ou se ferme (`visibilitychange` → hidden, `pagehide` — le cas du
// téléphone qu'on verrouille ou de l'onglet qu'on quitte), les cases modifiées sont validées tout
// de suite. Un envoi lancé pendant la FERMETURE même n'est pas garanti par le navigateur : c'est
// la confirmation avant de quitter qui couvre ce cas.

let enCours = 0;
let enErreur = 0;
/** Case modifiée → fonction qui la valide (et l'enregistre) sur-le-champ. */
const modifiees = new Map<object, () => void>();
let ecouteQuitter = false;
let ecouteMasquage = false;

function avantDechargement(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = ""; // anciens navigateurs : la présence d'une valeur déclenche la confirmation
}

/** Valide toutes les cases modifiées (page masquée ou fermée). */
function validerModifiees() {
  for (const valider of [...modifiees.values()]) valider();
}
function surMasquage() {
  if (document.visibilityState === "hidden") validerModifiees();
}

function actualiser() {
  if (typeof window === "undefined") return;
  const besoin = enCours + enErreur + modifiees.size > 0;
  if (besoin && !ecouteQuitter) window.addEventListener("beforeunload", avantDechargement);
  if (!besoin && ecouteQuitter) window.removeEventListener("beforeunload", avantDechargement);
  ecouteQuitter = besoin;
  if (!ecouteMasquage) {
    ecouteMasquage = true;
    document.addEventListener("visibilitychange", surMasquage);
    window.addEventListener("pagehide", validerModifiees);
  }
}

export const suivi = {
  debut() { enCours++; actualiser(); },
  fin() { enCours = Math.max(0, enCours - 1); actualiser(); },
  erreur(plus: boolean) { enErreur = Math.max(0, enErreur + (plus ? 1 : -1)); actualiser(); },
  /** Une case vient d'être modifiée : `valider` l'enregistrera si la page se masque ou se ferme. */
  modifiee(jeton: object, valider: () => void) { modifiees.set(jeton, valider); actualiser(); },
  /** La case modifiée a été validée, annulée (Échap) ou rétablie. */
  propre(jeton: object) { if (modifiees.delete(jeton)) actualiser(); },
  /** Pour les tests. */
  etat: () => ({ enCours, enErreur, modifiees: modifiees.size, ecoute: ecouteQuitter }),
};

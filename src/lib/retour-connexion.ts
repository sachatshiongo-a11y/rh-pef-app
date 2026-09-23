// Le RETOUR APRÈS CONNEXION — module pur (proxy, page et action de connexion l'importent).
//
// Un salarié qui scanne l'affiche avec l'appareil photo du téléphone arrive sur `/scan?c=…` dans un
// navigateur sans session (sur iPhone, Safari ne partage pas la session de l'application
// installée). Le garde d'authentification l'envoie vers `/login?retour=/scan?c=…`, et la connexion
// le ramène au scan.
//
// `retour` voyage dans l'adresse : n'importe qui peut en forger un. Honoré sans contrôle, un lien
// « /login?retour=https://faux-site » renverrait le salarié, juste après son mot de passe, vers un
// site qui imite l'application (redirection ouverte). Une seule destination est donc permise, le
// scan de l'affiche ; tout le reste est ignoré et la connexion suit son chemin habituel (/entree).

const BASE_FICTIVE = "http://retour.invalid";
const LONGUEUR_MAX = 512;

/**
 * Le chemin de retour s'il est permis, sous forme canonique (`/scan?…`), sinon `null`.
 * Jamais décodé : un chemin encodé (« %2Fscan… ») n'est pas « /scan? » et reste refusé.
 */
export function retourValide(retour: unknown): string | null {
  if (typeof retour !== "string" || retour.length > LONGUEUR_MAX) return null;
  if (!retour.startsWith("/scan?")) return null;
  // ASCII imprimable seulement : ni espace, ni retour à la ligne (injection d'en-tête), ni
  // barre oblique inverse (certains navigateurs lisent « /\ » comme « // », un autre site).
  if (!/^[\x21-\x7e]+$/.test(retour) || retour.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(retour, BASE_FICTIVE);
  } catch {
    return null;
  }
  if (url.origin !== BASE_FICTIVE || url.pathname !== "/scan") return null;
  return `${url.pathname}${url.search}`;
}

/** Ce que le garde d'authentification mémorise en renvoyant vers la connexion : le scan seul. */
export function retourPourChemin(pathname: string, search: string): string | null {
  if (pathname !== "/scan") return null;
  return retourValide(`${pathname}${search}`);
}

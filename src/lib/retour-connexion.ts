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

// ── Le retour survit au changement du mot de passe temporaire ────────────────────────────────
// Un salarié dont le mot de passe est encore temporaire, arrivé par l'affiche, passe par
// `/espace/mot-de-passe` avant de pouvoir pointer. Le retour l'accompagne (même règle : seul le
// scan), puis la page de changement l'y ramène. Le code de l'affiche est le seul secret qui voyage
// dans l'adresse — il y est déjà, imprimé sur l'affiche ; le mot de passe, jamais.

export const PAGE_CHANGEMENT_MOT_DE_PASSE = "/espace/mot-de-passe";

/** Le retour vers le scan d'un code d'affiche (encodé comme l'affiche l'imprime), ou `null`. */
export function retourDuScan(code: string | undefined): string | null {
  if (!code) return null;
  return retourValide(`/scan?c=${encodeURIComponent(code)}`);
}

/** L'adresse de la page de changement, avec le retour s'il est permis (revalidé ici). */
export function adresseChangementMotDePasse(retour: unknown): string {
  const r = retourValide(retour);
  return r ? `${PAGE_CHANGEMENT_MOT_DE_PASSE}?retour=${encodeURIComponent(r)}` : PAGE_CHANGEMENT_MOT_DE_PASSE;
}

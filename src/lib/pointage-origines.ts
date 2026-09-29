// Les ORIGINES de l'affiche de pointage — module PUR, importé côté client (scanner) comme côté
// serveur (impression de l'affiche).
//
// L'application répond sur plusieurs adresses en production : gestion.patesenfolie.cd (l'OFFICIELLE
// depuis le 2026-09-29, décision de la Direction), rh.patesenfolie.cd (l'ancienne, désormais
// redirigée vers la nouvelle — des affiches ont pu être imprimées avec elle) et rh-pef.onrender.com.
// Un salarié a pu installer l'application depuis l'une ou l'autre. L'affiche, elle,
// n'en porte qu'UNE : toujours l'origine officielle, quelle que soit l'adresse depuis laquelle la
// Direction l'imprime. Le scanner accepte donc l'origine où il tourne ET celle de l'affiche.
// Le code de l'affiche reste vérifié côté serveur, en temps constant : accepter deux origines
// n'affaiblit rien.

const ORIGINE_OFFICIELLE = "https://gestion.patesenfolie.cd";
/** Anciennes adresses officielles : une affiche déjà imprimée avec elles reste lisible par le scanner. */
export const ANCIENNES_ORIGINES: readonly string[] = ["https://rh.patesenfolie.cd"];

function origineLue(valeur: string | undefined): string {
  const v = (valeur ?? "").trim();
  if (!v) return ORIGINE_OFFICIELLE;
  try {
    const url = new URL(v);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : ORIGINE_OFFICIELLE;
  } catch {
    return ORIGINE_OFFICIELLE;
  }
}

/**
 * L'origine encodée par l'affiche imprimée. `NEXT_PUBLIC_ORIGINE_AFFICHE` (écrit en toutes lettres :
 * Next.js ne l'inline dans le paquet client que sous cette forme), sinon l'adresse officielle.
 */
export const ORIGINE_AFFICHE: string = origineLue(process.env.NEXT_PUBLIC_ORIGINE_AFFICHE);

/** Les origines d'où un QR d'affiche est accepté : l'origine courante, celle de l'affiche, et les
 *  anciennes adresses officielles (affiches imprimées avant le changement d'adresse). */
export function originesAcceptees(courante: string): string[] {
  return [...new Set([courante, ORIGINE_AFFICHE, ...ANCIENNES_ORIGINES])];
}

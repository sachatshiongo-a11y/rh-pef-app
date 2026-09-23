// Le CODE de l'affiche de pointage — module SERVEUR (node:crypto). JAMAIS importé côté client :
// `pointage-qr.ts` porte les règles pures partagées avec le composant client, ce fichier-ci reste
// à part exprès pour qu'aucun bundle client n'embarque `node:crypto`.

import { randomBytes, timingSafeEqual } from "node:crypto";

/** Nouveau code d'affiche : 32 octets aléatoires, encodés base64url (sûr dans une URL). */
export function genererCodeAffiche(): string {
  return randomBytes(32).toString("base64url");
}

/** Compare deux codes en temps constant. Longueurs différentes → faux, sans comparer le contenu. */
export function codesEgaux(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

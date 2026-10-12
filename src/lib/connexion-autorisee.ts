import type { Role } from "@prisma/client";
import { estStock } from "@/lib/espaces";

/**
 * Qui peut ouvrir une session (src/app/login/actions.ts). Module PUR.
 *
 * Un compte désactivé, jamais. Un compte salarié (EMPLOYE) n'a, en propre, que l'espace salarié :
 * quand la Direction l'a fermé, il n'a rien à ouvrir — SAUF s'il a aussi reçu l'accès Stock
 * (`accesStock`), auquel cas il entre dans le Stock (audit du 10/10/2026, sécurité 10 : il était
 * refusé au motif « Identifiants incorrects », alors que /entree l'aurait bien orienté vers le Stock).
 * Les autres rôles ne dépendent pas de l'espace salarié.
 */
export function connexionAutorisee(profil: { role: Role; actif: boolean; accesStock: boolean } | null, espaceSalarieOuvert: boolean): boolean {
  if (!profil) return true; // pas de profil applicatif : verifySession tranchera (comportement inchangé)
  if (!profil.actif) return false;
  if (profil.role === "EMPLOYE") return espaceSalarieOuvert || estStock(profil);
  return true;
}

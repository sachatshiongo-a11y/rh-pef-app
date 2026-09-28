import "server-only";

import { redirect } from "next/navigation";
import { verifySession, type CurrentUser } from "@/lib/auth";
import { estRH, estStock, estExploitation } from "@/lib/espaces";

/**
 * GARDES DES PAGES (`page.tsx`) — LE LAYOUT NE SUFFIT PAS.
 *
 * Next rend le layout et la page EN PARALLÈLE. Quand `app/(app)/layout.tsx` renvoie un salarié
 * vers /entree, la page, elle, a déjà lu la base et son rendu part quand même dans la réponse :
 * mesuré le 2026-09-28 sur Next 16.2.9 (projet minimal, même structure), un compte refusé par le
 * layout reçoit une 307… dont le CORPS contient le rendu complet de la page (flux RSC inséré dans
 * le HTML, ou réponse `RSC: 1`). Un navigateur suit la redirection et ne montre rien ; un `curl`
 * avec le cookie d'un salarié lit la paie de toute la brigade.
 *
 * Chaque page appelle donc la garde de SON espace en PREMIÈRE instruction (hors `await params` /
 * `await searchParams`), avant toute lecture : le refus est levé avant que la page ait produit quoi
 * que ce soit. Mêmes prédicats que les layouts (`lib/espaces.ts`), même destination (/entree).
 * Vérifié par `src/app/pages-gardees.test.ts`, qui parcourt toutes les pages à chaque passage.
 * L'espace salarié a déjà la sienne : `chargerSalarie()` (`app/espace/garde.ts`).
 */

/** Espace RH — même règle que `app/(app)/layout.tsx`. */
export async function exigerPageRH(): Promise<CurrentUser> {
  const user = await verifySession();
  if (!estRH(user.role)) redirect("/entree");
  return user;
}

/** Espace Stock — même règle que `app/(stock)/layout.tsx`. */
export async function exigerPageStock(): Promise<CurrentUser> {
  const user = await verifySession();
  if (!estStock(user)) redirect("/entree");
  return user;
}

/** Espace Exploitation — même règle que `app/(exploitation)/layout.tsx`. */
export async function exigerPageExploitation(): Promise<CurrentUser> {
  const user = await verifySession();
  if (!estExploitation(user)) redirect("/entree");
  return user;
}

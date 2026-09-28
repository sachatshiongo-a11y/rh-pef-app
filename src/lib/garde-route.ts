import "server-only";

import type { Role } from "@prisma/client";
import { verifySession, type CurrentUser } from "@/lib/auth";
import { estRH, estStock, estExploitation, estSalarie } from "@/lib/espaces";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { peutLireFichier } from "@/lib/acces-fichier";

/**
 * GARDES DES ROUTE HANDLERS (`route.ts`).
 *
 * Un `route.ts` n'hérite PAS de la garde du layout de son groupe : `app/(app)/layout.tsx` renvoie
 * un salarié vers /entree quand il ouvre une PAGE RH, mais une route placée à côté
 * (`(app)/paie/bulletins-zip/route.ts`…) est servie sans jamais passer par ce layout. Jusqu'au
 * 2026-09-28, beaucoup de routes n'appelaient que `verifySession()` : tout compte connecté — un
 * salarié, un magasinier — pouvait télécharger tous les bulletins du mois, le livre de paie, les
 * fiches des collègues.
 *
 * Chaque route appelle donc la garde de SON espace, qui reprend EXACTEMENT la règle du layout
 * correspondant (mêmes prédicats, importés de `lib/espaces.ts`). Un refus est un 403 en texte, jamais
 * une redirection : un `fetch` (visionneuse, téléchargement) suit les redirections et enregistrerait
 * la page d'accueil sous le nom du document, sans que rien ne signale l'erreur.
 *
 * Usage, en PREMIÈRE instruction du handler :
 *
 *     const g = await exigerEspaceRH();
 *     if (!g.ok) return g.reponse;
 *
 * `src/app/routes-gardees.test.ts` vérifie que chaque `route.ts` du dépôt le fait.
 */

export type Garde<U = CurrentUser> = { ok: true; user: U } | { ok: false; reponse: Response };

export const MESSAGE_ACCES_REFUSE = "Accès refusé.";

export function refus(message: string = MESSAGE_ACCES_REFUSE): { ok: false; reponse: Response } {
  return {
    ok: false,
    reponse: new Response(message, {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

type Options = {
  /** Restreint en plus à ces rôles (ex. ["ADMIN", "MANAGER"]) — l'ancien `requireRole`, en 403. */
  roles?: Role[];
  /** Texte du refus, si la route en a un plus parlant que « Accès refusé. ». */
  message?: string;
};

function filtrerRoles(user: CurrentUser, opts?: Options): Garde {
  if (opts?.roles && !opts.roles.includes(user.role)) return refus(opts.message);
  return { ok: true, user };
}

/** Espace RH — même règle que `app/(app)/layout.tsx` : `estRH(user.role)`. */
export async function exigerEspaceRH(opts?: Options): Promise<Garde> {
  const user = await verifySession();
  if (!estRH(user.role)) return refus(opts?.message);
  return filtrerRoles(user, opts);
}

/** Espace Stock — même règle que `app/(stock)/layout.tsx` : `estStock(user)`. */
export async function exigerEspaceStock(opts?: Options): Promise<Garde> {
  const user = await verifySession();
  if (!estStock(user)) return refus(opts?.message);
  return filtrerRoles(user, opts);
}

/** Espace Exploitation — même règle que `app/(exploitation)/layout.tsx` : `estExploitation(user)`. */
export async function exigerEspaceExploitation(opts?: Options): Promise<Garde> {
  const user = await verifySession();
  if (!estExploitation(user)) return refus(opts?.message);
  return filtrerRoles(user, opts);
}

export type UtilisateurSalarie = CurrentUser & { employeeId: string };

/**
 * Espace salarié — même règle que `app/espace/layout.tsx` : l'espace est OUVERT (Config) et le
 * compte est relié à une fiche. Renvoie un utilisateur dont `employeeId` est garanti : c'est à
 * LUI, et à lui seul, que la route compare le propriétaire du document demandé.
 */
export async function exigerEspaceSalarie(opts?: Pick<Options, "message">): Promise<Garde<UtilisateurSalarie>> {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) return refus(opts?.message);
  return { ok: true, user: { ...user, employeeId: user.employeeId } };
}

/**
 * Fichier du bucket privé (`/fichiers/<chemin>`) — n'appartient à aucun espace : la RH ouvre tout,
 * un autre compte n'ouvre que ce que la BASE lui attribue (voir `lib/acces-fichier.ts`).
 */
export async function exigerAccesFichier(url: string): Promise<Garde> {
  const user = await verifySession();
  if (!(await peutLireFichier(prisma, user, url))) return refus();
  return { ok: true, user };
}

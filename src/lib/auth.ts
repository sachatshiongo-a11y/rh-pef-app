import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getJwksKeys } from "@/lib/supabase/jwks";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

export type CurrentUser = {
  id: string;
  email: string;
  nom: string;
  role: Role;
  accesStock: boolean; // compte salarié (EMPLOYE) ayant AUSSI accès à l'espace Stock
  employeeId: string | null; // fiche employé liée → ouvre l'espace salarié (self-service)
};

// Cache mémoire du profil (le serveur `next start` est un process durable). Évite une requête
// DB de rôle à CHAQUE navigation : le profil/rôle change rarement. TTL court → une
// désactivation de compte prend effet en ≤ 60 s. Invalidable via `invaliderProfil`.
const CACHE_PROFIL_MS = 60_000;
const cacheProfil = new Map<string, { profil: CurrentUser; expire: number }>();

export function invaliderProfil(userId: string) {
  cacheProfil.delete(userId);
}

/** Vérifie la session Supabase et retourne le profil applicatif (avec rôle). Redirige vers /login si absent. */
export const verifySession = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  // Vérification locale du jeton (signature ES256) — clés JWKS fournies depuis le cache module
  // pour éviter tout appel réseau (le client Supabase est recréé à chaque requête).
  const keys = await getJwksKeys();
  const { data } = await supabase.auth.getClaims(undefined, { keys });
  const sub = data?.claims?.sub;

  if (!sub) {
    redirect("/login");
  }

  const enCache = cacheProfil.get(sub);
  if (enCache && enCache.expire > Date.now()) {
    return enCache.profil;
  }

  const profile = await prisma.user.findUnique({ where: { id: sub } });

  if (!profile || !profile.actif) {
    cacheProfil.delete(sub);
    redirect("/login");
  }

  const profil: CurrentUser = {
    id: profile.id,
    email: profile.email,
    nom: profile.nom,
    role: profile.role,
    accesStock: profile.accesStock,
    employeeId: profile.employeeId,
  };
  cacheProfil.set(sub, { profil, expire: Date.now() + CACHE_PROFIL_MS });
  return profil;
});

/** À utiliser dans les Server Actions / Route Handlers pour exiger un rôle minimum. */
export function requireRole(user: CurrentUser, allowed: Role[]) {
  if (!allowed.includes(user.role)) {
    throw new Error("Accès refusé : rôle insuffisant.");
  }
}

// ── Accès par espace (cloisonnement RH / Stock / Salarié) ─────────────────────
// DEUX dimensions INDÉPENDANTES :
//   1. le RÔLE porte l'accès back-office : ADMIN (Direction) = RH + Stock ; MANAGER/VIEWER = RH ;
//      STOCK = Stock. Un salarié peut recevoir en plus l'accès Stock (User.accesStock).
//   2. l'ESPACE SALARIÉ (self-service) appartient à tout compte OPÉRATIONNEL relié à une fiche
//      employé (rôle EMPLOYE ou STOCK) — indépendamment de l'accès stock. Ainsi un magasinier
//      (STOCK) relié à sa fiche a À LA FOIS l'espace Stock ET son espace salarié, sans être Direction.
export type Espace = "rh" | "stock" | "salarie" | "exploitation";

export function estRH(role: Role): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "VIEWER";
}

/** Accès à l'espace Stock : rôles Stock/Direction, OU un salarié à qui l'accès stock a été accordé. */
export function estStock(user: { role: Role; accesStock?: boolean }): boolean {
  return user.role === "ADMIN" || user.role === "STOCK" || (user.role === "EMPLOYE" && !!user.accesStock);
}

/** Accès à l'espace Exploitation (finance : journal de caisse, comptes de trésorerie, plan comptable) :
 *  Direction ou rôle Compta dédié. */
export function estExploitation(user: { role: Role }): boolean {
  return user.role === "ADMIN" || user.role === "COMPTA";
}

/** A un espace salarié : TOUT compte relié à une fiche employé, quel que soit son rôle.
 *  La Direction (ADMIN/MANAGER) qui est aussi salariée y consulte SES bulletins et congés, et peut
 *  prévisualiser l'espace avant de l'ouvrir aux équipes. Sans risque : chaque page/route de
 *  l'espace est déjà limitée aux données de `user.employeeId`.
 *  Ne dépend PAS de l'accès stock. Toujours conditionné à l'activation de la fonctionnalité. */
export function estSalarie(user: { role: Role; employeeId?: string | null }): boolean {
  return !!user.employeeId;
}

/** Espaces auxquels un compte a accès. `espaceSalarieActif` = interrupteur global (Config). */
export function espacesDe(user: CurrentUser, espaceSalarieActif: boolean): Espace[] {
  const espaces: Espace[] = [];
  if (espaceSalarieActif && estSalarie(user)) espaces.push("salarie");
  if (estRH(user.role)) espaces.push("rh");
  if (estStock(user)) espaces.push("stock");
  if (estExploitation(user)) espaces.push("exploitation");
  return espaces;
}

/** URL d'accueil d'un espace. */
export function accueilEspace(espace: Espace): string {
  return espace === "rh" ? "/accueil" : espace === "stock" ? "/stock" : espace === "exploitation" ? "/exploitation" : "/espace";
}

/** Liens DIRECTS vers les AUTRES espaces du compte (changement en un clic, sans repasser par le
 *  sélecteur /choix-espace). Vide si le compte n'a qu'un seul espace. */
export function ciblesAutresEspaces(
  user: CurrentUser,
  espaceSalarieActif: boolean,
  courant: Espace
): { href: string; icone: string; label: string }[] {
  const infos: Record<Espace, { href: string; icone: string; label: string }> = {
    salarie: { href: "/espace", icone: "employes", label: "Mon espace salarié" },
    rh: { href: "/accueil", icone: "mallette", label: "Ressources humaines" },
    stock: { href: "/stock", icone: "colis", label: "Stock & Achats" },
    exploitation: { href: "/exploitation", icone: "balance", label: "Exploitation" },
  };
  return espacesDe(user, espaceSalarieActif)
    .filter((e) => e !== courant)
    .map((e) => infos[e]);
}

/** À utiliser dans les Server Actions / Server Components pour exiger l'accès à un espace. */
export function requireModule(user: CurrentUser, espace: Espace) {
  const ok = espace === "rh" ? estRH(user.role)
    : espace === "stock" ? estStock(user)
    : espace === "exploitation" ? estExploitation(user)
    : estSalarie(user);
  if (!ok) throw new Error("Accès refusé : module non autorisé.");
}

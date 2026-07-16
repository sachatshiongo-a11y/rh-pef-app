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
  accesStock: boolean; // salarié (EMPLOYE) ayant AUSSI accès à l'espace Stock (cumul de rôles)
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
// Espaces indépendants. Le rôle porte la dimension d'accès : ADMIN (Direction) voit tout ;
// MANAGER/VIEWER = RH ; STOCK = Stock ; EMPLOYE = espace salarié (self-service).
// Un salarié peut CUMULER l'accès Stock (User.accesStock) → il choisit son espace à la connexion.
export type Espace = "rh" | "stock" | "salarie";

export function estRH(role: Role): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "VIEWER";
}

/** Accès à l'espace Stock : rôles Stock/Direction, OU un salarié à qui l'accès stock a été accordé. */
export function estStock(user: { role: Role; accesStock?: boolean }): boolean {
  return user.role === "ADMIN" || user.role === "STOCK" || (user.role === "EMPLOYE" && !!user.accesStock);
}

/** Espaces auxquels un compte a accès (ADMIN = RH + Stock ; salarié = salarié [+ Stock si accordé]). */
export function espacesDe(user: CurrentUser): Espace[] {
  if (user.role === "EMPLOYE") {
    return estStock(user) ? ["salarie", "stock"] : ["salarie"];
  }
  const espaces: Espace[] = [];
  if (estRH(user.role)) espaces.push("rh");
  if (estStock(user)) espaces.push("stock");
  return espaces;
}

/** URL d'accueil d'un espace. */
export function accueilEspace(espace: Espace): string {
  return espace === "rh" ? "/accueil" : espace === "stock" ? "/stock" : "/espace";
}

/** À utiliser dans les Server Actions / Server Components pour exiger l'accès à un espace. */
export function requireModule(user: CurrentUser, espace: Espace) {
  const ok = espace === "rh" ? estRH(user.role) : espace === "stock" ? estStock(user) : user.role === "EMPLOYE";
  if (!ok) throw new Error("Accès refusé : module non autorisé.");
}

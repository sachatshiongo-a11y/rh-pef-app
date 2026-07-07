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

// ── Accès par espace (cloisonnement RH / Stock) ───────────────────────────────
// Deux espaces indépendants. Le rôle porte la dimension d'accès : ADMIN (Direction)
// voit tout ; MANAGER/VIEWER = RH uniquement ; STOCK = Stock uniquement.
// La Direction obtient les deux accès automatiquement (règle explicite ci-dessous).
export type Espace = "rh" | "stock";

export function estRH(role: Role): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "VIEWER";
}

export function estStock(role: Role): boolean {
  return role === "ADMIN" || role === "STOCK";
}

/** Espaces auxquels le rôle a accès (ADMIN = les deux). */
export function espacesAutorises(role: Role): Espace[] {
  const espaces: Espace[] = [];
  if (estRH(role)) espaces.push("rh");
  if (estStock(role)) espaces.push("stock");
  return espaces;
}

/** URL d'accueil d'un espace. */
export function accueilEspace(espace: Espace): string {
  return espace === "rh" ? "/accueil" : "/stock";
}

/** À utiliser dans les Server Actions / Server Components pour exiger l'accès à un espace. */
export function requireModule(user: CurrentUser, espace: Espace) {
  const ok = espace === "rh" ? estRH(user.role) : estStock(user.role);
  if (!ok) throw new Error("Accès refusé : module non autorisé.");
}

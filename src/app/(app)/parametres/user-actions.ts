"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, invaliderProfil } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import type { Role } from "@prisma/client";

const ROLES: Role[] = ["ADMIN", "MANAGER", "VIEWER", "STOCK"];

/** Crée un utilisateur : compte Supabase Auth (email + mot de passe) + profil applicatif (rôle). */
export async function creerUtilisateur(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const nom = String(formData.get("nom") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "VIEWER") as Role;

  if (!email || !nom) throw new Error("Email et nom sont requis.");
  if (password.length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères.");
  if (!ROLES.includes(role)) throw new Error("Rôle invalide.");

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // 1) Création du compte d'authentification Supabase (email confirmé d'office).
  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = await res.json();
  if (!res.ok || !json?.id) {
    throw new Error(json?.msg || json?.error_description || "Échec de la création du compte.");
  }

  // 2) Profil applicatif (id = uid Supabase, exploité par verifySession).
  await prisma.user.create({ data: { id: json.id, email, nom, role, actif: true } });

  await journaliser(prisma, {
    entite: "User",
    entiteId: json.id,
    champ: "creation",
    nouvelleValeur: `${email} — ${role}`,
    userId: user.id,
  });
  revalidatePath("/parametres");
}

/** Change le rôle d'un utilisateur. */
export async function definirRoleUtilisateur(userId: string, formData: FormData) {
  const admin = await verifySession();
  requireRole(admin, ["ADMIN"]);
  const role = String(formData.get("role") ?? "") as Role;
  if (!ROLES.includes(role)) throw new Error("Rôle invalide.");

  await prisma.user.update({ where: { id: userId }, data: { role } });
  invaliderProfil(userId);
  await journaliser(prisma, { entite: "User", entiteId: userId, champ: "role", nouvelleValeur: role, userId: admin.id });
  revalidatePath("/parametres");
}

/** Active / désactive un utilisateur (un compte désactivé ne peut plus se connecter). */
export async function basculerActifUtilisateur(userId: string) {
  const admin = await verifySession();
  requireRole(admin, ["ADMIN"]);
  if (userId === admin.id) throw new Error("Vous ne pouvez pas désactiver votre propre compte.");

  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({ where: { id: userId }, data: { actif: !u.actif } });
  invaliderProfil(userId);
  await journaliser(prisma, { entite: "User", entiteId: userId, champ: "actif", nouvelleValeur: String(!u.actif), userId: admin.id });
  revalidatePath("/parametres");
}

/** Lie (ou délie) un compte utilisateur à une fiche employé — la même personne. */
export async function lierUtilisateurEmploye(userId: string, formData: FormData) {
  const admin = await verifySession();
  requireRole(admin, ["ADMIN"]);
  const employeeId = String(formData.get("employeeId") ?? "").trim() || null;

  // Un employé ne peut être lié qu'à un seul compte : on détache d'abord tout autre compte.
  if (employeeId) {
    await prisma.user.updateMany({ where: { employeeId, NOT: { id: userId } }, data: { employeeId: null } });
  }
  await prisma.user.update({ where: { id: userId }, data: { employeeId } });
  await journaliser(prisma, {
    entite: "User",
    entiteId: userId,
    champ: "employeeId",
    nouvelleValeur: employeeId ?? "(délié)",
    userId: admin.id,
  });
  revalidatePath("/parametres");
}

/** Réinitialise le mot de passe d'un utilisateur (Supabase Auth). */
export async function reinitialiserMotDePasse(userId: string, formData: FormData) {
  const admin = await verifySession();
  requireRole(admin, ["ADMIN"]);
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères.");

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("Échec de la réinitialisation du mot de passe.");
  await journaliser(prisma, { entite: "User", entiteId: userId, champ: "motDePasse", nouvelleValeur: "réinitialisé", userId: admin.id });
  revalidatePath("/parametres");
}

import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Espace salarié (self-service) — désactivé par défaut. Chaque déploiement l'active via le toggle
 * `Config.espaceEmployeActif` (Paramètres). Rien ne change tant qu'il est éteint : pas de compte
 * salarié, pas de connexion salarié, routes /espace fermées, boutons masqués.
 */
export async function espaceEmployeActif(): Promise<boolean> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { espaceEmployeActif: true } });
  return config?.espaceEmployeActif ?? false;
}

/**
 * E-mail interne DÉTERMINISTE dérivé du matricule : sert d'identifiant Supabase Auth pour un
 * compte salarié (les salariés se connectent avec leur MATRICULE, pas une adresse e-mail réelle).
 * Le domaine `.salarie.local` n'est jamais utilisé pour envoyer un e-mail — c'est une clé de login.
 * Ex. « CB28-PEF » → « cb28pef@salarie.local ».
 */
export function emailInterneMatricule(matricule: string): string {
  const cle = matricule.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${cle || "salarie"}@salarie.local`;
}

/** true si l'identifiant saisi ressemble à un matricule (pas d'« @ ») plutôt qu'à un e-mail. */
export function estMatricule(identifiant: string): boolean {
  return !identifiant.includes("@");
}

/** Mot de passe temporaire lisible (sans caractères ambigus) pour la 1re connexion d'un salarié. */
export function genererMotDePasseTemporaire(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1 (ambigus)
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`; // ex. « K7MQP-R4TN9 »
}

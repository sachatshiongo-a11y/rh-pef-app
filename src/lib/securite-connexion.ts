import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Sécurité de connexion : anti-force-brute par DÉLAI QUI S'ALLONGE (et non blocage dur) et jetons de
// réinitialisation de mot de passe (hachés en base, usage unique, expiration courte).
//
// Décision de Sacha (2026-10-13) : plus de blocage après 5 échecs. Chaque échec de plus allonge l'attente avant
// l'essai suivant : 1er échec aucune, 2e 2 s, puis 4, 8, 16… plafonné à 15 min. PAR IDENTIFIANT seulement :
// aucun blocage par adresse IP (tout le personnel sort par la même IP via le VPN — l'IP reste journalisée).
// Un succès, ou un mot de passe réinitialisé, remet l'ardoise à zéro ; « Mot de passe oublié » reste toujours possible.
// Les essais faits PENDANT l'attente sont refusés sans être comptés (attendre ne fait pas monter le délai).

export const PREMIER_DELAI_S = 2; // attente après le 2e échec
export const ATTENTE_MAX_S = 15 * 60; // plafond : 15 minutes
export const FENETRE_MIN = 60; // les échecs plus anciens sont oubliés (le délai redescend)
export const JETON_VALIDITE_MIN = 60;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (email: string) => email.trim().toLowerCase();

/** Attente (secondes) imposée après le n-ième échec consécutif : 0, 2, 4, 8, 16… plafonnée à 15 min. */
export function delaiApresEchecs(n: number): number {
  if (n < 2) return 0;
  return Math.min(ATTENTE_MAX_S, PREMIER_DELAI_S * 2 ** Math.min(n - 2, 20));
}

/** « 8 secondes », « 1 minute », « 15 minutes » : ce que la personne doit attendre, jamais arrondi vers le bas. */
export function formaterAttente(secondes: number): string {
  if (secondes < 60) return `${secondes} seconde${secondes > 1 ? "s" : ""}`;
  const m = Math.ceil(secondes / 60);
  return `${m} minute${m > 1 ? "s" : ""}`;
}

/** Secondes restantes à attendre avant un nouvel essai pour cet identifiant (0 = on peut essayer). */
export async function secondesAttente(email: string, maintenant: Date = new Date()): Promise<number> {
  const depuis = new Date(maintenant.getTime() - FENETRE_MIN * 60_000);
  const where = { email: norm(email), createdAt: { gte: depuis } };
  const [n, dernier] = await Promise.all([
    prisma.tentativeConnexion.count({ where }),
    prisma.tentativeConnexion.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!dernier) return 0;
  const reste = dernier.createdAt.getTime() + delaiApresEchecs(n) * 1000 - maintenant.getTime();
  return Math.max(0, Math.ceil(reste / 1000));
}

/** Enregistre un échec de connexion. */
export async function enregistrerEchec(email: string, ip: string | null): Promise<void> {
  await prisma.tentativeConnexion.create({ data: { email: norm(email), ip } });
}

/** Connexion réussie (ou mot de passe réinitialisé) : efface l'ardoise. */
export async function effacerEchecs(email: string): Promise<void> {
  await prisma.tentativeConnexion.deleteMany({ where: { email: norm(email) } });
}

/** Génère un jeton de réinitialisation (invalide les précédents de l'email) et renvoie le jeton EN CLAIR (à envoyer par e-mail). */
export async function genererJetonReinitialisation(email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.jetonReinitialisation.updateMany({
    where: { email: norm(email), usedAt: null },
    data: { usedAt: new Date() }, // les anciens jetons non utilisés sont invalidés
  });
  await prisma.jetonReinitialisation.create({
    data: { email: norm(email), tokenHash: sha256(token), expiresAt: new Date(Date.now() + JETON_VALIDITE_MIN * 60_000) },
  });
  return token;
}

/** Vérifie un jeton : renvoie l'email s'il est valide (non utilisé, non expiré), sinon null. */
export async function verifierJeton(token: string): Promise<string | null> {
  if (!token || token.length < 32) return null;
  const j = await prisma.jetonReinitialisation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!j || j.usedAt || j.expiresAt < new Date()) return null;
  return j.email;
}

/** Consomme un jeton (usage unique). */
export async function consommerJeton(token: string): Promise<void> {
  await prisma.jetonReinitialisation.updateMany({ where: { tokenHash: sha256(token) }, data: { usedAt: new Date() } });
}

/** Change le mot de passe d'un compte via l'API admin Supabase (service role). `userId` = auth.users.id = User.id. */
export async function changerMotDePasseAdmin(userId: string, nouveauMotDePasse: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: nouveauMotDePasse }),
  });
  if (!res.ok) throw new Error(`Échec de la mise à jour du mot de passe (${res.status}).`);
}

/**
 * Crée un utilisateur Supabase Auth (service role) et renvoie son id (= futur User.id).
 * `emailConfirme` marque l'e-mail comme vérifié (comptes salariés à identifiant interne : pas
 * d'e-mail de confirmation à envoyer). Le mot de passe est fourni par l'appelant.
 */
export async function creerUtilisateurAuth(email: string, motDePasse: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: motDePasse, email_confirm: true }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 422 || /already/i.test(txt)) throw new Error("Un compte existe déjà pour ce salarié.");
    throw new Error(`Échec de la création du compte (${res.status}).`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Réponse inattendue du service d'authentification.");
  return data.id;
}

/** Supprime un utilisateur Supabase Auth (service role) — nettoyage après échec ou désactivation. */
export async function supprimerUtilisateurAuth(userId: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  await fetch(`${base}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => {});
}

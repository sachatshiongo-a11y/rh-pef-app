import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Sécurité de connexion : anti-force-brute (blocage temporaire après N échecs) et jetons de
// réinitialisation de mot de passe (hachés en base, usage unique, expiration courte).

export const MAX_ECHECS = 5;
export const FENETRE_MIN = 15; // fenêtre d'observation ET durée de blocage (minutes)
export const JETON_VALIDITE_MIN = 60;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (email: string) => email.trim().toLowerCase();

/** Nombre de minutes restantes de blocage pour cet email (0 = pas bloqué). */
export async function minutesBlocage(email: string): Promise<number> {
  const depuis = new Date(Date.now() - FENETRE_MIN * 60_000);
  const echecs = await prisma.tentativeConnexion.findMany({
    where: { email: norm(email), createdAt: { gte: depuis } },
    orderBy: { createdAt: "desc" },
    take: MAX_ECHECS,
  });
  if (echecs.length < MAX_ECHECS) return 0;
  const plusRecent = echecs[0].createdAt.getTime();
  return Math.max(1, Math.ceil((plusRecent + FENETRE_MIN * 60_000 - Date.now()) / 60_000));
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

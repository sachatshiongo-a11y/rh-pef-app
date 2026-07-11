"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { envoyerEmail } from "@/lib/email";
import {
  minutesBlocage, enregistrerEchec, effacerEchecs,
  genererJetonReinitialisation, verifierJeton, consommerJeton, changerMotDePasseAdmin,
} from "@/lib/securite-connexion";

export type LoginState = { error?: string } | undefined;

async function ipClient(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email et mot de passe requis." };
  }

  // Anti-force-brute : après 5 échecs en 15 min, blocage temporaire de l'email.
  const attente = await minutesBlocage(email);
  if (attente > 0) {
    return { error: `Trop de tentatives. Réessayez dans ${attente} min, ou utilisez « Mot de passe oublié ».` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await enregistrerEchec(email, await ipClient());
    return { error: "Identifiants incorrects." };
  }

  await effacerEchecs(email);
  redirect("/entree");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type ResetState = { ok?: string; error?: string } | undefined;

/** « Mot de passe oublié » : envoie un lien de réinitialisation SI un compte actif existe.
 * Réponse volontairement identique dans tous les cas (ne révèle pas l'existence d'un compte). */
export async function demanderReinitialisation(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Indiquez votre adresse e-mail." };

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.actif) {
    const token = await genererJetonReinitialisation(email);
    const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gestion.patesenfolie.cd";
    await envoyerEmail(
      [email],
      "Pâtes en Folie — réinitialisation de votre mot de passe",
      [
        `Bonjour ${user.nom},`,
        "",
        "Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :",
        `${base}/reinitialiser?token=${token}`,
        "",
        "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
      ].join("\n"),
    );
  }
  return { ok: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé." };
}

/** Applique le nouveau mot de passe si le jeton est valide (usage unique, expire en 1 h). */
export async function reinitialiserMotDePasse(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (password.length < 8) return { error: "Le mot de passe doit faire au moins 8 caractères." };
  if (password !== confirmation) return { error: "Les deux mots de passe ne correspondent pas." };

  const email = await verifierJeton(token);
  if (!email) return { error: "Lien invalide ou expiré. Refaites une demande depuis « Mot de passe oublié »." };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.actif) return { error: "Compte introuvable ou désactivé." };

  await changerMotDePasseAdmin(user.id, password);
  await consommerJeton(token);
  await effacerEchecs(email);
  redirect("/login?reinitialise=1");
}

import "server-only";

import nodemailer from "nodemailer";

/**
 * Envoi d'e-mail via SMTP (Google Workspace : smtp.gmail.com). Configuré par variables
 * d'environnement — si elles sont absentes, l'envoi est simplement ignoré (no-op), la cloche
 * in-app continuant de fonctionner. À renseigner sur le serveur, jamais dans l'app de bureau :
 *   SMTP_HOST (défaut smtp.gmail.com), SMTP_PORT (défaut 465), SMTP_USER, SMTP_PASS (mot de passe
 *   d'application Google), SMTP_FROM (adresse d'expéditeur, défaut = SMTP_USER).
 */
let transporteur: nodemailer.Transporter | null = null;

function getTransporteur(): nodemailer.Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  if (!transporteur) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporteur = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }
  return transporteur;
}

/** Envoie un e-mail. Ne lève jamais : les erreurs sont journalisées, l'app continue. */
export async function envoyerEmail(destinataires: string[], sujet: string, texte: string): Promise<void> {
  const t = getTransporteur();
  const to = destinataires.filter(Boolean);
  if (!t || to.length === 0) return;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to,
      subject: sujet,
      text: texte,
    });
  } catch (e) {
    console.error("[email] échec d'envoi :", e instanceof Error ? e.message : e);
  }
}

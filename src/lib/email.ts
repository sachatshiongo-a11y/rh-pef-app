import "server-only";

import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { ErreurMetier } from "@/lib/erreur-metier";

/**
 * Envoi d'e-mail. Deux transports, choisis par les variables d'environnement (à renseigner sur le serveur, jamais
 * dans l'app de bureau) :
 *
 *  1. API GMAIL (HTTPS, port 443) — prioritaire quand les trois variables sont présentes :
 *       GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN  (compte Google Workspace expéditeur, portée gmail.send)
 *       GMAIL_FROM (facultative) : adresse d'expéditeur ; à défaut SMTP_FROM, puis SMTP_USER.
 *     Pourquoi : l'offre gratuite de Render bloque le SMTP sortant (ports 465/587) ; aucun courriel ne partait depuis
 *     le 13/10/2026. L'API Gmail passe par HTTPS et n'est pas bloquée. Sans nouvelle dépendance : `fetch` natif.
 *  2. SMTP (nodemailer) — si l'API Gmail n'est pas configurée mais que le SMTP l'est :
 *       SMTP_HOST (défaut smtp.gmail.com), SMTP_PORT (défaut 465), SMTP_USER, SMTP_PASS (mot de passe d'application
 *       Google), SMTP_FROM (adresse d'expéditeur, défaut = SMTP_USER).
 *  3. Sinon : l'envoi est ignoré (no-op), la cloche in-app continuant de fonctionner.
 *
 * Aucun jeton, secret ni adresse de destinataire n'est jamais écrit dans les journaux.
 */

export type TransportCourriel = "gmail" | "smtp" | "aucun";

/** Quel transport les variables d'environnement désignent-elles ? (Gmail > SMTP > rien.) */
export function transportCourriel(env: NodeJS.ProcessEnv = process.env): TransportCourriel {
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) return "gmail";
  if (env.SMTP_USER && env.SMTP_PASS) return "smtp";
  return "aucun";
}

/** L'adresse seule de l'expéditeur (la variable peut déjà être au format « Nom <adresse> »). */
function adresseExpediteur(env: NodeJS.ProcessEnv = process.env): string {
  const brut = (env.GMAIL_FROM ?? env.SMTP_FROM ?? env.SMTP_USER ?? "").trim();
  return brut.match(/<([^>]+)>/)?.[1]?.trim() ?? brut;
}

const NOM_EXPEDITEUR = "Gestion Pâtes en Folie";
const DELAI_MS = 15_000;

// ── Construction du message RFC 822 ───────────────────────────────────────────────────────────────

/** Une adresse simple (« a@b.cd ») : refuse espaces, chevrons, virgules, guillemets — donc tout saut de ligne injecté. */
const ADRESSE = /^[^\s<>(),;:"\\]+@[^\s<>(),;:"\\]+$/;

/**
 * Encode un texte d'en-tête en « mots encodés » RFC 2047 (UTF-8, base64) : accents, émojis (📊) passent. Chaque mot
 * fait 75 caractères au plus et ne coupe jamais un caractère en deux ; les mots sont repliés par `CRLF + espace`.
 * Un texte ASCII court est laissé tel quel. Les sauts de ligne sont retirés d'abord (pas d'injection d'en-tête).
 */
export function encoderEnTete(texte: string): string {
  const propre = texte.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(propre) && propre.length <= 60) return propre;
  const mots: string[] = [];
  let courant = "";
  for (const car of Array.from(propre)) {
    // 45 octets → 60 caractères base64 ; « =?UTF-8?B? » + « ?= » = 12 → 72 ≤ 75.
    if (Buffer.byteLength(courant + car, "utf8") > 45) {
      mots.push(courant);
      courant = "";
    }
    courant += car;
  }
  if (courant) mots.push(courant);
  return mots.map((m) => `=?UTF-8?B?${Buffer.from(m, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** Le corps en base64, lignes de 76 caractères, fins de ligne CRLF (forme canonique d'un text/plain). */
export function corpsBase64(texte: string): string {
  const canonique = texte.replace(/\r\n|\r|\n/g, "\r\n");
  const b64 = Buffer.from(canonique, "utf8").toString("base64");
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

export type MessageCourriel = {
  expediteur: string;
  destinataires: string[];
  sujet: string;
  texte: string;
  date?: Date;
  idMessage?: string;
};

/** Le message complet (en-têtes + corps), fins de ligne CRLF. */
export function construireMessage(m: MessageCourriel): string {
  const domaine = m.expediteur.split("@")[1] || "patesenfolie.cd";
  const enTetes = [
    `From: ${encoderEnTete(NOM_EXPEDITEUR)} <${m.expediteur}>`,
    `To: ${m.destinataires.join(", ")}`,
    `Subject: ${encoderEnTete(m.sujet)}`,
    `Date: ${(m.date ?? new Date()).toUTCString()}`,
    `Message-ID: <${m.idMessage ?? randomUUID()}@${domaine}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${enTetes.join("\r\n")}\r\n\r\n${corpsBase64(m.texte)}\r\n`;
}

/** Le champ `raw` de l'API Gmail : le message en base64url (sans remplissage). */
export function messageBase64Url(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}

// ── API Gmail ─────────────────────────────────────────────────────────────────────────────────────

const URL_JETON = "https://oauth2.googleapis.com/token";
const URL_ENVOI = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const MARGE_JETON_MS = 60_000;

let jetonEnCache: { valeur: string; expireA: number } | null = null;
let jetonEnCours: Promise<string> | null = null;

/** Pour les tests : oublie le jeton d'accès mis en cache. */
export function oublierJetonGmail(): void {
  jetonEnCache = null;
  jetonEnCours = null;
}

/**
 * Rend un texte venu de l'extérieur (corps d'erreur de Google, message de nodemailer) SANS DANGER pour le journal :
 * Google ou un serveur SMTP peut y refléter une adresse de destinataire (« Invalid To header: a@b.cd », « 550 <a@b.cd>… »)
 * ou un jeton d'accès (« ya29.… »). Les adresses et toute suite opaque de 24 caractères ou plus sont masquées.
 */
export function assainirPourJournal(texte: string): string {
  return texte
    .replace(/[^\s<>(),;:"'\\]+@[^\s<>(),;:"'\\]+/g, "<adresse>")
    .replace(/[A-Za-z0-9._~+/=-]{24,}/g, "<masqué>")
    .replace(/\s+/g, " ")
    .trim();
}

/** Une erreur de l'API, déjà formulée pour la Direction (jamais de secret dedans). */
class ErreurGmail extends ErreurMetier {
  constructor(message: string, readonly statut?: number) {
    super(message);
  }
}

async function appeler(url: string, init: RequestInit): Promise<Response> {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
  try {
    return await fetch(url, { ...init, signal: controle.signal });
  } catch (e) {
    if (controle.signal.aborted) throw new ErreurGmail(`délai dépassé (${DELAI_MS / 1000} s) : ${new URL(url).host} n'a pas répondu`);
    throw new ErreurGmail(`réseau : ${e instanceof Error ? assainirPourJournal(e.message) : "appel impossible"}`);
  } finally {
    clearTimeout(minuteur);
  }
}

async function corpsJson(r: Response): Promise<Record<string, unknown>> {
  try {
    const j: unknown = await r.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function demanderJeton(env: NodeJS.ProcessEnv): Promise<string> {
  const r = await appeler(URL_JETON, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID ?? "",
      client_secret: env.GMAIL_CLIENT_SECRET ?? "",
      refresh_token: env.GMAIL_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }).toString(),
  });
  const j = await corpsJson(r);
  if (!r.ok) {
    const code = typeof j.error === "string" && /^[a-z_]{1,40}$/.test(j.error) ? j.error : `HTTP ${r.status}`;
    const aide =
      code === "invalid_grant"
        ? "le jeton d'actualisation GMAIL_REFRESH_TOKEN est révoqué ou expiré (mot de passe du compte changé, accès retiré, ou écran de consentement en mode test) : en générer un nouveau"
        : code === "invalid_client" || code === "unauthorized_client"
          ? "GMAIL_CLIENT_ID ou GMAIL_CLIENT_SECRET est incorrect, ou ne correspond pas au jeton d'actualisation"
          : "demande de jeton refusée par Google";
    throw new ErreurGmail(`jeton d'accès refusé (${code}) : ${aide}`, r.status);
  }
  if (typeof j.access_token !== "string" || !j.access_token) throw new ErreurGmail("jeton d'accès absent de la réponse de Google", r.status);
  const duree = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 3600;
  jetonEnCache = { valeur: j.access_token, expireA: Date.now() + duree * 1000 - MARGE_JETON_MS };
  return j.access_token;
}

async function jetonAcces(env: NodeJS.ProcessEnv): Promise<string> {
  if (jetonEnCache && Date.now() < jetonEnCache.expireA) return jetonEnCache.valeur;
  // Deux envois simultanés ne demandent qu'un seul jeton.
  jetonEnCours ??= demanderJeton(env).finally(() => {
    jetonEnCours = null;
  });
  return jetonEnCours;
}

async function envoyerParGmail(raw: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (let essai = 0; ; essai++) {
    const jeton = await jetonAcces(env);
    const r = await appeler(URL_ENVOI, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    if (r.ok) return;
    // Jeton d'accès périmé avant son heure : on l'oublie et on réessaie UNE fois avec un jeton neuf.
    if (r.status === 401 && essai === 0) {
      jetonEnCache = null;
      continue;
    }
    const j = await corpsJson(r);
    const err = (j.error && typeof j.error === "object" ? j.error : {}) as { message?: unknown; status?: unknown; errors?: { reason?: unknown }[] };
    const raison = typeof err.errors?.[0]?.reason === "string" ? err.errors[0].reason : typeof err.status === "string" ? err.status : "";
    const detail = typeof err.message === "string" ? assainirPourJournal(err.message).slice(0, 200) : "";
    const aide =
      r.status === 403
        ? "API Gmail non activée dans le projet Google Cloud, ou portée gmail.send non accordée au jeton d'actualisation (le regénérer avec la portée https://www.googleapis.com/auth/gmail.send)"
        : r.status === 401
          ? "jeton d'accès refusé par Gmail"
          : r.status === 429
            ? "quota d'envoi Gmail dépassé, réessayer plus tard"
            : r.status === 400
              ? "message ou adresse refusé par Gmail"
              : "envoi refusé par Gmail";
    throw new ErreurGmail(`envoi refusé (HTTP ${r.status}${raison ? ` ${raison}` : ""}) : ${aide}${detail ? ` — « ${detail} »` : ""}`, r.status);
  }
}

// ── SMTP (repli) ──────────────────────────────────────────────────────────────────────────────────

let transporteur: nodemailer.Transporter | null = null;

function getTransporteurSmtp(): nodemailer.Transporter {
  if (!transporteur) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporteur = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Délais courts (2026-10-14) : par défaut nodemailer attend 2 min une connexion SMTP qui ne vient pas.
      // Un port SMTP bloqué faisait dépasser les 120 s du déclencheur GitHub (curl, code 28) sans que
      // l'échec soit dit nulle part. Désormais l'envoi échoue en ~15 s et le journal le dit.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporteur;
}

/**
 * Envoie un e-mail. Ne lève jamais : les erreurs sont journalisées, l'app continue.
 * Renvoie `false` seulement si un envoi a été TENTÉ et a échoué (aucun transport configuré ou aucun destinataire :
 * `true`, rien à signaler) — les déclencheurs planifiés s'en servent pour se mettre en échec.
 */
export async function envoyerEmail(destinataires: string[], sujet: string, texte: string): Promise<boolean> {
  const demandes = destinataires.filter(Boolean);
  const transport = transportCourriel();
  if (transport === "aucun" || demandes.length === 0) return true;
  const adresse = adresseExpediteur();

  try {
    if (transport === "gmail") {
      const to = demandes.map((d) => d.trim()).filter((d) => ADRESSE.test(d));
      if (to.length === 0) throw new ErreurGmail("aucune adresse de destinataire valide");
      if (!ADRESSE.test(adresse)) throw new ErreurGmail("adresse d'expéditeur absente ou invalide : renseigner GMAIL_FROM (ou SMTP_FROM)");
      const raw = messageBase64Url(construireMessage({ expediteur: adresse, destinataires: to, sujet, texte }));
      await envoyerParGmail(raw, process.env);
      console.info(`[email] envoyé via l'API Gmail (${to.length} destinataire(s))`);
    } else {
      await getTransporteurSmtp().sendMail({
        from: { name: NOM_EXPEDITEUR, address: adresse },
        to: demandes,
        subject: sujet,
        text: texte,
      });
    }
    return true;
  } catch (e) {
    // Assaini une dernière fois : un refus SMTP cite souvent l'adresse du destinataire.
    // (Les ErreurGmail sont déjà formulées par nous, avec le détail de Google assaini à la source.)
    const cause = e instanceof ErreurGmail ? e.message : assainirPourJournal(e instanceof Error ? e.message : "erreur inconnue");
    console.error(`[email] échec d'envoi (transport : ${transport === "gmail" ? "API Gmail" : "SMTP"}) : ${cause}`);
    return false;
  }
}

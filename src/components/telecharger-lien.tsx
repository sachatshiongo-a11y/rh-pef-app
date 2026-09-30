"use client";

import { useState } from "react";

/**
 * Ce que dit la réponse d'une route de document. Fonction PURE, séparée du composant parce que ce
 * dépôt n'a pas de DOM en test : c'est la seule partie de ce chemin qu'un test peut tenir.
 *
 * `redirected` SE LIT AVANT `ok`, et l'ordre est tout : `fetch` SUIT les redirections, et le garde
 * d'authentification peut REDIRIGER vers /login au lieu de refuser. Session expirée = 200 + la page
 * de connexion en HTML ; `ok` est vrai, et sans ce contrôle on enregistre cet écran sous le nom
 * « Bulletin Août 2026.pdf », que le salarié transmet ensuite à sa banque ou à son bailleur.
 *
 * Mais TOUTE redirection n'est pas une session expirée : `/fichiers/…` répond légitimement par un
 * 302 vers l'URL signée du stockage (une AUTRE origine). Une redirection qui atterrit hors de notre
 * origine est donc un fichier, pas la page de connexion — la page de connexion, elle, est toujours
 * chez nous. Sans `url` ni `origine` on ne peut pas trancher : on reste prudent (session expirée).
 *
 * Ordre des verdicts : redirection vers chez nous, puis 401 (session expirée : répondu par le
 * garde pour une requête de données, cf. src/lib/supabase/middleware.ts), puis 403 (refus), puis
 * toute autre erreur, puis le CONTENU : une page HTML n'est jamais un document (bulletin, tableur,
 * archive), même servie en 200.
 */
export type VerdictReponseDocument = "ok" | "session-expiree" | "refuse" | "erreur" | "pas-un-document";

export function verdictReponseDocument(res: {
  redirected: boolean;
  ok: boolean;
  status?: number;
  /** Adresse FINALE de la réponse (`Response.url`), après redirections. */
  url?: string;
  /** Origine de l'application (`location.origin`). */
  origine?: string;
  /** `Content-Type` de la réponse. */
  contentType?: string | null;
}): VerdictReponseDocument {
  if (res.redirected && !atterritHorsDeChezNous(res.url, res.origine)) return "session-expiree";
  if (res.status === 401) return "session-expiree";
  if (res.status === 403) return "refuse";
  if (!res.ok) return "erreur";
  if ((res.contentType ?? "").toLowerCase().split(";")[0].trim() === "text/html") return "pas-un-document";
  return "ok";
}

function atterritHorsDeChezNous(url: string | undefined, origine: string | undefined): boolean {
  if (!url || !origine) return false;
  try {
    return new URL(url).origin !== origine;
  } catch {
    return false;
  }
}

/**
 * Le message que la personne lit quand le fichier n'arrive pas. `texteServeur` est le corps d'une
 * réponse texte de la route (« Le bon de commande doit être validé avant d'être exporté. », « Aucune
 * paie calculée pour ce mois »…) : c'est la phrase la plus précise dont on dispose, on la donne telle
 * quelle. Fonction PURE.
 */
export function messageEchecDocument(verdict: VerdictReponseDocument, texteServeur?: string | null): string {
  const precis = (texteServeur ?? "").trim();
  switch (verdict) {
    case "session-expiree":
      return "Votre session a expiré. Reconnectez-vous, puis rouvrez ce document.";
    case "refuse":
      return precis && precis.length <= 300 ? precis : "Vous n'avez pas accès à ce document.";
    case "pas-un-document":
      return "Le serveur n'a pas renvoyé de document (votre session a peut-être expiré). Reconnectez-vous puis réessayez.";
    case "erreur":
    default:
      return precis && precis.length <= 300
        ? precis
        : "Le document n'a pas pu être récupéré. Vérifiez votre connexion, puis réessayez.";
  }
}

function nomDepuisEntetes(headers: Headers, defaut: string): string {
  const cd = headers.get("Content-Disposition") ?? "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!m) return defaut;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Ce que veut dire la fin de `navigator.share`. Fonction PURE (ce dépôt n'a pas de DOM en test).
 * Une ANNULATION (AbortError) n'est PAS un enregistrement : le fichier n'est allé nulle part. La
 * confondre avec un succès ferait croire à l'écran des comptes en lot que les fiches — seul
 * exemplaire des mots de passe — sont enregistrées. Toute autre erreur : on tente le repli.
 */
export type IssuePartage = "partage" | "annule" | "repli";

export function issuePartage(r: { ok: true } | { erreur: unknown }): IssuePartage {
  if ("ok" in r) return "partage";
  return (r.erreur as Error | null)?.name === "AbortError" ? "annule" : "repli";
}

type NavigateurPartage = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

/**
 * Vrai si `enregistrerFichier` ouvrira la feuille de partage native (et donc WhatsApp, Messages…)
 * pour ce fichier ; faux si elle le TÉLÉCHARGERA. Réservé au tactile : sur ordinateur (y compris
 * PWA installée), `canShare` peut renvoyer true mais le partage se termine sans rien télécharger
 * → « rien ne se passe ». À n'appeler que côté client (après le montage).
 */
export function partageDeFichierPossible(file: File): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const tactile = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const nav = navigator as NavigateurPartage;
  return tactile && !!nav.canShare && !!nav.share && nav.canShare({ files: [file] });
}

/**
 * Le GESTE D'ENREGISTREMENT d'un fichier déjà en mémoire, partagé par `TelechargerLien` (fichier
 * récupéré par `fetch`) et par les écrans qui reçoivent un document dans la réponse d'une action
 * serveur (ex. fiches de connexion, Paramètres → Espace salarié) :
 *   1) sur mobile TACTILE : `navigator.share({ files })` = feuille native « Enregistrer dans
 *      Fichiers / Partager » en superposition (ne quitte pas l'app installée) ;
 *   2) sinon (ou si le partage échoue autrement que par une annulation) : téléchargement classique
 *      via un lien blob invisible.
 * À appeler depuis un geste de l'utilisateur (un clic) : iOS refuse le partage hors geste.
 *
 * Renvoie le chemin RÉELLEMENT pris : « partage » (la feuille s'est conclue), « telechargement »
 * (lien de téléchargement déclenché, y compris en repli après un partage en échec), « annule »
 * (feuille fermée par l'utilisateur : rien n'est enregistré). Ni l'un ni l'autre ne prouve que le
 * fichier est arrivé (le navigateur ne le dit pas) : seulement qu'il est parti.
 */
export type IssueEnregistrement = "partage" | "telechargement" | "annule";

export async function enregistrerFichier(blob: Blob, nom: string): Promise<IssueEnregistrement> {
  const type = blob.type || "application/octet-stream";
  const file = new File([blob], nom, { type });

  // 1) Mobile TACTILE uniquement : partage natif (n'ouvre pas la webview, pas de piège).
  const nav = navigator as NavigateurPartage;
  if (partageDeFichierPossible(file) && nav.share) {
    let issue: IssuePartage;
    try {
      await nav.share({ files: [file], title: nom });
      issue = issuePartage({ ok: true });
    } catch (err) {
      issue = issuePartage({ erreur: err });
    }
    // Annulé par l'utilisateur → on s'arrête, RIEN n'est enregistré. Autre erreur → repli.
    if (issue === "partage" || issue === "annule") return issue;
  }

  // 2) Ordinateur : téléchargement classique.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "telechargement";
}

/**
 * La lecture d'un texte d'erreur renvoyé par une route (« Le bon de commande doit être validé… »).
 * Bornée : une page HTML d'erreur ne doit jamais finir dans une boîte de dialogue.
 */
async function texteDeLaReponse(res: Response): Promise<string | null> {
  const type = (res.headers.get("Content-Type") ?? "").toLowerCase();
  if (!type.startsWith("text/plain")) return null;
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return null;
  }
}

/**
 * RÉCUPÈRE un document par `fetch` (la session voyage avec) puis l'ENREGISTRE (feuille de partage
 * ou téléchargement) — SANS JAMAIS faire naviguer la fenêtre. C'est le seul chemin de la maison
 * pour un fichier : « un document se RÉCUPÈRE, il ne se VISITE pas ».
 *
 * Toute panne se DIT (boîte de dialogue) et s'arrête là. Il n'y a volontairement AUCUN repli du
 * genre `window.open(href)` : dans l'application installée, ouvrir un PDF « dans un autre onglet »
 * ne sort pas de l'application, elle navigue vers le fichier et il n'y a plus de bouton retour
 * (Direction, 2026-09-30 : « piégé dans le logiciel quand on veut télécharger un bon de commande »).
 * Un message honnête vaut mieux qu'une impasse.
 *
 * À appeler depuis un geste de l'utilisateur (un clic ou l'envoi d'un formulaire).
 */
export async function telechargerDocument(href: string, nomFichier?: string): Promise<IssueEnregistrement | "echec"> {
  try {
    const res = await fetch(href, { credentials: "same-origin" });
    const verdict = verdictReponseDocument({
      redirected: res.redirected,
      ok: res.ok,
      status: res.status,
      url: res.url,
      origine: window.location.origin,
      contentType: res.headers.get("Content-Type"),
    });
    if (verdict !== "ok") {
      window.alert(messageEchecDocument(verdict, verdict === "erreur" || verdict === "refuse" ? await texteDeLaReponse(res) : null));
      return "echec";
    }
    const blob = await res.blob();
    const nom = nomFichier ?? nomDepuisEntetes(res.headers, "document.pdf");
    return await enregistrerFichier(blob, nom);
  } catch {
    window.alert(messageEchecDocument("erreur"));
    return "echec";
  }
}

/**
 * Téléchargement fiable, y compris en PWA mobile installée (iOS/Android).
 *
 * Le simple `<a href>` (même en `target="_blank"` ou avec `download`) NAVIGUE vers le PDF dans la
 * webview de l'app installée iOS → l'utilisateur est piégé, sans bouton retour. Ici on récupère le
 * fichier en arrière-plan (fetch → blob), puis :
 *   1) sur mobile : `navigator.share({ files })` = feuille native « Enregistrer dans Fichiers /
 *      Partager » en superposition (ne quitte pas l'app) ;
 *   2) sur ordinateur : téléchargement classique via un lien blob invisible.
 *
 * `onClick` (facultatif) est appelé au clic, avant la récupération : les menus s'en servent pour se
 * refermer.
 */
export function TelechargerLien({
  href,
  nomFichier,
  className,
  title,
  onClick: auClic,
  children,
}: {
  href: string;
  nomFichier?: string;
  className?: string;
  title?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    auClic?.();
    if (busy) return;
    setBusy(true);
    try {
      await telechargerDocument(href, nomFichier);
    } finally {
      setBusy(false);
    }
  }

  return (
    <a href={href} onClick={onClick} className={className} title={title} aria-busy={busy}>
      {children}
    </a>
  );
}

/**
 * L'adresse qu'un formulaire GET enverrait au navigateur : `action` + les champs, en paramètres.
 * Fonction PURE (testable sans DOM). Les champs sans valeur texte (fichiers) sont ignorés ; un
 * paramètre déjà présent dans `action` est conservé.
 */
export function adresseDeFormulaire(action: string, champs: Iterable<[string, unknown]>): string {
  const params = new URLSearchParams();
  for (const [nom, valeur] of champs) if (typeof valeur === "string") params.append(nom, valeur);
  const qs = params.toString();
  if (!qs) return action;
  return action + (action.includes("?") ? "&" : "?") + qs;
}

/**
 * Le pendant de `TelechargerLien` pour un FORMULAIRE GET dont le résultat est un fichier (fiches à
 * remplir : choix de la semaine, de la date…). Un `<form action="/…/fiche" method="get">` ordinaire
 * ferait naviguer la fenêtre vers le PDF ; ici l'envoi est intercepté, le fichier récupéré en
 * arrière-plan, et l'écran ne bouge pas. Sans JavaScript (avant l'hydratation), le formulaire reste
 * un formulaire GET valide.
 */
export function TelechargerFormulaire({
  action,
  nomFichier,
  className,
  children,
}: {
  action: string;
  nomFichier?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const champs = new FormData(e.currentTarget);
      // Le bouton qui a envoyé le formulaire (`<button name="format" value="pdf">`) porte un champ,
      // que `FormData` n'inclut pas de lui-même : on l'ajoute, comme le ferait le navigateur.
      const envoyeur = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      if (envoyeur?.name) champs.append(envoyeur.name, envoyeur.value);
      await telechargerDocument(adresseDeFormulaire(action, champs.entries()), nomFichier);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={action} method="get" onSubmit={onSubmit} className={className} aria-busy={busy}>
      {children}
    </form>
  );
}

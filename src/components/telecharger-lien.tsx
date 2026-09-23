"use client";

import { useState } from "react";

/**
 * Ce que dit la réponse d'une route de document. Fonction PURE, séparée du composant parce que ce
 * dépôt n'a pas de DOM en test : c'est la seule partie de ce chemin qu'un test peut tenir.
 *
 * `redirected` SE LIT AVANT `ok`, et l'ordre est tout : `fetch` SUIT les redirections, et le garde
 * d'authentification REDIRIGE vers /login au lieu de refuser. Session expirée = 200 + la page de
 * connexion en HTML ; `ok` est vrai, et sans ce contrôle on enregistre cet écran sous le nom
 * « Bulletin Août 2026.pdf », que le salarié transmet ensuite à sa banque ou à son bailleur.
 */
export type VerdictReponseDocument = "ok" | "session-expiree" | "erreur";

export function verdictReponseDocument(res: { redirected: boolean; ok: boolean }): VerdictReponseDocument {
  if (res.redirected) return "session-expiree";
  return res.ok ? "ok" : "erreur";
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
 * Renvoie `false` si l'utilisateur a ANNULÉ la feuille de partage (rien n'est enregistré), `true`
 * si la feuille s'est conclue ou si le lien de téléchargement a été déclenché. `true` ne prouve
 * pas que le fichier est sur le disque (le navigateur ne le dit pas) : seulement qu'il est parti.
 */
export async function enregistrerFichier(blob: Blob, nom: string): Promise<boolean> {
  const type = blob.type || "application/octet-stream";
  const file = new File([blob], nom, { type });

  // 1) Mobile TACTILE uniquement : partage natif (n'ouvre pas la webview, pas de piège).
  //    Sur desktop (y compris PWA installée), `canShare` peut renvoyer true mais le partage se
  //    termine sans rien télécharger → « rien ne se passe ». On réserve donc le partage au tactile.
  const tactile = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data?: ShareData) => Promise<void>;
  };
  if (tactile && nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    let issue: IssuePartage;
    try {
      await nav.share({ files: [file], title: nom });
      issue = issuePartage({ ok: true });
    } catch (err) {
      issue = issuePartage({ erreur: err });
    }
    // Annulé par l'utilisateur → on s'arrête, RIEN n'est enregistré. Autre erreur → repli.
    if (issue === "partage") return true;
    if (issue === "annule") return false;
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
  return true;
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
 */
export function TelechargerLien({
  href,
  nomFichier,
  className,
  title,
  children,
}: {
  href: string;
  nomFichier?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      const verdict = verdictReponseDocument(res);
      if (verdict === "session-expiree") {
        // On NE retombe PAS sur `window.open` ici : il servirait la page de connexion, ou serait
        // bloqué en silence (appelé après un `await`, il est hors geste utilisateur). Mieux vaut
        // le dire.
        window.alert("Votre session a expiré. Reconnectez-vous, puis rouvrez ce document.");
        return;
      }
      if (verdict === "erreur") throw new Error(String(res.status));
      const blob = await res.blob();
      const nom = nomFichier ?? nomDepuisEntetes(res.headers, "document.pdf");
      await enregistrerFichier(blob, nom);
    } catch {
      window.open(href, "_blank", "noopener,noreferrer");
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

"use client";

import { useState } from "react";

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
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const nom = nomFichier ?? nomDepuisEntetes(res.headers, "document.pdf");
      const type = blob.type || "application/octet-stream";
      const file = new File([blob], nom, { type });

      // 1) Mobile : partage natif (n'ouvre pas la webview, pas de piège).
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data?: ShareData) => Promise<void>;
      };
      if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: nom });
          return;
        } catch (err) {
          // Annulé par l'utilisateur → on s'arrête. Autre erreur → on tente le repli.
          if ((err as Error)?.name === "AbortError") return;
        }
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

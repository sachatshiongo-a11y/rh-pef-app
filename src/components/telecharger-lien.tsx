"use client";

import { useState } from "react";

/**
 * Lien de téléchargement fiable sur PWA mobile (iOS/Android) : au lieu de NAVIGUER vers le fichier
 * (ce qui piège l'utilisateur dans la webview installée, sans bouton retour), on récupère le fichier
 * en arrière-plan (fetch → blob) puis on déclenche l'enregistrement via un lien temporaire. L'app
 * reste ouverte. Repli : ouverture classique si le fetch échoue.
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
      let nom = nomFichier;
      if (!nom) {
        const cd = res.headers.get("Content-Disposition") ?? "";
        nom = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? "document";
        nom = decodeURIComponent(nom);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.rel = "noopener";
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

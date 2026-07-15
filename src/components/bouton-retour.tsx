"use client";

import { useRouter } from "next/navigation";

/**
 * Bouton « Retour » global (flèche ←) : revient à la page précédente, comme la flèche du
 * navigateur — indispensable en PWA installée, où le navigateur n'affiche aucune flèche.
 */
export function BoutonRetour({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Revenir à la page précédente"
      title="Revenir à la page précédente"
      className={`rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

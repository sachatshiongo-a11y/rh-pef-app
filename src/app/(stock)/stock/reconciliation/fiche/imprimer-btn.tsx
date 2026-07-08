"use client";

import { useEffect } from "react";

export function ImprimerBtn() {
  return (
    <button onClick={() => window.print()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
      Imprimer / Enregistrer en PDF
    </button>
  );
}

// Ouvre automatiquement la boîte d'impression (→ « Enregistrer en PDF ») une fois la fiche rendue.
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}

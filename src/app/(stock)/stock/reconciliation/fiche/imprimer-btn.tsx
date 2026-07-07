"use client";

export function ImprimerBtn() {
  return (
    <button onClick={() => window.print()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
      🖨️ Imprimer / Enregistrer en PDF
    </button>
  );
}

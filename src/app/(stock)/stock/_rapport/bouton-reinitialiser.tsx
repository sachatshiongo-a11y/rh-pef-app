"use client";

// Bouton « Réinitialiser » — toujours en rouge, visible uniquement pour la Direction.
export function BoutonReinitialiser({ estDirection, onClick }: { estDirection: boolean; onClick: () => void }) {
  if (!estDirection) return null;
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
      Réinitialiser
    </button>
  );
}

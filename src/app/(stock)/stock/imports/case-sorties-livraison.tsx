"use client";

// Case « Les sorties sont des livraisons au restaurant » — commune aux deux imports (CSV de
// mouvements, classeur d'inventaire). Cochée par défaut (décision Direction du 2026-09-28).
// Pas d'attribut `name` : l'écran envoie toujours « 1 » ou « 0 » explicitement (voir
// `lib/motif-sorties-import.ts`), une case décochée n'étant pas transmise par un formulaire.

export function CaseSortiesLivraison({ coche, onChange }: { coche: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={coche} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="font-medium">Les sorties sont des livraisons au restaurant</span>
        <span className="block text-xs text-muted-foreground">Décochée : les sorties importées n&apos;ont pas de motif. Les sorties déjà en base ne changent pas.</span>
      </span>
    </label>
  );
}

/** Rappel du choix dans l'aperçu. */
export function MotifSortiesApercu({ coche }: { coche: boolean }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Motif des sorties importées : </span>
      {coche ? <b>Livraison restaurant</b> : <b>aucun motif</b>}
    </p>
  );
}

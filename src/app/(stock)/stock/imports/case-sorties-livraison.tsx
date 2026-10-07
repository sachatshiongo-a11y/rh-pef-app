// Motif des sorties importées — commun aux deux imports (CSV de mouvements, classeur d'inventaire).
// Décision de la Direction (2026-09-28) : les sorties importées sont des livraisons au restaurant.
// Décision de Sacha (2026-10-07) : le motif est OBLIGATOIRE pour toute sortie — la case « sans motif »
// a disparu ; l'écran envoie toujours « 1 » (voir `lib/motif-sorties-import.ts`).

export function CaseSortiesLivraison() {
  return (
    <p className="text-sm">
      <span className="font-medium">Les sorties importées reçoivent le motif « Livraison restaurant ».</span>
      <span className="block text-xs text-muted-foreground">Le motif est obligatoire pour toute sortie. Une sortie qui n&apos;est pas une livraison se requalifie ensuite dans Mouvements (« Changer le motif »). Les sorties déjà en base ne changent pas.</span>
    </p>
  );
}

/** Rappel dans l'aperçu. */
export function MotifSortiesApercu() {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Motif des sorties importées : </span>
      <b>Livraison restaurant</b>
    </p>
  );
}

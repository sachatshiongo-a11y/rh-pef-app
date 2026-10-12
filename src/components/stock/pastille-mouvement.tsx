// PASTILLES D'UN MOUVEMENT DE STOCK — une seule source pour l'écran Mouvements ET la fiche article (2026-10-16 :
// « entrées et sorties avec des pastilles également »). Couleur + libellé, jamais la couleur seule. Les couleurs
// du type reprennent celles des colonnes de l'écran Mouvements (Entrées vert, Sorties rouge) ; celles du motif sont
// les pastilles de motif d'origine de cet écran. Pas de "use client" : sans état, utilisable côté serveur comme client.

// Ajustement : NEUTRE (gris) — son sens n'est pas enregistré, et l'ambre est déjà la couleur des « à valider » / alertes.
// `anneau` : filet de la même teinte — sur une petite pastille, le fond pâle (le même que le bandeau des colonnes de
// l'écran Mouvements) ne suffisait pas à faire VOIR le sens ; la couleur du fond et du texte ne change pas.
export const TYPE_PASTILLE: Record<string, { texte: string; classe: string; anneau: string }> = {
  ENTREE: { texte: "Entrée", classe: "bg-emerald-50 text-emerald-800", anneau: "ring-1 ring-inset ring-emerald-300" },
  SORTIE: { texte: "Sortie", classe: "bg-red-50 text-red-800", anneau: "ring-1 ring-inset ring-red-300" },
  AJUSTEMENT: { texte: "Ajustement", classe: "bg-slate-100 text-slate-700", anneau: "ring-1 ring-inset ring-slate-300" },
};

export const MOTIF_CHIP: Record<string, { texte: string; classe: string }> = {
  LIVRAISON_RESTAURANT: { texte: "Livraison restaurant", classe: "bg-sky-100 text-sky-900" },
  PERTE: { texte: "Perte", classe: "bg-red-100 text-red-900" },
  "": { texte: "sans motif", classe: "bg-muted text-muted-foreground" },
};

const BASE = "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium";

/** Type du mouvement : Entrée / Sortie / Ajustement (un type inconnu s'affiche tel quel, en neutre). */
export function PastilleType({ type, className = "" }: { type: string; className?: string }) {
  const p = TYPE_PASTILLE[type];
  return <span data-pastille-type={type} className={`${BASE} ${p ? `${p.classe} ${p.anneau}` : "bg-muted text-muted-foreground"} ${className}`}>{p?.texte ?? type}</span>;
}

/** Motif d'une sortie (Perte, Livraison restaurant…) ; `null` ou vide = « sans motif », dit tel quel. */
export function PastilleMotif({ motif, className = "" }: { motif: string | null | undefined; className?: string }) {
  const p = MOTIF_CHIP[motif ?? ""];
  return <span data-pastille-motif={motif ?? ""} className={`${BASE} ${p?.classe ?? MOTIF_CHIP[""]!.classe} ${className}`}>{p?.texte ?? motif}</span>;
}

/** Les mêmes couleurs sur les pastilles de FILTRE (fiche article : Entrées / Sorties / Ajustements / Tous). */
export const TEINTE_FILTRE_MOUVEMENT = {
  entrees: { repos: "border-emerald-300 text-emerald-800", actif: "border-emerald-600 bg-emerald-50 text-emerald-900" },
  sorties: { repos: "border-red-300 text-red-800", actif: "border-red-600 bg-red-50 text-red-900" },
  ajustements: { repos: "border-slate-300 text-slate-700", actif: "border-slate-500 bg-slate-100 text-slate-900" },
} as const;

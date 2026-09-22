// Source unique des boutons d'action de validation (B7 / D, uniformisation 2026-09-22).
// Avant : la même décision (approuver/refuser une demande) était peinte de six façons
// différentes selon l'écran — aplat, pastille, contour, couleurs en dur. Ici, l'icône et
// la forme sont DANS le composant : un écran ne peut plus les faire dériver.
// Vert = approuver/valider, rouge = refuser (toujours un APLAT, jamais un contour — à
// côté d'un aplat vert, un contour se lit comme secondaire alors que les deux décisions
// ont le même poids). rounded-md et non rounded-full : c'est la forme de tous les autres
// boutons du logiciel, la cohérence d'ensemble prime sur celle d'un écran.
//
// Pas de "use client" ici : ces composants n'ont ni state ni hook, ils héritent du
// contexte de leur appelant (serveur avec <form action={...}> + type="submit", ou client
// avec onClick + useTransition).
import type { ButtonHTMLAttributes } from "react";

// LA géométrie de la famille : forme, espacement, taille de texte. Exportée nue (sans aucune
// couleur) pour les éléments d'une barre d'actions qui ne sont PAS des décisions à deux issues
// et n'ont donc pas à entrer dans la famille — un bouton bg-primary, un <summary> de menu, un
// <span> d'état désactivé. Ils composent cette géométrie avec leurs propres couleurs : la barre
// reste homogène sans qu'on leur invente une sémantique qu'ils n'ont pas.
export const CLASSES_GEOMETRIE =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50";

const BASE_CLASSES = CLASSES_GEOMETRIE;

// Chaînes de classes équivalentes aux composants ci-dessous, pour les cas où l'élément ne PEUT
// PAS être un <button> : un <Link> next/link (« Voir l'aperçu », « Modifier le brouillon » —
// ce sont des navigations : en faire des <button> ferait perdre l'ouverture dans un nouvel
// onglet et le préchargement), ou un <button> brut composé avec un <select> dans le même
// <form> (status-actions.tsx). Même géométrie que BASE_CLASSES : c'est la norme, et une barre
// d'actions qui contient un bouton de la famille doit être homogène jusqu'au dernier élément.
// À réserver aux étapes intermédiaires qui ne sont ni une approbation ni un refus — pour
// approuver/refuser/valider, toujours un composant ci-dessous.
export const CLASSES_NEUTRE = `${BASE_CLASSES} border hover:bg-accent`;
export const CLASSES_DANGER = `${BASE_CLASSES} border border-destructive/40 text-destructive hover:bg-destructive/10`;

/** Alias historique de CLASSES_NEUTRE (déjà importé ailleurs). */
export const BTN_NEUTRE = CLASSES_NEUTRE;

type BoutonActionProps = ButtonHTMLAttributes<HTMLButtonElement>;

function fusionner(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** Bouton d'approbation — aplat vert (bg-success), icône ✓, libellé « Approuver » par défaut. */
export function BoutonApprouver({ children, className, ...props }: BoutonActionProps) {
  return (
    <button
      {...props}
      className={fusionner(BASE_CLASSES, "bg-success text-white hover:bg-success/90", className)}
    >
      <span aria-hidden="true">✓</span>
      {children ?? "Approuver"}
    </button>
  );
}

/**
 * Bouton de refus — aplat rouge (bg-destructive), jamais un contour : le refus a le même
 * poids visuel que l'approbation. Icône ✕, libellé « Refuser » par défaut.
 */
export function BoutonRefuser({ children, className, ...props }: BoutonActionProps) {
  return (
    <button
      {...props}
      className={fusionner(BASE_CLASSES, "bg-destructive text-white hover:bg-destructive/90", className)}
    >
      <span aria-hidden="true">✕</span>
      {children ?? "Refuser"}
    </button>
  );
}

/**
 * Bouton de validation à sens unique (pas de « refus » en vis-à-vis) — même aplat vert que
 * BoutonApprouver, mais pour les écrans où l'action n'a pas d'opposé (valider un bon de
 * commande, valider/marquer payé un bulletin de paie...). Icône ✓, libellé « Valider » par défaut.
 */
export function BoutonValider({ children, className, ...props }: BoutonActionProps) {
  return (
    <button
      {...props}
      className={fusionner(BASE_CLASSES, "bg-success text-white hover:bg-success/90", className)}
    >
      <span aria-hidden="true">✓</span>
      {children ?? "Valider"}
    </button>
  );
}

/**
 * Bouton neutre — pour une étape intermédiaire qui n'est ni une approbation ni un refus
 * (ex. « Rouvrir » un bulletin déjà validé, « Désélectionner »). Pas d'icône imposée : le
 * libellé la porte au besoin (« ↩ Rouvrir »).
 */
export function BoutonNeutre({ children, className, ...props }: BoutonActionProps) {
  return (
    <button {...props} className={fusionner(CLASSES_NEUTRE, className)}>
      {children}
    </button>
  );
}

/**
 * Bouton destructif — une SUPPRESSION, pas un refus : le libellé « Refuser » mentirait, donc
 * il a sa propre entrée dans la famille. Contour rouge (jamais un aplat : un aplat rouge est
 * réservé au refus d'une demande, qui pèse autant qu'une approbation), mais MÊME GÉOMÉTRIE
 * que les autres — c'est tout l'objet de son existence : il vit à côté d'un BoutonValider
 * dans une barre d'actions groupées, et une barre d'actions doit être homogène.
 * Couleurs reprises telles quelles de l'existant, seule la géométrie est normalisée.
 */
export function BoutonDanger({ children, className, ...props }: BoutonActionProps) {
  return (
    <button {...props} className={fusionner(CLASSES_DANGER, className)}>
      {children}
    </button>
  );
}

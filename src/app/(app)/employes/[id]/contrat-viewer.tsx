"use client";

import { ApercuDocumentBouton } from "@/components/apercu-document";

/** Bouton ouvrant un PDF (contrat / attestation de paie) en plein écran, avec bouton de fermeture.
 *  `href` = route du PDF (ex. /employes/{id}/contrat/{contratId}, /employes/{id}/attestation-paie/{ligneId}).
 *  Simple habillage de `ApercuDocumentBouton` (src/components/apercu-document.tsx) : « Télécharger »
 *  récupère la même route en `?dl=1`. */
export function ContratViewerButton({ href, titre, libelle = "Voir le contrat", className = "font-medium text-primary underline" }: { href: string; titre: string; libelle?: string; className?: string }) {
  return <ApercuDocumentBouton href={href} titre={titre} libelle={libelle} className={className} telechargerHref={`${href}?dl=1`} />;
}

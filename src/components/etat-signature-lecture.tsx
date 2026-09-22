import type { EtatSignatureUI } from "@/components/bouton-signer";

/**
 * L'état de signature pour un compte qui ne peut PAS faire signer (VIEWER) : lecture seule.
 *
 * Un seul exemplaire, partagé par « Documents & archives » et la fiche employé : recopié dans
 * chacune, un écran aurait fini par dire « Signé » là où l'autre dit « À resigner ».
 */
export function EtatSignatureLecture({ etat, signeLeTexte }: { etat: EtatSignatureUI; signeLeTexte: string | null }) {
  if (etat === "SIGNE") {
    return <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Signé le {signeLeTexte}</span>;
  }
  if (etat === "A_RESIGNER") {
    return <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">À resigner</span>;
  }
  return <span className="whitespace-nowrap text-xs text-muted-foreground">À signer</span>;
}

import Link from "next/link";
import type { ReactNode } from "react";
import { TEINTE, TEXTE } from "@/components/teinte";

export type TeinteIndicateur = keyof typeof TEINTE;

/**
 * LA carte d'indicateur (libellé, valeur, sous-texte, teinte, lien facultatif). La teinte colore le
 * fond ET le chiffre (`src/components/teinte.ts`) : `entree`/`sortie` disent la catégorie,
 * `alerte` un problème, `attention` ce qu'il faut surveiller. La valeur arrive DÉJÀ formatée
 * (montants par `src/lib/montant.ts`) : la carte n'invente aucun format.
 */
export function Indicateur({
  libelle, valeur, sousTexte, teinte, href,
}: {
  libelle: string;
  valeur: string;
  sousTexte?: ReactNode;
  teinte?: TeinteIndicateur;
  href?: string;
}) {
  const carte = (
    <div className={`flex h-full min-w-0 flex-col rounded-lg border p-4 ${teinte ? TEINTE[teinte] : ""} ${href ? "transition-colors hover:border-primary" : ""}`}>
      <p className="text-xs text-muted-foreground">{libelle}</p>
      <p className={`mt-1 break-words text-lg font-semibold tabular-nums sm:text-xl ${teinte ? TEXTE[teinte] : ""}`}>{valeur}</p>
      {sousTexte && <p className="mt-auto pt-0.5 text-xs text-muted-foreground">{sousTexte}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{carte}</Link> : carte;
}

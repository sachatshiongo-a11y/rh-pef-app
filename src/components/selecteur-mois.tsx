import Link from "next/link";
import { Icone } from "@/components/icones";
import { moisAdjacent, MOIS_FR } from "@/lib/dates-fr";

// Sélecteur de mois des tableaux de bord (Exploitation, Stock) — un seul composant, un seul
// comportement : flèches ◀/▶ mois par mois, champ « Mois » + « Afficher » (formulaire GET natif,
// sans JavaScript), mois dans l'URL (`?mois=AAAA-MM`, lien partageable). Hors du mois courant, un
// lien ramène au mois courant (l'adresse nue : c'est le mois par défaut). Pas de borne sur les
// mois futurs : c'est la règle de l'Exploitation. Rien de collant : il vit dans le flux de la page,
// donc ni sous l'en-tête ni sous la barre du bas ; `flex-wrap` le replie sur un téléphone étroit.
export function SelecteurMois({ chemin, moisValue, moisCourant }: { chemin: string; moisValue: string; moisCourant: string }) {
  const [a, m] = moisCourant.split("-").map(Number);
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs" data-selecteur-mois>
      <Link href={`${chemin}?mois=${moisAdjacent(moisValue, -1)}`} aria-label="Mois précédent" className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent">
        <Icone nom="chevronGauche" />
      </Link>
      <form className="flex items-end gap-2">
        <label className="flex flex-col gap-0.5 text-muted-foreground">Mois
          <input type="month" name="mois" defaultValue={moisValue} className="rounded border border-input bg-background px-2 py-1.5 text-foreground" />
        </label>
        <button className="rounded-md border px-3 py-1.5 font-medium hover:bg-accent">Afficher</button>
      </form>
      <Link href={`${chemin}?mois=${moisAdjacent(moisValue, 1)}`} aria-label="Mois suivant" className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent">
        <Icone nom="chevronDroit" />
      </Link>
      {moisValue !== moisCourant && (
        <Link href={chemin} className="flex h-8 items-center whitespace-nowrap text-primary underline" data-retour-mois-courant>
          Revenir à {MOIS_FR[m - 1]} {a}
        </Link>
      )}
    </div>
  );
}

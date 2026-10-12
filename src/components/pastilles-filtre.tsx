import Link from "next/link";

/**
 * Pastilles de filtre d'un onglet (liens, avec effectif) : « À payer (3) · Payées (1) · Toutes (4) ».
 * Même forme que celles de l'écran Factures et de la fiche fournisseur ; le filtre vit dans l'adresse.
 */
export function PastillesFiltre<T extends string>({ valeurs, actif, effectifs, lien, libelle }: {
  valeurs: readonly (readonly [T, string])[]; actif: T; effectifs: Record<T, number>; lien: (v: T) => string; libelle: string;
}) {
  return (
    <nav aria-label={libelle} className="flex flex-wrap gap-1.5 text-sm">
      {valeurs.map(([v, label]) => (
        <Link key={v} href={lien(v)} scroll={false} aria-current={v === actif ? "page" : undefined} className={`rounded-full border px-3 py-1 ${v === actif ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>
          {label} ({effectifs[v]})
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";

/**
 * Pastilles de filtre d'un onglet (liens, avec effectif) : « À payer (3) · Payées (1) · Toutes (4) ».
 * Même forme que celles de l'écran Factures et de la fiche fournisseur ; le filtre vit dans l'adresse.
 */
/** Teinte d'une pastille qui porte un SENS (Entrées en vert, Sorties en rouge…) : au repos et quand elle est choisie. */
export type TeintePastille = { repos: string; actif: string };

export function PastillesFiltre<T extends string>({ valeurs, actif, effectifs, lien, libelle, teintes }: {
  valeurs: readonly (readonly [T, string])[]; actif: T; effectifs: Record<T, number>; lien: (v: T) => string; libelle: string;
  teintes?: Partial<Record<T, TeintePastille>>;
}) {
  return (
    <nav aria-label={libelle} className="flex flex-wrap gap-1.5 text-sm">
      {valeurs.map(([v, label]) => {
        const t = teintes?.[v];
        const classe = v === actif
          ? (t ? `${t.actif} font-medium` : "border-primary bg-primary/10 font-medium")
          : (t ? `${t.repos} hover:bg-accent` : "hover:bg-accent");
        return (
          <Link key={v} href={lien(v)} scroll={false} aria-current={v === actif ? "page" : undefined} data-teinte={t ? "oui" : undefined} className={`rounded-full border px-3 py-1 ${classe}`}>
            {label} ({effectifs[v]})
          </Link>
        );
      })}
    </nav>
  );
}

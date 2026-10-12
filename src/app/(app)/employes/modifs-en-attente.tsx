import Link from "next/link";

export type ModifEnAttente = { id: string; auteurNom: string; le: string; motif: string | null; lignes: string[] };

/** Bandeau « Modification en attente de validation » (fiche et page Modifier), visible de tous. */
export function ModifsEnAttente({ demandes, estDirection }: { demandes: ModifEnAttente[]; estDirection: boolean }) {
  if (demandes.length === 0) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">À valider</span>
        Modification en attente de validation par la Direction — pas encore appliquée à la fiche
      </p>
      {demandes.map((d) => (
        <div key={d.id} className="mt-1">
          <ul className="list-inside list-disc tabular-nums">
            {d.lignes.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <p className="text-xs text-amber-800">Demandée par {d.auteurNom} le {d.le}{d.motif ? ` — motif : ${d.motif}` : ""}</p>
        </div>
      ))}
      <Link href="/a-valider#modifications-fiches" className="mt-1 inline-block text-xs font-medium text-primary underline">
        {estDirection ? "Décider" : "Voir"} dans « À valider » →
      </Link>
    </div>
  );
}

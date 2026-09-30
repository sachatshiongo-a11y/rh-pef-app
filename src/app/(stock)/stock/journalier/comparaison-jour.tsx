"use client";

import Link from "next/link";
import { Fragment } from "react";
import { qte } from "@/lib/stock";
import { LIBELLE_ECART, ecartConsoLivre, ecartLivreCommande, livreDiffereDuCommande, type LigneComparaison } from "@/lib/journalier-restaurant";
import { useJourAffiche } from "@/components/selecteur-jour";
import { TitreJour } from "@/components/liste-jour";
import { FOND_ECART, PASTILLE_ECART, qteConso } from "./comparaison-format";

// Onglet « Comparaison » sur téléphone : pour le jour choisi, trois petites valeurs côte à côte —
// Commandé / Livré / Consommé — avec les couleurs d'écart du tableau. Mêmes lignes que le tableau ;
// n'y figurent que les articles qui ont bougé ce jour-là. « — » : consommation inconnue (jamais 0) ;
// un « 0 » n'apparaît que côté commandé ou livré, quand l'autre valeur est là (l'écart se lit).
// Chaque écart porte sa couleur ET son signe (« -1 », « +2 ») sous la valeur : jamais la couleur seule.

type Jour = { iso: string; label: string };

const COL = "w-14 shrink-0 text-center";

/** Écart signé sous la valeur : lisible sans la couleur (et annoncé tel quel par un lecteur d'écran). */
function Signe({ nature, signe, titre }: { nature: keyof typeof PASTILLE_ECART; signe: string; titre: string }) {
  return <span data-signe={signe} aria-label={`${signe} : ${titre}`} className={`mx-auto mt-0.5 block w-fit rounded px-1 text-[11px] font-bold leading-4 ${PASTILLE_ECART[nature]}`}>{signe}</span>;
}

export function ComparaisonJour({ jours, lignes, sansMotif }: { jours: Jour[]; lignes: LigneComparaison[]; sansMotif: number }) {
  const [rang] = useJourAffiche(jours.map((j) => j.iso));
  const jour = jours[rang]!;
  const duJour = lignes.filter((r) => (r.cmd[rang] ?? 0) > 0 || (r.liv[rang] ?? 0) > 0 || (r.conso[rang] ?? null) !== null);
  return (
    <div data-vue-liste="comparaison" className="space-y-1">
      <TitreJour iso={jour.iso} resume={`${duJour.length} / ${lignes.length} article(s) ce jour`} />
      <details className="rounded-lg border bg-muted/30 px-3 text-xs text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
          Légende des couleurs <span aria-hidden className="text-[10px]">▼</span>
        </summary>
        <ul className="space-y-1 pb-3">
          <li className="flex items-center gap-2"><span className={`shrink-0 rounded px-1 text-[11px] font-bold leading-4 ${PASTILLE_ECART.LIVRE_DIFFERE}`}>±</span> livré ≠ commandé (+ : livré en plus)</li>
          <li className="flex items-center gap-2"><span className={`shrink-0 rounded px-1 text-[11px] font-bold leading-4 ${PASTILLE_ECART.LIVRE_NON_CONSOMME}`}>-1</span> {LIBELLE_ECART.LIVRE_NON_CONSOMME}</li>
          <li className="flex items-center gap-2"><span className={`shrink-0 rounded px-1 text-[11px] font-bold leading-4 ${PASTILLE_ECART.CONSOMME_PLUS_QUE_LIVRE}`}>+1</span> {LIBELLE_ECART.CONSOMME_PLUS_QUE_LIVRE}</li>
          <li>« — » : jour sans comptage ; le consommé vient des comptages du restaurant.</li>
        </ul>
      </details>
      {sansMotif > 0 && (
        <p className="px-1 text-xs text-amber-800">
          {sansMotif}{" "}article(s) sorti(s) du dépôt sans motif cette semaine : ni livrés au restaurant, ni pertes, ils ne comptent pas dans « Livré » (voir l&apos;onglet Consommation).
        </p>
      )}
      {duJour.map((r, ri) => {
        const nouvelleCat = ri === 0 || duJour[ri - 1]!.categorie !== r.categorie;
        const c = r.cmd[rang]!, l = r.liv[rang]!, ecartCL = livreDiffereDuCommande(c, l);
        const ecart = r.ecarts[rang] ?? null;
        const signeCL = ecartCL ? ecartLivreCommande(c, l) : null;
        const signeCs = ecart ? ecartConsoLivre(l, r.conso[rang] ?? null) : null;
        return (
          <Fragment key={r.id}>
            {nouvelleCat && (
              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-100 px-3 py-1.5 text-amber-900">
                <span className="min-w-0 flex-1 text-sm font-semibold">{r.categorie}</span>
                <span className={`${COL} text-[11px] font-medium text-emerald-700`}>Commandé</span>
                <span className={`${COL} text-[11px] font-medium text-red-700`}>Livré</span>
                <span className={`${COL} text-[11px] font-medium text-indigo-700`}>Consommé</span>
              </div>
            )}
            <div className="flex min-h-14 items-center gap-1.5 border-b px-1 py-1.5" data-article={r.designation}>
              <div className="min-w-0 flex-1 break-words text-sm font-medium">
                {r.lien ? <Link href={`/stock/catalogue/${r.id}`} className="text-primary hover:underline">{r.designation}</Link> : r.designation}
              </div>
              <span className={`${COL} rounded-md py-1 text-sm font-medium tabular-nums text-emerald-700 ${ecartCL ? "bg-orange-50" : ""}`}><span data-valeur>{c > 0 ? qte(c) : ecartCL ? "0" : ""}</span></span>
              <span className={`${COL} rounded-md py-1 text-sm font-medium tabular-nums text-red-700 ${ecartCL ? "bg-orange-100" : ""}`}><span data-valeur>{l > 0 ? qte(l) : ecartCL ? "0" : ""}</span>{signeCL && <Signe nature="LIVRE_DIFFERE" signe={signeCL} titre="livré différent du commandé" />}</span>
              <span
                className={`${COL} rounded-md py-1 text-sm tabular-nums text-indigo-700 ${ecart ? FOND_ECART[ecart] : ""}`}
                data-ecart={ecart ?? undefined} aria-label={ecart ? `${qteConso(r.conso[rang] ?? null)} — ${LIBELLE_ECART[ecart]}` : undefined}
              >
                <span data-valeur>{qteConso(r.conso[rang] ?? null)}</span>
                {ecart && signeCs && <Signe nature={ecart} signe={signeCs} titre={LIBELLE_ECART[ecart]} />}
              </span>
            </div>
          </Fragment>
        );
      })}
      {duJour.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucune commande, livraison ni consommation ce jour.</p>}
    </div>
  );
}

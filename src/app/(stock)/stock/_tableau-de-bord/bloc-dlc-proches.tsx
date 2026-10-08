import Link from "next/link";
import { qte } from "@/lib/stock";
import { jjmmaaaa } from "@/lib/achats-liste";
import { classePastilleDlc, libelleJoursDlc } from "@/lib/achats-doublons";
import { DLC_ENTREES_JOURS, DLC_HORIZON_JOURS, type DlcProche } from "@/lib/dlc-stock";

/**
 * Bloc « DLC proches » du tableau de bord Stock (Direction, 2026-10-08) : les entrées des 60 derniers
 * jours dont la DLC tombe dans les 7 prochains jours, ou est passée — la plus urgente d'abord.
 * INDICATIF, et dit comme tel : le logiciel ne suit pas les lots, la quantité entrée n'est peut-être
 * plus au dépôt. Toujours la situation d'AUJOURD'HUI (`periode` le dit hors du mois courant).
 */
export function BlocDlcProches({ lignes, total, periode }: { lignes: DlcProche[]; total: number; periode?: string }) {
  return (
    <div data-bloc-dlc-proches className="rounded-xl border p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">DLC proches{total > 0 ? ` (${total})` : ""}{periode && <span className="text-xs font-normal text-muted-foreground" data-periode> · {periode}</span>}</h2>
        <Link href="/stock/entree" className="shrink-0 text-xs text-primary hover:underline">Liste d&apos;achat →</Link>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Entrées des {DLC_ENTREES_JOURS} derniers jours dont la DLC tombe dans les {DLC_HORIZON_JOURS} jours ou est passée. Indicatif : le logiciel ne suit pas les lots, la quantité n&apos;est peut-être plus en stock.
      </p>
      {lignes.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Aucune DLC proche.</p>
      ) : (
        <ul className="divide-y text-sm">
          {lignes.map((l) => (
            <li key={l.mouvementId} data-dlc-ligne className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate pr-2">
                <Link href={`/stock/catalogue/${l.articleId}`} className="font-medium text-primary hover:underline">{l.designation}</Link>
                <span className="text-xs text-muted-foreground"> · +{qte(l.quantite)}{l.unite ? ` ${l.unite}` : ""} entré le {jjmmaaaa(l.dateEntreeISO)}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${classePastilleDlc(l.jours)}`}>
                DLC {jjmmaaaa(l.dlcISO)} · {libelleJoursDlc(l.jours)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {total > lignes.length && <p className="mt-1 text-xs text-muted-foreground">… et {total - lignes.length} autre(s).</p>}
    </div>
  );
}

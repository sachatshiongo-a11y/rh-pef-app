import { qte } from "@/lib/stock";
import type { TotalUnite } from "@/lib/journalier-restaurant";

// Totaux PAR UNITÉ (Commande, Consommation) : 12 kg et 5 bouteilles ne s'additionnent jamais en « 17 »
// (audit du 10/10/2026). Un total par unité, une unité par ligne ; rien quand il n'y a rien.
// Composant de présentation, sans état : utilisable côté serveur comme côté client.

const visibles = (totaux: TotalUnite[]) => totaux.filter((t) => t.total > 0);

/** « 12 kg », ou « 3 (unité ?) » quand l'unité n'est pas renseignée et qu'une autre unité figure à côté. */
function texteTotal(t: TotalUnite, plusieurs: boolean): string {
  return `${qte(t.total)}${t.unite ? ` ${t.unite}` : plusieurs ? " (unité ?)" : ""}`;
}

/** Un total par ligne, dans la cellule d'un tableau. */
export function TotauxUnites({ totaux }: { totaux: TotalUnite[] }) {
  const v = visibles(totaux);
  return <>{v.map((t, i) => <span key={i} className="block whitespace-nowrap">{texteTotal(t, v.length > 1)}</span>)}</>;
}

/** Les mêmes totaux sur une ligne (résumé du téléphone) : « 12 kg · 5 bouteille ». */
export function texteTotauxUnites(totaux: TotalUnite[]): string {
  const v = visibles(totaux);
  return v.map((t) => texteTotal(t, v.length > 1)).join(" · ");
}

/** « Farine (kg) » : l'unité du catalogue à côté du nom, discrète — `null` quand elle n'est pas renseignée. */
export function UniteArticle({ unite }: { unite: string | null | undefined }) {
  const u = unite?.trim();
  return u ? <span className="font-normal text-muted-foreground"> ({u})</span> : null;
}

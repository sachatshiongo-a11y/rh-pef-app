import Link from "next/link";
import { Fragment } from "react";
import Decimal from "decimal.js";
import { qte } from "@/lib/stock";
import { LIBELLE_ECART, type LigneComparaison } from "@/lib/journalier-restaurant";
import { VueJourOuSemaine } from "@/components/vue-jour-semaine";
import { ComparaisonJour } from "./comparaison-jour";
import { FOND_ECART, qteConso } from "./comparaison-format";

// Onglet « Comparaison » : commandé (C), livré au restaurant (L) et consommé au restaurant (Cs),
// jour par jour, avec les écarts. Composant de présentation (aucun état) : rendu côté serveur.
// Téléphone : la liste d'UN jour (`ComparaisonJour`) ; le tableau de la semaine reste en « Vue semaine ».

type Jour = { iso: string; label: string };

/** Total consommé : seulement si chaque jour est connu, sinon « — » (jamais un total partiel). */
const totalConso = (vs: (string | null)[]) => (vs.some((v) => v === null) ? null : vs.reduce((t, v) => t.plus(v!), new Decimal(0)).toString());

export function TableComparaison({ jours, lignes, sansMotif }: { jours: Jour[]; lignes: LigneComparaison[]; sansMotif: number }) {
  const colSpan = jours.length * 3 + 4;
  return (
    <VueJourOuSemaine
      jour={<ComparaisonJour jours={jours} lignes={lignes} sansMotif={sansMotif} />}
      semaine={
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-emerald-700">C</span> = commandé · <span className="font-semibold text-red-700">L</span> = livré au restaurant ·{" "}
          <span className="font-semibold text-indigo-700">Cs</span> = consommé au restaurant (comptages ; « — » : jour sans comptage)
        </span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-200" /> livré ≠ commandé</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-200" /> {LIBELLE_ECART.LIVRE_NON_CONSOMME}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-200" /> {LIBELLE_ECART.CONSOMME_PLUS_QUE_LIVRE}</span>
      </p>
      {sansMotif > 0 && (
        <p className="text-xs text-amber-800">
          {sansMotif} article(s) sorti(s) du dépôt sans motif cette semaine : ni livrés au restaurant, ni pertes, ils ne comptent pas dans « L » (voir l&apos;onglet Consommation).
        </p>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th className="sticky left-0 z-30 bg-muted px-3">Article</th>
              {jours.map((j) => <th key={j.iso} className="!text-center" colSpan={3}>{j.label}</th>)}
              <th className="!text-center" colSpan={3}>Total</th>
            </tr>
            <tr className="[&>th]:border-b [&>th]:px-1 [&>th]:pb-1 [&>th]:text-[10px] [&>th]:font-medium [&>th]:text-muted-foreground">
              <th className="sticky left-0 z-30 bg-muted" />
              {[...jours.map((j) => j.iso), "total"].map((k) => (
                <Fragment key={k}><th className="!text-right">C</th><th className="!text-right">L</th><th className="!text-right">Cs</th></Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-1 [&>tr>td]:py-1.5">
            {lignes.map((r, ri) => {
              const nouvelleCat = ri === 0 || lignes[ri - 1]!.categorie !== r.categorie;
              const totC = r.cmd.reduce((a, b) => a + b, 0), totL = r.liv.reduce((a, b) => a + b, 0);
              return (
                <Fragment key={r.id}>
                  {nouvelleCat && <tr><td colSpan={colSpan} className="sticky left-0 !bg-amber-100 !px-3 !py-1.5 text-xs font-bold tracking-wide text-amber-900">{r.categorie}</td></tr>}
                  <tr className="even:bg-muted/25 hover:bg-accent/40" data-article={r.designation}>
                    <td className="sticky left-0 z-10 bg-background px-3 font-medium">
                      {r.lien ? <Link href={`/stock/catalogue/${r.id}`} className="text-primary hover:underline">{r.designation}</Link> : r.designation}
                    </td>
                    {jours.map((j, i) => {
                      const c = r.cmd[i]!, l = r.liv[i]!, ecartCL = c !== l && (c > 0 || l > 0);
                      const ecart = r.ecarts[i] ?? null;
                      return (
                        <Fragment key={j.iso}>
                          <td className={`text-right font-medium tabular-nums text-emerald-700 ${ecartCL ? "bg-orange-50" : ""}`}>{c > 0 ? qte(c) : ""}</td>
                          <td className={`text-right font-medium tabular-nums text-red-700 ${ecartCL ? "bg-orange-100" : ""}`}>{l > 0 ? qte(l) : ""}</td>
                          <td
                            className={`text-right tabular-nums text-indigo-700 ${ecart ? FOND_ECART[ecart] : ""}`}
                            data-ecart={ecart ?? undefined}
                            title={ecart ? LIBELLE_ECART[ecart] : undefined}
                          >
                            {qteConso(r.conso[i] ?? null)}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="text-right font-semibold tabular-nums text-emerald-700">{totC > 0 ? qte(totC) : ""}</td>
                    <td className="text-right font-semibold tabular-nums text-red-700">{totL > 0 ? qte(totL) : ""}</td>
                    <td className="text-right font-semibold tabular-nums text-indigo-700">{qteConso(totalConso(r.conso))}</td>
                  </tr>
                </Fragment>
              );
            })}
            {lignes.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">Aucune commande, livraison ni consommation cette semaine.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
      }
    />
  );
}

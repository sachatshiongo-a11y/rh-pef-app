"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import Decimal from "decimal.js";
import { qte } from "@/lib/stock";
import { LIBELLE_ECART, aUnEcart, ecartConsoLivre, ecartLivreCommande, livreDiffereDuCommande, type LigneComparaison } from "@/lib/journalier-restaurant";
import { FOND_ECART, PASTILLE_ECART, qteConso } from "./comparaison-format";

// Onglet « Comparaison », tableau de la semaine (ordinateur ; téléphone en « Vue semaine ») :
// articles × 7 jours, trois colonnes par jour — Cmd (commandé), Livré (au restaurant), Conso
// (consommé au restaurant) — puis le total de la semaine, figé à droite. Lecture :
//  - deux niveaux d'en-tête (le jour et sa date, puis Cmd / Livré / Conso), figés en haut ;
//  - un filet marqué et un fond alterné séparent les jours ; l'article reste figé à gauche ;
//  - chaque écart porte sa couleur ET son signe (« -1 », « +2 ») : jamais la couleur seule ;
//  - cases vides pour 0 (commandé, livré), « — » pour un consommé inconnu, « 0 » discret pour un consommé nul.
// Aucun chiffre n'est recalculé ici : mêmes lignes que l'export, seule la présentation change.

type Jour = { iso: string; label: string };

/** Total consommé : seulement si chaque jour est connu, sinon « — » (jamais un total partiel). */
const totalConso = (vs: (string | null)[]) => (vs.some((v) => v === null) ? null : vs.reduce((t, v) => t.plus(v!), new Decimal(0)).toString());

/** « Lun 21 » -> jour « Lun » et date « 21 » (deux lignes de l'en-tête) ; un libellé sans espace reste entier. */
const decouperJour = (label: string): [string, string] => {
  const i = label.indexOf(" ");
  return i < 0 ? [label, ""] : [label.slice(0, i), label.slice(i + 1)];
};

const FILET_JOUR = "border-l-2 border-l-foreground/25";
const bande = (i: number) => (i % 2 === 1 ? "bg-muted/60" : "");
// Fond de l'en-tête d'un jour : opaque (les lignes défilent dessous), alterné comme les bandes du corps.
const ENTETE_JOUR = ["bg-muted", "bg-muted bg-linear-to-b from-foreground/10 to-foreground/10"];
const LARGEUR_TOTAL = "w-[3.75rem] min-w-[3.75rem] max-w-[3.75rem]";
const ROLES = [
  { court: "Cmd", titre: "Commandé par le restaurant", couleur: "text-emerald-700" },
  { court: "Livré", titre: "Livré au restaurant (sorties « Livraison restaurant »)", couleur: "text-red-700" },
  { court: "Conso", titre: "Consommé au restaurant (comptages du restaurant)", couleur: "text-indigo-700 dark:text-indigo-300" },
] as const;
/** Fixation à droite des trois colonnes du total (Cmd, Livré, Conso). */
// 0,05 rem de recouvrement entre voisines : sans lui, un liseré des colonnes qui défilent dessous apparaît à l'arrondi.
const DROITE_TOTAL = ["right-[7.4rem]", "right-[3.7rem]", "right-0"] as const;

function Pastille({ nature, signe, titre }: { nature: keyof typeof PASTILLE_ECART; signe: string; titre: string }) {
  return (
    <span data-signe={signe} title={titre} aria-label={`${signe} : ${titre}`} className={`mr-0.5 inline-block rounded px-0.5 text-[11px] font-bold leading-4 ${PASTILLE_ECART[nature]}`}>
      {signe}
    </span>
  );
}

export function ComparaisonSemaine({ jours, lignes, sansMotif }: { jours: Jour[]; lignes: LigneComparaison[]; sansMotif: number }) {
  const [seulementEcarts, setSeulementEcarts] = useState(false);
  const nbEcarts = useMemo(() => lignes.filter(aUnEcart).length, [lignes]);
  const affichees = useMemo(() => (seulementEcarts ? lignes.filter(aUnEcart) : lignes), [lignes, seulementEcarts]);
  const colSpan = jours.length * 3 + 4;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={seulementEcarts} onChange={(e) => setSeulementEcarts(e.target.checked)} className="h-4 w-4" />
          Afficher seulement les écarts
          <span className="font-normal text-muted-foreground" data-compte-ecarts>
            ({nbEcarts} article(s) sur {lignes.length})
          </span>
        </label>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Légende des écarts">
          <li className="flex items-center"><Pastille nature="LIVRE_NON_CONSOMME" signe="-1" titre={LIBELLE_ECART.LIVRE_NON_CONSOMME} />{LIBELLE_ECART.LIVRE_NON_CONSOMME}</li>
          <li className="flex items-center"><Pastille nature="CONSOMME_PLUS_QUE_LIVRE" signe="+1" titre={LIBELLE_ECART.CONSOMME_PLUS_QUE_LIVRE} />{LIBELLE_ECART.CONSOMME_PLUS_QUE_LIVRE}</li>
          <li className="flex items-center"><Pastille nature="LIVRE_DIFFERE" signe="+2" titre="livré différent du commandé" />livré ≠ commandé</li>
          <li title="Conso vient des comptages du restaurant : « — » quand le jour n'a pas été compté">« — » : jour sans comptage</li>
        </ul>
      </div>
      {sansMotif > 0 && (
        <p className="text-xs text-amber-800">
          {sansMotif}{" "}article(s) sorti(s) du dépôt sans motif cette semaine : ni livrés au restaurant, ni pertes, ils ne comptent pas dans « Livré » (voir l&apos;onglet Consommation).
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-separate border-spacing-0 text-sm" data-table="comparaison">
          <thead className="bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b-0 [&>th]:px-2 [&>th]:pt-2 [&>th]:pb-0.5 [&>th]:font-semibold">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-[13rem] border-r bg-muted px-3 align-bottom !pb-2">Article</th>
              {jours.map((j, i) => {
                const [nom, date] = decouperJour(j.label);
                return (
                  <th key={j.iso} colSpan={3} data-jour={j.iso} className={`!text-center leading-tight ${FILET_JOUR} ${ENTETE_JOUR[i % 2]}`}>
                    {nom}
                    {date && <span className="block text-xs font-normal text-muted-foreground">{date}</span>}
                  </th>
                );
              })}
              <th colSpan={3} data-jour="total" className={`sticky right-0 z-30 !text-center leading-tight ${FILET_JOUR} ${ENTETE_JOUR[jours.length % 2]}`}>
                Total
                <span className="block text-xs font-normal text-muted-foreground">semaine</span>
              </th>
            </tr>
            <tr className="[&>th]:border-b [&>th]:px-1 [&>th]:pb-1.5 [&>th]:pt-0 [&>th]:text-xs [&>th]:font-semibold">
              {[...jours.map((j) => j.iso), "total"].map((k, i) => (
                <Fragment key={k}>
                  {ROLES.map((r, ri) => (
                    <th
                      key={r.court}
                      title={r.titre}
                      data-role-colonne={r.court}
                      className={`!text-right ${r.couleur} ${ri === 0 ? FILET_JOUR : ""} ${ENTETE_JOUR[i % 2]} ${k === "total" ? `sticky z-30 ${LARGEUR_TOTAL} ${DROITE_TOTAL[ri]}` : ""}`}
                    >
                      {r.court}
                    </th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-1 [&>tr>td]:py-1.5 [&>tr>td]:whitespace-nowrap">
            {affichees.map((r, ri) => {
              const nouvelleCat = ri === 0 || affichees[ri - 1]!.categorie !== r.categorie;
              const totC = r.cmd.reduce((a, b) => a + b, 0), totL = r.liv.reduce((a, b) => a + b, 0);
              return (
                <Fragment key={r.id}>
                  {nouvelleCat && (
                    <tr data-rubrique={r.categorie}>
                      <td className="sticky left-0 z-10 min-w-[13rem] !whitespace-normal border-r bg-amber-100 !px-3 !py-1.5 text-xs font-bold tracking-wide text-amber-900">{r.categorie}</td>
                      <td colSpan={colSpan - 1} className="bg-amber-100" />
                    </tr>
                  )}
                  <tr className="group" data-article={r.designation}>
                    <td className="sticky left-0 z-10 min-w-[13rem] !whitespace-normal border-r bg-background px-3 font-medium group-hover:brightness-95">
                      {r.lien ? <Link href={`/stock/catalogue/${r.id}`} className="text-primary hover:underline">{r.designation}</Link> : r.designation}
                    </td>
                    {jours.map((j, i) => {
                      const c = r.cmd[i]!, l = r.liv[i]!, ecartCL = livreDiffereDuCommande(c, l);
                      const ecart = r.ecarts[i] ?? null;
                      const signeCL = ecartCL ? ecartLivreCommande(c, l) : null;
                      const signeCs = ecart ? ecartConsoLivre(l, r.conso[i] ?? null) : null;
                      const conso = qteConso(r.conso[i] ?? null);
                      const fond = bande(i);
                      return (
                        <Fragment key={j.iso}>
                          <td className={`text-right font-medium tabular-nums text-emerald-700 group-hover:brightness-95 ${FILET_JOUR} ${ecartCL ? "bg-orange-50" : fond}`}>{c > 0 ? qte(c) : ""}</td>
                          <td className={`text-right font-medium tabular-nums text-red-700 group-hover:brightness-95 ${ecartCL ? "bg-orange-100" : fond}`} data-ecart-livre={ecartCL ? "LIVRE_DIFFERE" : undefined}>
                            {signeCL && <Pastille nature="LIVRE_DIFFERE" signe={signeCL} titre="livré différent du commandé" />}
                            <span data-valeur>{l > 0 ? qte(l) : ""}</span>
                          </td>
                          <td
                            className={`text-right tabular-nums text-indigo-700 group-hover:brightness-95 dark:text-indigo-300 ${ecart ? FOND_ECART[ecart] : fond}`}
                            data-ecart={ecart ?? undefined}
                            title={ecart ? LIBELLE_ECART[ecart] : undefined}
                          >
                            {ecart && signeCs && <Pastille nature={ecart} signe={signeCs} titre={LIBELLE_ECART[ecart]} />}
                            <span data-valeur className={conso === "0" && !ecart ? "text-muted-foreground" : ""}>{conso}</span>
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className={`sticky z-10 bg-muted text-right font-semibold tabular-nums text-emerald-700 ${FILET_JOUR} ${LARGEUR_TOTAL} ${DROITE_TOTAL[0]}`}>{totC > 0 ? qte(totC) : ""}</td>
                    <td className={`sticky z-10 bg-muted text-right font-semibold tabular-nums text-red-700 ${LARGEUR_TOTAL} ${DROITE_TOTAL[1]}`}>{totL > 0 ? qte(totL) : ""}</td>
                    <td className={`sticky z-10 bg-muted text-right font-semibold tabular-nums text-indigo-700 dark:text-indigo-300 ${LARGEUR_TOTAL} ${DROITE_TOTAL[2]}`}>{qteConso(totalConso(r.conso))}</td>
                  </tr>
                </Fragment>
              );
            })}
            {lignes.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">Aucune commande, livraison ni consommation cette semaine.</td></tr>}
            {lignes.length > 0 && affichees.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">Aucun écart cette semaine.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Fragment } from "react";
import { qte } from "@/lib/stock";
import { formaterNombre } from "@/lib/montant";
import { texteConso, SECTION_SANS_MOTIF, type LigneConso, type LigneJours } from "@/lib/journalier-restaurant";
import { ECART_NEGATIF, type ConsommationReelle } from "@/lib/stock-restaurant";
import { useJourAffiche } from "@/components/selecteur-jour";
import { LigneJour, RubriqueJour, TitreJour } from "@/components/liste-jour";

// Onglet « Consommation » sur téléphone : ce qui sort du dépôt et ce que le restaurant consomme, pour
// le jour choisi dans le sélecteur du haut de page. Mêmes données que le tableau de la semaine
// (`TableConso`), en lecture seule ; « — » pour une consommation inconnue, jamais 0.

type Jour = { iso: string; label: string };
type Detail = Extract<ConsommationReelle, { etat: "CONNUE" }>;

const n3 = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 3 });

function Sorties({ rows, rang, lien }: { rows: LigneJours[]; rang: number; lien: boolean }) {
  return rows.filter((r) => (r.jours[rang] ?? 0) > 0).map((r) => (
    <LigneJour
      key={r.id}
      nom={lien ? <Link href={`/stock/catalogue/${r.id}`} className="text-primary hover:underline">{r.designation}</Link> : r.designation}
      droite={<span className="text-base font-semibold tabular-nums">{qte(r.jours[rang]!)}</span>}
    />
  ));
}

/** Ligne de consommation réelle : valeur à droite, et — sous le nom, visible sans survol — le calcul. */
function LigneConsoJour({ c, rang }: { c: LigneConso; rang: number }) {
  const j = c.jours[rang]!;
  if (j.etat !== "CONNUE") return null; // les jours sans comptage sont comptés à part, jamais affichés 0
  const d: Detail = j;
  return (
    <LigneJour
      nom={<>{c.designation}{c.unite && <span className="font-normal text-muted-foreground"> ({c.unite})</span>}</>}
      sous={
        <>
          <p className="text-xs text-muted-foreground">veille {n3(d.stockVeille)}{d.veilleEstimee ? " (estimée, aucun comptage)" : ""} + reçu {n3(d.recu)} − compté {n3(d.compte)}</p>
          {d.negative && <p className="text-xs font-medium text-red-700">{ECART_NEGATIF}</p>}
        </>
      }
      droite={
        <span className={`text-base font-semibold tabular-nums ${d.negative ? "text-red-700" : ""}`} aria-label={d.negative ? `${texteConso(d)} — ${ECART_NEGATIF}` : undefined}>
          {d.veilleEstimee ? "≈ " : ""}{texteConso(d)}
        </span>
      }
    />
  );
}

export function ConsoJour({ jours, sorties, legumes, consoResto }: {
  jours: Jour[];
  sorties: { livraisons: LigneJours[]; pertes: LigneJours[]; sansMotif: LigneJours[] };
  legumes: { nom: string; jours: number[]; total: number }[];
  consoResto: LigneConso[];
}) {
  const [rang] = useJourAffiche(jours.map((j) => j.iso));
  const jour = jours[rang]!;
  const duJour = (rows: LigneJours[]) => rows.filter((r) => (r.jours[rang] ?? 0) > 0);
  const livraisons = duJour(sorties.livraisons), pertes = duJour(sorties.pertes), sansMotif = duJour(sorties.sansMotif);
  const legumesJour = legumes.filter((l) => (l.jours[rang] ?? 0) > 0);
  const totalLivre = livraisons.reduce((t, r) => t + r.jours[rang]!, 0);
  const totalSansMotif = sansMotif.reduce((t, r) => t + r.jours[rang]!, 0);
  const conso = consoResto.filter((c) => c.jours[rang]?.etat === "CONNUE");
  const sansComptage = consoResto.length - conso.length;
  const vide = livraisons.length + pertes.length + sansMotif.length + legumesJour.length + conso.length === 0;
  return (
    <div data-vue-liste="conso" className="space-y-1">
      <TitreJour iso={jour.iso} />
      {livraisons.length > 0 && (
        <>
          <RubriqueJour ton="sky">Livré au restaurant</RubriqueJour>
          <Sorties rows={livraisons} rang={rang} lien />
          <p className="flex min-h-11 items-center justify-between rounded-md bg-muted/60 px-3 text-sm font-semibold"><span>Total livré au restaurant</span><span>{qte(totalLivre)}</span></p>
        </>
      )}
      {pertes.length > 0 && (<><RubriqueJour ton="rouge">Pertes (restent au dépôt)</RubriqueJour><Sorties rows={pertes} rang={rang} lien /></>)}
      {sansMotif.length > 0 && (
        <>
          <RubriqueJour ton="gris">{SECTION_SANS_MOTIF}</RubriqueJour>
          <Sorties rows={sansMotif} rang={rang} lien />
          <p className="flex min-h-11 items-center justify-between rounded-md bg-muted/60 px-3 text-sm font-semibold"><span>Total jour — sorties sans motif</span><span>{qte(totalSansMotif)}</span></p>
        </>
      )}
      {legumesJour.length > 0 && (
        <>
          <RubriqueJour ton="vert">Légumes frais (achats du jour)</RubriqueJour>
          {legumesJour.map((l) => <Fragment key={l.nom}><LigneJour nom={l.nom} droite={<span className="text-base font-semibold tabular-nums">{qte(l.jours[rang]!)}</span>} /></Fragment>)}
        </>
      )}
      {consoResto.length > 0 && (
        <>
          <RubriqueJour ton="indigo">Consommation réelle du restaurant</RubriqueJour>
          {conso.map((c) => <LigneConsoJour key={c.id} c={c} rang={rang} />)}
          {sansComptage > 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {sansComptage} article(s) sans consommation connue ce jour (« — ») : pas de comptage, stock de la veille inconnu ou livraison non additionnée.
            </p>
          )}
        </>
      )}
      {vide && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucune sortie ni comptage ce jour.</p>}
    </div>
  );
}

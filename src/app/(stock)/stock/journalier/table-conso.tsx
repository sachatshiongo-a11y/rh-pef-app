import Link from "next/link";
import { Fragment } from "react";
import { qte } from "@/lib/stock";
import { texteConso, totalConso, SECTION_CONSO, SECTION_LIVRE, SECTION_PERTES, SECTION_SANS_MOTIF, type LigneConso, type LigneJours } from "@/lib/journalier-restaurant";
import { ECART_NEGATIF, LIBELLE_CONSO_INCONNUE, type ConsommationReelle } from "@/lib/stock-restaurant";

// Onglet « Consommation » de la Conso. journalière : ce qui sort du dépôt, SÉPARÉ par motif (livré au
// restaurant, pertes, sans motif), les légumes frais, puis la consommation RÉELLE du restaurant
// (comptages). Composant de présentation (aucun état) : rendu côté serveur.

type Jour = { iso: string; label: string };

const EN_TETE_SECTION: Record<string, string> = {
  livre: "!bg-sky-100 text-sky-900",
  pertes: "!bg-red-100 text-red-900",
  sansMotif: "!bg-muted text-foreground",
  legumes: "!bg-emerald-100 text-emerald-900",
  conso: "!bg-indigo-100 text-indigo-900",
};

function Section({ titre, ton, colSpan }: { titre: string; ton: keyof typeof EN_TETE_SECTION; colSpan: number }) {
  return <tr><td colSpan={colSpan} className={`sticky left-0 !py-1.5 text-xs font-bold tracking-wide ${EN_TETE_SECTION[ton]}`}>{titre}</td></tr>;
}

function LignesSorties({ rows, lien }: { rows: LigneJours[]; lien: boolean }) {
  return rows.map((r) => (
    <tr key={r.id} className="hover:bg-accent/40 even:bg-muted/25">
      <td className="sticky left-0 z-10 bg-background font-medium">
        {lien ? <Link href={`/stock/catalogue/${r.id}`} className="text-primary hover:underline">{r.designation}</Link> : r.designation}
      </td>
      {r.jours.map((q, i) => <td key={i} className="text-right text-muted-foreground">{q > 0 ? qte(q) : ""}</td>)}
      <td className="text-right font-semibold">{qte(r.total)}</td>
    </tr>
  ));
}

function CelluleConso({ c }: { c: ConsommationReelle }) {
  if (c.etat === "INCONNUE") return <td className="text-right text-muted-foreground" title={LIBELLE_CONSO_INCONNUE[c.raison]}>—</td>;
  const detail = `veille ${c.stockVeille}${c.veilleEstimee ? " (estimée, aucun comptage)" : ""} + reçu ${c.recu} − compté ${c.compte}`;
  if (c.negative) {
    return (
      <td className="text-right font-medium text-red-700" title={`${ECART_NEGATIF} — ${detail}`} aria-label={`${texteConso(c)} — ${ECART_NEGATIF}`}>
        {texteConso(c)} <span className="text-[10px]">écart</span>
      </td>
    );
  }
  return <td className="text-right tabular-nums" title={detail}>{c.veilleEstimee ? "≈ " : ""}{texteConso(c)}</td>;
}

export function TableConso({ jours, sorties, legumes, consoResto }: {
  jours: Jour[];
  sorties: { livraisons: LigneJours[]; pertes: LigneJours[]; sansMotif: LigneJours[] };
  legumes: { nom: string; jours: number[]; total: number }[];
  consoResto: LigneConso[];
}) {
  const colSpan = jours.length + 2;
  const totauxLivres = jours.map((_, i) => sorties.livraisons.reduce((t, r) => t + r.jours[i]!, 0));
  const vide = sorties.livraisons.length + sorties.pertes.length + sorties.sansMotif.length + legumes.length + consoResto.length === 0;
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border">
      <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
          <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
            <th className="sticky left-0 z-30 bg-muted">Article</th>
            {jours.map((j) => <th key={j.iso} className="!text-right">{j.label}</th>)}
            <th className="!text-right">Total</th>
          </tr>
        </thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
          {sorties.livraisons.length > 0 && <><Section titre={SECTION_LIVRE} ton="livre" colSpan={colSpan} /><LignesSorties rows={sorties.livraisons} lien /></>}
          {sorties.pertes.length > 0 && <><Section titre={SECTION_PERTES} ton="pertes" colSpan={colSpan} /><LignesSorties rows={sorties.pertes} lien /></>}
          {sorties.sansMotif.length > 0 && <><Section titre={`${SECTION_SANS_MOTIF} — ni livrées au restaurant, ni pertes`} ton="sansMotif" colSpan={colSpan} /><LignesSorties rows={sorties.sansMotif} lien /></>}
          {legumes.length > 0 && (
            <>
              <Section titre="Légumes frais (achats du jour)" ton="legumes" colSpan={colSpan} />
              <LignesSorties rows={legumes.map((l) => ({ id: l.nom, designation: l.nom, jours: l.jours, total: l.total }))} lien={false} />
            </>
          )}
          {consoResto.length > 0 && (
            <>
              <Section titre={SECTION_CONSO} ton="conso" colSpan={colSpan} />
              {consoResto.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40 even:bg-muted/25">
                  <td className="sticky left-0 z-10 bg-background font-medium">{c.designation}{c.unite && <span className="font-normal text-muted-foreground"> ({c.unite})</span>}</td>
                  {c.jours.map((j, i) => <Fragment key={i}><CelluleConso c={j} /></Fragment>)}
                  <td className="text-right font-semibold" title="Total seulement si chaque jour a un comptage">{totalConso(c.jours)}</td>
                </tr>
              ))}
            </>
          )}
          {vide && <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">Aucune sortie ni comptage cette semaine.</td></tr>}
        </tbody>
        {sorties.livraisons.length > 0 && (
          <tfoot className="sticky bottom-0"><tr className="bg-muted/60 font-semibold [&>td]:px-3 [&>td]:py-2">
            <td className="sticky left-0 bg-muted/60">Total livré au restaurant</td>
            {totauxLivres.map((t, i) => <td key={i} className="text-right">{t > 0 ? qte(t) : ""}</td>)}
            <td className="text-right">{qte(totauxLivres.reduce((a, b) => a + b, 0))}</td>
          </tr></tfoot>
        )}
      </table>
    </div>
  );
}

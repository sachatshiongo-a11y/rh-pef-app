"use client";

import { EtatVide } from "@/components/etat-vide";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useBulkSelection, BulkBar } from "@/components/bulk-bar";
import { MoisAccordeon } from "@/components/mois-accordeon";
import { grouperParMois } from "@/lib/dates-fr";
import { validerBonsEnLot, supprimerBonsEnLot } from "./actions";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE } from "@/lib/stock";
import { estErreur } from "@/lib/action-lisible";
import { BoutonValider, BoutonDanger, BoutonNeutre } from "@/components/action-buttons";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ApercuDocumentBouton } from "@/components/apercu-document";
import { Pagination, usePagination } from "@/components/pagination";
import { tranche, type ParPage } from "@/lib/pagination";

export type BCRow = {
  id: string; numero: string; fournisseurId: string | null; fournisseurNom: string | null;
  date: string; nbLignes: number; total: number; statut: string; documentUrl: string | null;
};

/**
 * `sansFournisseur` : la liste est celle d'UN fournisseur (sa fiche) — son nom est celui de la page,
 * on ne le répète pas à chaque ligne. `suffixeRetour` : « ?retour=… » ajouté au lien du bon pour que
 * son « ← Retour » revienne à la fiche, sur le bon onglet.
 * `paginer` (écran Bons de commande, 2026-10-08) : 50 / 100 / Tout par page, page et taille dans l'URL. Tous les
 * bons du filtre sont chargés : les mois gardent leur compteur et leur total sur TOUT le filtre et ne montrent que
 * les lignes de la page ; « Tout sélectionner » = la page, un lien prend tout le filtre.
 */
export function CommandesListe({ commandes, estDirection, sansFournisseur = false, suffixeRetour = "", paginer = false, pageInit = 1, parInit = 50, cleFiltre = "" }: { commandes: BCRow[]; estDirection: boolean; sansFournisseur?: boolean; suffixeRetour?: string; paginer?: boolean; pageInit?: number; parInit?: ParPage; /** Filtres de la page : la page repart à 1 quand ils changent, pas après une action groupée. */ cleFiltre?: string }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const pagination = usePagination({ total: commandes.length, pageInit, parInit: paginer ? parInit : "tout", cleFiltre, synchroUrl: paginer });
  const { debut: debutPage, fin: finPage } = pagination;
  const pageCommandes = useMemo(() => (paginer ? tranche(commandes, { debut: debutPage, fin: finPage }) : commandes), [paginer, commandes, debutPage, finPage]);
  const idsPage = new Set(pageCommandes.map((c) => c.id));
  const cocheesPage = pageCommandes.reduce((t, c) => t + (sel.has(c.id) ? 1 : 0), 0);
  const brouillons = ids.filter((id) => commandes.some((c) => c.id === id && c.statut === "BROUILLON"));
  const run = (fn: () => Promise<unknown>) => { setErreur(null); start(async () => { const r = await fn(); if (estErreur(r)) { setErreur(r.erreur); return; } clear(); router.refresh(); /* la fiche d'un fournisseur n'est pas revalidée par ces actions */ }); };
  const pdfLien = (c: BCRow) => c.documentUrl
    ? <ApercuDocumentBouton href={c.documentUrl} titre={`Bon de commande ${c.numero} (PDF d'origine)`} libelle="PDF" className="text-primary underline" />
    : c.statut !== "BROUILLON" && c.statut !== "ANNULE" ? <TelechargerLien href={`/stock/commandes/${c.id}/pdf`} className="text-primary underline">PDF</TelechargerLien> : null;

  return (
    <div className="space-y-2">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {estDirection && commandes.length > 0 && (
        <BulkBar
          count={sel.size} total={pageCommandes.length} cochesAffichees={cocheesPage}
          libelleTout={pageCommandes.length < commandes.length ? "Tout sélectionner (cette page)" : "Tout sélectionner"}
          onAll={(on) => setAll(on ? [...sel, ...pageCommandes.map((c) => c.id)] : [...sel].filter((id) => !idsPage.has(id)), true)}
        >
          {pageCommandes.length < commandes.length && cocheesPage === pageCommandes.length && sel.size < commandes.length && (
            <button type="button" data-tout-le-filtre="proposer" onClick={() => setAll(commandes.map((c) => c.id), true)} className="text-xs font-medium text-primary underline">
              Sélectionner les {commandes.length} bons du filtre
            </button>
          )}
          <BoutonValider disabled={isPending || brouillons.length === 0} onClick={() => run(() => validerBonsEnLot(brouillons))}>{`Valider (${brouillons.length})`}</BoutonValider>
          <BoutonDanger disabled={isPending} onClick={() => { if (confirm(`Supprimer ${sel.size} bon(s) de commande ?`)) run(() => supprimerBonsEnLot(ids)); }}>✕ Supprimer ({sel.size})</BoutonDanger>
          <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}

      {commandes.length === 0 ? (
        <EtatVide message="Aucun bon de commande pour ce filtre." />
      ) : (
        grouperParMois(commandes, (c) => c.date).filter((g) => g.items.some((c) => idsPage.has(c.id))).map((g, i) => {
          const affichees = g.items.filter((c) => idsPage.has(c.id));
          return (
          <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} bon(s)${affichees.length < g.items.length ? ` · ${affichees.length} affiché(s)` : ""}`} resume={usd(g.items.reduce((t, c) => t + c.total, 0))} defaultOpen={i === 0}>
            <ul className="divide-y border-t text-sm">
              {affichees.map((c) => (
                <li key={c.id} className={`flex items-center gap-2 px-3 py-1.5 ${sel.has(c.id) ? "bg-primary/10" : "hover:bg-accent/40"}`}>
                  {estDirection && <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="shrink-0" aria-label={`Sélectionner ${c.numero}`} />}
                  <div className="min-w-0 flex-1">
                    <Link href={`/stock/commandes/${c.id}${suffixeRetour}`} className="font-medium text-primary hover:underline">{c.numero}</Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {!sansFournisseur && <>{c.fournisseurId ? <Link href={`/stock/fournisseurs/${c.fournisseurId}`} className="text-primary hover:underline">{c.fournisseurNom}</Link> : (c.fournisseurNom ?? "—")} · </>}{new Date(c.date).toLocaleDateString("fr-FR")} · {c.nbLignes} ligne(s)
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[c.statut]}`}>{STATUT_BC_LABEL[c.statut]}</span>
                    <span className="font-semibold tabular-nums">{usd(c.total)}</span>
                    {pdfLien(c)}
                  </span>
                </li>
              ))}
            </ul>
          </MoisAccordeon>
          );
        })
      )}
      {paginer && <Pagination className="pt-2" total={commandes.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="bons de commande" />}
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { validerDemandes, refuserDemandes, retirerMaDemande, type BilanDecision } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonApprouver, BoutonRefuser, BoutonNeutre } from "@/components/action-buttons";
import type { ApercuDemande } from "@/lib/validations-stock/apercu";
import { NATURE_LIBELLE, type NatureDemande } from "@/lib/validations-stock/charge";
import { AlertesDemande, DetailDemande } from "./detail-demande";
import { MOTIFS_SORTIE } from "@/lib/motif-sortie";

const ORDRE: NatureDemande[] = ["PAIEMENT_FACTURE", "RECONCILIATION", "MOUVEMENT_MANUEL", "MODIF_ARTICLE"];
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

/**
 * File des demandes en attente, regroupées par nature. Direction : cases à cocher + barre d'actions
 * groupées (Valider / Refuser avec UN motif), et les mêmes gestes ligne par ligne. Autre compte : ses
 * propres demandes, qu'il peut retirer. Chaque demande est décidée dans SA transaction : le bilan
 * nomme celles qui n'ont pas pu l'être (demande périmée…) au lieu de vider la sélection en silence.
 */
export function DemandesAValider({ demandes, estDirection }: { demandes: ApercuDemande[]; estDirection: boolean }) {
  const [isPending, start] = useTransition();
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const [refusLot, setRefusLot] = useState(false);
  const [motifLot, setMotifLot] = useState("");
  const [refusUn, setRefusUn] = useState<string | null>(null);
  const [motifUn, setMotifUn] = useState("");
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(demandes.filter((d) => d.paiement).map((d) => [d.id, d.paiement!.date])));
  // Motif choisi pour une ANCIENNE demande de sortie : obligatoire pour la valider (2026-10-07).
  const [motifs, setMotifs] = useState<Record<string, { categorie: string; raison: string }>>({});
  const motifsDe = (liste: string[]) => Object.fromEntries(liste.flatMap((id) => (motifs[id] ? [[id, motifs[id]]] : [])));
  const estSortie = (d: ApercuDemande) => d.nature === "MOUVEMENT_MANUEL" && d.mouvement?.type === "SORTIE";
  const motifIncomplet = (d: ApercuDemande) => estSortie(d) && (!motifs[d.id]?.categorie || (motifs[d.id].categorie === "PERTE" && !motifs[d.id].raison.trim()));
  const [erreur, setErreur] = useState<string | null>(null);
  const [bilan, setBilan] = useState<{ ok: string; echecs: string[] } | null>(null);

  const resume = useMemo(() => new Map(demandes.map((d) => [d.id, d.resume])), [demandes]);
  // Version AFFICHÉE de chaque demande : la décision porte sur elle, pas sur une retouche ultérieure.
  const versionsDe = (liste: string[]) => Object.fromEntries(liste.flatMap((id) => { const d = demandes.find((x) => x.id === id); return d ? [[id, d.version]] : []; }));
  const groupes = ORDRE.map((n) => ({ nature: n, items: demandes.filter((d) => d.nature === n) })).filter((g) => g.items.length > 0);

  const decider = (fn: () => Promise<BilanDecision | { erreur: string }>, verbe: string, apres?: () => void) => {
    setErreur(null); setBilan(null);
    start(async () => {
      const r = await fn();
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setBilan({
        ok: r.traitees.length ? `${r.traitees.length} demande${r.traitees.length > 1 ? "s" : ""} ${verbe}${r.traitees.length > 1 ? "s" : ""}.` : "",
        echecs: r.echecs.map((e) => `« ${resume.get(e.id) ?? "Demande"} » : ${e.erreur}`),
      });
      clear();
      apres?.();
    });
  };
  // Date de paiement de chaque demande sélectionnée : celle que la Direction a corrigée, sinon la
  // date proposée (une demande arrivée après l'ouverture de la page n'est pas dans `dates`).
  const proposee = useMemo(() => new Map(demandes.filter((d) => d.paiement).map((d) => [d.id, d.paiement!.date])), [demandes]);
  const datesDe = (liste: string[]) => Object.fromEntries(liste.flatMap((id) => { const v = dates[id] ?? proposee.get(id); return v ? [[id, v]] : []; }));

  if (demandes.length === 0) {
    return <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">{estDirection ? "Aucune demande en attente." : "Vous n'avez aucune demande en attente."}</p>;
  }

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {bilan && (bilan.ok || bilan.echecs.length > 0) && (
        <div className="space-y-1">
          {bilan.ok && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{bilan.ok}</p>}
          {bilan.echecs.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">Non traitée{bilan.echecs.length > 1 ? "s" : ""} :</p>
              <ul className="list-disc pl-4">{bilan.echecs.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {estDirection && (
        <BulkBar count={sel.size} total={demandes.length} onAll={(on) => setAll(demandes.map((d) => d.id), on)}>
          {!refusLot ? (
            <>
              <BoutonApprouver disabled={isPending} onClick={() => decider(() => validerDemandes(ids, datesDe(ids), versionsDe(ids), motifsDe(ids)), "validée")}>Valider ({sel.size})</BoutonApprouver>
              <BoutonRefuser disabled={isPending} onClick={() => setRefusLot(true)}>Refuser ({sel.size})</BoutonRefuser>
              <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
            </>
          ) : (
            <>
              <input value={motifLot} onChange={(e) => setMotifLot(e.target.value)} autoFocus placeholder="Motif du refus (obligatoire)" aria-label="Motif du refus" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm sm:w-64 sm:flex-none" />
              <BoutonRefuser disabled={isPending || motifLot.trim().length < 3} onClick={() => decider(() => refuserDemandes(ids, motifLot, versionsDe(ids)), "refusée", () => { setRefusLot(false); setMotifLot(""); })}>Confirmer le refus ({sel.size})</BoutonRefuser>
              <BoutonNeutre onClick={() => { setRefusLot(false); setMotifLot(""); }}>Annuler</BoutonNeutre>
            </>
          )}
        </BulkBar>
      )}

      {groupes.map((g) => (
        <section key={g.nature} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{NATURE_LIBELLE[g.nature]} ({g.items.length})</h2>
          <ul className="space-y-2">
            {g.items.map((d) => (
              <li key={d.id} className={`rounded-lg border p-3 ${sel.has(d.id) ? "bg-primary/5" : "bg-card"}`}>
                <div className="flex items-start gap-3">
                  {estDirection && <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} className="mt-1 h-4 w-4 shrink-0" aria-label={`Sélectionner : ${d.resume}`} />}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="font-medium">{d.resume}</p>
                      <p className="text-xs text-muted-foreground">Demandé par {d.auteurNom} le {quand(d.creeLe)}</p>
                    </div>
                    <AlertesDemande a={d} />
                    <details className="group" open={g.nature !== "RECONCILIATION" || undefined}>
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
                        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span> Détail
                      </summary>
                      <div className="mt-2"><DetailDemande a={d} /></div>
                    </details>
                    <div className="flex flex-wrap items-end gap-2">
                      {estDirection && d.paiement && (
                        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date de paiement
                          <input type="date" value={dates[d.id] ?? d.paiement.date} max={jourKinshasaISO()} onChange={(e) => setDates((x) => ({ ...x, [d.id]: e.target.value }))} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                        </label>
                      )}
                      {estDirection && estSortie(d) && (
                        <>
                          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Motif de la sortie (obligatoire)
                            <select value={motifs[d.id]?.categorie ?? ""} aria-invalid={motifIncomplet(d) || undefined} onChange={(e) => setMotifs((x) => ({ ...x, [d.id]: { categorie: e.target.value, raison: x[d.id]?.raison ?? "" } }))} className={`rounded-md border bg-background px-2 py-1.5 text-sm ${motifIncomplet(d) ? "border-amber-500" : "border-input"}`}>
                              <option value="">— motif —</option>
                              {Object.entries(MOTIFS_SORTIE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </label>
                          {motifs[d.id]?.categorie === "PERTE" && (
                            <label className="flex flex-col gap-1 text-xs text-muted-foreground">Raison de la perte
                              <input value={motifs[d.id]?.raison ?? ""} onChange={(e) => setMotifs((x) => ({ ...x, [d.id]: { categorie: "PERTE", raison: e.target.value } }))} placeholder="Obligatoire" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                            </label>
                          )}
                        </>
                      )}
                      {estDirection && refusUn !== d.id && (
                        <>
                          <BoutonApprouver disabled={isPending || d.illisible || motifIncomplet(d)} onClick={() => decider(() => validerDemandes([d.id], datesDe([d.id]), versionsDe([d.id]), motifsDe([d.id])), "validée")}>Valider</BoutonApprouver>
                          <BoutonRefuser disabled={isPending} onClick={() => { setRefusUn(d.id); setMotifUn(""); }}>Refuser</BoutonRefuser>
                        </>
                      )}
                      {estDirection && refusUn === d.id && (
                        <>
                          <input value={motifUn} onChange={(e) => setMotifUn(e.target.value)} autoFocus placeholder="Motif du refus (obligatoire)" aria-label="Motif du refus" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                          <BoutonRefuser disabled={isPending || motifUn.trim().length < 3} onClick={() => decider(() => refuserDemandes([d.id], motifUn, versionsDe([d.id])), "refusée", () => setRefusUn(null))}>Confirmer le refus</BoutonRefuser>
                          <BoutonNeutre onClick={() => setRefusUn(null)}>Annuler</BoutonNeutre>
                        </>
                      )}
                      {!estDirection && (
                        <>
                          <span className="text-xs font-medium text-amber-700">En attente de la Direction</span>
                          <BoutonNeutre disabled={isPending} onClick={() => { if (confirm("Retirer cette demande ? Rien n'aura été fait.")) { setErreur(null); start(async () => { const r = await retirerMaDemande(d.id); if (estErreur(r)) setErreur(r.erreur); }); } }}>Retirer ma demande</BoutonNeutre>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

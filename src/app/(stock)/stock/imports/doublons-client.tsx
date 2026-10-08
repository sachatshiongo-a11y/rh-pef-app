"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { detecterDoublonsAction, retirerDoublonsAction } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonDanger, BoutonNeutre } from "@/components/action-buttons";
import { qte } from "@/lib/stock";
import type { ApercuDoublons, LotImport, MvtDoublon } from "@/lib/doublons-imports";
import { ListePaginee } from "./liste-paginee";
import { Pagination, usePagination } from "@/components/pagination";
import { tranche } from "@/lib/pagination";

// Outil « Retirer les mouvements en double » (Direction). Règle : on GARDE la copie de l'import de
// MOUVEMENTS, on RETIRE celle de l'import d'INVENTAIRE. Le stock ne bouge pas : l'inventaire l'a
// posé en valeur absolue ; seul l'historique était doublé.

const jj = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const TYPE_LABEL: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie" };
const TYPE_CLASSE: Record<string, string> = { ENTREE: "bg-emerald-100 text-emerald-800", SORTIE: "bg-red-100 text-red-800" };

function Mouvement({ m }: { m: MvtDoublon }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Link href={`/stock/catalogue/${m.articleId}`} className="min-w-0 break-words font-medium text-primary hover:underline">{m.article}</Link>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_CLASSE[m.type] ?? "bg-muted"}`}>{TYPE_LABEL[m.type] ?? m.type}</span>
      <span className="text-sm tabular-nums">{qte(m.quantite)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{jj(m.date)}</span>
    </span>
  );
}

function ListeSeuls({ titre, aide, mvts }: { titre: string; aide: string; mvts: MvtDoublon[] }) {
  if (mvts.length === 0) return null;
  return (
    <details className="rounded-md border p-2 text-sm">
      <summary className="cursor-pointer font-medium">{titre} ({mvts.length})</summary>
      <p className="mt-1 text-xs text-muted-foreground">{aide}</p>
      <ListePaginee items={mvts} libelle="mouvements" className="mt-1 divide-y" ligne={(m) => (
        <li key={m.id} className="py-1.5"><Mouvement m={m} /><span className="block text-xs text-muted-foreground">{m.libelle}</span></li>
      )} />
    </details>
  );
}

export function DoublonsClient({ inventaires, mouvements, defaut }: {
  inventaires: LotImport[];
  mouvements: LotImport[];
  defaut: { inventaireId: string | null; mouvementsIds: string[] };
}) {
  const [inventaireId, setInventaireId] = useState(defaut.inventaireId ?? "");
  const [mvIds, setMvIds] = useState<Set<string>>(new Set(defaut.mouvementsIds));
  const [apercu, setApercu] = useState<ApercuDoublons | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();

  // Pagination des paires jumelles (50 / 100 / Tout). La page reste en état local : l'aperçu est éphémère.
  const nbPaires = apercu?.paires.length ?? 0;
  const pagination = usePagination({ total: nbPaires, cleFiltre: apercu ? `${apercu.inventaire.id}|${nbPaires}` : "", synchroUrl: false });

  const basculerLot = (id: string) => setMvIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chercher = async () => {
    const a = await detecterDoublonsAction(inventaireId, [...mvIds]);
    clear();
    if (estErreur(a)) { setErreur(a.erreur); setApercu(null); return; }
    setApercu(a);
  };
  const rechercher = () => { setErreur(null); setSucces(null); start(chercher); };

  const retirer = () => {
    if (!apercu || ids.length === 0) return;
    const garde = apercu.mouvements.map((m) => `« ${m.libelle} »`).join(", ");
    if (!confirm(
      `Retirer ${ids.length} mouvement(s) en double de « ${apercu.inventaire.libelle} » ?\n\n` +
      `Leurs jumeaux restent dans ${garde}. Le stock n'est pas modifié, ni les légumes, ni les articles.`
    )) return;
    setErreur(null); setSucces(null);
    start(async () => {
      const r = await retirerDoublonsAction(apercu.inventaire.id, apercu.mouvements.map((m) => m.id), ids);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setSucces(r.message);
      await chercher(); // relancé : l'outil ne doit plus rien trouver pour ce qui a été retiré
    });
  };

  if (inventaires.length === 0 || mouvements.length === 0) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Il faut au moins un import d&apos;inventaire et un import de mouvements appliqués pour chercher des doublons.</p>;
  }

  const paires = apercu?.paires ?? [];
  const pairesPage = tranche(paires, pagination);
  const cocheesPage = pairesPage.reduce((t, p) => t + (sel.has(p.retire.id) ? 1 : 0), 0);
  const cocheesFiltre = paires.reduce((t, p) => t + (sel.has(p.retire.id) ? 1 : 0), 0);
  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <p className="text-sm text-muted-foreground">
          Un même mouvement (même article, date, type et quantité) importé deux fois, par un import de mouvements
          puis par un import d&apos;inventaire, compte deux fois dans l&apos;historique. L&apos;outil garde la copie de
          l&apos;import de mouvements et retire celle de l&apos;inventaire. <b className="text-foreground">Le stock ne bouge pas.</b>
        </p>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Import d&apos;inventaire — copies retirées</span>
          <select value={inventaireId} onChange={(e) => setInventaireId(e.target.value)} className="block w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
            {inventaires.map((l) => <option key={l.id} value={l.id}>{l.libelle} — {l.creeLe}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">Imports de mouvements — copies conservées</legend>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {mouvements.map((l) => (
              <li key={l.id}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={mvIds.has(l.id)} onChange={() => basculerLot(l.id)} />
                  <span className="min-w-0 break-words">{l.libelle} <span className="text-xs text-muted-foreground">— {l.creeLe}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <button type="button" onClick={rechercher} disabled={isPending || !inventaireId || mvIds.size === 0} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
          {isPending && !apercu ? "Recherche…" : "Rechercher les doublons"}
        </button>
      </div>

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {succes && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{succes}</p>}

      {apercu && (
        <div className="space-y-3 rounded-lg border p-3 sm:p-4">
          <h3 className="font-semibold">Aperçu — rien n&apos;est encore retiré</h3>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <Kpi label="Paires jumelles" val={paires.length} />
            <Kpi label="Sans jumeau — inventaire" val={apercu.sansJumeauInventaire.length} />
            <Kpi label="Sans jumeau — mouvements" val={apercu.sansJumeauMouvements.length} />
          </div>
          {apercu.controle.ecarts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Contrôle : après retrait, les entrées et sorties de chaque article comptent comme après un seul import
              ({apercu.controle.verifies} article·type vérifiés).
            </p>
          ) : (
            <details className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              <summary className="cursor-pointer font-medium">⚠ Contrôle : {apercu.controle.ecarts.length} écart(s) — ne retirez rien sans les comprendre</summary>
              <ul className="mt-1 list-disc pl-5">
                {apercu.controle.ecarts.map((e) => <li key={e.articleId + e.type}>{e.article} · {TYPE_LABEL[e.type] ?? e.type} : attendu {qte(e.attendu)}, obtenu {qte(e.obtenu)}</li>)}
              </ul>
            </details>
          )}

          {paires.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Aucun mouvement en double entre ces imports.</p>
          ) : (
            <>
              {/* « Tout sélectionner » = la page ; « Sélectionner les N paires » = toutes (la même liste d'identifiants part à l'action). */}
              <BulkBar count={sel.size} total={pairesPage.length} cochesAffichees={cocheesPage} libelleTout={paires.length > pairesPage.length ? "Tout sélectionner (cette page)" : "Tout sélectionner"}
                onAll={(on) => { if (on) setAll([...sel, ...pairesPage.map((p) => p.retire.id)], true); else setAll([...sel].filter((id) => !pairesPage.some((p) => p.retire.id === id)), true); }}>
                {paires.length > pairesPage.length && cocheesPage === pairesPage.length && cocheesFiltre < paires.length && (
                  <button type="button" data-tout-le-filtre="proposer" onClick={() => setAll(paires.map((p) => p.retire.id), true)} className="text-xs font-medium text-primary underline">
                    Sélectionner les {paires.length} paires
                  </button>
                )}
                <BoutonDanger disabled={isPending} onClick={retirer}>{isPending ? "Retrait…" : `✕ Retirer ${sel.size} mouvement(s) en double`}</BoutonDanger>
                <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
              </BulkBar>
              <ul className="divide-y rounded-lg border">
                {pairesPage.map((p) => (
                  <li key={p.retire.id} className="flex items-start gap-2 px-3 py-2">
                    <input type="checkbox" className="mt-1" checked={sel.has(p.retire.id)} onChange={() => toggle(p.retire.id)} aria-label={`Retirer la copie de ${p.retire.article} du ${jj(p.retire.date)}`} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <Mouvement m={p.retire} />
                      <p className="break-words text-xs text-muted-foreground">
                        <span className="text-red-700">Retirée :</span> {p.retire.libelle} · <span className="text-emerald-700">Gardée :</span> {p.garde.libelle}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination total={paires.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="paires" />
            </>
          )}

          <ListeSeuls
            titre="Sans jumeau dans l'inventaire — conservés"
            aide="Présents dans le classeur d'inventaire mais pas dans les imports de mouvements choisis : ils ne sont pas des doublons et restent en place. À vérifier."
            mvts={apercu.sansJumeauInventaire}
          />
          <ListeSeuls
            titre="Sans jumeau dans les imports de mouvements — conservés"
            aide="Présents dans les imports de mouvements mais pas dans le classeur d'inventaire : ils restent en place. À vérifier."
            mvts={apercu.sansJumeauMouvements}
          />
        </div>
      )}
    </div>
  );
}

function Kpi({ label, val }: { label: string; val: number }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{val}</p>
    </div>
  );
}

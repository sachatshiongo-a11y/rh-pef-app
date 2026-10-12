"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { creerFournisseur, fusionnerFournisseurs, supprimerFournisseursEnLot } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { estDoublonFournisseur, type DoublonFournisseur } from "@/lib/fournisseur-doublon";
import { ChoixFournisseurProche } from "@/components/stock/choix-fournisseur-proche";
import { normTexte } from "@/lib/texte";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsFournisseurs } from "@/lib/recherche-options";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonDanger, BoutonNeutre } from "@/components/action-buttons";
import { TelechargerLien } from "@/components/telecharger-lien";
import { Pagination, usePagination } from "@/components/pagination";
import { tranche, type ParPage } from "@/lib/pagination";
import { MAX_EXPORT_SELECTION } from "@/lib/export-selection";
import { ErreurAction } from "@/components/erreur-action";
import { EtatVide } from "@/components/etat-vide";

export type FournRow = {
  id: string; nom: string; contactNom: string; telephone: string; ville: string;
  rccm: string; idNational: string; delaiPaiement: string; delaiLivraison: string; nbArticles: number;
};
const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";

// Liste de fournisseurs : navigation pure (le nom mène à la fiche, où se fait l'édition).
// L'ajout et la fusion restent ici ; modifier/supprimer un fournisseur se fait sur sa fiche.
export function FournisseursClient({ fournisseurs, estDirection, pageInit = 1, parInit = 50 }: { fournisseurs: FournRow[]; estDirection: boolean; pageInit?: number; parInit?: ParPage }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const [ajout, setAjout] = useState(false);
  const [fusion, setFusion] = useState(false);
  const [source, setSource] = useState("");
  const [cible, setCible] = useState("");
  const [q, setQ] = useState("");
  // Anti-doublon : le fournisseur tapé ressemble (ou est identique) à un fournisseur existant — la saisie est gardée pour « Créer quand même ».
  const [doublon, setDoublon] = useState<{ saisie: [string, string][]; d: DoublonFournisseur } | null>(null);

  const tries = useMemo(() => [...fournisseurs].sort((a, b) => a.nom.localeCompare(b.nom, "fr")), [fournisseurs]);
  // Fusion : l'autre fournisseur choisi est retiré de la liste (il ne peut pas se fusionner avec lui-même).
  // Chaque option porte de quoi distinguer deux noms proches : ville, téléphone, nombre d'articles.
  const distinguables = useMemo(() => tries.map((f) => ({
    id: f.id, nom: f.nom,
    detail: [f.ville, f.telephone, f.nbArticles > 0 ? `${f.nbArticles} article${f.nbArticles > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · "),
  })), [tries]);
  const optionsSource = useMemo(() => optionsFournisseurs(distinguables.filter((f) => f.id !== cible)), [distinguables, cible]);
  const optionsCible = useMemo(() => optionsFournisseurs(distinguables.filter((f) => f.id !== source)), [distinguables, source]);
  const run = (fn: () => Promise<unknown>) => {
    setErreur(null);
    startTransition(async () => { const r = await fn(); if (estErreur(r)) setErreur(r.erreur); });
  };
  const creer = (saisie: [string, string][], quandMeme: boolean) => {
    setErreur(null);
    setDoublon(null);
    const fd = new FormData();
    for (const [k, v] of saisie) if (k !== "creerQuandMeme") fd.append(k, v);
    if (quandMeme) fd.append("creerQuandMeme", "1");
    startTransition(async () => {
      const r = await creerFournisseur(fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (estDoublonFournisseur(r)) { setDoublon({ saisie, d: r }); return; }
      setAjout(false);
    });
  };
  const fusionner = () => {
    const s = fournisseurs.find((f) => f.id === source);
    const c = fournisseurs.find((f) => f.id === cible);
    if (!s || !c || s.id === c.id) { setErreur("Choisissez deux fournisseurs différents."); return; }
    if (!confirm(`Fusionner « ${s.nom} » dans « ${c.nom} » ?\n\nTous les articles, bons de commande, factures et achats directs de « ${s.nom} » seront rattachés à « ${c.nom} », les coordonnées manquantes complétées, puis « ${s.nom} » sera supprimé. Action irréversible.`)) return;
    // Le panneau ne se ferme et la saisie ne se vide qu'une fois la fusion ACCEPTÉE : un refus du serveur reste affiché, choix gardés.
    run(async () => {
      const r = await fusionnerFournisseurs(s.id, c.id);
      if (!estErreur(r)) { setFusion(false); setSource(""); setCible(""); }
      return r;
    });
  };

  const visibles = useMemo(() => {
    const nq = normTexte(q.trim());
    const base = nq ? fournisseurs.filter((f) => normTexte(`${f.nom} ${f.contactNom} ${f.ville}`).includes(nq)) : fournisseurs;
    return [...base].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [fournisseurs, q]);

  // Pagination (50 / 100 / Tout) : tous les fournisseurs sont chargés, la recherche et les cases agissent sur TOUT l'ensemble.
  const pagination = usePagination({ total: visibles.length, pageInit, parInit, cleFiltre: q });
  const pageFournisseurs = tranche(visibles, { debut: pagination.debut, fin: pagination.fin });
  const idsPage = pageFournisseurs.map((f) => f.id);
  const cocheesPage = idsPage.filter((id) => sel.has(id)).length;
  const supprimerSelection = () => {
    if (!confirm(`Supprimer ${ids.length} fournisseur(s) ? Leurs articles, factures et bons de commande sont détachés (pas supprimés). Action irréversible.`)) return;
    setErreur(null); setInfo(null);
    startTransition(async () => {
      const r = await supprimerFournisseursEnLot(ids);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      const rapport = r as { traitees: number; echecs: string[] };
      clear();
      if (rapport.echecs.length > 0) setErreur(`${rapport.traitees} fournisseur(s) supprimé(s), ${rapport.echecs.length} refusé(s) — ${rapport.echecs.join(" · ")}`);
      else setInfo(`${rapport.traitees} fournisseur(s) supprimé(s).`);
    });
  };
  // Deux cochés : proposer de les fusionner (la fusion existante, préremplie ; c'est la Direction qui choisit lequel garder).
  const fusionnerCoches = () => { setFusion(true); setAjout(false); setSource(ids[0]); setCible(ids[1]); };

  return (
    <div className="space-y-3">
      <ErreurAction message={erreur} />
      {info && <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{info}</p>}
      {!estDirection && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Consultation — seule la Direction peut ajouter, modifier ou supprimer un fournisseur (modification depuis la fiche).</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom, contact, ville)…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        <span className="text-xs text-muted-foreground">{visibles.length} / {fournisseurs.length} fournisseur(s)</span>
        {estDirection && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => { setFusion((v) => !v); setAjout(false); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              {fusion ? "Fermer" : "⤵ Fusionner"}
            </button>
            <button onClick={() => { setAjout((v) => !v); setFusion(false); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              {ajout ? "Fermer" : "+ Ajouter un fournisseur"}
            </button>
          </div>
        )}
      </div>

      {fusion && estDirection && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-sm font-medium">Fusionner deux fournisseurs</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Le fournisseur à fusionner est supprimé ; ses articles, bons de commande et factures passent sur celui à conserver, dont les coordonnées manquantes sont complétées.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground">À fusionner (supprimé)
              <ChoixRecherche options={optionsSource} value={source} vide="— choisir —" onChange={setSource} aria-label="Fournisseur à fusionner (supprimé)" className="w-56 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <span className="pb-2 text-muted-foreground">→</span>
            <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground">À conserver
              <ChoixRecherche options={optionsCible} value={cible} vide="— choisir —" onChange={setCible} aria-label="Fournisseur à conserver" className="w-56 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <button onClick={fusionner} disabled={isPending || !source || !cible} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Fusionner</button>
          </div>
        </div>
      )}

      {ajout && estDirection && (
        <form onSubmit={(e) => { e.preventDefault(); creer([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)] as [string, string]), false); /* pas d'action de formulaire : elle viderait la saisie, gardée pour « Créer quand même » */ }} className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-4">
          <input name="nom" placeholder="Nom *" required className={inp} />
          <input name="contactNom" placeholder="Contact" className={inp} />
          <input name="telephone" placeholder="Téléphone" className={inp} />
          <input name="email" placeholder="Email" className={inp} />
          <input name="ville" placeholder="Ville" className={inp} />
          <input name="pays" placeholder="Pays" defaultValue="République démocratique du Congo" className={inp} />
          <input name="rccm" placeholder="RCCM" className={inp} />
          <input name="idNational" placeholder="ID National" className={inp} />
          <input name="delaiPaiement" placeholder="Délai paiement" className={inp} />
          <input name="delaiLivraison" placeholder="Délai livraison" className={inp} />
          <input name="modePaiement" placeholder="Mode paiement" className={inp} />
          <input name="produits" placeholder="Produits fournis" className={inp} />
          {doublon && (
            <div className="col-span-2 md:col-span-4">
              <ChoixFournisseurProche nom={doublon.d.nom} candidats={doublon.d.candidats} creationPossible={doublon.d.creationPossible} hrefUtiliser={(c) => `/stock/fournisseurs/${c.id}`}
                onCreer={() => creer(doublon.saisie, true)} desactive={isPending} />
            </div>
          )}
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer le fournisseur</button>
        </form>
      )}

      {visibles.length > 0 && (
        <BulkBar
          count={sel.size} total={pageFournisseurs.length} cochesAffichees={cocheesPage}
          libelleTout={pageFournisseurs.length < visibles.length ? "Tout sélectionner (cette page)" : "Tout sélectionner"}
          onAll={(on) => setAll(on ? [...new Set([...ids, ...idsPage])] : ids.filter((id) => !idsPage.includes(id)), true)}
        >
          {pageFournisseurs.length < visibles.length && cocheesPage === pageFournisseurs.length && sel.size < visibles.length && (
            <button type="button" data-tout-le-filtre="proposer" onClick={() => setAll(visibles.map((f) => f.id), true)} className="text-xs font-medium text-primary underline">
              Sélectionner les {visibles.length} fournisseurs
            </button>
          )}
          {ids.length > MAX_EXPORT_SELECTION ? (
            <button type="button" disabled className="rounded-md border px-3 py-1.5 text-sm font-medium opacity-60">Export : {MAX_EXPORT_SELECTION} fournisseurs au plus</button>
          ) : (
            <TelechargerLien href={`/stock/fournisseurs/export?ids=${ids.join(",")}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">⭳ Exporter ({ids.length})</TelechargerLien>
          )}
          {estDirection && ids.length === 2 && <BoutonNeutre onClick={fusionnerCoches}>⤵ Fusionner les 2</BoutonNeutre>}
          {estDirection && <BoutonDanger disabled={isPending} onClick={supprimerSelection}>✕ Supprimer ({ids.length})</BoutonDanger>}
          <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}

      {/* Liste : une case par fournisseur, le nom mène à sa fiche. */}
      <div className="divide-y overflow-hidden rounded-lg border">
        {pageFournisseurs.map((f) => (
          <div key={f.id} className={`flex items-center gap-2 pl-3 ${sel.has(f.id) ? "bg-primary/10" : "hover:bg-accent/40"}`}>
            <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="h-4 w-4 shrink-0" aria-label={`Sélectionner ${f.nom}`} />
            <Link href={`/stock/fournisseurs/${f.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2.5 pr-3">
              <div className="min-w-0">
                <div className="truncate font-medium text-primary">{f.nom}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[f.contactNom, f.telephone, f.ville].filter(Boolean).join(" · ") || "Coordonnées non renseignées"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-right">
                <span className="text-xs text-muted-foreground">{f.nbArticles} article(s)</span>
                <span aria-hidden className="text-muted-foreground">›</span>
              </div>
            </Link>
          </div>
        ))}
        {visibles.length === 0 && <EtatVide message="Aucun fournisseur." />}
      </div>
      <Pagination className="pt-2" total={visibles.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="fournisseurs" />
    </div>
  );
}

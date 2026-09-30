"use client";

import { Fragment, memo, useCallback, useState, useTransition } from "react";
import { majComptage, modifierArticleResto, creerArticleResto, supprimerArticleResto, rattacherArticleResto, changerActivationArticlesResto } from "./actions";
import type { JourResto } from "./semaine";
import { estErreur } from "@/lib/action-lisible";
import { ChoixArticleCatalogue, type OptionCatalogue } from "./choix-article";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { useJourAffiche } from "@/components/selecteur-jour";
import { VueJourOuSemaine } from "@/components/vue-jour-semaine";
import { CASE_JOUR, LigneJour, RubriqueJour, TitreJour } from "@/components/liste-jour";
import { lireSaisieNombre, MOTIF_HTML_DECIMAL_POSITIF } from "@/lib/nombre";
import { formaterNombre } from "@/lib/montant";
import { MENTION_AUCUN_COMPTAGE } from "@/lib/stock-restaurant";

const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : String(v));

export type Jour = JourResto;
export type LigneResto = {
  id: string;
  /** Désactivé : affiché seulement sur « Afficher les désactivés », grisé, sans saisie. */
  actif?: boolean; categorie: string | null; designation: string; unite: string | null;
  base: string; comptages: Record<string, string>; // iso → quantité
  /** Article du catalogue rattaché (disponibilité des plats) — posé par la Direction, jamais deviné. */
  articleStockId: string | null; articleStockDesignation: string | null;
  /** Reçu du dépôt par jour (iso → quantité, unité du restaurant) : LECTURE SEULE, dérivé des sorties. */
  recus: Record<string, string>;
  /** Livraisons du jour non additionnées (à répartir, unité incompatible), en clair. */
  signauxJour: Record<string, string[]>;
  /** Stock théorique à ce jour (dernier comptage + livraisons depuis) ; `stock` null = inconnu. */
  theorique: { stock: string | null; aucunComptage: boolean; signalements: string[] };
};

/** Quantité lisible (« 2 000 », « 0,5 ») : formatage partagé, espaces normalisées. */
const qteTexte = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 3 });

const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const cell = "w-16 rounded border border-input bg-background px-1 py-1 text-right text-xs";

export function RestaurantGrille({
  espace, jours, lignes, categories, estDirection, catalogue,
}: {
  espace: "CUISINE" | "BAR"; jours: Jour[]; lignes: LigneResto[]; categories: string[]; estDirection: boolean;
  catalogue: OptionCatalogue[];
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [isPending, start] = useTransition();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const listeId = `cats-${espace}`;
  // Rappels STABLES (les lignes sont mémoïsées : un nouveau rappel à chaque rendu les re-rendrait toutes).
  const basculer = useCallback((id: string) => setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const toutSelectionne = lignes.length > 0 && lignes.every((l) => selection.has(l.id));
  // Désactivation d'un article qui a encore du stock compté : le serveur n'écrit rien et renvoie
  // une confirmation qui nomme ce stock et sa conséquence ; « Désactiver quand même » la confirme.
  const [aConfirmer, setAConfirmer] = useState<{ ids: string[]; message: string } | null>(null);
  const activer = useCallback((ids: string[], actif: boolean, confirmer = false) => {
    setErreur(null);
    start(async () => {
      const r = await changerActivationArticlesResto(ids, actif, confirmer);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if ("aConfirmer" in r && r.aConfirmer) { setAConfirmer({ ids, message: r.message ?? "" }); return; }
      setAConfirmer(null);
      setSelection(new Set());
    });
  }, []);
  const nbCol = jours.length + (estDirection ? 7 : 5);

  const save = async (id: string, name: string, value: string) => {
    setErreur(null);
    const fd = new FormData(); fd.set(name, value);
    const r = await modifierArticleResto(id, fd);
    if (estErreur(r)) setErreur(r.erreur);
    return r; // une case numérique affiche aussi l'échec en rouge
  };
  const saveComptage = async (id: string, iso: string, value: string) => {
    setErreur(null);
    const r = await majComptage(id, iso, value);
    if (estErreur(r)) setErreur(r.erreur);
    return r;
  };
  const rattacher = async (id: string, articleStockId: string | null) => {
    setErreur(null);
    const r = await rattacherArticleResto(id, articleStockId);
    if (estErreur(r)) setErreur(r.erreur);
  };
  const run = (fn: () => Promise<unknown>) => { setErreur(null); start(async () => { const r = await fn(); if (estErreur(r)) setErreur(r.erreur); }); };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <datalist id={listeId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>

      <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent max-lg:min-h-11">{ajout ? "Fermer" : "+ Ajouter un article"}</button>
      {ajout && (
        <form action={(fd) => run(async () => { await creerArticleResto(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm md:grid-cols-5">
          <input type="hidden" name="espace" value={espace} />
          <input name="designation" placeholder="Désignation *" required className="rounded border border-input bg-background px-2 py-1" />
          <input name="categorie" list={listeId} placeholder="Catégorie" className="rounded border border-input bg-background px-2 py-1" />
          <input name="unite" placeholder="Unité" className="rounded border border-input bg-background px-2 py-1" />
          <input name="stockBaseJournalier" type="text" inputMode="decimal" pattern={MOTIF_HTML_DECIMAL_POSITIF} title="Nombre, ex. 2,5" placeholder="Stock de base" className="rounded border border-input bg-background px-2 py-1" />
          <button disabled={isPending} className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-50">Ajouter</button>
        </form>
      )}

      {aConfirmer && (
        <div role="alertdialog" aria-label="Confirmer la désactivation" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{aConfirmer.message}</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={isPending} onClick={() => activer(aConfirmer.ids, false, true)} className="rounded-md bg-amber-700 px-3 py-1 font-medium text-white hover:bg-amber-800 disabled:opacity-50">Désactiver quand même</button>
            <button onClick={() => setAConfirmer(null)} className="rounded-md border px-3 py-1 hover:bg-accent">Annuler</button>
          </div>
        </div>
      )}

      {/* Téléphone : la barre se colle SOUS la barre du haut de la coquille (même hauteur : marge de sécurité + 2,7 rem), sinon elle la recouvre. */}
      {estDirection && selection.size > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm max-lg:top-[calc(max(0.5rem,env(safe-area-inset-top))+2.7rem)]">
          <span className="font-medium">{selection.size} article(s) sélectionné(s)</span>
          <button disabled={isPending} onClick={() => activer([...selection], false)} className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50">Désactiver la sélection</button>
          <button disabled={isPending} onClick={() => activer([...selection], true)} className="rounded border px-2 py-1 hover:bg-accent disabled:opacity-50">Réactiver la sélection</button>
          <button onClick={() => setSelection(new Set())} className="ml-auto text-muted-foreground underline">Tout désélectionner</button>
        </div>
      )}

      <p className="text-xs text-muted-foreground max-lg:hidden">
        Sous chaque comptage : <span className="font-medium text-emerald-800">Reçu du dépôt</span> (sorties « Livraison restaurant » du jour, lecture seule). « Stock théorique » = dernier comptage + livraisons reçues depuis ; le jour d&apos;un comptage, le comptage fait foi.
      </p>

      {/* Défilement interne (vertical + horizontal) avec en-tête figé, comme les catalogues. */}
      <ZoneTableur>
      <VueJourOuSemaine
        jour={
          <ListeRestoJour
            lignes={lignes} jours={jours} estDirection={estDirection} selection={selection} onSelection={basculer}
            onToutSelectionner={(on) => setSelection(on ? new Set(lignes.map((l) => l.id)) : new Set())}
            onSaveComptage={saveComptage}
          />
        }
        semaine={
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              {estDirection && (
                <th className="w-8 max-lg:sticky max-lg:left-0 max-lg:z-20 max-lg:bg-muted">
                  <input type="checkbox" checked={toutSelectionne} onChange={(e) => setSelection(e.target.checked ? new Set(lignes.map((l) => l.id)) : new Set())} aria-label="Tout cocher" />
                </th>
              )}
              <th className={`max-lg:sticky max-lg:z-20 max-lg:bg-muted ${estDirection ? "max-lg:left-8" : "max-lg:left-0"}`}>Désignation</th>
              <th className="min-w-44">Article du catalogue</th>
              <th className="w-24">Unité</th>
              <th className="text-right">Stock base</th>
              {jours.map((j) => <th key={j.iso} className="text-center">{j.label}<br /><span className="font-normal text-muted-foreground">{j.num}</span></th>)}
              <th className="min-w-28 text-right">Stock théorique<br /><span className="font-normal text-muted-foreground">aujourd&apos;hui</span></th>
              {estDirection && <th></th>}
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {lignes.map((l, i) => (
              <Fragment key={l.id}>
                {(i === 0 || lignes[i - 1].categorie !== l.categorie) && l.categorie && (
                  <tr><td colSpan={nbCol} className="bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900 max-lg:sticky max-lg:left-0 max-lg:normal-case max-lg:tracking-normal">{l.categorie}</td></tr>
                )}
                <LigneR ligne={l} jours={jours} estDirection={estDirection} catalogue={catalogue}
                  selectionne={selection.has(l.id)} onSelection={basculer} onActiver={(id, actif) => activer([id], actif)}
                  onSave={save} onSaveComptage={saveComptage} onRattacher={rattacher} onDelete={(id) => run(() => supprimerArticleResto(id))} />
              </Fragment>
            ))}
            {lignes.length === 0 && <tr><td colSpan={nbCol} className="px-3 py-6 text-center text-muted-foreground">Aucun article. Ajoutez-en avec « + Ajouter un article ».</td></tr>}
          </tbody>
        </table>
      </div>
        }
      />
      </ZoneTableur>
    </div>
  );
}

const LigneR = memo(function LigneR({ ligne, jours, estDirection, catalogue, selectionne, onSelection, onActiver, onSave, onSaveComptage, onRattacher, onDelete }: {
  ligne: LigneResto; jours: Jour[]; estDirection: boolean; catalogue: OptionCatalogue[];
  selectionne: boolean; onSelection: (id: string) => void; onActiver: (id: string, actif: boolean) => void;
  onSave: (id: string, name: string, value: string) => Promise<unknown>;
  onSaveComptage: (id: string, iso: string, value: string) => Promise<unknown>;
  onRattacher: (id: string, articleStockId: string | null) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => { if (value === prev) return; setBusy(true); onSave(ligne.id, name, value).finally(() => setBusy(false)); };

  const inactif = ligne.actif === false;
  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy || inactif ? "opacity-60" : ""}`} data-inactif={inactif ? "" : undefined}>
      {estDirection && <td className="max-lg:sticky max-lg:left-0 max-lg:z-10 max-lg:bg-background"><input type="checkbox" checked={selectionne} onChange={() => onSelection(ligne.id)} aria-label={`Sélectionner ${ligne.designation}`} /></td>}
      <td className={`max-lg:sticky max-lg:z-10 max-lg:bg-background ${estDirection ? "max-lg:left-8" : "max-lg:left-0"}`}>
        <input defaultValue={ligne.designation} onBlur={(e) => write("designation", e.target.value, ligne.designation)} className={`${inp} min-w-40 font-medium max-lg:min-w-28`} />
        {inactif && <span className="text-[10px] font-medium text-muted-foreground">désactivé</span>}
      </td>
      <td>
        <ChoixArticleCatalogue
          articleStockId={ligne.articleStockId}
          designation={ligne.articleStockDesignation}
          catalogue={catalogue}
          onChoisir={(id) => { setBusy(true); onRattacher(ligne.id, id).finally(() => setBusy(false)); }}
        />
      </td>
      <td><input defaultValue={ligne.unite ?? ""} onBlur={(e) => write("unite", e.target.value, ligne.unite ?? "")} className={inp} /></td>
      {/* Cases du tableur partagé (Entrée ↓, Tab →, pas de flèches d'incrément) : colonne 0 = base, puis un jour par colonne. */}
      <td className="text-right"><CelluleNombre ligne={ligne.id} col={0} groupe={ligne.categorie ?? ""} quantite valeur={nombreOuNull(ligne.base)} onEnregistrer={(v) => onSave(ligne.id, "stockBaseJournalier", texteDe(v))} className={cell} aria-label={`Stock de base — ${ligne.designation}`} /></td>
      {jours.map((j, i) => (
        <td key={j.iso} className="text-center">
          <CelluleNombre ligne={ligne.id} col={i + 1} groupe={ligne.categorie ?? ""} quantite disabled={inactif} valeur={nombreOuNull(ligne.comptages[j.iso] ?? "")} onEnregistrer={(v) => onSaveComptage(ligne.id, j.iso, texteDe(v))} className={cell} aria-label={`${ligne.designation} — ${j.label} ${j.num}`} />
          {/* Reçu du dépôt : texte dérivé des sorties, jamais une case (le comptage reste la seule saisie). */}
          {ligne.recus[j.iso] !== undefined && (
            <div className="mt-0.5 whitespace-nowrap text-[10px] font-medium text-emerald-800" aria-label={`Reçu du dépôt — ${ligne.designation} — ${j.label} ${j.num}`} title="Reçu du dépôt (lecture seule)">
              reçu {qteTexte(ligne.recus[j.iso]!)}
            </div>
          )}
          {(ligne.signauxJour[j.iso] ?? []).map((t, k) => (
            <div key={k} className="mt-0.5 text-[10px] font-medium text-amber-800">{t}</div>
          ))}
        </td>
      ))}
      <td className="text-right text-xs" data-colonne="stock-theorique" title={ligne.theorique.aucunComptage && ligne.theorique.stock !== null ? MENTION_AUCUN_COMPTAGE : undefined}>
        {ligne.theorique.stock === null ? "—" : (
          <span className="font-medium tabular-nums">{qteTexte(ligne.theorique.stock)}{ligne.unite ? ` ${ligne.unite}` : ""}</span>
        )}
        {ligne.theorique.aucunComptage && ligne.theorique.stock !== null && <div className="text-[10px] text-muted-foreground">estimé (aucun comptage)</div>}
        {ligne.theorique.signalements.map((t, k) => <div key={k} className="text-[10px] font-medium text-amber-800">{t}</div>)}
      </td>
      {estDirection && (
        <td className="whitespace-nowrap text-right">
          <button onClick={() => onActiver(ligne.id, inactif)} className="mr-1 rounded border px-1.5 py-0.5 text-xs hover:bg-accent">{inactif ? "Réactiver" : "Désactiver"}</button>
          <button onClick={() => { if (confirm(`Supprimer « ${ligne.designation} » ?`)) onDelete(ligne.id); }} className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10" aria-label={`Supprimer ${ligne.designation}`}>✕</button>
        </td>
      )}
    </tr>
  );
});

/**
 * Téléphone : le comptage d'UN jour (celui du sélecteur du haut de page), article par article — le nom
 * à gauche avec, en petit dessous, le stock théorique et le « reçu du dépôt » du jour ; la case de
 * comptage à droite (44 px). Même action (`majComptage`, via `onSaveComptage`), même case partagée,
 * mêmes lignes que le tableau. Le stock de base, l'unité, le rattachement au catalogue et la
 * désactivation d'un article se règlent dans la « Vue semaine » (ou par la sélection, pour la Direction).
 */
function ListeRestoJour({ lignes, jours, estDirection, selection, onSelection, onToutSelectionner, onSaveComptage }: {
  lignes: LigneResto[]; jours: Jour[]; estDirection: boolean;
  selection: Set<string>; onSelection: (id: string) => void; onToutSelectionner: (on: boolean) => void;
  onSaveComptage: (id: string, iso: string, value: string) => Promise<unknown>;
}) {
  const [rang] = useJourAffiche(jours.map((j) => j.iso));
  const jour = jours[rang]!;
  const nomJour = `${jour.label} ${jour.num}`;
  const toutSelectionne = lignes.length > 0 && lignes.every((l) => selection.has(l.id));
  return (
    <div data-tableur="" data-vue-liste="restaurant" className="space-y-1">
      <TitreJour iso={jour.iso} resume={`${lignes.length} article(s)`} />
      {estDirection && lignes.length > 0 && (
        <label className="flex min-h-11 items-center gap-3 px-1 text-sm font-medium">
          <input type="checkbox" checked={toutSelectionne} onChange={(e) => onToutSelectionner(e.target.checked)} className="h-5 w-5 shrink-0" />
          Tout cocher
        </label>
      )}
      {lignes.map((l, i) => {
        const inactif = l.actif === false;
        const recu = l.recus[jour.iso];
        return (
          <Fragment key={l.id}>
            {(i === 0 || lignes[i - 1].categorie !== l.categorie) && l.categorie && <RubriqueJour>{l.categorie}</RubriqueJour>}
            <LigneJour
              className={inactif ? "opacity-60" : ""}
              gauche={estDirection && (
                <label className="flex h-11 w-7 shrink-0 items-center justify-center">
                  <input type="checkbox" checked={selection.has(l.id)} onChange={() => onSelection(l.id)} aria-label={`Sélectionner ${l.designation}`} className="h-5 w-5" />
                </label>
              )}
              nom={<>{l.designation}{inactif && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(désactivé)</span>}</>}
              sous={
                <>
                  <p className="text-xs text-muted-foreground" data-theorique-jour="">
                    Théorique aujourd&apos;hui : {l.theorique.stock === null ? "—" : <span className="font-medium text-foreground">{qteTexte(l.theorique.stock)}{l.unite ? ` ${l.unite}` : ""}</span>}
                    {l.theorique.aucunComptage && l.theorique.stock !== null && <span> · estimé (aucun comptage)</span>}
                    {l.base !== "" && <span> · base {qteTexte(l.base)}</span>}
                  </p>
                  {recu !== undefined && (
                    <p className="text-xs font-medium text-emerald-800" aria-label={`Reçu du dépôt — ${l.designation} — ${nomJour}`}>reçu du dépôt {qteTexte(recu)}</p>
                  )}
                  {(l.signauxJour[jour.iso] ?? []).map((t, k) => <p key={k} className="text-xs font-medium text-amber-800">{t}</p>)}
                  {l.theorique.signalements.map((t, k) => <p key={k} className="text-xs font-medium text-amber-800">{t}</p>)}
                </>
              }
              droite={
                // Clé = le jour : changer de jour remonte la case (une frappe en attente part à sa date d'origine).
                <CelluleNombre key={jour.iso} ligne={l.id} col={0} groupe={l.categorie ?? ""} donnee={jour.iso} quantite disabled={inactif}
                  valeur={nombreOuNull(l.comptages[jour.iso] ?? "")} onEnregistrer={(v, c) => onSaveComptage(l.id, c.donnee ?? jour.iso, texteDe(v))}
                  placeholder="—" className={CASE_JOUR} aria-label={`${l.designation} — ${nomJour}`} />
              }
            />
          </Fragment>
        );
      })}
      {lignes.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun article. Ajoutez-en avec « + Ajouter un article ».</p>}
    </div>
  );
}

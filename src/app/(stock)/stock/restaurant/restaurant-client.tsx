"use client";

import { Fragment, memo, useState, useTransition } from "react";
import { majComptage, modifierArticleResto, creerArticleResto, supprimerArticleResto } from "./actions";
import type { JourResto } from "./semaine";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { lireSaisieNombre, MOTIF_HTML_DECIMAL_POSITIF } from "@/lib/nombre";

const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : String(v));

export type Jour = JourResto;
export type LigneResto = {
  id: string; categorie: string | null; designation: string; unite: string | null;
  base: string; comptages: Record<string, string>; // iso → quantité
};

const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const cell = "w-16 rounded border border-input bg-background px-1 py-1 text-right text-xs";

export function RestaurantGrille({
  espace, jours, lignes, categories, estDirection,
}: {
  espace: "CUISINE" | "BAR"; jours: Jour[]; lignes: LigneResto[]; categories: string[]; estDirection: boolean;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [isPending, start] = useTransition();
  const listeId = `cats-${espace}`;

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
  const run = (fn: () => Promise<unknown>) => { setErreur(null); start(async () => { const r = await fn(); if (estErreur(r)) setErreur(r.erreur); }); };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <datalist id={listeId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>

      <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{ajout ? "Fermer" : "+ Ajouter un article"}</button>
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

      {/* Défilement interne (vertical + horizontal) avec en-tête figé, comme les catalogues. */}
      <ZoneTableur>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th>Désignation</th>
              <th className="w-24">Unité</th>
              <th className="text-right">Stock base</th>
              {jours.map((j) => <th key={j.iso} className="text-center">{j.label}<br /><span className="font-normal text-muted-foreground">{j.num}</span></th>)}
              {estDirection && <th></th>}
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {lignes.map((l, i) => (
              <Fragment key={l.id}>
                {(i === 0 || lignes[i - 1].categorie !== l.categorie) && l.categorie && (
                  <tr><td colSpan={jours.length + (estDirection ? 4 : 3)} className="bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{l.categorie}</td></tr>
                )}
                <LigneR ligne={l} jours={jours} estDirection={estDirection}
                  onSave={save} onSaveComptage={saveComptage} onDelete={(id) => run(() => supprimerArticleResto(id))} />
              </Fragment>
            ))}
            {lignes.length === 0 && <tr><td colSpan={jours.length + (estDirection ? 5 : 4)} className="px-3 py-6 text-center text-muted-foreground">Aucun article. Ajoutez-en avec « + Ajouter un article ».</td></tr>}
          </tbody>
        </table>
      </div>
      </ZoneTableur>
    </div>
  );
}

const LigneR = memo(function LigneR({ ligne, jours, estDirection, onSave, onSaveComptage, onDelete }: {
  ligne: LigneResto; jours: Jour[]; estDirection: boolean;
  onSave: (id: string, name: string, value: string) => Promise<unknown>;
  onSaveComptage: (id: string, iso: string, value: string) => Promise<unknown>;
  onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => { if (value === prev) return; setBusy(true); onSave(ligne.id, name, value).finally(() => setBusy(false)); };

  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy ? "opacity-60" : ""}`}>
      <td><input defaultValue={ligne.designation} onBlur={(e) => write("designation", e.target.value, ligne.designation)} className={`${inp} min-w-40 font-medium`} /></td>
      <td><input defaultValue={ligne.unite ?? ""} onBlur={(e) => write("unite", e.target.value, ligne.unite ?? "")} className={inp} /></td>
      {/* Cases du tableur partagé (Entrée ↓, Tab →, pas de flèches d'incrément) : colonne 0 = base, puis un jour par colonne. */}
      <td className="text-right"><CelluleNombre ligne={ligne.id} col={0} groupe={ligne.categorie ?? ""} quantite valeur={nombreOuNull(ligne.base)} onEnregistrer={(v) => onSave(ligne.id, "stockBaseJournalier", texteDe(v))} className={cell} aria-label={`Stock de base — ${ligne.designation}`} /></td>
      {jours.map((j, i) => (
        <td key={j.iso} className="text-center">
          <CelluleNombre ligne={ligne.id} col={i + 1} groupe={ligne.categorie ?? ""} quantite valeur={nombreOuNull(ligne.comptages[j.iso] ?? "")} onEnregistrer={(v) => onSaveComptage(ligne.id, j.iso, texteDe(v))} className={cell} aria-label={`${ligne.designation} — ${j.label} ${j.num}`} />
        </td>
      ))}
      {estDirection && <td className="text-right"><button onClick={() => { if (confirm(`Supprimer « ${ligne.designation} » ?`)) onDelete(ligne.id); }} className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10">✕</button></td>}
    </tr>
  );
});

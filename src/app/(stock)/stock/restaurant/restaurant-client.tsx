"use client";

import { memo, useState, useTransition } from "react";
import { majComptage, modifierArticleResto, creerArticleResto, supprimerArticleResto } from "./actions";
import type { JourResto } from "./semaine";

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
    try { await modifierArticleResto(id, fd); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const saveComptage = async (id: string, iso: string, value: string) => {
    setErreur(null);
    try { await majComptage(id, iso, value); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const run = (fn: () => Promise<void>) => { setErreur(null); start(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } }); };

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
          <input name="stockBaseJournalier" type="number" step="0.001" placeholder="Stock de base" className="rounded border border-input bg-background px-2 py-1" />
          <button disabled={isPending} className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-50">Ajouter</button>
        </form>
      )}

      {/* Défilement interne (vertical + horizontal) avec en-tête figé, comme les catalogues. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th className="w-40">Catégorie</th>
              <th>Désignation</th>
              <th className="w-24">Unité</th>
              <th className="text-right">Stock base</th>
              {jours.map((j) => <th key={j.iso} className="text-center">{j.label}<br /><span className="font-normal text-muted-foreground">{j.num}</span></th>)}
              {estDirection && <th></th>}
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {lignes.map((l) => (
              <LigneR key={l.id} ligne={l} jours={jours} listeId={listeId} estDirection={estDirection}
                onSave={save} onSaveComptage={saveComptage} onDelete={(id) => run(() => supprimerArticleResto(id))} />
            ))}
            {lignes.length === 0 && <tr><td colSpan={jours.length + (estDirection ? 5 : 4)} className="px-3 py-6 text-center text-muted-foreground">Aucun article. Ajoutez-en avec « + Ajouter un article ».</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LigneR = memo(function LigneR({ ligne, jours, listeId, estDirection, onSave, onSaveComptage, onDelete }: {
  ligne: LigneResto; jours: Jour[]; listeId: string; estDirection: boolean;
  onSave: (id: string, name: string, value: string) => Promise<void>;
  onSaveComptage: (id: string, iso: string, value: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => { if (value === prev) return; setBusy(true); onSave(ligne.id, name, value).finally(() => setBusy(false)); };
  const writeComptage = (iso: string, value: string, prev: string) => { if (value === prev) return; setBusy(true); onSaveComptage(ligne.id, iso, value).finally(() => setBusy(false)); };

  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy ? "opacity-60" : ""}`}>
      <td><input defaultValue={ligne.categorie ?? ""} list={listeId} onBlur={(e) => write("categorie", e.target.value, ligne.categorie ?? "")} className={inp} /></td>
      <td><input defaultValue={ligne.designation} onBlur={(e) => write("designation", e.target.value, ligne.designation)} className={`${inp} min-w-40 font-medium`} /></td>
      <td><input defaultValue={ligne.unite ?? ""} onBlur={(e) => write("unite", e.target.value, ligne.unite ?? "")} className={inp} /></td>
      <td className="text-right"><input type="number" step="0.001" defaultValue={ligne.base} onBlur={(e) => write("stockBaseJournalier", e.target.value, ligne.base)} className={cell} /></td>
      {jours.map((j) => {
        const v = ligne.comptages[j.iso] ?? "";
        return (
          <td key={j.iso} className="text-center">
            <input type="number" step="0.001" defaultValue={v} onBlur={(e) => writeComptage(j.iso, e.target.value, v)} className={cell} />
          </td>
        );
      })}
      {estDirection && <td className="text-right"><button onClick={() => { if (confirm(`Supprimer « ${ligne.designation} » ?`)) onDelete(ligne.id); }} className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10">✕</button></td>}
    </tr>
  );
});

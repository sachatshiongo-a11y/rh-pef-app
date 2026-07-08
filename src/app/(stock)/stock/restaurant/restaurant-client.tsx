"use client";

import { Fragment, memo, useState, useTransition } from "react";
import { majComptage, majBaseResto, creerArticleResto, supprimerArticleResto } from "./actions";

export type Jour = { iso: string; label: string; num: string };
export type LigneResto = {
  id: string; categorie: string | null; designation: string; unite: string | null;
  base: string; comptages: Record<string, string>; // iso → quantité
};

const cell = "w-16 rounded border border-input bg-background px-1 py-1 text-right text-xs";

export function RestaurantGrille({ espace, jours, lignes }: { espace: "CUISINE" | "BAR"; jours: Jour[]; lignes: LigneResto[] }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [isPending, start] = useTransition();

  const save = async (fn: () => Promise<void>) => {
    setErreur(null);
    try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const run = (fn: () => Promise<void>) => { setErreur(null); start(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } }); };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{ajout ? "Fermer" : "+ Ajouter un article"}</button>
      {ajout && (
        <form action={(fd) => run(async () => { await creerArticleResto(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm md:grid-cols-5">
          <input type="hidden" name="espace" value={espace} />
          <input name="designation" placeholder="Désignation *" required className="rounded border border-input bg-background px-2 py-1" />
          <input name="categorie" placeholder="Catégorie" className="rounded border border-input bg-background px-2 py-1" />
          <input name="unite" placeholder="Unité" className="rounded border border-input bg-background px-2 py-1" />
          <input name="stockBaseJournalier" type="number" step="0.001" placeholder="Stock de base" className="rounded border border-input bg-background px-2 py-1" />
          <button disabled={isPending} className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-50">Ajouter</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th>Désignation</th>
              <th>Unité</th>
              <th className="text-right">Stock base</th>
              {jours.map((j) => <th key={j.iso} className="text-center">{j.label}<br /><span className="font-normal text-muted-foreground">{j.num}</span></th>)}
              <th></th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {lignes.map((l, i) => (
              <Fragment key={l.id}>
                {(i === 0 || lignes[i - 1].categorie !== l.categorie) && l.categorie && (
                  <tr><td colSpan={jours.length + 4} className="bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{l.categorie}</td></tr>
                )}
                <LigneR ligne={l} jours={jours} onSave={save} onDelete={(id) => run(() => supprimerArticleResto(id))} />
              </Fragment>
            ))}
            {lignes.length === 0 && <tr><td colSpan={jours.length + 4} className="px-3 py-6 text-center text-muted-foreground">Aucun article. Ajoutez-en ou importez depuis l’inventaire.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LigneR = memo(function LigneR({ ligne, jours, onSave, onDelete }: {
  ligne: LigneResto; jours: Jour[]; onSave: (fn: () => Promise<void>) => Promise<void>; onDelete: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (fn: () => Promise<void>) => { setBusy(true); onSave(fn).finally(() => setBusy(false)); };

  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy ? "opacity-60" : ""}`}>
      <td className="font-medium">{ligne.designation}</td>
      <td className="text-muted-foreground">{ligne.unite ?? ""}</td>
      <td className="text-right">
        <input type="number" step="0.001" defaultValue={ligne.base} onBlur={(e) => { if (e.target.value !== ligne.base) write(() => majBaseResto(ligne.id, e.target.value)); }} className={cell} />
      </td>
      {jours.map((j) => {
        const v = ligne.comptages[j.iso] ?? "";
        return (
          <td key={j.iso} className="text-center">
            <input type="number" step="0.001" defaultValue={v} onBlur={(e) => { if (e.target.value !== v) write(() => majComptage(ligne.id, j.iso, e.target.value)); }} className={cell} />
          </td>
        );
      })}
      <td className="text-right"><button onClick={() => { if (confirm(`Supprimer « ${ligne.designation} » ?`)) onDelete(ligne.id); }} className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10">✕</button></td>
    </tr>
  );
});

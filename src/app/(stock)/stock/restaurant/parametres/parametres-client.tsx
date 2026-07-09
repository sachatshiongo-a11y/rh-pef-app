"use client";

import { memo, useState, useTransition } from "react";
import { modifierArticleResto, creerArticleResto, supprimerArticleResto } from "../actions";

export type ArtParam = { id: string; categorie: string; designation: string; unite: string; base: string; ordre: number };
const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";

export function ParametresResto({ espace, articles, categories }: { espace: "CUISINE" | "BAR"; articles: ArtParam[]; categories: string[] }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [isPending, start] = useTransition();

  const save = async (id: string, name: string, value: string) => {
    setErreur(null);
    const fd = new FormData(); fd.set(name, value);
    try { await modifierArticleResto(id, fd); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const run = (fn: () => Promise<void>) => { setErreur(null); start(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } }); };
  const listeId = `cats-${espace}`;

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <datalist id={listeId}>{categories.map((c) => <option key={c} value={c} />)}</datalist>

      <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{ajout ? "Fermer" : "+ Ajouter un article"}</button>
      {ajout && (
        <form action={(fd) => run(async () => { await creerArticleResto(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm md:grid-cols-5">
          <input type="hidden" name="espace" value={espace} />
          <input name="designation" placeholder="Désignation *" required className={inp} />
          <input name="categorie" list={listeId} placeholder="Catégorie" className={inp} />
          <input name="unite" placeholder="Unité" className={inp} />
          <input name="stockBaseJournalier" type="number" step="0.001" placeholder="Stock de base" className={inp} />
          <button disabled={isPending} className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-50">Ajouter</button>
        </form>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th className="w-16 text-right">Ordre</th>
              <th>Catégorie</th>
              <th>Désignation</th>
              <th>Unité</th>
              <th className="text-right">Stock base</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {articles.map((a) => (
              <LigneParam key={a.id} a={a} listeId={listeId} onSave={save} onDelete={(id, d) => { if (confirm(`Supprimer « ${d} » ?`)) run(() => supprimerArticleResto(id)); }} />
            ))}
            {articles.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LigneParam = memo(function LigneParam({ a, listeId, onSave, onDelete }: {
  a: ArtParam; listeId: string; onSave: (id: string, name: string, value: string) => Promise<void>; onDelete: (id: string, d: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => { if (value === prev) return; setBusy(true); onSave(a.id, name, value).finally(() => setBusy(false)); };
  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy ? "opacity-60" : ""}`}>
      <td><input defaultValue={a.ordre} onBlur={(e) => write("ordre", e.target.value, String(a.ordre))} type="number" className={`${inp} text-right`} /></td>
      <td><input defaultValue={a.categorie} list={listeId} onBlur={(e) => write("categorie", e.target.value, a.categorie)} className={inp} /></td>
      <td><input defaultValue={a.designation} onBlur={(e) => write("designation", e.target.value, a.designation)} className={inp} /></td>
      <td><input defaultValue={a.unite} onBlur={(e) => write("unite", e.target.value, a.unite)} className={`${inp} w-24`} /></td>
      <td><input defaultValue={a.base} onBlur={(e) => write("stockBaseJournalier", e.target.value, a.base)} type="number" step="0.001" className={`${inp} w-24 text-right`} /></td>
      <td className="text-right"><button onClick={() => onDelete(a.id, a.designation)} className="text-xs text-destructive underline">Suppr.</button></td>
    </tr>
  );
});

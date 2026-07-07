"use client";

import { useState, useTransition } from "react";
import { creerArticle, modifierArticle, categoriserEnMasse } from "./actions";
import { ALERTE_CLASSE, ALERTE_LABEL, type NiveauAlerte } from "@/lib/stock";

export type ArticleRow = {
  id: string;
  designation: string;
  domaine: "NOURRITURE" | "BOISSON";
  categorieId: string | null;
  fournisseurId: string | null;
  prix: string | null;
  quantite: string;
  stockMinimum: string;
  seuilUrgent: string;
  niveau: NiveauAlerte | null;
};
type Cat = { id: string; nom: string; domaine: string };
type Four = { id: string; nom: string };

const cellCls = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";

export function CatalogueTable({ articles, categories, fournisseurs }: { articles: ArticleRow[]; categories: Cat[]; fournisseurs: Four[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [ajout, setAjout] = useState(false);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => {
      try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };
  const champ = (id: string, name: string, value: string) => {
    const fd = new FormData();
    fd.set(name, value);
    run(() => modifierArticle(id, fd));
  };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toutSel = (on: boolean) => setSel(on ? new Set(articles.map((a) => a.id)) : new Set());
  const catsPour = (domaine: string) => categories.filter((c) => c.domaine === domaine);

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {/* Barre d'actions groupées */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} sélectionné(s)</span>
          <span className="text-muted-foreground">→ catégoriser :</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            <option value="">Choisir une catégorie…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.domaine === "NOURRITURE" ? "N" : "B"})</option>)}
          </select>
          <button
            disabled={isPending || !bulkCat}
            onClick={() => run(async () => { await categoriserEnMasse([...sel], bulkCat); setSel(new Set()); setBulkCat(""); })}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Appliquer
          </button>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground underline">Annuler</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          {ajout ? "Fermer" : "+ Ajouter un article"}
        </button>
      </div>

      {ajout && (
        <form action={(fd) => run(async () => { await creerArticle(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm md:grid-cols-4">
          <input name="designation" placeholder="Désignation *" required className={cellCls} />
          <select name="domaine" defaultValue="NOURRITURE" className={cellCls}>
            <option value="NOURRITURE">Nourriture</option>
            <option value="BOISSON">Boisson</option>
          </select>
          <select name="categorieId" defaultValue="" className={cellCls}>
            <option value="">— catégorie —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({c.domaine === "NOURRITURE" ? "N" : "B"})</option>)}
          </select>
          <select name="fournisseurId" defaultValue="" className={cellCls}>
            <option value="">— fournisseur —</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          <input name="unite" placeholder="Unité (Kg, Pièce…)" className={cellCls} />
          <input name="prixUnitaireUSD" type="number" step="0.0001" placeholder="Prix USD" className={cellCls} />
          <input name="quantite" type="number" step="0.001" placeholder="Stock initial" className={cellCls} />
          <input name="stockMinimum" type="number" step="0.001" placeholder="Stock minimum" className={cellCls} />
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer l&apos;article</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-2 py-2"><input type="checkbox" checked={sel.size === articles.length && articles.length > 0} onChange={(e) => toutSel(e.target.checked)} /></th>
              <th className="px-2 py-2">Désignation</th>
              <th className="px-2 py-2">Catégorie</th>
              <th className="px-2 py-2">Fournisseur</th>
              <th className="px-2 py-2 text-right">Prix USD</th>
              <th className="px-2 py-2 text-right">Stock</th>
              <th className="px-2 py-2 text-right">Min</th>
              <th className="px-2 py-2 text-right">Seuil urgent</th>
              <th className="px-2 py-2">Alerte</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => (
              <tr key={a.id} className={`border-t ${sel.has(a.id) ? "bg-primary/5" : ""}`}>
                <td className="px-2 py-1"><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} /></td>
                <td className="px-2 py-1 font-medium">{a.designation}</td>
                <td className="px-2 py-1">
                  <select defaultValue={a.categorieId ?? ""} disabled={isPending} onChange={(e) => champ(a.id, "categorieId", e.target.value)} className={`${cellCls} ${!a.categorieId ? "border-amber-400" : ""}`}>
                    <option value="">— à classer —</option>
                    {catsPour(a.domaine).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <select defaultValue={a.fournisseurId ?? ""} disabled={isPending} onChange={(e) => champ(a.id, "fournisseurId", e.target.value)} className={cellCls}>
                    <option value="">—</option>
                    {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1"><input type="number" step="0.0001" defaultValue={a.prix ?? ""} disabled={isPending} onBlur={(e) => { if (e.target.value !== (a.prix ?? "")) champ(a.id, "prixUnitaireUSD", e.target.value); }} className={`${cellCls} text-right`} /></td>
                <td className="px-2 py-1"><input type="number" step="0.001" defaultValue={a.quantite} disabled={isPending} onBlur={(e) => { if (e.target.value !== a.quantite) champ(a.id, "quantite", e.target.value); }} className={`${cellCls} text-right`} /></td>
                <td className="px-2 py-1"><input type="number" step="0.001" defaultValue={a.stockMinimum} disabled={isPending} onBlur={(e) => { if (e.target.value !== a.stockMinimum) champ(a.id, "stockMinimum", e.target.value); }} className={`${cellCls} text-right`} /></td>
                <td className="px-2 py-1"><input type="number" step="0.001" defaultValue={a.seuilUrgent} disabled={isPending} onBlur={(e) => { if (e.target.value !== a.seuilUrgent) champ(a.id, "seuilUrgent", e.target.value); }} className={`${cellCls} text-right`} /></td>
                <td className="px-2 py-1">{a.niveau && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>{ALERTE_LABEL[a.niveau]}</span>}</td>
              </tr>
            ))}
            {articles.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { Fragment, memo, useMemo, useState, useTransition } from "react";
import { creerArticle, modifierArticle, categoriserEnMasse, fusionnerArticles } from "./actions";
import { ALERTE_CLASSE, ALERTE_LABEL, DOMAINE_LABEL, type NiveauAlerte } from "@/lib/stock";

export type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type ArticleRow = {
  id: string;
  designation: string;
  domaine: Domaine;
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
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ALERTES = [["", "Toutes"], ["URGENT", "Urgent"], ["APPRO", "À réappro."], ["OK", "Satisfaisant"]] as const;

export function CatalogueTable({ articles, categories, fournisseurs, lockedDomaine, initialQ }: { articles: ArticleRow[]; categories: Cat[]; fournisseurs: Four[]; lockedDomaine?: Domaine; initialQ?: string }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [ajout, setAjout] = useState(false);
  const [q, setQ] = useState(initialQ ?? "");
  const [dom, setDom] = useState<"TOUS" | Domaine>(lockedDomaine ?? "TOUS");
  const [alerte, setAlerte] = useState<"" | NiveauAlerte>("");

  const catNom = useMemo(() => new Map(categories.map((c) => [c.id, c.nom])), [categories]);
  const fourNom = useMemo(() => new Map(fournisseurs.map((f) => [f.id, f.nom])), [fournisseurs]);

  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    return articles.filter((a) =>
      (dom === "TOUS" || a.domaine === dom) &&
      (!alerte || a.niveau === alerte) &&
      (!nq || norm(a.designation).includes(nq)),
    );
  }, [articles, q, dom, alerte]);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => {
      try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };
  const save = async (id: string, name: string, value: string) => {
    const fd = new FormData();
    fd.set(name, value);
    try { await modifierArticle(id, fd); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toutSel = (on: boolean) => setSel(on ? new Set(visibles.map((a) => a.id)) : new Set());

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {/* Recherche + filtre domaine */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Rechercher un article…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        {!lockedDomaine && (
          <div className="flex gap-1.5 text-sm">
            {(["TOUS", "NOURRITURE", "BOISSON", "AUTRE"] as const).map((k) => (
              <button key={k} onClick={() => setDom(k)} className={`rounded-full border px-3 py-1 ${dom === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>
                {k === "TOUS" ? "Tous" : DOMAINE_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 text-sm">
          {ALERTES.map(([k, label]) => (
            <button key={k} onClick={() => setAlerte(k as "" | NiveauAlerte)} className={`rounded-full border px-3 py-1 ${alerte === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{visibles.length} / {articles.length} article(s)</span>
      </div>

      {/* Barre d'actions groupées */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} sélectionné(s)</span>
          <span className="text-muted-foreground">→ catégoriser :</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            <option value="">Choisir une catégorie…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({(DOMAINE_LABEL[c.domaine] ?? "?")[0]})</option>)}
          </select>
          <button
            disabled={isPending || !bulkCat}
            onClick={() => run(async () => { await categoriserEnMasse([...sel], bulkCat); setSel(new Set()); setBulkCat(""); })}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Appliquer
          </button>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground underline">Annuler</button>
          {sel.size >= 2 && (
            <button
              disabled={isPending}
              onClick={() => { if (confirm(`Fusionner ces ${sel.size} articles en un seul ? Les doublons seront supprimés (stock cumulé sur l'article conservé).`)) run(async () => { await fusionnerArticles([...sel]); setSel(new Set()); }); }}
              className="ml-auto rounded-md border border-amber-400 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              ⛙ Fusionner en 1
            </button>
          )}
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
          <select name="domaine" defaultValue={lockedDomaine ?? "NOURRITURE"} className={cellCls}>
            <option value="NOURRITURE">Nourriture</option>
            <option value="BOISSON">Boisson</option>
            <option value="AUTRE">Autre</option>
          </select>
          <select name="categorieId" defaultValue="" className={cellCls}>
            <option value="">— catégorie —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({(DOMAINE_LABEL[c.domaine] ?? "?")[0]})</option>)}
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
        <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2.5 [&>th]:font-semibold">
              <th><input type="checkbox" checked={sel.size > 0 && sel.size === visibles.length} onChange={(e) => toutSel(e.target.checked)} /></th>
              <th>Désignation</th>
              <th>Catégorie</th>
              <th>Fournisseur</th>
              <th className="text-right">Prix USD</th>
              <th className="text-right">Stock</th>
              <th className="text-right">Min</th>
              <th className="text-right">Seuil urgent</th>
              <th>Alerte</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {visibles.map((a, i) => (
              <Fragment key={a.id}>
                {(i === 0 || visibles[i - 1].domaine !== a.domaine) && (
                  <tr>
                    <td colSpan={10} className="bg-amber-100 !py-2 text-sm font-bold uppercase tracking-wide text-amber-900">
                      {DOMAINE_LABEL[a.domaine]} ({visibles.filter((x) => x.domaine === a.domaine).length})
                    </td>
                  </tr>
                )}
                <LigneArticle
                  a={a}
                  categories={categories}
                  fournisseurs={fournisseurs}
                  catNom={a.categorieId ? catNom.get(a.categorieId) ?? null : null}
                  fourNom={a.fournisseurId ? fourNom.get(a.fournisseurId) ?? null : null}
                  selected={sel.has(a.id)}
                  onToggle={toggle}
                  onSave={save}
                />
              </Fragment>
            ))}
            {visibles.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LigneArticle = memo(function LigneArticle({
  a, categories, fournisseurs, catNom, fourNom, selected, onToggle, onSave,
}: {
  a: ArticleRow; categories: Cat[]; fournisseurs: Four[]; catNom: string | null; fourNom: string | null;
  selected: boolean; onToggle: (id: string) => void; onSave: (id: string, name: string, value: string) => Promise<void>;
}) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const catsPour = categories.filter((c) => c.domaine === a.domaine);

  const write = (name: string, value: string, prev: string) => {
    if (value === prev) return;
    setBusy(true);
    onSave(a.id, name, value).finally(() => setBusy(false));
  };

  return (
    <tr className={`hover:bg-accent/40 ${selected ? "bg-primary/10" : "even:bg-muted/25"} ${busy ? "opacity-60" : ""}`}>
      <td className="px-2 py-1"><input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} /></td>
      <td className="px-2 py-1 font-medium">{a.designation}</td>
      {edit ? (
        <>
          <td className="px-2 py-1">
            <select defaultValue={a.categorieId ?? ""} onChange={(e) => write("categorieId", e.target.value, a.categorieId ?? "")} className={`${cellCls} ${!a.categorieId ? "border-amber-400" : ""}`}>
              <option value="">— à classer —</option>
              {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </td>
          <td className="px-2 py-1">
            <select defaultValue={a.fournisseurId ?? ""} onChange={(e) => write("fournisseurId", e.target.value, a.fournisseurId ?? "")} className={cellCls}>
              <option value="">—</option>
              {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
          </td>
          <td className="px-2 py-1"><input type="number" step="0.0001" defaultValue={a.prix ?? ""} onBlur={(e) => write("prixUnitaireUSD", e.target.value, a.prix ?? "")} className={`${cellCls} text-right`} /></td>
          <td className="px-2 py-1 text-right tabular-nums" title="Le stock ne se modifie que par la Liste d'achat ou la réception">{a.quantite}</td>
          <td className="px-2 py-1"><input type="number" step="0.001" defaultValue={a.stockMinimum} onBlur={(e) => write("stockMinimum", e.target.value, a.stockMinimum)} className={`${cellCls} text-right`} /></td>
          <td className="px-2 py-1"><input type="number" step="0.001" defaultValue={a.seuilUrgent} onBlur={(e) => write("seuilUrgent", e.target.value, a.seuilUrgent)} className={`${cellCls} text-right`} /></td>
        </>
      ) : (
        <>
          <td className={`px-2 py-1 ${!catNom ? "text-amber-700" : "text-muted-foreground"}`}>{catNom ?? "à classer"}</td>
          <td className="px-2 py-1 text-muted-foreground">{fourNom ?? "—"}</td>
          <td className="px-2 py-1 text-right tabular-nums">{a.prix ? `${a.prix} $` : "—"}</td>
          <td className="px-2 py-1 text-right tabular-nums">{a.quantite}</td>
          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{a.stockMinimum}</td>
          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{a.seuilUrgent}</td>
        </>
      )}
      <td className="px-2 py-1">{a.niveau && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>{ALERTE_LABEL[a.niveau]}</span>}</td>
      <td className="px-2 py-1 text-right">
        <button onClick={() => setEdit((v) => !v)} title={edit ? "Terminer" : "Modifier"} className="rounded border px-2 py-0.5 text-xs hover:bg-accent">{edit ? "✓" : "✎"}</button>
      </td>
    </tr>
  );
});

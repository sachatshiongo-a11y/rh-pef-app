"use client";

import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { Fragment, memo, useMemo, useState, useTransition, type ReactNode } from "react";
import { creerArticle, modifierArticle, categoriserEnMasse, fusionnerArticles, basculerActifArticles, definirFournisseurEnMasse, definirSeuilEnMasse, corrigerStocksNegatifs } from "./actions";
import { ALERTE_CLASSE, ALERTE_LABEL, DOMAINE_LABEL, usd, type NiveauAlerte } from "@/lib/stock";

const valeurStock = (a: { prix: string | null; quantite: string }) => (Number(a.prix) || 0) * (Number(a.quantite) || 0);

export type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type ArticleRow = {
  id: string;
  code: string | null; // code article (repris du fichier d'inventaire)
  designation: string;
  domaine: Domaine;
  categorieId: string | null;
  fournisseurId: string | null;
  unite: string | null;
  prix: string | null;
  uniteParCarton: string | null; // conditionnement : nb d'unités par carton
  quantite: string;
  stockMinimum: string;
  niveau: NiveauAlerte | null;
};
type Cat = { id: string; nom: string; domaine: string };
type Four = { id: string; nom: string };

type TriCol = "designation" | "categorie" | "fournisseur" | "stock" | "valeur" | "prix" | "min" | "alerte";
const ORDRE_ALERTE: Record<string, number> = { URGENT: 0, APPRO: 1, OK: 2 };
const valeurTri = (a: ArticleRow, col: TriCol, catNom: Map<string, string>, fourNom: Map<string, string>): string | number =>
  col === "designation" ? a.designation.toLowerCase() :
  col === "categorie" ? (a.categorieId ? catNom.get(a.categorieId) ?? "" : "￿").toLowerCase() :
  col === "fournisseur" ? (a.fournisseurId ? fourNom.get(a.fournisseurId) ?? "" : "￿").toLowerCase() :
  col === "stock" ? Number(a.quantite) || 0 :
  col === "valeur" ? valeurStock(a) :
  col === "prix" ? Number(a.prix) || 0 :
  col === "min" ? Number(a.stockMinimum) || 0 :
  col === "alerte" ? (a.niveau ? ORDRE_ALERTE[a.niveau] : 3) : 0;

type ManqueKey = "" | "prix" | "fournisseur" | "seuil" | "unite" | "negatif";
// Détecte un champ manquant (pur, hors composant → pas de dépendance de hook).
const manqueDe = (a: ArticleRow, m: ManqueKey) =>
  m === "prix" ? !a.prix || Number(a.prix) === 0 :
  m === "fournisseur" ? !a.fournisseurId :
  m === "seuil" ? !a.stockMinimum || Number(a.stockMinimum) <= 0 :
  m === "unite" ? !a.unite || !a.unite.trim() :
  m === "negatif" ? Number(a.quantite) < 0 : false;

const cellCls = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ALERTES = [["", "Toutes"], ["URGENT", "Urgent"], ["APPRO", "À réappro."], ["OK", "Satisfaisant"]] as const;

export function CatalogueTable({ articles, categories, fournisseurs, lockedDomaine, initialQ, initialAlerte }: { articles: ArticleRow[]; categories: Cat[]; fournisseurs: Four[]; lockedDomaine?: Domaine; initialQ?: string; initialAlerte?: NiveauAlerte }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [fusionKeep, setFusionKeep] = useState<string | null>(null); // article à conserver (panneau de fusion ouvert)
  const [ajout, setAjout] = useState(false);
  const [q, setQ] = useState(initialQ ?? "");
  const [dom, setDom] = useState<"TOUS" | Domaine>(lockedDomaine ?? "TOUS");
  const [alerte, setAlerte] = useState<"" | NiveauAlerte>(initialAlerte ?? "");
  const [manque, setManque] = useState<ManqueKey>(""); // vue « À compléter »
  const [bulkFour, setBulkFour] = useState("");
  const [bulkSeuil, setBulkSeuil] = useState("");
  const [tri, setTri] = useState<{ col: TriCol; dir: 1 | -1 } | null>(null); // null = groupé par catégorie

  const catNom = useMemo(() => new Map(categories.map((c) => [c.id, c.nom])), [categories]);
  const fourNom = useMemo(() => new Map(fournisseurs.map((f) => [f.id, f.nom])), [fournisseurs]);

  // Clic sur un en-tête : croissant → décroissant → retour au groupement par catégorie.
  const trierPar = (col: TriCol) =>
    setTri((t) => (t?.col !== col ? { col, dir: 1 } : t.dir === 1 ? { col, dir: -1 } : null));

  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    return articles.filter((a) =>
      (dom === "TOUS" || a.domaine === dom) &&
      (!alerte || a.niveau === alerte) &&
      (!manque || manqueDe(a, manque)) &&
      (!nq || norm(a.designation).includes(nq) || (a.code ?? "").toLowerCase().includes(nq)),
    );
  }, [articles, q, dom, alerte, manque]);

  // Liste affichée : triée par colonne si un tri est actif, sinon ordre d'origine (groupé par catégorie).
  const affichees = useMemo(() => {
    if (!tri) return visibles;
    return [...visibles].sort((a, b) => {
      const x = valeurTri(a, tri.col, catNom, fourNom), y = valeurTri(b, tri.col, catNom, fourNom);
      return (x < y ? -1 : x > y ? 1 : 0) * tri.dir;
    });
  }, [visibles, tri, catNom, fourNom]);

  // Compteurs « À compléter » (sur le domaine courant) — dette de saisie qui bride alertes/valorisation.
  const incomplets = useMemo(() => {
    const base = articles.filter((a) => dom === "TOUS" || a.domaine === dom);
    return {
      prix: base.filter((a) => manqueDe(a, "prix")).length,
      fournisseur: base.filter((a) => manqueDe(a, "fournisseur")).length,
      seuil: base.filter((a) => manqueDe(a, "seuil")).length,
      unite: base.filter((a) => manqueDe(a, "unite")).length,
      negatif: base.filter((a) => manqueDe(a, "negatif")).length,
    };
  }, [articles, dom]);

  // Compteurs d'alerte (sur le domaine courant) pour le bandeau de réapprovisionnement.
  const compte = useMemo(() => {
    let urgent = 0, appro = 0;
    for (const a of articles) {
      if (dom !== "TOUS" && a.domaine !== dom) continue;
      if (a.niveau === "URGENT") urgent++;
      else if (a.niveau === "APPRO") appro++;
    }
    return { urgent, appro };
  }, [articles, dom]);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };
  const save = async (id: string, name: string, value: string) => {
    const fd = new FormData(); fd.set(name, value);
    try { await modifierArticle(id, fd); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toutSel = (on: boolean) => setSel(on ? new Set(visibles.map((a) => a.id)) : new Set());

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {/* Bandeau réapprovisionnement : visible en permanence dès qu'un article est bas ; clic = filtre. */}
      {(compte.urgent > 0 || compte.appro > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm">
          <span className="font-semibold text-amber-900">⚠ À réapprovisionner</span>
          {compte.urgent > 0 && (
            <button
              onClick={() => setAlerte(alerte === "URGENT" ? "" : "URGENT")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ALERTE_CLASSE.URGENT} ${alerte === "URGENT" ? "ring-2 ring-red-400" : ""}`}
            >
              {compte.urgent} urgent{compte.urgent > 1 ? "s" : ""}
            </button>
          )}
          {compte.appro > 0 && (
            <button
              onClick={() => setAlerte(alerte === "APPRO" ? "" : "APPRO")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ALERTE_CLASSE.APPRO} ${alerte === "APPRO" ? "ring-2 ring-amber-400" : ""}`}
            >
              {compte.appro} à réappro.
            </button>
          )}
          {alerte && <button onClick={() => setAlerte("")} className="ml-auto text-xs text-muted-foreground underline">Voir tout</button>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        {!lockedDomaine && (
          <div className="flex gap-1.5 text-sm">
            {(["TOUS", "NOURRITURE", "BOISSON", "AUTRE"] as const).map((k) => (
              <button key={k} onClick={() => setDom(k)} className={`rounded-full border px-3 py-1 ${dom === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{k === "TOUS" ? "Tous" : DOMAINE_LABEL[k]}</button>
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

      {/* À compléter : champs manquants qui brident les alertes et la valorisation. Clic = filtre. */}
      {(incomplets.prix + incomplets.fournisseur + incomplets.seuil + incomplets.unite + incomplets.negatif > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium text-muted-foreground">À compléter :</span>
          {([
            ["seuil", incomplets.seuil, "sans seuil (jamais d'alerte)"],
            ["fournisseur", incomplets.fournisseur, "sans fournisseur"],
            ["prix", incomplets.prix, "sans prix"],
            ["unite", incomplets.unite, "sans unité"],
            ["negatif", incomplets.negatif, "stock négatif"],
          ] as const).filter(([, n]) => n > 0).map(([k, n, lbl]) => (
            <button key={k} onClick={() => setManque(manque === k ? "" : k)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${manque === k ? "border-primary bg-primary/10" : "hover:bg-accent"} ${k === "negatif" ? "text-red-700" : ""}`}>
              {n} {lbl}
            </button>
          ))}
          {manque && <button onClick={() => setManque("")} className="ml-auto text-xs text-muted-foreground underline">Voir tout</button>}
        </div>
      )}

      {/* Correction rapide : le filtre « stock négatif » est actif → remise à 0 en un clic (ajustement tracé). */}
      {manque === "negatif" && visibles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm">
          <span className="font-medium text-red-800">{visibles.length} article(s) en stock négatif</span>
          <span className="text-xs text-red-700/80">Un mouvement d&apos;ajustement (entrée) sera créé pour revenir à 0.</span>
          <button
            disabled={isPending}
            onClick={() => run(async () => { await corrigerStocksNegatifs(visibles.map((a) => a.id)); setManque(""); })}
            className="ml-auto rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Remettre à 0
          </button>
        </div>
      )}

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} sélectionné(s)</span>
          <span className="text-muted-foreground">→ catégoriser :</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            <option value="">Choisir une catégorie…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({(DOMAINE_LABEL[c.domaine] ?? "?")[0]})</option>)}
          </select>
          <button disabled={isPending || !bulkCat} onClick={() => run(async () => { await categoriserEnMasse([...sel], bulkCat); setSel(new Set()); setBulkCat(""); })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">Appliquer</button>
          <span className="text-muted-foreground">· fournisseur :</span>
          <select value={bulkFour} onChange={(e) => setBulkFour(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            <option value="">Choisir un fournisseur…</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          <button disabled={isPending || !bulkFour} onClick={() => run(async () => { await definirFournisseurEnMasse([...sel], bulkFour); setSel(new Set()); setBulkFour(""); })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">Appliquer</button>
          <span className="text-muted-foreground">· seuil min :</span>
          <input type="number" min="0" step="0.001" value={bulkSeuil} onChange={(e) => setBulkSeuil(e.target.value)} placeholder="ex. 4" className="w-16 rounded border border-input bg-background px-2 py-1 text-xs" />
          <button disabled={isPending || bulkSeuil === ""} onClick={() => run(async () => { await definirSeuilEnMasse([...sel], Number(bulkSeuil)); setSel(new Set()); setBulkSeuil(""); })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">Appliquer</button>
          <button disabled={isPending} onClick={() => run(async () => { await basculerActifArticles([...sel], true); setSel(new Set()); })} className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Activer</button>
          <button disabled={isPending} onClick={() => run(async () => { await basculerActifArticles([...sel], false); setSel(new Set()); })} className="rounded-md border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50">Désactiver</button>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground underline">Annuler</button>
          {sel.size >= 2 && (
            <button disabled={isPending} onClick={() => setFusionKeep([...sel][0])} className="ml-auto rounded-md border border-amber-400 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50">Fusionner en 1…</button>
          )}
        </div>
      )}

      {/* Panneau de fusion : choix explicite de l'article à CONSERVER ; les autres sont supprimés. */}
      {fusionKeep && sel.size >= 2 && (() => {
        const selectionnes = articles.filter((a) => sel.has(a.id));
        const keepOk = selectionnes.some((a) => a.id === fusionKeep) ? fusionKeep : selectionnes[0]?.id;
        return (
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
            <p className="mb-2 font-medium text-amber-900">Fusionner {selectionnes.length} articles — lequel <span className="underline">conserver</span> ?</p>
            <p className="mb-2 text-xs text-amber-800">L&apos;article conservé récupère le stock, les mouvements, bons de commande et factures des autres. Les autres sont <strong>supprimés définitivement</strong>.</p>
            <ul className="mb-3 space-y-1">
              {selectionnes.map((a) => (
                <li key={a.id}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 ${keepOk === a.id ? "border-amber-400 bg-amber-100" : "bg-background hover:bg-accent"}`}>
                    <input type="radio" name="fusion-keep" checked={keepOk === a.id} onChange={() => setFusionKeep(a.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{a.code ? `${a.code} · ` : ""}{a.designation}</span>
                      <span className="ml-2 text-xs text-muted-foreground">stock {a.quantite}{a.categorieId ? " · catégorisé" : " · sans catégorie"}{a.prix ? ` · ${usd(Number(a.prix))}` : ""}</span>
                    </span>
                    {keepOk === a.id && <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900">à conserver</span>}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <button disabled={isPending || !keepOk} onClick={() => run(async () => { await fusionnerArticles([...sel], keepOk); setSel(new Set()); setFusionKeep(null); })} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">Fusionner ({selectionnes.length - 1} supprimé{selectionnes.length - 1 > 1 ? "s" : ""})</button>
              <button onClick={() => setFusionKeep(null)} className="text-xs text-muted-foreground underline">Annuler</button>
            </div>
          </div>
        );
      })()}

      <div className="flex items-center justify-between">
        <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{ajout ? "Fermer" : "+ Ajouter un article"}</button>
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
          <input name="code" placeholder="Code article (ex. 137)" className={cellCls} />
          <input name="unite" placeholder="Unité (Kg, Pièce…)" className={cellCls} />
          <input name="prixUnitaireUSD" type="number" step="0.0001" placeholder="Prix USD" className={cellCls} />
          <input name="uniteParCarton" type="number" step="1" min="0" placeholder="Unités / carton (ex. 24)" className={cellCls} />
          <input name="quantite" type="number" step="0.001" placeholder="Stock initial" className={cellCls} />
          <input name="stockMinimum" type="number" step="0.001" placeholder="Stock minimum" className={cellCls} />
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer l&apos;article</button>
        </form>
      )}

      {/* Mobile : cartes éditables (une par article), groupées par catégorie. */}
      <div className="space-y-2 lg:hidden">
        {affichees.map((a, i) => (
          <Fragment key={a.id}>
            {!tri && (i === 0 || affichees[i - 1].categorieId !== a.categorieId) && (
              <div className="px-1 pt-1 text-xs font-bold uppercase tracking-wide text-amber-900">
                {a.categorieId ? catNom.get(a.categorieId) ?? "Catégorie" : "À classer"} ({visibles.filter((x) => x.categorieId === a.categorieId).length})
              </div>
            )}
            <CarteArticle a={a} categories={categories} fournisseurs={fournisseurs} selected={sel.has(a.id)} onToggle={toggle} onSave={save} />
          </Fragment>
        ))}
        {visibles.length === 0 && <EtatVide message="Aucun article." />}
      </div>

      {/* Ordinateur — tableur : cellules éditables, en-tête figé, défilement interne */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-lg border lg:block">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th className="w-8"><input type="checkbox" checked={sel.size > 0 && sel.size === visibles.length} onChange={(e) => toutSel(e.target.checked)} /></th>
              <th className="w-14">Code</th>
              <ThTri col="designation" tri={tri} onTri={trierPar}>Désignation</ThTri>
              <ThTri col="stock" tri={tri} onTri={trierPar} align="right" className="w-16">Stock</ThTri>
              <ThTri col="alerte" tri={tri} onTri={trierPar} className="w-24">Alerte</ThTri>
              <ThTri col="min" tri={tri} onTri={trierPar} align="right" className="w-20">Min</ThTri>
              <ThTri col="categorie" tri={tri} onTri={trierPar}>Catégorie</ThTri>
              <ThTri col="fournisseur" tri={tri} onTri={trierPar}>Fournisseur</ThTri>
              <th className="w-20">Unité</th>
              <ThTri col="valeur" tri={tri} onTri={trierPar} align="right" className="w-24" title="Prix × stock">Valeur</ThTri>
              <ThTri col="prix" tri={tri} onTri={trierPar} align="right" className="w-24">Prix&nbsp;USD</ThTri>
              <th className="w-20 text-right" title="Nombre d'unités par carton">Par carton</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {affichees.map((a, i) => (
              <Fragment key={a.id}>
                {!tri && (i === 0 || affichees[i - 1].categorieId !== a.categorieId) && (
                  <tr>
                    <td colSpan={12} className="bg-amber-100 !py-2 text-sm font-bold uppercase tracking-wide text-amber-900">
                      {a.categorieId ? catNom.get(a.categorieId) ?? "Catégorie" : "À classer"} ({visibles.filter((x) => x.categorieId === a.categorieId).length})
                    </td>
                  </tr>
                )}
                <LigneArticle a={a} categories={categories} fournisseurs={fournisseurs} selected={sel.has(a.id)} onToggle={toggle} onSave={save} />
              </Fragment>
            ))}
            {visibles.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
          {visibles.length > 0 && (
            <tfoot className="sticky bottom-0 bg-muted">
              <tr className="border-t-2 font-semibold [&>td]:px-2 [&>td]:py-2">
                <td colSpan={9} className="text-right">Valeur totale du stock affiché</td>
                <td className="text-right tabular-nums">{usd(affichees.reduce((t, a) => t + valeurStock(a), 0))}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// En-tête de colonne triable : clic = croissant → décroissant → groupé par catégorie.
function ThTri({ col, tri, onTri, align, className, title, children }: {
  col: TriCol; tri: { col: TriCol; dir: 1 | -1 } | null; onTri: (c: TriCol) => void;
  align?: "right"; className?: string; title?: string; children: ReactNode;
}) {
  const actif = tri?.col === col;
  return (
    <th className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`} title={title}>
      <button
        type="button"
        onClick={() => onTri(col)}
        className={`inline-flex items-center gap-0.5 font-semibold hover:text-primary ${align === "right" ? "flex-row-reverse" : ""} ${actif ? "text-primary" : ""}`}
      >
        {children}
        <span className="w-2 text-[10px]">{actif ? (tri!.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

const LigneArticle = memo(function LigneArticle({
  a, categories, fournisseurs, selected, onToggle, onSave,
}: {
  a: ArticleRow; categories: Cat[]; fournisseurs: Four[];
  selected: boolean; onToggle: (id: string) => void; onSave: (id: string, name: string, value: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const catsPour = categories.filter((c) => c.domaine === a.domaine);
  const write = (name: string, value: string, prev: string) => {
    if (value === prev) return;
    setBusy(true);
    onSave(a.id, name, value).finally(() => setBusy(false));
  };

  return (
    <tr className={`hover:bg-accent/40 ${selected ? "bg-primary/10" : "even:bg-muted/25"} ${busy ? "opacity-60" : ""}`}>
      <td><input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} /></td>
      <td><input defaultValue={a.code ?? ""} onBlur={(e) => write("code", e.target.value, a.code ?? "")} className={`${cellCls} w-14 text-center tabular-nums`} placeholder="—" title="Code article" /></td>
      <td>
        <div className="flex items-center gap-1">
          <input defaultValue={a.designation} onBlur={(e) => write("designation", e.target.value, a.designation)} className={`${cellCls} min-w-44 flex-1 font-medium`} title="Modifier le nom de l'article" />
          <Link href={`/stock/catalogue/${a.id}`} title="Ouvrir la fiche article (historique, prix)" className="shrink-0 text-primary hover:text-primary/70" aria-label="Fiche article">↗</Link>
        </div>
      </td>
      <td className="text-right tabular-nums text-muted-foreground" title="Le stock ne se modifie que par la liste d'achat, la facture ou une sortie">{a.quantite}</td>
      <td>{a.niveau && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>{ALERTE_LABEL[a.niveau]}</span>}</td>
      <td><input type="number" step="0.001" defaultValue={a.stockMinimum} onBlur={(e) => write("stockMinimum", e.target.value, a.stockMinimum)} className={`${cellCls} text-right`} title="Seuil minimum (alerte de réappro)" /></td>
      <td>
        <select defaultValue={a.categorieId ?? ""} onChange={(e) => write("categorieId", e.target.value, a.categorieId ?? "")} className={`${cellCls} min-w-32 ${!a.categorieId ? "border-amber-400" : ""}`}>
          <option value="">— à classer —</option>
          {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <select defaultValue={a.fournisseurId ?? ""} onChange={(e) => write("fournisseurId", e.target.value, a.fournisseurId ?? "")} className={`${cellCls} min-w-28 flex-1`}>
            <option value="">—</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          {a.fournisseurId && (
            <Link href={`/stock/fournisseurs/${a.fournisseurId}`} title="Ouvrir la fiche fournisseur" className="shrink-0 text-primary hover:text-primary/70" aria-label="Fiche fournisseur">↗</Link>
          )}
        </div>
      </td>
      <td><input defaultValue={a.unite ?? ""} onBlur={(e) => write("unite", e.target.value, a.unite ?? "")} className={cellCls} placeholder="—" title="Unité de mesure (Kg, Pièce, Bouteille…)" /></td>
      <td className="text-right tabular-nums text-muted-foreground">{usd(valeurStock(a))}</td>
      <td><input type="number" step="0.0001" defaultValue={a.prix ?? ""} onBlur={(e) => write("prixUnitaireUSD", e.target.value, a.prix ?? "")} className={`${cellCls} text-right`} /></td>
      <td><input type="number" step="1" min="0" defaultValue={a.uniteParCarton ?? ""} onBlur={(e) => write("uniteParCarton", e.target.value, a.uniteParCarton ?? "")} className={`${cellCls} text-right`} placeholder="—" title="Nombre d'unités par carton (ex. 24)" /></td>
    </tr>
  );
});

const champLabel = "flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground";

/** Carte éditable d'un article — équivalent mobile de LigneArticle (même logique d'enregistrement au blur). */
const CarteArticle = memo(function CarteArticle({
  a, categories, fournisseurs, selected, onToggle, onSave,
}: {
  a: ArticleRow; categories: Cat[]; fournisseurs: Four[];
  selected: boolean; onToggle: (id: string) => void; onSave: (id: string, name: string, value: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const catsPour = categories.filter((c) => c.domaine === a.domaine);
  const write = (name: string, value: string, prev: string) => {
    if (value === prev) return;
    setBusy(true);
    onSave(a.id, name, value).finally(() => setBusy(false));
  };

  return (
    <div className={`rounded-xl border p-3 ${selected ? "bg-primary/10" : "bg-card"} ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} className="mt-2 shrink-0" aria-label="Sélectionner" />
        <input defaultValue={a.designation} onBlur={(e) => write("designation", e.target.value, a.designation)} className={`${cellCls} flex-1 min-w-0 !py-1.5 !text-sm font-medium`} title="Modifier le nom" />
        <Link href={`/stock/catalogue/${a.id}`} className="mt-1.5 shrink-0 text-primary hover:text-primary/70" title="Fiche article" aria-label="Fiche article">↗</Link>
        {a.niveau && <span className={`mt-1 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${ALERTE_CLASSE[a.niveau]}`}>{ALERTE_LABEL[a.niveau]}</span>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {/* Stock + seuil mis en avant (comme les colonnes du tableur). */}
        <label className={champLabel}>Stock (auto)
          <span className={`rounded border px-1.5 py-1.5 text-right text-xs font-medium tabular-nums ${Number(a.quantite) < 0 ? "border-red-300 bg-red-50 text-red-700" : "border-input/40 bg-muted/40 text-muted-foreground"}`}>{a.quantite}</span>
        </label>
        <label className={champLabel}>Stock min.
          <input type="number" step="0.001" defaultValue={a.stockMinimum} onBlur={(e) => write("stockMinimum", e.target.value, a.stockMinimum)} className={`${cellCls} !py-1.5 text-right`} />
        </label>
        <label className={`${champLabel} col-span-2`}>Catégorie
          <select defaultValue={a.categorieId ?? ""} onChange={(e) => write("categorieId", e.target.value, a.categorieId ?? "")} className={`${cellCls} !py-1.5 ${!a.categorieId ? "border-amber-400" : ""}`}>
            <option value="">— à classer —</option>
            {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </label>
        <label className={`${champLabel} col-span-2`}>
          <span className="flex items-center justify-between">Fournisseur
            {a.fournisseurId && (
              <Link href={`/stock/fournisseurs/${a.fournisseurId}`} className="text-primary hover:underline">Voir la fiche ↗</Link>
            )}
          </span>
          <select defaultValue={a.fournisseurId ?? ""} onChange={(e) => write("fournisseurId", e.target.value, a.fournisseurId ?? "")} className={`${cellCls} !py-1.5`}>
            <option value="">—</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </label>
        <label className={champLabel}>Code article
          <input defaultValue={a.code ?? ""} onBlur={(e) => write("code", e.target.value, a.code ?? "")} className={`${cellCls} !py-1.5`} placeholder="—" />
        </label>
        <label className={champLabel}>Unité
          <input defaultValue={a.unite ?? ""} onBlur={(e) => write("unite", e.target.value, a.unite ?? "")} className={`${cellCls} !py-1.5`} placeholder="Kg, Pièce…" />
        </label>
        <label className={champLabel}>Valeur
          <span className="rounded border border-input/40 bg-muted/40 px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{usd(valeurStock(a))}</span>
        </label>
        <label className={champLabel}>Prix USD
          <input type="number" step="0.0001" defaultValue={a.prix ?? ""} onBlur={(e) => write("prixUnitaireUSD", e.target.value, a.prix ?? "")} className={`${cellCls} !py-1.5 text-right`} />
        </label>
        <label className={`${champLabel} col-span-2`}>Unités / carton
          <input type="number" step="1" min="0" defaultValue={a.uniteParCarton ?? ""} onBlur={(e) => write("uniteParCarton", e.target.value, a.uniteParCarton ?? "")} className={`${cellCls} !py-1.5 text-right`} placeholder="ex. 24" />
        </label>
      </div>
    </div>
  );
});

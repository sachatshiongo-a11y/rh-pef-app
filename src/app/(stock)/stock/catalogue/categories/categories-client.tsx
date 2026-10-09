"use client";

import { useMemo, useState, useTransition } from "react";
import { basculerActifCategories, creerCategorie, deplacerCategorie, modifierCategorie, supprimerCategories } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { EtatVide } from "@/components/etat-vide";
import { PilulesDomaine, type DomaineCle } from "@/components/stock/pilules-domaine";
import { DOMAINE_LABEL } from "@/lib/stock";
import { NOM_CATEGORIE_MAX } from "@/lib/categorie-stock";

export type CategorieRow = { id: string; nom: string; domaine: string; actif: boolean; nbArticles: number };

const DOMAINES: DomaineCle[] = ["NOURRITURE", "BOISSON", "AUTRE"];
const cellCls = "w-full rounded border border-input bg-background px-2 py-1.5 text-sm";
const boutonLigne = "rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent";
const articles = (n: number) => `${n.toLocaleString("fr-FR")} article${n > 1 ? "s" : ""}`;

/**
 * Catégories de l'Inventaire : listées par domaine (mêmes pastilles que l'Inventaire), avec leur nombre
 * d'articles. Direction : cases à cocher + barre d'actions groupées (archiver, réactiver, supprimer),
 * création, renommage / changement de domaine en ligne, monter / descendre. Autres rôles : lecture.
 * Les `rows` arrivent du serveur dans l'ordre affiché (domaine, ordre, nom).
 */
export function CategoriesClient({ categories, estDirection }: { categories: CategorieRow[]; estDirection: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [domaine, setDomaine] = useState<DomaineCle | "">("");
  const [ajout, setAjout] = useState(false);
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const { sel, toggle, clear, setAll } = useBulkSelection();

  const run = (fn: () => Promise<unknown>) => {
    setErreur(null);
    startTransition(async () => { const r = await fn(); if (estErreur(r)) setErreur(r.erreur); });
  };

  const comptes = useMemo(() => ({
    TOUS: categories.length,
    NOURRITURE: categories.filter((c) => c.domaine === "NOURRITURE").length,
    BOISSON: categories.filter((c) => c.domaine === "BOISSON").length,
    AUTRE: categories.filter((c) => c.domaine === "AUTRE").length,
  }), [categories]);
  const sections = useMemo(
    () => DOMAINES.filter((d) => !domaine || d === domaine).map((d) => ({ domaine: d, lignes: categories.filter((c) => c.domaine === d) })).filter((s) => s.lignes.length > 0),
    [categories, domaine],
  );
  const visibles = useMemo(() => sections.flatMap((s) => s.lignes), [sections]);
  const cochees = visibles.filter((c) => sel.has(c.id));

  const appliquer = (fn: (ids: string[]) => Promise<unknown>) => run(async () => { const r = await fn(cochees.map((c) => c.id)); if (!estErreur(r)) clear(); return r; });
  const supprimer = () => {
    const pleines = cochees.filter((c) => c.nbArticles > 0);
    if (pleines.length > 0) { setErreur(`Suppression impossible : ${pleines.map((c) => `« ${c.nom} » (${articles(c.nbArticles)})`).join(", ")} — déplacez d'abord les articles, ou archivez plutôt la catégorie. Rien n'a été supprimé.`); return; }
    if (!confirm(`Supprimer ${cochees.length} catégorie${cochees.length > 1 ? "s" : ""} vide${cochees.length > 1 ? "s" : ""} (${cochees.map((c) => `« ${c.nom} »`).join(", ")}) ?\n\nAucun article n'est concerné. Action irréversible.`)) return;
    appliquer(supprimerCategories);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold sm:text-2xl">Catégories</h1>
          <PilulesDomaine actif={domaine} comptes={comptes} pilule={(d, p) => (
            <button type="button" onClick={() => { setDomaine(d.cle); clear(); }} className={p.className}>{p.children}</button>
          )} />
        </div>
        {estDirection && (
          <button type="button" onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            {ajout ? "Fermer" : "+ Nouvelle catégorie"}
          </button>
        )}
      </div>

      {erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {!estDirection && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Consultation — seule la Direction peut créer, renommer, ordonner, archiver ou supprimer une catégorie.</p>}

      {ajout && estDirection && (
        <form action={(fd) => run(async () => { const r = await creerCategorie(fd); if (!estErreur(r)) setAjout(false); return r; })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm md:grid-cols-4">
          <input name="nom" placeholder="Nom de la catégorie *" required maxLength={NOM_CATEGORIE_MAX} aria-label="Nom de la nouvelle catégorie" className={`${cellCls} col-span-2`} />
          <select name="domaine" defaultValue={domaine || "NOURRITURE"} aria-label="Domaine de la nouvelle catégorie" className={cellCls}>
            {DOMAINES.map((d) => <option key={d} value={d}>{DOMAINE_LABEL[d]}</option>)}
          </select>
          <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">Créer la catégorie</button>
          <p className="col-span-2 text-xs text-muted-foreground md:col-span-4">Un nom déjà pris dans le même domaine (même à une majuscule, un accent ou un pluriel près) est refusé : la catégorie existante est nommée.</p>
        </form>
      )}

      {estDirection && visibles.length > 0 && (
        <BulkBar count={cochees.length} total={visibles.length} cochesAffichees={cochees.length} onAll={(on) => setAll(visibles.map((c) => c.id), on)}>
          <button type="button" disabled={isPending} onClick={() => appliquer((ids) => basculerActifCategories(ids, false))} className="rounded-md border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50">Archiver</button>
          <button type="button" disabled={isPending} onClick={() => appliquer((ids) => basculerActifCategories(ids, true))} className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Réactiver</button>
          <button type="button" disabled={isPending} onClick={supprimer} className="rounded-md border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">Supprimer</button>
        </BulkBar>
      )}

      {visibles.length === 0 ? (
        <EtatVide message={categories.length === 0 ? "Aucune catégorie pour le moment." : "Aucune catégorie dans ce domaine."} action={estDirection ? <button type="button" onClick={() => setAjout(true)} className="text-primary underline">Créer une catégorie</button> : undefined} />
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <section key={s.domaine} aria-label={DOMAINE_LABEL[s.domaine]}>
              <h2 className="mb-1 px-1 text-sm font-semibold text-muted-foreground">{DOMAINE_LABEL[s.domaine]} <span className="font-normal">· {s.lignes.length}</span></h2>
              <ul className="divide-y overflow-hidden rounded-lg border">
                {s.lignes.map((c, i) => (
                  <li key={c.id} data-categorie={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${c.actif ? "" : "bg-muted/30"}`}>
                    {estDirection && <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Sélectionner ${c.nom}`} />}
                    {enEdition === c.id && estDirection ? (
                      <EditionLigne c={c} pending={isPending}
                        onAnnuler={() => setEnEdition(null)}
                        onEnregistrer={(fd) => run(async () => { const r = await modifierCategorie(c.id, fd); if (!estErreur(r)) setEnEdition(null); return r; })} />
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <span className={`font-medium ${c.actif ? "" : "text-muted-foreground"}`}>{c.nom}</span>
                          {!c.actif && <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Archivée</span>}
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">{articles(c.nbArticles)}</span>
                        {estDirection && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button type="button" disabled={isPending || i === 0} onClick={() => run(() => deplacerCategorie(c.id, "haut"))} aria-label={`Monter ${c.nom}`} title="Monter" className={boutonLigne}>↑</button>
                            <button type="button" disabled={isPending || i === s.lignes.length - 1} onClick={() => run(() => deplacerCategorie(c.id, "bas"))} aria-label={`Descendre ${c.nom}`} title="Descendre" className={boutonLigne}>↓</button>
                            <button type="button" disabled={isPending} onClick={() => { setEnEdition(c.id); setErreur(null); }} className={boutonLigne}>Modifier</button>
                            <button type="button" disabled={isPending} onClick={() => run(() => basculerActifCategories([c.id], !c.actif))} className={boutonLigne}>{c.actif ? "Archiver" : "Réactiver"}</button>
                            <button type="button" disabled={isPending || c.nbArticles > 0} onClick={() => { if (confirm(`Supprimer la catégorie vide « ${c.nom} » ? Action irréversible.`)) run(() => supprimerCategories([c.id])); }}
                              aria-label={`Supprimer ${c.nom}`} title={c.nbArticles > 0 ? "Impossible : elle contient des articles (déplacez-les d'abord)" : "Supprimer cette catégorie vide"}
                              className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:hover:bg-transparent">✕</button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {estDirection && <p className="text-xs text-muted-foreground">Une catégorie archivée n&apos;est plus proposée dans les listes de choix ; ses articles restent visibles et rattachés. On ne supprime qu&apos;une catégorie vide.</p>}
    </div>
  );
}

/** Renommer et, si la catégorie est vide, changer de domaine : le domaine d'un article ne change jamais par ici. */
function EditionLigne({ c, pending, onAnnuler, onEnregistrer }: { c: CategorieRow; pending: boolean; onAnnuler: () => void; onEnregistrer: (fd: FormData) => void }) {
  const vide = c.nbArticles === 0;
  return (
    <form action={onEnregistrer} className="grid min-w-0 flex-1 grid-cols-2 items-end gap-2 md:grid-cols-[1fr_12rem_auto]">
      <label className="col-span-2 flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground md:col-span-1">Nom
        <input name="nom" defaultValue={c.nom} required maxLength={NOM_CATEGORIE_MAX} autoFocus className={cellCls} />
      </label>
      <label className="col-span-2 flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground md:col-span-1">Domaine
        <select name="domaine" defaultValue={c.domaine} disabled={!vide} className={`${cellCls} disabled:opacity-60`}>
          {DOMAINES.map((d) => <option key={d} value={d}>{DOMAINE_LABEL[d]}</option>)}
        </select>
        {!vide && <span className="font-normal">Déplacez d&apos;abord ses {articles(c.nbArticles)} pour changer de domaine.</span>}
      </label>
      {/* Un <select> désactivé n'est pas envoyé : le domaine reste celui de la catégorie. */}
      <div className="col-span-2 flex gap-2 md:col-span-1">
        <button disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Enregistrer</button>
        <button type="button" onClick={onAnnuler} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Annuler</button>
      </div>
    </form>
  );
}

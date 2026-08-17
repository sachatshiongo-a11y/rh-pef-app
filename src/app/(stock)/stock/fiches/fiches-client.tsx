"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useBulkSelection, BulkBar } from "@/components/bulk-bar";
import { VignettePlat } from "@/components/vignette-plat";
import { EtatVide } from "@/components/etat-vide";
import { estErreur } from "@/lib/action-lisible";
import { usd } from "@/lib/stock";
import { normTexte } from "@/lib/texte";
import { pct, TYPE_LABEL } from "./_data/fiche-calc";
import { creerFiche, supprimerFiches, dupliquerFiches } from "./actions";

export type FicheRow = {
  id: string;
  nom: string;
  categorie: string;
  type: string;
  estSousRecette: boolean;
  actif: boolean;
  /** Photo du plat — pure affichage (référence de dressage), aucune incidence sur le coût. */
  photoUrl: string | null;
  nbPortions: number;
  nbIngredients: number;
  coutPortion: number;
  coutConnu: boolean;
  /** Le coût est minoré par des ingrédients non valorisés (≥). */
  coutPartiel: boolean;
  /** `coutPartiel` OU un nombre de portions inexploitable. */
  incomplet: boolean;
  nbIndetermines: number;
  prixVenteHT: number | null;
  prixEstConseille: boolean;
  tauxMarque: number | null;
};

const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";

/**
 * `incomplet` a TROIS causes, pas deux — et elles n'appellent pas la même correction :
 *   1. des ingrédients non valorisés (le coût affiché est un minorant, d'où le « ≥ ») ;
 *   2. AUCUN ingrédient saisi (fiche vide : le coût n'est pas 0, il est inconnu) ;
 *   3. un nombre de portions inexploitable (le coût total, lui, reste exact).
 * Sans la 2e, une fiche vide s'annonçait « Portions inexploitables » — un motif faux qui envoie
 * corriger l'entête alors qu'il manque toute la recette. Quand une fiche vide a EN PLUS des
 * portions invalides, on nomme le manque d'ingrédients : c'est la correction à faire d'abord.
 */
function motifIncomplet(f: FicheRow): { badge: string; cause: string } {
  if (f.coutPartiel) return { badge: `Coût partiel — ${f.nbIndetermines} ingrédient(s)`, cause: "coût partiel" };
  if (f.nbIngredients === 0) return { badge: "Aucun ingrédient saisi", cause: "aucun ingrédient saisi" };
  return { badge: "Portions inexploitables", cause: "portions inexploitables" };
}

/**
 * Liste des fiches techniques : navigation (le nom mène à la fiche, où se fait l'édition) +
 * actions groupées (supprimer / dupliquer / exporter) sur la sélection.
 */
export function FichesClient({ fiches }: { fiches: FicheRow[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [q, setQ] = useState("");
  const [categorie, setCategorie] = useState("");
  const [nature, setNature] = useState<"" | "PLAT_FINAL" | "SOUS_RECETTE" | "PARTIEL">("");
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();

  const run = (fn: () => Promise<unknown>) => {
    setErreur(null);
    start(async () => {
      const r = await fn();
      if (estErreur(r)) { setErreur(r.erreur); return; }
      clear();
    });
  };

  const categories = useMemo(
    () => [...new Set(fiches.map((f) => f.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")),
    [fiches],
  );

  const visibles = useMemo(() => {
    const nq = normTexte(q.trim());
    return fiches.filter((f) => {
      if (nq && !normTexte(`${f.nom} ${f.categorie}`).includes(nq)) return false;
      if (categorie && f.categorie !== categorie) return false;
      if (nature === "SOUS_RECETTE" && !f.estSousRecette) return false;
      if (nature === "PLAT_FINAL" && f.estSousRecette) return false;
      if (nature === "PARTIEL" && !f.incomplet) return false;
      return true;
    });
  }, [fiches, q, categorie, nature]);

  const creer = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      const r = await creerFiche(fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setAjout(false);
      router.push(`/stock/fiches/${r.id}`);
    });
  };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom, catégorie)…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        <select value={categorie} onChange={(e) => setCategorie(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="">Toutes les catégories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={nature} onChange={(e) => setNature(e.target.value as typeof nature)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="">Toutes les fiches</option>
          <option value="PLAT_FINAL">Plats vendus</option>
          <option value="SOUS_RECETTE">Sous-recettes</option>
          <option value="PARTIEL">Coût partiel</option>
        </select>
        <span className="text-xs text-muted-foreground">{visibles.length} / {fiches.length} fiche(s)</span>
        <button onClick={() => setAjout((v) => !v)} className="ml-auto rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          {ajout ? "Fermer" : "+ Nouvelle fiche"}
        </button>
      </div>

      {ajout && (
        <form action={creer} className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-4">
          <input name="nom" placeholder="Nom de la fiche *" required className={inp} />
          <input name="categorie" placeholder="Catégorie (ex. Pâtes classiques)" className={inp} />
          <input name="nbPortions" type="number" min="1" step="1" defaultValue="1" placeholder="Portions" className={inp} />
          <select name="type" defaultValue="PLAT" className={inp}>
            <option value="PLAT">Plat</option>
            <option value="BAR">Bar</option>
          </select>
          <label className="col-span-2 flex items-center gap-2 text-xs md:col-span-4">
            <input type="checkbox" name="estSousRecette" />
            <span>C&apos;est une <strong>sous-recette</strong> (sauce, base…) : elle n&apos;a pas de prix de vente, elle entre dans d&apos;autres fiches.</span>
          </label>
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer la fiche</button>
        </form>
      )}

      {fiches.length > 0 && (
        <BulkBar count={sel.size} total={visibles.length} onAll={(on) => setAll(visibles.map((f) => f.id), on)}>
          <a
            href={`/stock/fiches/export?ids=${ids.join(",")}`}
            download
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            ⭳ Exporter ({sel.size})
          </a>
          <button
            disabled={isPending}
            onClick={() => run(() => dupliquerFiches(ids))}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            ⧉ Dupliquer ({sel.size})
          </button>
          <button
            disabled={isPending}
            onClick={() => { if (confirm(`Supprimer ${sel.size} fiche(s) et leurs ingrédients ? Action irréversible.`)) run(() => supprimerFiches(ids)); }}
            className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            ✕ Supprimer ({sel.size})
          </button>
          <button onClick={clear} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Désélectionner</button>
        </BulkBar>
      )}

      {visibles.length === 0 ? (
        <EtatVide message={fiches.length ? "Aucune fiche pour ce filtre." : "Aucune fiche technique. Créez-en une pour connaître le coût de revient d'un plat."} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border text-sm">
          {visibles.map((f) => (
            <li key={f.id} className={`flex items-center gap-2 px-3 py-2 ${sel.has(f.id) ? "bg-primary/10" : "hover:bg-accent/40"}`}>
              <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="shrink-0" aria-label={`Sélectionner ${f.nom}`} />
              {/* Vignette : la photo si la fiche en a une, sinon un cadre neutre — carré à coins
                  arrondis (jamais un cercle : un plat n'est pas un visage, voir vignette-plat.tsx). */}
              <Link href={`/stock/fiches/${f.id}`} className="shrink-0" tabIndex={-1} aria-hidden>
                <VignettePlat nom={f.nom} photoUrl={f.photoUrl} />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/stock/fiches/${f.id}`} className="font-medium text-primary hover:underline">{f.nom}</Link>
                {f.estSousRecette && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-800">Sous-recette</span>}
                {!f.actif && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Inactive</span>}
                <div className="truncate text-xs text-muted-foreground">
                  {[f.categorie || "Sans catégorie", TYPE_LABEL[f.type] ?? f.type, `${f.nbPortions} portion(s)`, `${f.nbIngredients} ingrédient(s)`].join(" · ")}
                </div>
              </div>

              {/* Un coût partiel n'est JAMAIS affiché en chiffre nu : le « ≥ » ET le badge vivent
                  dans la MÊME cellule que le montant, donc à toute largeur d'écran. L'app est
                  installée en PWA sur téléphone : une colonne masquée sous 640 px emporterait la
                  mention et laisserait le chiffre tout seul. */}
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">
                  {f.coutConnu ? `${f.coutPartiel ? "≥ " : ""}${usd(f.coutPortion)}` : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">coût / portion</div>
                {f.incomplet && (
                  <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    {motifIncomplet(f).badge}
                  </span>
                )}
              </div>

              <div className="hidden w-40 shrink-0 text-right sm:block">
                {f.incomplet ? (
                  <span className="text-[11px] text-muted-foreground">Prix et marge non fiables : {motifIncomplet(f).cause}</span>
                ) : f.estSousRecette ? (
                  <span className="text-[11px] text-muted-foreground">Sous-recette : pas de marge</span>
                ) : (
                  <>
                    <div className="text-xs tabular-nums">{usd(f.prixVenteHT)} HT</div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.prixEstConseille ? "conseillé · " : ""}taux de marque {pct(f.tauxMarque)}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

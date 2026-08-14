"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useBulkSelection, BulkBar } from "@/components/bulk-bar";
import { estErreur } from "@/lib/action-lisible";
import { arrondirCentime, calculerCout, type FicheCalc, type LigneCout } from "@/lib/fiches/cout";
import { usd, qte } from "@/lib/stock";
import {
  MOTIF_LABEL, coef, pct, versFicheCalc,
  type ArticleOption, type FicheVue, type LigneFiche,
} from "../_data/fiche-calc";
import { ajouterIngredient, dupliquerFiches, modifierFiche, remplacerIngredients, supprimerFiches, supprimerIngredients } from "../actions";

type AutreFiche = { id: string; nom: string; estSousRecette: boolean };

const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const champ = "flex flex-col gap-1 text-xs text-muted-foreground";

/** Encodage du sélecteur de source : une ligne est un article OU une sous-recette, jamais les deux. */
const valeurSource = (l: { articleId: string | null; sousFicheId: string | null }) =>
  l.articleId ? `art:${l.articleId}` : l.sousFicheId ? `fiche:${l.sousFicheId}` : "";
const decoderSource = (v: string) => ({
  articleId: v.startsWith("art:") ? v.slice(4) : null,
  sousFicheId: v.startsWith("fiche:") ? v.slice(6) : null,
});

/**
 * Fiche technique : entête, ingrédients et coût de revient.
 *
 * ⚠️ Aucun coût, aucune marge, aucun prix n'est calculé ici : tout vient de `calculerCout`
 * (`src/lib/fiches/cout.ts`), appelé à chaque frappe sur l'état courant du formulaire. C'est la
 * même fonction que côté serveur — un seul chiffre possible pour une même fiche.
 */
export function EditerFiche({
  vue, articles, autresFiches, contexte,
}: {
  vue: FicheVue;
  articles: ArticleOption[];
  autresFiches: AutreFiche[];
  contexte: FicheCalc[];
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ent, setEnt] = useState(vue);
  const [lignes, setLignes] = useState<LigneFiche[]>(vue.lignes);
  const [nouvelle, setNouvelle] = useState({ source: "", unite: "", quantite: "" });
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();

  const mapArticles = new Map(articles.map((a) => [a.id, a]));
  const mapNoms = new Map<string, { nom: string }>([
    [vue.id, { nom: ent.nom }],
    ...autresFiches.map((f) => [f.id, { nom: f.nom }] as [string, { nom: string }]),
  ]);

  // Recalcul en direct sur l'état du formulaire (valeurs non encore enregistrées comprises).
  const resultat = calculerCout(versFicheCalc({ ...ent, lignes }, mapArticles, mapNoms), {
    fiches: new Map(contexte.map((f) => [f.id, f])),
  });
  const coutConnu = resultat.lignes.some((l) => l.cout !== null);
  // `incomplet` couvre deux causes distinctes : des ingrédients non valorisés (le coût est alors un
  // minorant : ce qui manque ne peut qu'ajouter) et un nombre de portions inexploitable (le coût
  // total, lui, reste juste). On les distingue pour ne pas écrire « ≥ » sur un chiffre exact.
  const coutPartiel = resultat.ingredientsSansPrix.length > 0 || resultat.cycle;
  const portionsInvalides = !Number.isFinite(ent.nbPortions) || ent.nbPortions <= 0;

  const initiales = new Map(vue.lignes.map((l) => [l.id, l]));
  const ligneModifiee = (l: LigneFiche) => {
    const o = initiales.get(l.id);
    return !o || o.articleId !== l.articleId || o.sousFicheId !== l.sousFicheId || o.unite !== l.unite || o.quantite !== l.quantite;
  };
  const modifiees = lignes.filter(ligneModifiee);

  const run = (fn: () => Promise<unknown>, apres?: () => void) => {
    setErreur(null);
    start(async () => {
      const r = await fn();
      if (estErreur(r)) { setErreur(r.erreur); return; }
      apres?.();
    });
  };

  const majLigne = (id: string, patch: Partial<LigneFiche>) =>
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  // Le tableau part EN UN SEUL APPEL transactionnel : le serveur valide TOUTES les lignes avant la
  // moindre écriture. Un refus n'écrit rien du tout — la fiche ne peut pas rester à moitié ancienne,
  // à moitié nouvelle, avec un coût recalculé sur ce mélange.
  const enregistrerIngredients = () =>
    run(
      () => remplacerIngredients(vue.id, lignes.map(({ id, articleId, sousFicheId, unite, quantite }) => ({ id, articleId, sousFicheId, unite, quantite }))),
      () => router.refresh(),
    );

  const ajouter = (fd: FormData) => {
    const { articleId, sousFicheId } = decoderSource(String(fd.get("source") ?? ""));
    fd.set("articleId", articleId ?? "");
    fd.set("sousFicheId", sousFicheId ?? "");
    run(() => ajouterIngredient(vue.id, fd), () => { setNouvelle({ source: "", unite: "", quantite: "" }); router.refresh(); });
  };

  const supprimer = () => {
    if (!confirm(`Supprimer la fiche « ${vue.nom} » et ses ingrédients ? Action irréversible.`)) return;
    run(() => supprimerFiches([vue.id]), () => router.push("/stock/fiches"));
  };

  const dupliquer = () => {
    setErreur(null);
    start(async () => {
      const r = await dupliquerFiches([vue.id]);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (r.ids[0]) router.push(`/stock/fiches/${r.ids[0]}`);
    });
  };

  return (
    <div className="space-y-5">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{ent.nom}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[ent.categorie || "Sans catégorie", ent.estSousRecette ? "Sous-recette" : "Plat vendu", `${lignes.length} ingrédient(s)`].join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={dupliquer} disabled={isPending} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">⧉ Dupliquer</button>
          <button onClick={supprimer} disabled={isPending} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">Supprimer</button>
        </div>
      </div>

      {/* ── Entête ───────────────────────────────────────────────────────── */}
      <form action={(fd) => run(() => modifierFiche(vue.id, fd))} className="rounded-xl border p-4">
        <h2 className="mb-3 text-base font-semibold">Entête</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className={`${champ} col-span-2`}>Nom *
            <input name="nom" value={ent.nom} onChange={(e) => setEnt({ ...ent, nom: e.target.value })} required className={`${inp} w-full text-foreground`} />
          </label>
          <label className={champ}>Catégorie
            <input name="categorie" value={ent.categorie} onChange={(e) => setEnt({ ...ent, categorie: e.target.value })} className={`${inp} w-full text-foreground`} />
          </label>
          <label className={champ}>Type
            <select name="type" value={ent.type} onChange={(e) => setEnt({ ...ent, type: e.target.value })} className={`${inp} w-full text-foreground`}>
              <option value="PLAT">Plat</option>
              <option value="BAR">Bar</option>
            </select>
          </label>
          <label className={champ}>Portions
            <input name="nbPortions" type="number" min="1" step="1" value={ent.nbPortions} onChange={(e) => setEnt({ ...ent, nbPortions: Number(e.target.value) })} className={`${inp} w-full text-foreground`} />
          </label>
          <label className={champ}>TVA (décimal : 0,16 = 16 %)
            <input name="tauxTVA" type="number" min="0" max="1" step="0.0001" value={ent.tauxTVA} onChange={(e) => setEnt({ ...ent, tauxTVA: e.target.value })} className={`${inp} w-full text-foreground`} />
          </label>
          <label className={champ} title="Mode par défaut : prix de vente HT = coût de revient × coefficient">Coefficient cible
            <input name="coefficientMargeCible" type="number" min="0" step="0.01" value={ent.coefficientMargeCible} onChange={(e) => setEnt({ ...ent, coefficientMargeCible: e.target.value })} placeholder="ex. 8" className={`${inp} w-full text-foreground`} />
          </label>
          <label className={champ} title="Laissez vide pour laisser le coefficient conduire le prix">Prix de vente TTC décidé
            <input name="prixVenteTTC" type="number" min="0" step="0.01" value={ent.prixVenteTTC} onChange={(e) => setEnt({ ...ent, prixVenteTTC: e.target.value })} placeholder="—" className={`${inp} w-full text-foreground`} />
          </label>

          <label className="col-span-2 flex items-center gap-2 text-xs md:col-span-2">
            <input type="checkbox" name="estSousRecette" checked={ent.estSousRecette} onChange={(e) => setEnt({ ...ent, estSousRecette: e.target.checked })} />
            <span>Sous-recette (entre dans d&apos;autres fiches, pas de prix de vente attendu)</span>
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs md:col-span-2">
            <input type="checkbox" name="actif" checked={ent.actif} onChange={(e) => setEnt({ ...ent, actif: e.target.checked })} />
            <span>Fiche active</span>
          </label>

          {/* Fiche redevenue « plat » : on conserve le rendement déjà saisi plutôt que de l'effacer
              en silence à l'enregistrement (il redeviendra utile si la fiche repasse sous-recette). */}
          {!ent.estSousRecette && (
            <>
              <input type="hidden" name="rendementQuantite" value={ent.rendementQuantite} />
              <input type="hidden" name="rendementUnite" value={ent.rendementUnite} />
            </>
          )}

          {ent.estSousRecette && (
            <>
              <label className={champ}>Rendement (quantité)
                <input name="rendementQuantite" type="number" min="0" step="0.001" value={ent.rendementQuantite} onChange={(e) => setEnt({ ...ent, rendementQuantite: e.target.value })} placeholder="ex. 4600" className={`${inp} w-full text-foreground`} />
              </label>
              <label className={champ} title="Unité de BASE uniquement : « g » ou « ml ». Le coût d'une sous-recette se calcule sans conversion.">Rendement (unité)
                <input name="rendementUnite" value={ent.rendementUnite} onChange={(e) => setEnt({ ...ent, rendementUnite: e.target.value })} placeholder="g" className={`${inp} w-full text-foreground`} />
              </label>
              <p className="col-span-2 self-end text-[11px] text-muted-foreground">
                Le rendement doit être dans la <strong>même unité</strong> que la consommation des fiches qui l&apos;utilisent (« g » pour une sauce). Sinon le coût est refusé plutôt que faussé.
              </p>
            </>
          )}

          <label className={`${champ} col-span-2 md:col-span-4`}>Recette / mode opératoire
            <textarea name="recette" rows={4} value={ent.recette} onChange={(e) => setEnt({ ...ent, recette: e.target.value })} className={`${inp} w-full text-foreground`} />
          </label>
        </div>
        <button disabled={isPending} className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Enregistrer l'entête"}
        </button>
      </form>

      {/* ── Ingrédients ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Ingrédients ({lignes.length})</h2>
          {modifiees.length > 0 && (
            <button onClick={enregistrerIngredients} disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Enregistrer {modifiees.length} modification(s)
            </button>
          )}
        </div>

        {lignes.length > 0 && (
          <BulkBar count={sel.size} total={lignes.length} onAll={(on) => setAll(lignes.map((l) => l.id), on)}>
            <button
              disabled={isPending || modifiees.length > 0}
              title={modifiees.length > 0 ? "Enregistrez d'abord les modifications en cours" : undefined}
              onClick={() => { if (confirm(`Retirer ${sel.size} ingrédient(s) de la fiche ?`)) run(() => supprimerIngredients(vue.id, ids), () => { clear(); router.refresh(); }); }}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              ✕ Retirer ({sel.size})
            </button>
            <button onClick={clear} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Désélectionner</button>
          </BulkBar>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2">Article du stock ou sous-recette</th>
                <th className="px-2 py-2">Unité de conso.</th>
                <th className="px-2 py-2 text-right">Quantité</th>
                <th className="px-2 py-2 text-right">Coût HT</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <LigneIngredient
                  key={l.id}
                  ligne={l}
                  cout={resultat.lignes[i]}
                  article={l.articleId ? mapArticles.get(l.articleId) : undefined}
                  sousFiche={l.sousFicheId ? autresFiches.find((f) => f.id === l.sousFicheId) : undefined}
                  articles={articles}
                  autresFiches={autresFiches}
                  modifiee={ligneModifiee(l)}
                  selectionnee={sel.has(l.id)}
                  onToggle={() => toggle(l.id)}
                  onChange={(patch) => majLigne(l.id, patch)}
                />
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun ingrédient. Ajoutez-en un ci-dessous.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Ajout d'une ligne */}
        <form action={ajouter} className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <label className={champ}>Article ou sous-recette
            <select name="source" required value={nouvelle.source} onChange={(e) => setNouvelle({ ...nouvelle, source: e.target.value })} className={`${inp} w-72 text-foreground`}>
              <option value="">— choisir —</option>
              <OptionsSource articles={articles} autresFiches={autresFiches} />
            </select>
          </label>
          <label className={champ}>Unité
            <input name="unite" required value={nouvelle.unite} onChange={(e) => setNouvelle({ ...nouvelle, unite: e.target.value })} placeholder="g, cl, pièce…" className={`${inp} w-28 text-foreground`} />
          </label>
          <label className={champ}>Quantité
            <input name="quantite" type="number" min="0" step="0.001" required value={nouvelle.quantite} onChange={(e) => setNouvelle({ ...nouvelle, quantite: e.target.value })} className={`${inp} w-28 text-right text-foreground`} />
          </label>
          <button disabled={isPending} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">+ Ajouter l&apos;ingrédient</button>
        </form>
      </section>

      {/* ── Coût de revient ──────────────────────────────────────────────── */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-base font-semibold">Coût de revient (recalculé, jamais stocké)</h2>

        {coutPartiel && <BandeauPartiel resultat={resultat} />}
        {portionsInvalides && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚠ Nombre de portions inexploitable : le coût par portion est calculé sur <strong>1 portion</strong>. Corrigez l&apos;entête.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label={coutPartiel ? "Coût total HT (partiel)" : "Coût total HT"} valeur={coutConnu ? `${coutPartiel ? "≥ " : ""}${usd(arrondirCentime(resultat.coutTotal))}` : "—"} accent={coutPartiel ? "amber" : undefined} />
          <Kpi label={coutPartiel ? "Coût / portion (partiel)" : "Coût / portion"} valeur={coutConnu ? `${coutPartiel ? "≥ " : ""}${usd(arrondirCentime(resultat.coutParPortion))}` : "—"} accent={coutPartiel || portionsInvalides ? "amber" : undefined} />
          <Kpi label="Portions" valeur={portionsInvalides ? "—" : `${ent.nbPortions}`} accent={portionsInvalides ? "amber" : undefined} />
          {ent.estSousRecette && <Kpi label="Rendement" valeur={ent.rendementQuantite ? `${qte(ent.rendementQuantite)} ${ent.rendementUnite || "?"}` : "—"} accent={ent.rendementQuantite ? undefined : "amber"} />}
        </div>

        {!coutConnu && lignes.length > 0 && (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Aucun ingrédient n&apos;est valorisé : cette fiche n&apos;a pas de coût connu (et surtout pas un coût de 0).
          </p>
        )}
      </section>

      {/* ── Prix et marge ────────────────────────────────────────────────── */}
      {(!ent.estSousRecette || resultat.prixVenteHT !== null) && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-1 text-base font-semibold">
            Prix et marge{resultat.prixEstConseille ? " — conseillés depuis le coefficient cible" : ""}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {resultat.prixEstConseille
              ? "Aucun prix de vente n'a été décidé : ces montants sont dérivés du coefficient cible, ce sont des suggestions."
              : "Montants dérivés du prix de vente TTC saisi."}
          </p>

          {/* Un bloc prix ne s'affiche JAMAIS sans dire qu'il repose sur un coût partiel. Le moteur
              ne pose son drapeau `minorant` que sur le prix conseillé : les autres montants sont
              qualifiés ici, depuis `incomplet`. On les dit « assis sur un coût partiel » sans
              inventer de sens de variation — selon le mode (prix décidé ou coefficient), la marge
              peut être surestimée ou sous-estimée. */}
          {resultat.incomplet && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ⚠ Ces montants reposent sur un <strong>coût partiel</strong>
              {coutPartiel ? ` (${resultat.ingredientsSansPrix.length} ingrédient(s) non valorisé(s))` : " (nombre de portions inexploitable)"} :
              ils ne sont <strong>pas fiables</strong>. N&apos;arrêtez pas un prix de vente là-dessus.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={etiquette("Prix de vente HT", resultat.prixEstConseille, resultat.incomplet)} valeur={usd(resultat.prixVenteHT)} accent={resultat.incomplet ? "amber" : undefined} />
            <Kpi label={etiquette("Prix de vente TTC", resultat.prixEstConseille, resultat.incomplet)} valeur={usd(resultat.prixVenteTTC)} accent={resultat.incomplet ? "amber" : undefined} />
            <Kpi label={etiquette("Marge brute", resultat.prixEstConseille, resultat.incomplet)} valeur={usd(resultat.margeBrute)} accent={resultat.incomplet ? "amber" : "green"} />
            <Kpi label={etiquette("Coefficient", resultat.prixEstConseille, resultat.incomplet)} valeur={coef(resultat.coefficient)} accent={resultat.incomplet ? "amber" : undefined} />
            <Kpi label={etiquette("Taux de marque", resultat.prixEstConseille, resultat.incomplet)} valeur={pct(resultat.tauxMarque)} accent={resultat.incomplet ? "amber" : undefined} />
            <Kpi label={etiquette("Ratio matière", resultat.prixEstConseille, resultat.incomplet)} valeur={pct(resultat.ratioMatiere)} accent={resultat.incomplet ? "amber" : undefined} />
            {resultat.prixConseille && (
              <div className="col-span-2 rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Prix conseillé (coefficient cible)</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">
                  {resultat.prixConseille.minorant ? "≥ " : ""}{usd(resultat.prixConseille.ht)} HT
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({resultat.prixConseille.minorant ? "≥ " : ""}{usd(resultat.prixConseille.ttc)} TTC)
                  </span>
                </p>
                {resultat.prixConseille.minorant && (
                  <p className="mt-1 text-xs text-amber-800">
                    Coût partiel : {resultat.ingredientsSansPrix.length} ingrédient(s) non valorisé(s) — ce n&apos;est pas un prix, c&apos;est un plancher.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Étiquette d'un indicateur de prix : dit son ORIGINE (conseillé depuis le coefficient cible, ou
 * dérivé d'un prix décidé) et sa COMPLÉTUDE (assis ou non sur un coût partiel). Deux questions
 * différentes, deux mentions — c'est ce qui empêche de lire un prix arrêté là où il n'y a qu'une cible.
 */
function etiquette(base: string, conseille: boolean, incomplet: boolean): string {
  const notes = [conseille ? "conseillé" : null, incomplet ? "sur coût partiel" : null].filter(Boolean);
  return notes.length ? `${base} (${notes.join(", ")})` : base;
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function LigneIngredient({
  ligne, cout, article, sousFiche, articles, autresFiches, modifiee, selectionnee, onToggle, onChange,
}: {
  ligne: LigneFiche;
  cout: LigneCout | undefined;
  article: ArticleOption | undefined;
  sousFiche: AutreFiche | undefined;
  articles: ArticleOption[];
  autresFiches: AutreFiche[];
  modifiee: boolean;
  selectionnee: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<LigneFiche>) => void;
}) {
  return (
    <tr className={`border-t align-top ${selectionnee ? "bg-primary/10" : modifiee ? "bg-amber-50/60" : ""}`}>
      <td className="px-2 py-1.5">
        <input type="checkbox" checked={selectionnee} onChange={onToggle} aria-label="Sélectionner cet ingrédient" />
      </td>
      <td className="px-2 py-1.5">
        <select value={valeurSource(ligne)} onChange={(e) => onChange(decoderSource(e.target.value))} className={`${inp} w-full min-w-56`}>
          <option value="">— choisir —</option>
          <OptionsSource articles={articles} autresFiches={autresFiches} />
        </select>
        {/* Harmonie : le nom d'un article mène à sa fiche catalogue, celui d'une sous-recette à sa
            fiche technique — comme les noms de fournisseurs mènent à leur fiche. */}
        {article && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            <Link href={`/stock/catalogue/${article.id}`} className="text-primary hover:underline">{article.designation}</Link>
            {" · "}{usd(article.prixUnitaireUSD)} / {article.unite || "unité ?"}
            {!article.actif && " · article inactif"}
          </div>
        )}
        {sousFiche && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            <Link href={`/stock/fiches/${sousFiche.id}`} className="text-primary hover:underline">{sousFiche.nom}</Link>
            {" · sous-recette"}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <input value={ligne.unite} onChange={(e) => onChange({ unite: e.target.value })} className={`${inp} w-24`} placeholder="g, cl…" />
      </td>
      <td className="px-2 py-1.5">
        <input type="number" min="0" step="0.001" value={ligne.quantite} onChange={(e) => onChange({ quantite: e.target.value })} className={`${inp} w-28 text-right`} />
      </td>
      <td className="px-2 py-1.5 text-right">
        {cout?.cout ? (
          <span className="font-medium tabular-nums">{cout.partiel ? "≥ " : ""}{usd(arrondirCentime(cout.cout))}</span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {cout?.motif ? MOTIF_LABEL[cout.motif] : "Coût indéterminé"}
          </span>
        )}
        {modifiee && <div className="text-[11px] text-amber-700">non enregistré</div>}
      </td>
    </tr>
  );
}

/** Sélecteur unique : les deux sources dans deux groupes, le XOR est garanti par construction. */
function OptionsSource({ articles, autresFiches }: { articles: ArticleOption[]; autresFiches: AutreFiche[] }) {
  const sousRecettes = autresFiches.filter((f) => f.estSousRecette);
  const autres = autresFiches.filter((f) => !f.estSousRecette);
  return (
    <>
      {sousRecettes.length > 0 && (
        <optgroup label="Sous-recettes">
          {sousRecettes.map((f) => <option key={f.id} value={`fiche:${f.id}`}>{f.nom}</option>)}
        </optgroup>
      )}
      <optgroup label="Articles du stock">
        {articles.map((a) => <option key={a.id} value={`art:${a.id}`}>{a.designation}{a.actif ? "" : " (inactif)"}</option>)}
      </optgroup>
      {autres.length > 0 && (
        <optgroup label="Autres fiches">
          {autres.map((f) => <option key={f.id} value={`fiche:${f.id}`}>{f.nom}</option>)}
        </optgroup>
      )}
    </>
  );
}

/** Coût partiel : jamais un chiffre nu — on nomme les ingrédients en cause. */
function BandeauPartiel({ resultat }: { resultat: ReturnType<typeof calculerCout> }) {
  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="font-medium">
        ⚠ Coût partiel — {resultat.ingredientsSansPrix.length} ingrédient(s) au coût indéterminé
        {resultat.cycle && " · boucle détectée entre fiches"}
      </p>
      <p className="mt-0.5 text-xs">
        Ces ingrédients ne sont <strong>pas</strong> comptés pour zéro : ils ne sont pas comptés du tout. Le coût affiché est un minorant.
      </p>
      <ul className="mt-1 list-inside list-disc text-xs">
        {resultat.ingredientsSansPrix.map((nom, i) => <li key={`${nom}-${i}`}>{nom}</li>)}
      </ul>
    </div>
  );
}

function Kpi({ label, valeur, accent }: { label: string; valeur: string; accent?: "green" | "amber" | "red" }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : accent === "green" ? "border-emerald-200 bg-emerald-50" : "";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{valeur}</p>
    </div>
  );
}

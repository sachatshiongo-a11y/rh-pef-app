"use client";

import { useRef, useState, useTransition } from "react";
import { analyserInventaireAction, appliquerInventaireAction } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import type { PreviewInventaire } from "@/lib/import-inventaire";
import { cleArticleImport } from "@/lib/import-inventaire-cle";
import { ChoixArticleProche } from "@/components/stock/choix-article-proche";
import { CaseSortiesLivraison, MotifSortiesApercu } from "./case-sorties-livraison";
import { CHAMP_SORTIES_LIVRAISON } from "@/lib/motif-sorties-import";
import { ListePaginee } from "@/components/liste-paginee";

export function ImportInventaireClient() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewInventaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  /** Anti-doublon (2026-10-09) : pour chaque article à créer qui a des proches, « Utiliser » (id) ou « CREER ». */
  const [choix, setChoix] = useState<Record<string, string>>({});

  const analyser = () => {
    setErreur(null); setSucces(null); setPreview(null); setChoix({});
    const fd = new FormData(formRef.current!);
    start(async () => {
      const p = await analyserInventaireAction(fd);
      if (estErreur(p)) { setErreur(p.erreur); return; }
      setPreview(p);
    });
  };
  const appliquer = () => {
    setErreur(null);
    const fd = new FormData(formRef.current!);
    fd.set(CHAMP_SORTIES_LIVRAISON, "1"); // motif obligatoire : toujours « Livraison restaurant »
    fd.set("choixArticles", JSON.stringify(choix));
    start(async () => {
      const r = await appliquerInventaireAction(fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setSucces(
        `Import appliqué : stock final posé sur ${r.resume.maj} article(s) (${r.resume.crees} créé(s)), ${r.resume.mvEntree + r.resume.mvSortie} mouvement(s) ajouté(s) au journal` +
        (r.resume.dejaPresents > 0 ? `, ${r.resume.dejaPresents} mouvement(s) déjà présent(s), ignoré(s)` : "") +
        `, ${r.resume.legumes} achat(s) de légumes.`
      );
      setPreview(null); formRef.current?.reset();
    });
  };

  const sansMatch = preview?.articles.filter((a) => a.match === "aucun") ?? [];
  const parNom = preview?.articles.filter((a) => a.match === "nom") ?? [];
  const aDecider = sansMatch.filter((a) => a.proches?.length);
  const nonDecides = aDecider.filter((a) => { const c = choix[cleArticleImport(a)]; return !(c && (c === "CREER" ? a.creationPossible : a.proches!.some((p) => p.id === c))); });

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-md border bg-card px-3 py-2 text-sm">
        <p className="font-medium">Cet import fait deux choses :</p>
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          <li>il <b className="text-foreground">pose le stock final</b> du classeur : la valeur absolue <b className="text-foreground">remplace</b> le stock actuel de chaque article ;</li>
          <li>il <b className="text-foreground">importe le journal détaillé</b> (entrées et sorties datées) dans l&apos;historique des mouvements. Un mouvement déjà présent (même article, date, type et quantité, par exemple importé par le CSV d&apos;entrées/sorties) est <b className="text-foreground">ignoré</b> : il ne compte pas deux fois.</li>
        </ul>
      </div>
      <form ref={formRef} className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Classeur d&apos;inventaire (.xlsx)</span>
          <input type="file" name="fichier" accept=".xlsx" className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Libellé (optionnel)</span>
          <input name="libelle" placeholder="Inventaire Juillet 2026" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={analyser} disabled={isPending} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">{isPending && !preview ? "Analyse…" : "Analyser"}</button>
        <div className="basis-full"><CaseSortiesLivraison /></div>
      </form>

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {succes && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{succes}</p>}

      {preview && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Aperçu — rien n&apos;est encore écrit</h3>
          <MotifSortiesApercu />
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Kpi label="Articles mis à jour" val={preview.resume.maj} />
            <Kpi label="Articles créés" val={preview.resume.crees} accent={preview.resume.crees > 0} />
            <Kpi label="Sans correspondance" val={preview.resume.sansMatch} accent={preview.resume.sansMatch > 0} />
            <Kpi label="Entrées ajoutées au journal" val={preview.resume.mvEntree} />
            <Kpi label="Sorties ajoutées au journal" val={preview.resume.mvSortie} />
            <Kpi label="Déjà présents, ignorés" val={preview.resume.dejaPresents} />
            <Kpi label="Achats légumes" val={preview.resume.legumes} />
          </div>

          {sansMatch.length > 0 && (
            <details className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              <summary className="cursor-pointer font-medium">⚠ {sansMatch.length} article(s) sans correspondance — seront créés</summary>
              <ListePaginee items={sansMatch} libelle="articles" ligne={(a) => <li key={a.domaine + a.code}>{a.nom} [{a.domaine}] (code {a.code})</li>} />
            </details>
          )}
          {aDecider.length > 0 && (
            <div data-doublons-import className="space-y-2 rounded-md border border-amber-400 bg-amber-50/60 p-2 text-sm">
              <p className="font-medium text-amber-900">{aDecider.length} article(s) à créer ressemblent à un article du catalogue : choisissez pour chacun avant d&apos;appliquer.</p>
              {aDecider.map((a) => {
                const k = cleArticleImport(a);
                const c = choix[k];
                const utilise = a.proches!.find((p) => p.id === c);
                return (
                  <div key={k} className="space-y-1">
                    <p className="text-xs">{a.nom} [{a.domaine}] (code {a.code}){utilise ? <b> → stock posé sur « {utilise.designation} »</b> : c === "CREER" ? <b> → nouvel article créé</b> : null}</p>
                    <ChoixArticleProche nom={a.nom} candidats={a.proches!} creationPossible={!!a.creationPossible} desactive={isPending}
                      onUtiliser={(p) => setChoix((x) => ({ ...x, [k]: p.id }))} onCreer={() => setChoix((x) => ({ ...x, [k]: "CREER" }))} />
                  </div>
                );
              })}
            </div>
          )}
          {parNom.length > 0 && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">{parNom.length} rapprochement(s) par nom (à vérifier)</summary>
              <ListePaginee items={parNom} libelle="rapprochements" className="mt-1 list-disc pl-5 text-muted-foreground" ligne={(a) => <li key={a.domaine + a.code}>{a.nom} → {a.articleNom}</li>} />
            </details>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={appliquer} disabled={isPending || nonDecides.length > 0} title={nonDecides.length > 0 ? `${nonDecides.length} article(s) à décider` : undefined} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Application…" : "Appliquer l'import"}</button>
            <button type="button" onClick={() => setPreview(null)} className="text-sm text-muted-foreground underline">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, val, accent }: { label: string; val: number; accent?: boolean }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent ? "text-amber-700" : ""}`}>{val}</p>
    </div>
  );
}

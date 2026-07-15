"use client";

import { useRef, useState, useTransition } from "react";
import { analyserInventaireAction, appliquerInventaireAction } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import type { PreviewInventaire } from "@/lib/import-inventaire";

export function ImportInventaireClient() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewInventaire | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const analyser = () => {
    setErreur(null); setSucces(null); setPreview(null);
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
    start(async () => {
      const r = await appliquerInventaireAction(fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setSucces(`Import appliqué : ${r.resume.maj} article(s) mis à jour, ${r.resume.crees} créé(s), ${r.resume.mvEntree + r.resume.mvSortie} mouvement(s), ${r.resume.legumes} achat(s) de légumes.`);
      setPreview(null); formRef.current?.reset();
    });
  };

  const sansMatch = preview?.articles.filter((a) => a.match === "aucun") ?? [];
  const parNom = preview?.articles.filter((a) => a.match === "nom") ?? [];

  return (
    <div className="space-y-3">
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
      </form>

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {succes && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{succes}</p>}

      {preview && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Aperçu — rien n&apos;est encore écrit</h3>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Kpi label="Articles mis à jour" val={preview.resume.maj} />
            <Kpi label="Articles créés" val={preview.resume.crees} accent={preview.resume.crees > 0} />
            <Kpi label="Sans correspondance" val={preview.resume.sansMatch} accent={preview.resume.sansMatch > 0} />
            <Kpi label="Mouvements entrée" val={preview.resume.mvEntree} />
            <Kpi label="Mouvements sortie" val={preview.resume.mvSortie} />
            <Kpi label="Achats légumes" val={preview.resume.legumes} />
          </div>

          {sansMatch.length > 0 && (
            <details className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              <summary className="cursor-pointer font-medium">⚠ {sansMatch.length} article(s) sans correspondance — seront créés</summary>
              <ul className="mt-1 list-disc pl-5">{sansMatch.slice(0, 50).map((a) => <li key={a.domaine + a.code}>{a.nom} [{a.domaine}] (code {a.code})</li>)}</ul>
            </details>
          )}
          {parNom.length > 0 && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">{parNom.length} rapprochement(s) par nom (à vérifier)</summary>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">{parNom.slice(0, 50).map((a) => <li key={a.domaine + a.code}>{a.nom} → {a.articleNom}</li>)}</ul>
            </details>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={appliquer} disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Application…" : "Appliquer l'import"}</button>
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

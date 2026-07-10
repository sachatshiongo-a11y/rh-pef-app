"use client";

import { useRef, useState, useTransition } from "react";
import { analyserFacturesAction, appliquerFacturesAction } from "./actions";
import type { PreviewFactures } from "@/lib/import-factures";
import { usd } from "@/lib/stock";

export function ImportFacturesClient() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewFactures | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const analyser = () => {
    setErreur(null); setSucces(null); setPreview(null);
    const fd = new FormData(formRef.current!);
    start(async () => { try { setPreview(await analyserFacturesAction(fd)); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };
  const appliquer = () => {
    setErreur(null);
    const fd = new FormData(formRef.current!);
    start(async () => {
      try { const r = await appliquerFacturesAction(fd); setSucces(`Import appliqué : ${r.resume.aInserer} facture(s) ajoutée(s), ${r.resume.fournisseursCrees} fournisseur(s) créé(s), ${r.resume.doublons} doublon(s) ignoré(s).`); setPreview(null); formRef.current?.reset(); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  return (
    <div className="space-y-3">
      <form ref={formRef} className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Classeur(s) de factures (.xlsx)</span>
          <input type="file" name="fichiers" accept=".xlsx" multiple className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Libellé (optionnel)</span>
          <input name="libelle" placeholder="Factures Juillet 2026" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={analyser} disabled={isPending} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">{isPending && !preview ? "Analyse…" : "Analyser"}</button>
      </form>

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {succes && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{succes}</p>}

      {preview && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Aperçu — rien n&apos;est encore écrit</h3>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Kpi label="Factures à ajouter" val={String(preview.resume.aInserer)} />
            <Kpi label="Doublons ignorés" val={String(preview.resume.doublons)} />
            <Kpi label="Fournisseurs créés" val={String(preview.resume.fournisseursCrees)} accent={preview.resume.fournisseursCrees > 0} />
            <Kpi label="Total à ajouter" val={usd(preview.resume.totalUSD)} />
          </div>

          {preview.fournisseursCrees.length > 0 && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">{preview.fournisseursCrees.length} fournisseur(s) seront créés</summary>
              <p className="mt-1 text-muted-foreground">{preview.fournisseursCrees.join(" · ")}</p>
            </details>
          )}
          {preview.erreurs.length > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{preview.erreurs.join(" · ")}</p>}
          <details className="rounded-md border p-2 text-sm">
            <summary className="cursor-pointer font-medium">Voir les {preview.factures.length} ligne(s) lue(s)</summary>
            <ul className="mt-1 max-h-64 space-y-0.5 overflow-auto text-xs">
              {preview.factures.slice(0, 200).map((f, i) => (
                <li key={i} className={f.nouvelle ? "" : "text-muted-foreground line-through"}>{f.fournisseurNom} · {f.numero ?? "sans n°"} · {f.periode} · {usd(f.montantUSD)}{f.nouvelle ? "" : " (doublon)"}</li>
              ))}
            </ul>
          </details>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={appliquer} disabled={isPending || preview.resume.aInserer === 0} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Application…" : "Appliquer l'import"}</button>
            <button type="button" onClick={() => setPreview(null)} className="text-sm text-muted-foreground underline">Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, val, accent }: { label: string; val: string; accent?: boolean }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent ? "text-amber-700" : ""}`}>{val}</p>
    </div>
  );
}

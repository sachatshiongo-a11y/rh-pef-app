"use client";

import { useRef, useState, useTransition } from "react";
import { analyserMouvementsAction, appliquerMouvementsAction } from "./actions";
import type { PreviewMouvements } from "@/lib/import-mouvements";

const RAPPRO_LABEL: Record<string, string> = { code: "Code", nom: "Nom", flou: "Approché", inconnu: "Inconnu" };
const RAPPRO_CLASSE: Record<string, string> = {
  code: "bg-emerald-100 text-emerald-800", nom: "bg-emerald-100 text-emerald-800",
  flou: "bg-amber-100 text-amber-800", inconnu: "bg-red-100 text-red-800",
};

export function ImportMouvementsClient() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewMouvements | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const analyser = () => {
    setErreur(null); setSucces(null); setPreview(null);
    const fd = new FormData(formRef.current!);
    start(async () => { try { setPreview(await analyserMouvementsAction(fd)); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };
  const appliquer = () => {
    setErreur(null);
    const fd = new FormData(formRef.current!);
    start(async () => {
      try {
        const r = await appliquerMouvementsAction(fd);
        setSucces(`Import appliqué : ${r.resume.rapprochees} ligne(s) sur ${r.resume.articles} article(s) — ${r.resume.entreesQte} entrée(s), ${r.resume.sortiesQte} sortie(s). ${r.resume.inconnues} ligne(s) inconnue(s) ignorée(s).`);
        setPreview(null); formRef.current?.reset();
      } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  return (
    <div className="space-y-3">
      <form ref={formRef} className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Fichier CSV (entrées / sorties)</span>
          <input type="file" name="fichier" accept=".csv,text/csv" className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Libellé (optionnel)</span>
          <input name="libelle" placeholder="Mouvements du 10/07" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Date par défaut</span>
          <input name="dateDefaut" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={analyser} disabled={isPending} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">{isPending && !preview ? "Analyse…" : "Analyser"}</button>
      </form>
      <p className="text-xs text-muted-foreground">Le fichier doit contenir des colonnes Date, Désignation (et/ou Code article), Entrées et Sorties. Les entrées augmentent le stock, les sorties le diminuent. Réversible depuis le journal ci-dessous.</p>

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {succes && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{succes}</p>}
      {preview && preview.erreurs.length > 0 && (
        <ul className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{preview.erreurs.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}

      {preview && preview.lignes.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
            <span><b>{preview.resume.rapprochees}</b> ligne(s) rapprochée(s)</span>
            <span className="text-muted-foreground">·</span>
            <span><b>{preview.resume.articles}</b> article(s)</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-emerald-700">{preview.resume.entreesQte} entrée(s)</span>
            <span className="text-red-700">{preview.resume.sortiesQte} sortie(s)</span>
            {preview.resume.inconnues > 0 && <><span className="text-muted-foreground">·</span><span className="text-red-700"><b>{preview.resume.inconnues}</b> inconnue(s) (ignorée(s))</span></>}
            {preview.resume.sansDate > 0 && <><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{preview.resume.sansDate} sans date → date par défaut</span></>}
            <button type="button" onClick={appliquer} disabled={isPending || preview.resume.rapprochees === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Application…" : "Appliquer l'import"}</button>
          </div>

          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs">
                <tr className="[&>th]:px-3 [&>th]:py-2">
                  <th>Date</th><th>CSV</th><th>Article rapproché</th><th>Lien</th><th className="text-right">Entrée</th><th className="text-right">Sortie</th>
                </tr>
              </thead>
              <tbody>
                {preview.lignes.map((l, i) => (
                  <tr key={i} className="border-t even:bg-muted/25">
                    <td className="px-3 py-1.5 text-muted-foreground">{l.date ?? "—"}</td>
                    <td className="px-3 py-1.5">{l.codeCsv && <span className="mr-1 font-mono text-xs text-muted-foreground">{l.codeCsv}</span>}{l.designationCsv}</td>
                    <td className="px-3 py-1.5">{l.articleNom ?? <span className="text-red-700">Aucun</span>}</td>
                    <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RAPPRO_CLASSE[l.rapprochement]}`}>{RAPPRO_LABEL[l.rapprochement]}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{l.entree > 0 ? `+${l.entree}` : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{l.sortie > 0 ? `−${l.sortie}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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

  // Sélection : période (sur la date effective = date de la ligne, sinon date par défaut)
  // + lignes décochées à la main. Par défaut : tout ce qui est rapproché est sélectionné.
  const [dateDefaut, setDateDefaut] = useState(new Date().toISOString().slice(0, 10));
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [decochees, setDecochees] = useState<Set<number>>(new Set());

  const dateEffective = (l: PreviewMouvements["lignes"][number]) => l.date ?? dateDefaut;

  const visibles = useMemo(() => {
    if (!preview) return [];
    return preview.lignes.filter((l) => {
      const d = dateEffective(l);
      return (!du || d >= du) && (!au || d <= au);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, du, au, dateDefaut]);
  const selection = visibles.filter((l) => l.articleId && !decochees.has(l.ligne));
  const selEntrees = Math.round(selection.reduce((t, l) => t + l.entree, 0) * 1000) / 1000;
  const selSorties = Math.round(selection.reduce((t, l) => t + l.sortie, 0) * 1000) / 1000;

  const analyser = () => {
    setErreur(null); setSucces(null); setPreview(null); setDecochees(new Set());
    const fd = new FormData(formRef.current!);
    start(async () => {
      try {
        const p = await analyserMouvementsAction(fd);
        setPreview(p);
        // Période pré-remplie avec les bornes du fichier (dates effectives).
        const dates = p.lignes.map((l) => l.date ?? dateDefaut).sort();
        setDu(dates[0] ?? "");
        setAu(dates[dates.length - 1] ?? "");
      } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };
  const appliquer = () => {
    setErreur(null);
    const fd = new FormData(formRef.current!);
    fd.set("lignes", JSON.stringify(selection.map((l) => l.ligne)));
    start(async () => {
      try {
        const r = await appliquerMouvementsAction(fd);
        setSucces(`Import appliqué : ${r.resume.rapprochees} ligne(s) sur ${r.resume.articles} article(s) — ${r.resume.entreesQte} entrée(s), ${r.resume.sortiesQte} sortie(s).`);
        setPreview(null); formRef.current?.reset();
      } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  const basculer = (n: number) =>
    setDecochees((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const toutCocher = () => setDecochees(new Set());
  const toutDecocher = () => setDecochees(new Set(visibles.filter((l) => l.articleId).map((l) => l.ligne)));

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
          <input name="dateDefaut" type="date" value={dateDefaut} onChange={(e) => setDateDefaut(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={analyser} disabled={isPending} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">{isPending && !preview ? "Analyse…" : "Analyser"}</button>
      </form>
      <p className="text-xs text-muted-foreground">Le fichier doit contenir des colonnes Date, Désignation (et/ou Code article), Entrées et Sorties. L&apos;analyse n&apos;écrit rien : choisissez ensuite la période et les lignes à importer. Réversible depuis le journal ci-dessous.</p>

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {succes && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{succes}</p>}
      {preview && preview.erreurs.length > 0 && (
        <ul className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{preview.erreurs.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}

      {preview && preview.lignes.length > 0 && (
        <div className="space-y-2">
          {/* Période + sélection */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 text-sm">
            <label className="flex flex-col gap-1 text-xs">
              Du
              <input type="date" value={du} onChange={(e) => setDu(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Au
              <input type="date" value={au} onChange={(e) => setAu(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5" />
            </label>
            <button type="button" onClick={toutCocher} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Tout cocher</button>
            <button type="button" onClick={toutDecocher} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Tout décocher</button>
            <span className="text-xs text-muted-foreground">
              <b className="text-foreground">{selection.length}</b> à importer ·{" "}
              <span className="text-emerald-700">{selEntrees} entrée(s)</span> ·{" "}
              <span className="text-red-700">{selSorties} sortie(s)</span>
              {preview.resume.inconnues > 0 && <> · <span className="text-red-700">{preview.resume.inconnues} inconnue(s) ignorée(s)</span></>}
            </span>
            <button type="button" onClick={appliquer} disabled={isPending || selection.length === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Application…" : `Importer la sélection (${selection.length})`}</button>
          </div>

          <div className="max-h-[50vh] overflow-auto rounded-lg border">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs">
                <tr className="[&>th]:px-3 [&>th]:py-2">
                  <th className="w-8" /><th>Date</th><th>CSV</th><th>Article rapproché</th><th>Lien</th><th className="text-right">Entrée</th><th className="text-right">Sortie</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((l) => {
                  const rapprochee = !!l.articleId;
                  return (
                    <tr key={l.ligne} className={`border-t even:bg-muted/25 ${!rapprochee ? "opacity-60" : ""}`}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={rapprochee && !decochees.has(l.ligne)}
                          disabled={!rapprochee}
                          onChange={() => basculer(l.ligne)}
                          aria-label={`Importer la ligne ${l.ligne}`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{l.date ?? `${dateDefaut} (défaut)`}</td>
                      <td className="px-3 py-1.5">{l.codeCsv && <span className="mr-1 font-mono text-xs text-muted-foreground">{l.codeCsv}</span>}{l.designationCsv}</td>
                      <td className="px-3 py-1.5">{l.articleNom ?? <span className="text-red-700">Aucun</span>}</td>
                      <td className="px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RAPPRO_CLASSE[l.rapprochement]}`}>{RAPPRO_LABEL[l.rapprochement]}</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{l.entree > 0 ? `+${l.entree}` : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{l.sortie > 0 ? `−${l.sortie}` : ""}</td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Aucune ligne dans cette période.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

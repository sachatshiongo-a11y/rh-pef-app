"use client";

import { useMemo, useState, useTransition } from "react";
import {
  analyserPointageIVMS,
  appliquerPointageIVMS,
  type AnalysePointage,
  type ResultatImport,
} from "./import-actions";
import { Pagination, usePagination } from "@/components/pagination";
import { ListePaginee } from "@/components/liste-paginee";
import { tranche } from "@/lib/pagination";

// Import IVMS-4200 en deux temps : 1) Analyser (aperçu complet, rien n'est écrit) ;
// 2) choisir la période et cocher/décocher les lignes ; 3) Importer la sélection.

const STATUT_LABEL: Record<string, { label: string; cls: string }> = {
  OK: { label: "Importable", cls: "bg-emerald-100 text-emerald-800" },
  CONGE: { label: "Congé approuvé", cls: "bg-amber-100 text-amber-800" },
  PAIE_FIGEE: { label: "Paie validée", cls: "bg-red-100 text-red-800" },
};

export function ImportPointage() {
  const [pending, start] = useTransition();
  const [analyse, setAnalyse] = useState<AnalysePointage | null>(null);
  const [resultat, setResultat] = useState<ResultatImport | null>(null);
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [decochees, setDecochees] = useState<Set<string>>(new Set()); // lignes OK décochées par l'utilisateur

  const cle = (l: { employeeId: string; date: string }) => `${l.employeeId}_${l.date}`;

  // Lignes visibles = celles de la période choisie ; sélection = visibles OK non décochées.
  const visibles = useMemo(() => {
    if (!analyse) return [];
    return analyse.lignes.filter((l) => (!du || l.date >= du) && (!au || l.date <= au));
  }, [analyse, du, au]);
  // Pagination de l'aperçu (50 / 100 / Tout) : un mois de pointage fait des milliers de lignes (employés × jours).
  // La période, la sélection et « Importer la sélection » portent sur TOUTES les lignes de la période, pas sur la
  // page. Page en état local (l'aperçu vient d'un fichier : il n'existe plus au rechargement).
  const pagination = usePagination({ total: visibles.length, cleFiltre: `${du}|${au}|${analyse?.lignes.length ?? 0}`, synchroUrl: false });
  const page = tranche(visibles, pagination);
  const selection = visibles.filter((l) => l.statut === "OK" && !decochees.has(cle(l)));
  const nbImportables = visibles.filter((l) => l.statut === "OK").length;
  const importablesPage = page.filter((l) => l.statut === "OK");
  const pageToutCochee = importablesPage.length > 0 && importablesPage.every((l) => !decochees.has(cle(l)));
  const cocherPage = (on: boolean) => setDecochees((s) => { const n = new Set(s); for (const l of importablesPage) { if (on) n.delete(cle(l)); else n.add(cle(l)); } return n; });
  const nbConge = visibles.filter((l) => l.statut === "CONGE").length;
  const nbFige = visibles.filter((l) => l.statut === "PAIE_FIGEE").length;

  function lancerAnalyse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setResultat(null);
    start(async () => {
      const a = await analyserPointageIVMS(null, fd);
      setAnalyse(a);
      setDu(a.dateMin ?? "");
      setAu(a.dateMax ?? "");
      setDecochees(new Set());
    });
  }

  function importer() {
    start(async () => {
      const r = await appliquerPointageIVMS(
        selection.map((l) => ({ employeeId: l.employeeId, date: l.date, heures: l.heures }))
      );
      setResultat(r);
      if (r.ok) setAnalyse(null);
    });
  }

  const basculer = (k: string) =>
    setDecochees((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toutCocher = () => setDecochees(new Set());
  const toutDecocher = () =>
    setDecochees(new Set(visibles.filter((l) => l.statut === "OK").map((l) => cle(l))));

  return (
    <details className="mb-6 rounded-lg border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Importer un rapport de pointage (IVMS-4200)
      </summary>
      <div className="border-t p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          Chargez le rapport (Excel ou CSV) : l&apos;analyse affiche d&apos;abord un <b>aperçu</b> —
          rien n&apos;est importé tant que vous n&apos;avez pas choisi la <b>période</b> et les{" "}
          <b>lignes</b> à appliquer. Heures calculées par première entrée / dernière sortie, ajustées
          (pause, bornes du shift). Congé approuvé et paie validée restent intouchables.
        </p>

        <form onSubmit={lancerAnalyse} className="flex flex-wrap items-center gap-3">
          <input type="file" name="fichier" accept=".xlsx,.xls,.csv" required className="text-sm" />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending && !analyse ? "Analyse en cours…" : "Analyser le fichier"}
          </button>
        </form>

        {analyse && !analyse.ok && (
          <p className="mt-3 rounded-md bg-red-50 p-3 text-sm font-medium text-red-800">{analyse.message}</p>
        )}

        {analyse?.ok && (
          <div className="mt-4 space-y-3">
            <p className="rounded-md bg-primary/5 px-3 py-2 text-sm">{analyse.message}</p>

            {/* Période + sélection */}
            <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 text-sm">
              <label className="flex flex-col gap-1 text-xs">
                Du
                <input type="date" value={du} min={analyse.dateMin} max={analyse.dateMax} onChange={(e) => setDu(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Au
                <input type="date" value={au} min={analyse.dateMin} max={analyse.dateMax} onChange={(e) => setAu(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5" />
              </label>
              <button type="button" onClick={toutCocher} title="Toutes les lignes importables de la période, sur toutes les pages" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Tout cocher ({nbImportables})</button>
              <button type="button" onClick={toutDecocher} title="Toutes les lignes de la période, sur toutes les pages" className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent">Tout décocher ({nbImportables})</button>
              <span className="ml-auto text-xs text-muted-foreground">
                <b className="text-foreground">{selection.length}</b> à importer (toutes pages)
                {nbConge > 0 && <> · {nbConge} en congé (ignorés)</>}
                {nbFige > 0 && <> · {nbFige} paie validée (ignorés)</>}
              </span>
            </div>

            {/* Aperçu ligne par ligne */}
            <div className="tableau-normal rounded-lg border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="en-tete-collante bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th className="w-8"><input type="checkbox" checked={pageToutCochee} disabled={importablesPage.length === 0} onChange={(e) => cocherPage(e.target.checked)} aria-label={`Cocher les lignes de cette page (${importablesPage.length})`} title="Coche les lignes de cette page" /></th>
                    <th>Date</th>
                    <th>Employé</th>
                    <th className="text-right">Heures</th>
                    <th>Code</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((l) => {
                    const k = cle(l);
                    const importable = l.statut === "OK";
                    const st = STATUT_LABEL[l.statut];
                    return (
                      <tr key={k} className={`border-t ${!importable ? "opacity-60" : ""}`}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={importable && !decochees.has(k)}
                            disabled={!importable}
                            onChange={() => basculer(k)}
                            aria-label={`Importer ${l.nom} le ${l.date}`}
                          />
                        </td>
                        <td className="px-3 py-1.5 tabular-nums">{l.date}</td>
                        <td className="px-3 py-1.5">{l.nom}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {l.heures.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h
                        </td>
                        <td className="px-3 py-1.5">{l.code}</td>
                        <td className="px-3 py-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {visibles.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Aucun jour dans cette période.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination total={visibles.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="jours" />

            {analyse.anomalies.length > 0 && (
              <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-semibold">Anomalies (jamais appliquées) :</p>
                <ListePaginee items={analyse.anomalies} libelle="anomalies" className="mt-1 list-inside list-disc space-y-0.5" ligne={(a, i) => (
                  <li key={i}>{a.date} · {a.idExterne} · {a.type} — {a.detail}</li>
                )} />
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={importer}
                disabled={pending || selection.length === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {pending ? "Import en cours…" : `Importer la sélection (${selection.length})`}
              </button>
              <button type="button" onClick={() => setAnalyse(null)} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
                Annuler
              </button>
            </div>
          </div>
        )}

        {resultat && (
          <p className={`mt-3 rounded-md p-3 text-sm font-medium ${resultat.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {resultat.message} {resultat.ok && "Rechargez la grille pour voir les valeurs."}
          </p>
        )}
      </div>
    </details>
  );
}

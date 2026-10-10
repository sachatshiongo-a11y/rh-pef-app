"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { analyserFacturesAction, appliquerFacturesAction } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import type { PreviewFactures } from "@/lib/import-factures";
import { usd } from "@/lib/stock";
import { formaterMontantFacture, libelleTotal } from "@/lib/facture-devise";
import { ListePaginee } from "@/components/liste-paginee";
import { ChoixFournisseurProche } from "@/components/stock/choix-fournisseur-proche";

export function ImportFacturesClient() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<PreviewFactures | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  // Lignes « à confirmer » (probable doublon) cochées par la Direction ; décochées par défaut.
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  // Fournisseur à créer qui ressemble à un existant : « Utiliser » (id) ou « CREER », par nom du fichier.
  const [choix, setChoix] = useState<Record<string, string>>({});

  const analyser = () => {
    setErreur(null); setSucces(null); setPreview(null); setCochees(new Set()); setChoix({});
    const fd = new FormData(formRef.current!);
    start(async () => {
      const p = await analyserFacturesAction(fd);
      if (estErreur(p)) { setErreur(p.erreur); return; }
      setPreview(p);
    });
  };
  const appliquer = () => {
    setErreur(null);
    const fd = new FormData(formRef.current!);
    fd.set("forcer", JSON.stringify([...cochees]));
    fd.set("choixFournisseurs", JSON.stringify(choix));
    start(async () => {
      const r = await appliquerFacturesAction(fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setSucces(`Import appliqué : ${r.resume.aInserer} facture(s) ajoutée(s), ${r.resume.fournisseursCrees} fournisseur(s) créé(s), ${r.resume.doublons} refusée(s) (numéro déjà saisi)${r.resume.aConfirmer > 0 ? `, ${r.resume.aConfirmer} probable(s) doublon(s) non importé(s)` : ""}. Réversible depuis l'historique ci-dessous.`);
      setPreview(null); formRef.current?.reset();
    });
  };

  const aConfirmer = useMemo(() => preview?.factures.filter((f) => f.etat === "A_CONFIRMER") ?? [], [preview]);
  const aDecider = Object.entries(preview?.fournisseursProches ?? {});
  const nonDecides = aDecider.filter(([nom, ps]) => !(choix[nom] === "CREER" || ps.some((p) => p.id === choix[nom])));
  const aImporter = (preview?.resume.aInserer ?? 0) + cochees.size;
  const montant = (f: PreviewFactures["factures"][number]) => (f.devise === "USD" ? usd(f.montant) : formaterMontantFacture(f.montant, "CDF"));

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        Classeur « Suivi des factures fournisseurs » (.xlsx). La colonne <b className="text-foreground">Devise</b> (FC ou $) est <b className="text-foreground">obligatoire</b> sur chaque ligne : une ligne sans devise est refusée, la devise n&apos;est jamais devinée d&apos;après le montant. Même fournisseur et même numéro qu&apos;une facture déjà saisie : refusée. Même fournisseur et même montant à ±14 jours : à confirmer.
      </div>
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
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <Kpi label="Factures à ajouter" val={String(preview.resume.aInserer)} />
            <Kpi label="Refusées (numéro déjà saisi)" val={String(preview.resume.doublons)} />
            <Kpi label="À confirmer (probable doublon)" val={String(preview.resume.aConfirmer)} accent={preview.resume.aConfirmer > 0} />
            <Kpi label="Fournisseurs créés" val={String(preview.resume.fournisseursCrees)} accent={preview.resume.fournisseursCrees > 0} />
            <Kpi label="Total à ajouter" val={libelleTotal(preview.resume.total, usd(0), usd)} />
          </div>

          {preview.erreurs.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="font-medium">{preview.erreurs.length} ligne(s) ou feuille(s) refusée(s) :</p>
              <ListePaginee items={preview.erreurs} libelle="alertes" className="mt-1 list-disc pl-5" ligne={(e, i) => <li key={i}>{e}</li>} />
            </div>
          )}

          {aDecider.length > 0 && (
            <div data-fournisseurs-proches className="space-y-2 rounded-md border border-amber-400 bg-amber-50/60 p-2 text-sm">
              <p className="font-medium text-amber-900">{aDecider.length} fournisseur(s) à créer ressemblent à un fournisseur existant : choisissez pour chacun avant d&apos;appliquer.</p>
              {aDecider.map(([nom, ps]) => {
                const c = choix[nom];
                const utilise = ps.find((p) => p.id === c);
                return (
                  <div key={nom} className="space-y-1">
                    <p className="text-xs">{nom}{utilise ? <b> → factures rattachées à « {utilise.nom} »</b> : c === "CREER" ? <b> → nouveau fournisseur créé</b> : null}</p>
                    <ChoixFournisseurProche nom={nom} candidats={ps} desactive={isPending}
                      onUtiliser={(p) => setChoix((x) => ({ ...x, [nom]: p.id }))} onCreer={() => setChoix((x) => ({ ...x, [nom]: "CREER" }))} />
                  </div>
                );
              })}
            </div>
          )}

          {aConfirmer.length > 0 && (
            <div data-a-confirmer className="space-y-1 rounded-md border border-amber-400 bg-amber-50/60 p-2 text-sm">
              <p className="font-medium text-amber-900">{aConfirmer.length} facture(s) ressemblent à une facture déjà saisie (même fournisseur, même montant, à ±14 jours) : cochez celles qui sont bien distinctes.</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={() => setCochees(new Set(aConfirmer.map((f) => f.cle)))} className="rounded-md border px-2 py-1 hover:bg-accent">Tout cocher ({aConfirmer.length})</button>
                <button type="button" onClick={() => setCochees(new Set())} className="rounded-md border px-2 py-1 hover:bg-accent">Tout décocher</button>
              </div>
              <ListePaginee items={aConfirmer} libelle="factures à confirmer" className="space-y-1 text-xs" ligne={(f) => (
                <li key={f.cle} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={cochees.has(f.cle)} aria-label={`Importer quand même ${f.fournisseurNom} ${f.numero ?? ""}`}
                    onChange={() => setCochees((s) => { const n = new Set(s); if (n.has(f.cle)) n.delete(f.cle); else n.add(f.cle); return n; })} />
                  <span><b>{f.fournisseurNom}</b> · {f.numero ?? "sans n°"} · {f.periode} · {montant(f)} — <span className="text-amber-900">{f.message}</span></span>
                </li>
              )} />
            </div>
          )}

          {preview.fournisseursCrees.length > 0 && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">{preview.fournisseursCrees.length} fournisseur(s) seront créés</summary>
              <p className="mt-1 text-muted-foreground">{preview.fournisseursCrees.join(" · ")}</p>
            </details>
          )}
          <details className="rounded-md border p-2 text-sm">
            <summary className="cursor-pointer font-medium">Voir les {preview.factures.length} ligne(s) lue(s)</summary>
            <ListePaginee items={preview.factures} libelle="lignes" className="mt-1 space-y-0.5 text-xs" ligne={(f) => (
              <li key={f.cle} className={f.etat === "NOUVELLE" ? "" : "text-muted-foreground"}>
                {f.fournisseurNom} · {f.numero ?? "sans n°"} · {f.periode} · {montant(f)}
                {f.etat === "DOUBLON_NUMERO" ? <b className="text-red-700"> (refusée : numéro déjà saisi)</b> : f.etat === "A_CONFIRMER" ? <b className="text-amber-700"> (à confirmer)</b> : ""}
              </li>
            )} />
          </details>

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={appliquer} disabled={isPending || aImporter === 0 || nonDecides.length > 0} title={nonDecides.length > 0 ? `${nonDecides.length} fournisseur(s) à décider` : undefined} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Application…" : `Appliquer l'import (${aImporter})`}</button>
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

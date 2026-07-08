"use client";

import { Fragment, useState, useTransition } from "react";
import { creerFacture, marquerPayee, supprimerFacture } from "./actions";
import { usd, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";

export type FactureRow = {
  id: string;
  nom: string;
  numero: string | null;
  date: string | null;
  echeance: string | null;
  montant: string;
  reste: number;
  statut: string;
  modePaiement: string;
};

const MODES = ["Espèces", "Virement", "Mobile Money", "Chèque", "Autre"];
type Four = { id: string; nom: string; delaiJours: number | null };
type Bon = { id: string; numero: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export type Groupe = { titre: string; factures: FactureRow[] };

export function FacturesUI({ groupes, fournisseurs, bons }: { groupes: Groupe[]; fournisseurs: Four[]; bons: Bon[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [payerId, setPayerId] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  // Calcule l'échéance = date + délai de paiement du fournisseur sélectionné (si connu et non déjà saisie manuellement).
  const majEcheance = (form: HTMLFormElement | null) => {
    if (!form) return;
    const sel = form.elements.namedItem("fournisseurId") as HTMLSelectElement | null;
    const dateI = form.elements.namedItem("date") as HTMLInputElement | null;
    const echI = form.elements.namedItem("dateEcheance") as HTMLInputElement | null;
    if (!echI || !dateI?.value) return;
    const four = fournisseurs.find((f) => f.id === sel?.value);
    if (four?.delaiJours == null) return;
    const dt = new Date(dateI.value);
    dt.setDate(dt.getDate() + four.delaiJours);
    echI.value = dt.toISOString().slice(0, 10);
  };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
        {ajout ? "Fermer" : "+ Ajouter une facture"}
      </button>

      {ajout && (
        <form action={(fd) => run(async () => { await creerFacture(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-4">
          <select name="fournisseurId" defaultValue="" className={inp} onChange={(e) => {
            const form = e.currentTarget.form;
            const nomInput = (form?.elements.namedItem("fournisseurNom") as HTMLInputElement | null);
            const opt = e.currentTarget.selectedOptions[0];
            if (nomInput && opt.value) nomInput.value = opt.text;
            majEcheance(form);
          }}>
            <option value="">— fournisseur (catalogue) —</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          <input name="fournisseurNom" placeholder="Nom fournisseur *" required className={inp} />
          <input name="numero" placeholder="N° facture" className={inp} />
          <select name="bonDeCommandeId" defaultValue="" className={inp}>
            <option value="">— bon de commande lié —</option>
            {bons.map((b) => <option key={b.id} value={b.id}>{b.numero}</option>)}
          </select>
          <input name="modePaiement" placeholder="Mode de paiement" className={inp} />
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Date<input name="date" type="date" className={inp} onChange={(e) => majEcheance(e.currentTarget.form)} /></label>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Échéance (auto selon délai)<input name="dateEcheance" type="date" className={inp} /></label>
          <input name="montantUSD" type="number" step="0.01" placeholder="Montant USD *" required className={inp} />
          <input name="montantRegleUSD" type="number" step="0.01" placeholder="Déjà réglé USD" className={inp} />
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Enregistrer la facture</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[54rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Fournisseur</th>
              <th className="px-3 py-2">N°</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Échéance</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-right">Reste</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groupes.map((g) => {
              const total = g.factures.reduce((t, f) => t + Number(f.montant), 0);
              const reste = g.factures.reduce((t, f) => t + f.reste, 0);
              const regle = total - reste;
              const echu = g.factures.filter((f) => f.statut === "ECHUE_NON_REGLEE").reduce((t, f) => t + f.reste, 0);
              const aRegler = g.factures.filter((f) => f.statut === "A_REGLER").reduce((t, f) => t + f.reste, 0);
              const parFourn = Object.entries(g.factures.reduce((m, f) => { m[f.nom] = (m[f.nom] ?? 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
              return (
                <Fragment key={g.titre}>
                  <tr className="bg-muted/60">
                    <td colSpan={8} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold uppercase tracking-wide">{g.titre} · {g.factures.length} facture(s)</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                          <span>Total : <b>{usd(total)}</b></span>
                          <span className="text-emerald-700">Réglé : <b>{usd(regle)}</b></span>
                          <span className="text-amber-700">À régler : <b>{usd(aRegler)}</b></span>
                          <span className="text-red-700">Échu : <b>{usd(echu)}</b></span>
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {parFourn.map(([nom, n]) => <span key={nom} className="rounded-full border bg-background px-2 py-0.5">{nom} ({n})</span>)}
                      </div>
                    </td>
                  </tr>
                  {g.factures.map((f) => (
                    <tr key={f.id} className="border-t hover:bg-accent/40">
                      <td className="px-3 py-2 font-medium">{f.nom}</td>
                      <td className="px-3 py-2 text-muted-foreground">{f.numero ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{f.date ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{f.echeance ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{usd(f.montant)}</td>
                      <td className="px-3 py-2 text-right">{f.reste > 0 ? <span className="font-medium text-red-700">{usd(f.reste)}</span> : "—"}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span></td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                        {f.statut !== "REGLEE" && (
                          payerId === f.id ? (
                            <form action={(fd) => run(async () => { await marquerPayee(f.id, fd); setPayerId(null); })} className="flex items-center justify-end gap-1">
                              <select name="modePaiement" defaultValue={f.modePaiement || "Espèces"} className="rounded border border-input bg-background px-1.5 py-1 text-xs" title="Mode de paiement">
                                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <button disabled={isPending} className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Régler</button>
                              <button type="button" onClick={() => setPayerId(null)} className="px-1 text-xs text-muted-foreground">✕</button>
                            </form>
                          ) : (
                            <button onClick={() => setPayerId(f.id)} className="rounded border px-2 py-1 text-xs hover:bg-accent">Marquer payée</button>
                          )
                        )}
                        <button onClick={() => { if (confirm("Supprimer cette facture ?")) run(() => supprimerFacture(f.id)); }} disabled={isPending} title="Supprimer" className="rounded border px-2 py-1 text-xs text-destructive hover:bg-destructive/10">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {groupes.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Aucune facture.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

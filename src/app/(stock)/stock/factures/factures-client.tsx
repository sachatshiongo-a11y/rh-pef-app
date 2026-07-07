"use client";

import { Fragment, useState, useTransition } from "react";
import { creerFacture, marquerPayee } from "./actions";
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
};
type Four = { id: string; nom: string };
type Bon = { id: string; numero: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export type Groupe = { titre: string; factures: FactureRow[] };

export function FacturesUI({ groupes, fournisseurs, bons }: { groupes: Groupe[]; fournisseurs: Four[]; bons: Bon[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
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
            const nomInput = (e.currentTarget.form?.elements.namedItem("fournisseurNom") as HTMLInputElement | null);
            const opt = e.currentTarget.selectedOptions[0];
            if (nomInput && opt.value) nomInput.value = opt.text;
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
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Date<input name="date" type="date" className={inp} /></label>
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">Échéance<input name="dateEcheance" type="date" className={inp} /></label>
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
              const totalGroupe = g.factures.reduce((t, f) => t + f.reste, 0);
              return (
                <Fragment key={g.titre}>
                  <tr className="bg-muted/40">
                    <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.titre} · {g.factures.length} facture(s)</td>
                    <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">{totalGroupe > 0 ? `reste ${usd(totalGroupe)}` : ""}</td>
                  </tr>
                  {g.factures.map((f) => (
                    <tr key={f.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{f.nom}</td>
                      <td className="px-3 py-2 text-muted-foreground">{f.numero ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{f.date ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{f.echeance ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{usd(f.montant)}</td>
                      <td className="px-3 py-2 text-right">{f.reste > 0 ? <span className="font-medium text-red-700">{usd(f.reste)}</span> : "—"}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span></td>
                      <td className="px-3 py-2 text-right">
                        {f.statut !== "REGLEE" && (
                          <button onClick={() => run(() => marquerPayee(f.id))} disabled={isPending} className="rounded border px-2 py-1 text-xs hover:bg-accent">Marquer payée</button>
                        )}
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

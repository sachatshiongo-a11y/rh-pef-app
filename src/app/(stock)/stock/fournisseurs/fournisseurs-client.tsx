"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { creerFournisseur, modifierFournisseur, supprimerFournisseur } from "./actions";

export type FournRow = {
  id: string; nom: string; contactNom: string; telephone: string; ville: string;
  rccm: string; delaiPaiement: string; modePaiement: string; email: string; nbArticles: number; nbFactures: number;
};
const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const CH = ["nom", "contactNom", "telephone", "ville", "rccm", "delaiPaiement", "modePaiement"] as const;

export function FournisseursClient({ fournisseurs, estDirection }: { fournisseurs: FournRow[]; estDirection: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };
  const champ = (id: string, name: string, value: string, prev: string) => {
    if (value === prev) return;
    const fd = new FormData(); fd.set(name, value);
    run(() => modifierFournisseur(id, fd));
  };
  const supprimer = (id: string, nom: string) => {
    if (!confirm(`Supprimer le fournisseur « ${nom} » ? Les articles/factures liés seront détachés.`)) return;
    run(() => supprimerFournisseur(id));
  };

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {!estDirection && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Consultation — seule la Direction peut ajouter, modifier ou supprimer un fournisseur.</p>}

      {estDirection && (
        <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          {ajout ? "Fermer" : "+ Ajouter un fournisseur"}
        </button>
      )}

      {ajout && estDirection && (
        <form action={(fd) => run(async () => { await creerFournisseur(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-4">
          <input name="nom" placeholder="Nom *" required className={inp} />
          <input name="contactNom" placeholder="Contact" className={inp} />
          <input name="telephone" placeholder="Téléphone" className={inp} />
          <input name="email" placeholder="Email" className={inp} />
          <input name="ville" placeholder="Ville" className={inp} />
          <input name="pays" placeholder="Pays" defaultValue="République démocratique du Congo" className={inp} />
          <input name="rccm" placeholder="RCCM" className={inp} />
          <input name="idNational" placeholder="ID National" className={inp} />
          <input name="delaiPaiement" placeholder="Délai paiement" className={inp} />
          <input name="delaiLivraison" placeholder="Délai livraison" className={inp} />
          <input name="modePaiement" placeholder="Mode paiement" className={inp} />
          <input name="produits" placeholder="Produits fournis" className={inp} />
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer le fournisseur</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[68rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-2 py-2">Nom</th>
              <th className="px-2 py-2">Contact</th>
              <th className="px-2 py-2">Téléphone</th>
              <th className="px-2 py-2">Ville</th>
              <th className="px-2 py-2">RCCM</th>
              <th className="px-2 py-2">Délai paiement</th>
              <th className="px-2 py-2">Mode</th>
              <th className="px-2 py-2 text-right">Articles</th>
              <th className="px-2 py-2 text-right">Fact.</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {fournisseurs.map((f) => (
              <tr key={f.id} className="border-t hover:bg-accent/40 even:bg-muted/25">
                {CH.map((c) => (
                  <td key={c} className="px-2 py-1">
                    {estDirection
                      ? <input defaultValue={f[c]} disabled={isPending} onBlur={(e) => champ(f.id, c, e.target.value, f[c])} className={inp} />
                      : <span className={c === "nom" ? "font-medium" : "text-muted-foreground"}>{f[c] || "—"}</span>}
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  <Link href={`/stock/fournisseurs/${f.id}`} className="text-primary underline">{f.nbArticles}</Link>
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">{f.nbFactures}</td>
                <td className="px-2 py-1 text-right">
                  {estDirection && (
                    <button onClick={() => supprimer(f.id, f.nom)} disabled={isPending} className="text-xs text-destructive underline">Supprimer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

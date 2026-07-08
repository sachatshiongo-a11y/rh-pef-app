"use client";

import { memo, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { creerFournisseur, modifierFournisseur, supprimerFournisseur } from "./actions";
import { usd } from "@/lib/stock";

export type FournRow = {
  id: string; nom: string; contactNom: string; telephone: string; ville: string;
  rccm: string; delaiPaiement: string; delaiLivraison: string; modePaiement: string; email: string;
  nbArticles: number; nbFactures: number; soldeDu: number;
};
const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const CH = ["nom", "contactNom", "telephone", "ville", "rccm", "delaiPaiement", "delaiLivraison", "modePaiement"] as const;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function FournisseursClient({ fournisseurs, estDirection }: { fournisseurs: FournRow[]; estDirection: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [q, setQ] = useState("");

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };
  const save = async (id: string, name: string, value: string) => {
    const fd = new FormData(); fd.set(name, value);
    try { await modifierFournisseur(id, fd); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const supprimer = (id: string, nom: string) => {
    if (!confirm(`Supprimer le fournisseur « ${nom} » ? Les articles/factures liés seront détachés.`)) return;
    run(() => supprimerFournisseur(id));
  };

  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) return fournisseurs;
    return fournisseurs.filter((f) => norm(`${f.nom} ${f.contactNom} ${f.ville}`).includes(nq));
  }, [fournisseurs, q]);
  const totalDu = useMemo(() => fournisseurs.reduce((t, f) => t + f.soldeDu, 0), [fournisseurs]);

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {!estDirection && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Consultation — seule la Direction peut ajouter, modifier ou supprimer un fournisseur.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom, contact, ville)…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        <span className="text-xs text-muted-foreground">{visibles.length} / {fournisseurs.length} fournisseur(s)</span>
        {totalDu > 0 && <span className="ml-auto rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Total dû : {usd(totalDu)}</span>}
        {estDirection && (
          <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            {ajout ? "Fermer" : "+ Ajouter un fournisseur"}
          </button>
        )}
      </div>

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
        <table className="w-full min-w-[70rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th>Nom</th>
              <th>Contact</th>
              <th>Téléphone</th>
              <th>Ville</th>
              <th>RCCM</th>
              <th>Délai paiement</th>
              <th>Délai livraison</th>
              <th>Mode</th>
              <th className="text-right">Solde dû</th>
              <th className="text-right">Articles</th>
              <th className="text-right">Fact.</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {visibles.map((f) => (
              <LigneFournisseur key={f.id} f={f} estDirection={estDirection} onSave={save} onDelete={supprimer} />
            ))}
            {visibles.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">Aucun fournisseur.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LigneFournisseur = memo(function LigneFournisseur({
  f, estDirection, onSave, onDelete,
}: {
  f: FournRow; estDirection: boolean;
  onSave: (id: string, name: string, value: string) => Promise<void>;
  onDelete: (id: string, nom: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => {
    if (value === prev) return;
    setBusy(true);
    onSave(f.id, name, value).finally(() => setBusy(false));
  };

  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy ? "opacity-60" : ""}`}>
      {CH.map((c) => (
        <td key={c}>
          {estDirection && edit
            ? <input defaultValue={f[c]} onBlur={(e) => write(c, e.target.value, f[c])} className={inp} />
            : <span className={c === "nom" ? "font-medium" : "text-muted-foreground"}>{f[c] || "—"}</span>}
        </td>
      ))}
      <td className="text-right">{f.soldeDu > 0 ? <span className="font-semibold text-red-700">{usd(f.soldeDu)}</span> : "—"}</td>
      <td className="text-right"><Link href={`/stock/fournisseurs/${f.id}`} className="text-primary underline">{f.nbArticles}</Link></td>
      <td className="text-right text-muted-foreground">{f.nbFactures}</td>
      <td className="text-right">
        {estDirection && (
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setEdit((v) => !v)} title={edit ? "Terminer" : "Modifier"} className="rounded border px-2 py-0.5 text-xs hover:bg-accent">{edit ? "✓" : "✎"}</button>
            <button onClick={() => onDelete(f.id, f.nom)} className="text-xs text-destructive underline">Suppr.</button>
          </div>
        )}
      </td>
    </tr>
  );
});

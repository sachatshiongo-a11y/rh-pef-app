"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { modifierFournisseur, supprimerFournisseur } from "../actions";

export type FournEdit = {
  id: string; nom: string; contactNom: string; telephone: string; email: string; ville: string; pays: string;
  rccm: string; idNational: string; delaiPaiement: string; delaiLivraison: string; modePaiement: string; produits: string;
};

const inp = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
const CHAMPS: [keyof Omit<FournEdit, "id">, string][] = [
  ["nom", "Nom *"], ["contactNom", "Contact"], ["telephone", "Téléphone"], ["email", "E-mail"],
  ["ville", "Ville"], ["pays", "Pays"], ["rccm", "RCCM"], ["idNational", "ID National"],
  ["delaiPaiement", "Délai de paiement"], ["delaiLivraison", "Délai de livraison"],
  ["modePaiement", "Mode de paiement"], ["produits", "Produits fournis"],
];

/** Boutons Modifier / Supprimer sur la fiche fournisseur (Direction). L'édition ouvre un formulaire complet. */
export function EditerFournisseur({ f }: { f: FournEdit }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  const enregistrer = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      try { await modifierFournisseur(f.id, fd); setOuvert(false); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };
  const supprimer = () => {
    if (!confirm(`Supprimer le fournisseur « ${f.nom} » ? Les articles, bons de commande et factures liés seront détachés (non supprimés).`)) return;
    setErreur(null);
    start(async () => {
      try { await supprimerFournisseur(f.id); router.push("/stock/fournisseurs"); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  if (!ouvert) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Modifier</button>
        <button onClick={supprimer} disabled={isPending} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">Supprimer</button>
        {erreur && <span className="text-sm text-destructive">{erreur}</span>}
      </div>
    );
  }

  return (
    <form action={enregistrer} className="w-full rounded-xl border bg-muted/20 p-4">
      {erreur && <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHAMPS.map(([nom, label]) => (
          <label key={nom} className="flex flex-col gap-1 text-xs text-muted-foreground">{label}
            <input name={nom} defaultValue={f[nom]} required={nom === "nom"} className={inp} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Enregistrer"}</button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
      </div>
    </form>
  );
}

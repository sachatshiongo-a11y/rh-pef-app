"use client";

import { useState, useTransition } from "react";
import { receptionnerBonCommande } from "../actions";

type L = { id: string; designation: string; quantite: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function ReceptionForm({ bcId, lignes }: { bcId: string; lignes: L[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);

  if (lignes.length === 0) return null;

  const submit = (fd: FormData) => {
    setErreur(null);
    startTransition(async () => {
      try { await receptionnerBonCommande(bcId, fd); setOuvert(false); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  // Réception en un clic : toutes les lignes aux quantités commandées (cas le plus courant).
  const toutRecu = () => {
    setErreur(null);
    const fd = new FormData();
    for (const l of lignes) { fd.append("recu_ligneId", l.id); fd.append("recu_quantite", l.quantite); }
    startTransition(async () => {
      try { await receptionnerBonCommande(bcId, fd); }
      catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
    });
  };

  if (!ouvert) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {erreur && <span className="text-xs text-destructive">{erreur}</span>}
        <button onClick={toutRecu} disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "✓ Tout reçu"}
        </button>
        <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          Réception partielle…
        </button>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-2 rounded-lg border p-4">
      <p className="text-sm font-medium">Quantités reçues</p>
      <p className="text-xs text-muted-foreground">Enregistre la marchandise arrivée et met à jour le statut du bon. L’entrée en stock, elle, se fait à l’enregistrement de la facture (pas ici).</p>
      {erreur &&<p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {lignes.map((l) => (
        <div key={l.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate">{l.designation}</span>
          <span className="text-xs text-muted-foreground">commandé {l.quantite}</span>
          <input type="hidden" name="recu_ligneId" value={l.id} />
          <input name="recu_quantite" type="number" step="0.001" min="0" defaultValue={l.quantite} className={`${inp} w-24 text-right`} />
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider la réception"}
        </button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { receptionnerBonCommande } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { ChampNombre } from "@/components/champ-nombre";
import { versSaisie } from "@/lib/nombre";

/** `reste` = ce qu'il reste à recevoir (pré-rempli) ; `recue` = déjà reçu (null : inconnu) ; `libre` = ligne sans article du catalogue. */
type L = { id: string; designation: string; quantite: string; recue: number | null; reste: string; libre: boolean };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

/** Quantité de la base (« 2.125 », notation anglaise) → texte de saisie français (« 2,125 »). */
const enSaisie = (q: string) => versSaisie(Number(q));

export function ReceptionForm({ bcId, lignes }: { bcId: string; lignes: L[] }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState(false);

  if (lignes.length === 0) return null;

  const submit = (fd: FormData) => {
    setErreur(null);
    startTransition(async () => {
      const r = await receptionnerBonCommande(bcId, fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setOuvert(false);
    });
  };

  // Réception en un clic : tout le RESTE à recevoir de chaque ligne (cas le plus courant).
  const toutRecu = () => {
    setErreur(null);
    const fd = new FormData();
    for (const l of lignes) { fd.append("recu_ligneId", l.id); fd.append("recu_quantite", enSaisie(l.reste)); }
    startTransition(async () => {
      const r = await receptionnerBonCommande(bcId, fd);
      if (estErreur(r)) setErreur(r.erreur);
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
      <p className="text-xs text-muted-foreground">Saisissez ce qui est arrivé <strong>cette fois-ci</strong> : cela s&apos;ajoute à ce qui a déjà été reçu, ligne par ligne. Le bon passe à « Reçu » quand toutes les lignes sont entièrement reçues. L’entrée en stock, elle, se fait à l’enregistrement de la facture (pas ici ; une ligne libre n&apos;a aucun effet sur le stock).</p>
      {erreur &&<p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {lignes.map((l) => (
        <div key={l.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate">{l.designation}</span>
          <span className="text-xs text-muted-foreground">commandé {enSaisie(l.quantite)}{l.recue !== null ? ` · déjà reçu ${versSaisie(l.recue)}` : ""}{l.libre ? " · ligne libre" : ""}</span>
          <input type="hidden" name="recu_ligneId" value={l.id} />
          <ChampNombre name="recu_quantite" defaultValue={enSaisie(l.reste)} alerteMilliers aria-label={`Quantité reçue : ${l.designation}`} className={`${inp} w-24 text-right`} classeConteneur="w-24" />
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

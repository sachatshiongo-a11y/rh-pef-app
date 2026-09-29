"use client";

import { useState, useTransition } from "react";
import { requalifierSorties } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import type { FiltreMouvements } from "@/lib/filtre-mouvements";

// « Changer le motif » des sorties cochées (Direction, décision du 2026-09-28) : Livraison restaurant,
// Perte (raison obligatoire) ou sans motif. Une requalification : le stock du dépôt ne change pas.

const inp = "rounded border border-input bg-background px-2 py-1 text-xs";
const AUCUN = "__";
const LIBELLES: Record<string, string> = { LIVRAISON_RESTAURANT: "Livraison restaurant", PERTE: "Perte", "": "Sans motif" };

export function ChangerMotif({ ids, toutLeFiltre, onFait, onRecompte }: {
  ids: string[];
  /** Mode « tout le filtre » : l'action vise les `attendu` sorties du filtre, recomptées par le serveur. */
  toutLeFiltre?: { filtre: FiltreMouvements; attendu: number; libelle: string };
  onFait: (compteRendu: string) => void;
  /** Le serveur a recompté un autre nombre : rien n'est écrit, la colonne affiche le nouveau. */
  onRecompte?: (n: number) => void;
}) {
  const [motif, setMotif] = useState(AUCUN);
  const [raison, setRaison] = useState("");
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [isPending, start] = useTransition();
  const incomplet = motif === AUCUN || (motif === "PERTE" && !raison.trim());
  const nb = toutLeFiltre ? toutLeFiltre.attendu : ids.length;

  const envoyer = () => {
    if (incomplet) return;
    const question = toutLeFiltre
      ? `Changer le motif de ${toutLeFiltre.attendu} sorties (${toutLeFiltre.libelle}) en « ${LIBELLES[motif]} » ?`
      : `Passer ${ids.length} sortie(s) en « ${LIBELLES[motif]} » ?`;
    if (!confirm(`${question} Le stock du dépôt ne change pas : seul le motif est corrigé (journalisé).`)) return;
    setMessage(null);
    start(async () => {
      const selection = toutLeFiltre ? { filtre: toutLeFiltre.filtre, colonne: "SORTIES" as const, attendu: toutLeFiltre.attendu } : ids;
      const r = await requalifierSorties(selection, motif, motif === "PERTE" ? raison.trim() : undefined);
      if (estErreur(r)) {
        setMessage({ texte: r.erreur, erreur: true });
        const nouveau = (r as { nouveauNombre?: unknown }).nouveauNombre;
        if (typeof nouveau === "number") onRecompte?.(nouveau);
        return;
      }
      const texte = `${r.n} sortie(s) requalifiée(s) en « ${LIBELLES[motif]} »${r.n < nb ? ` · ${nb - r.n} déjà à ce motif` : ""}.`;
      setMessage({ texte, erreur: false });
      onFait(texte);
    });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <select aria-label="Nouveau motif" value={motif} onChange={(e) => setMotif(e.target.value)} className={inp}>
        <option value={AUCUN}>Motif…</option>
        <option value="LIVRAISON_RESTAURANT">Livraison restaurant</option>
        <option value="PERTE">Perte</option>
        <option value="">Sans motif</option>
      </select>
      {motif === "PERTE" && (
        <input aria-label="Raison de la perte" value={raison} onChange={(e) => setRaison(e.target.value)} placeholder="Raison (obligatoire)" className={`${inp} w-40 min-w-0`} />
      )}
      <button type="button" disabled={isPending || incomplet} onClick={envoyer} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
        Changer le motif ({nb})
      </button>
      {message && <span className={`basis-full text-xs ${message.erreur ? "text-destructive" : "text-emerald-800"}`}>{message.texte}</span>}
    </div>
  );
}

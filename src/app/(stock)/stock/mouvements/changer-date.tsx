"use client";

import { useState, useTransition } from "react";
import { changerDateSorties } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { jjmmaaaa } from "@/lib/date-sortie";
import type { FiltreMouvements } from "@/lib/filtre-mouvements";

// « Changer la date » des sorties (Direction, demande de Sacha du 2026-10-08) — même patron que
// « Changer le motif » : dans la barre d'actions groupées (id cochés ou tout le filtre), ou à l'unité
// depuis la ligne d'une sortie. Une CORRECTION de date : ni la quantité, ni le motif, ni le stock du
// dépôt ne changent. Pas de date future (jour de Kinshasa) ; le serveur refait tous les contrôles
// (période clôturée, comptage entre les deux dates, réconciliation en attente).

const inp = "rounded border border-input bg-background px-2 py-1 text-xs";

export function ChangerDate({ ids, toutLeFiltre, dateActuelle, onFait, onRecompte, onAnnuler }: {
  ids: string[];
  /** Mode « tout le filtre » : l'action vise les `attendu` sorties du filtre, recomptées par le serveur. */
  toutLeFiltre?: { filtre: FiltreMouvements; attendu: number; libelle: string };
  /** À l'unité : la date actuelle de la sortie (AAAA-MM-JJ), proposée au départ. */
  dateActuelle?: string;
  onFait: (compteRendu: string) => void;
  /** Le serveur a recompté un autre nombre : rien n'est écrit, la colonne affiche le nouveau. */
  onRecompte?: (n: number) => void;
  /** À l'unité : bouton « Annuler » qui referme le panneau de la ligne. */
  onAnnuler?: () => void;
}) {
  const aujourdHui = jourCourantKinshasaISO();
  const [date, setDate] = useState(dateActuelle ?? "");
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [isPending, start] = useTransition();
  const nb = toutLeFiltre ? toutLeFiltre.attendu : ids.length;
  const future = date > aujourdHui;
  const incomplet = !date || future || (dateActuelle !== undefined && date === dateActuelle);

  const envoyer = () => {
    if (incomplet) return;
    const quoi = toutLeFiltre
      ? `${toutLeFiltre.attendu} sorties (${toutLeFiltre.libelle})`
      : dateActuelle !== undefined ? `cette sortie (du ${jjmmaaaa(dateActuelle)})` : `${ids.length} sortie(s)`;
    if (!confirm(`Dater ${quoi} du ${jjmmaaaa(date)} ? Ni la quantité, ni le motif, ni le stock du dépôt ne changent : seule la date est corrigée (journalisée). La Conso. journalière et la Comparaison la liront à ce jour.`)) return;
    setMessage(null);
    start(async () => {
      const selection = toutLeFiltre ? { filtre: toutLeFiltre.filtre, colonne: "SORTIES" as const, attendu: toutLeFiltre.attendu } : ids;
      const r = await changerDateSorties(selection, date);
      if (estErreur(r)) {
        setMessage({ texte: r.erreur, erreur: true });
        const nouveau = (r as { nouveauNombre?: unknown }).nouveauNombre;
        if (typeof nouveau === "number") onRecompte?.(nouveau);
        return;
      }
      const texte = `${r.n} sortie(s) datée(s) du ${jjmmaaaa(r.date)}${r.deja > 0 ? ` · ${r.deja} déjà à cette date` : ""}.`;
      setMessage({ texte, erreur: false });
      onFait(texte);
    });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <input type="date" aria-label="Nouvelle date de la sortie" value={date} max={aujourdHui}
        onChange={(e) => { setDate(e.target.value); setMessage(null); }}
        aria-invalid={future || undefined}
        className={`${inp} ${future ? "border-destructive ring-1 ring-destructive" : ""}`} />
      <button type="button" disabled={isPending || incomplet} onClick={envoyer} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
        {dateActuelle !== undefined ? "Changer la date" : `Changer la date (${nb})`}
      </button>
      {onAnnuler && <button type="button" onClick={onAnnuler} className="text-xs text-muted-foreground underline">Annuler</button>}
      {future && <span className="basis-full text-xs text-destructive">Pas de date dans le futur (aujourd&apos;hui : {jjmmaaaa(aujourdHui)}).</span>}
      {message && <span role={message.erreur ? "alert" : "status"} className={`basis-full text-xs ${message.erreur ? "text-destructive" : "text-emerald-800"}`}>{message.texte}</span>}
    </div>
  );
}

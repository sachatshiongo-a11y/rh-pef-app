"use client";

import { useState, useTransition } from "react";
import { estErreur } from "@/lib/action-lisible";
import { alignerUnitesResto } from "./actions";

// Bandeau « N article(s) dont l'unité diffère de l'Inventaire » (règle de la Direction, 2026-10-12 : UNE
// seule unité par produit, celle de l'Inventaire). Les données d'avant la règle sont LISTÉES, jamais
// converties en silence : « Aligner sur l'Inventaire » montre d'abord l'effet (« 4,5 kg → 4 500 g sur 12
// comptages »), puis la Direction aligne ; un autre compte envoie une demande à valider.

export type EcartAffiche = {
  id: string; designation: string; espace: "CUISINE" | "BAR"; uniteResto: string | null; uniteInventaire: string | null;
  /** Alignable : le facteur lisible (« ×1 000 ») ; sinon la raison. */
  facteur: string | null; raison: string | null; nbComptages: number;
};

export function BandeauUnites({ ecarts, estDirection }: { ecarts: EcartAffiche[]; estDirection: boolean }) {
  const alignables = ecarts.filter((e) => e.facteur !== null);
  const [exclus, setExclus] = useState<Set<string>>(new Set());
  const [apercu, setApercu] = useState<{ ids: string[]; message: string } | null>(null);
  const [retour, setRetour] = useState<{ texte: string; erreur: boolean } | null>(null);
  const [enCours, start] = useTransition();
  if (ecarts.length === 0 && !retour) return null;
  const choisis = alignables.filter((e) => !exclus.has(e.id)).map((e) => e.id);
  const verbe = estDirection ? "Aligner sur l'Inventaire" : "Demander l'alignement sur l'Inventaire";

  const lancer = (ids: string[], confirmer: boolean) => {
    setRetour(null);
    start(async () => {
      const r = await alignerUnitesResto(ids, confirmer);
      if (estErreur(r)) { setApercu(null); setRetour({ texte: r.erreur, erreur: true }); return; }
      if ("aConfirmer" in r && r.aConfirmer) { setApercu({ ids, message: r.message }); return; }
      setApercu(null);
      setRetour({ texte: "enAttente" in r && r.enAttente ? "Demande envoyée à la Direction : l'unité ne change qu'une fois approuvée (Stock → À valider)." : `Unité alignée sur l'Inventaire (${"modifies" in r ? r.modifies : 0} article(s)).`, erreur: false });
    });
  };

  return (
    <section aria-label="Unités à aligner sur l'Inventaire" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      {ecarts.length > 0 && (
        <>
          <p className="font-semibold">{ecarts.length} article{ecarts.length > 1 ? "s" : ""} dont l&apos;unité diffère de l&apos;Inventaire</p>
          <p className="text-xs">Une seule unité par produit : celle de l&apos;Inventaire. Rien n&apos;est converti sans votre accord — l&apos;alignement convertit aussi les comptages, par le facteur exact.</p>
          <ul className="space-y-1">
            {ecarts.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2" data-ecart-unite={e.id}>
                {e.facteur !== null && (
                  <input type="checkbox" checked={!exclus.has(e.id)} aria-label={`Aligner ${e.designation}`}
                    onChange={() => setExclus((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
                )}
                <b>{e.designation}</b>
                <span className="text-xs text-muted-foreground">({e.espace === "BAR" ? "Bar" : "Cuisine"})</span>
                <span>{e.uniteResto?.trim() || "—"} → {e.uniteInventaire?.trim() || "—"}</span>
                {e.facteur !== null
                  ? <span className="text-xs">({e.facteur} · {e.nbComptages} comptage(s))</span>
                  : <span className="text-xs font-medium text-red-800">non convertible : {e.raison}</span>}
              </li>
            ))}
          </ul>
          {alignables.length > 0 && !apercu && (
            <button type="button" disabled={enCours || choisis.length === 0} onClick={() => lancer(choisis, false)}
              className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 max-lg:min-h-11">
              {verbe} ({choisis.length})
            </button>
          )}
        </>
      )}
      {apercu && (
        <div role="alertdialog" aria-label="Confirmer l'alignement" className="space-y-2 rounded-md border border-amber-600 bg-white p-2 text-xs">
          <p>{apercu.message}</p>
          <div className="flex gap-2">
            <button type="button" disabled={enCours} onClick={() => lancer(apercu.ids, true)} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50 max-lg:min-h-11">Confirmer</button>
            <button type="button" disabled={enCours} onClick={() => setApercu(null)} className="rounded-md border px-3 py-1.5 max-lg:min-h-11">Annuler</button>
          </div>
        </div>
      )}
      {retour && <p role={retour.erreur ? "alert" : "status"} className={`text-xs ${retour.erreur ? "text-destructive" : "font-medium"}`}>{retour.texte}</p>}
    </section>
  );
}

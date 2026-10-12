"use client";

import { useState, useTransition } from "react";
import { annulerImportAction } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { PREFIXE_STOCK_POSTERIEUR } from "@/lib/annulation-import-texte";

/** Ce que l'annulation d'un import va toucher (compté sur le journal de l'import). */
export type PorteeAnnulation = { mouvements: number; achatsLegumes: number; articlesCrees: number; articlesStock: number; factures: number; fournisseursCrees: number };

const s = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;

/** Le texte du confirm() : dit CE QUI VA SE PASSER selon le type d'import (jamais une formule générale). */
export function texteConfirmationAnnulation(libelle: string, type: string, p: PorteeAnnulation): string {
  const lignes: string[] = [];
  if (type === "MOUVEMENTS") {
    lignes.push(`${s(p.mouvements, "mouvement")} de cet import ${p.mouvements > 1 ? "seront supprimés" : "sera supprimé"}, et leur effet sera retiré du stock de ${s(p.articlesStock, "article")} (une entrée est retirée, une sortie est rendue).`);
    lignes.push("Les quantités saisies depuis (sorties, comptages, autres imports) ne sont pas touchées.");
  } else if (type === "INVENTAIRE") {
    lignes.push(`Le stock de ${s(p.articlesStock, "article")} sera remis à la valeur d'AVANT l'import ; ${s(p.mouvements, "mouvement")} du journal ${p.mouvements > 1 ? "seront retirés" : "sera retiré"}${p.achatsLegumes ? `, ${s(p.achatsLegumes, "achat")} de légumes aussi` : ""}${p.articlesCrees ? `, ${s(p.articlesCrees, "article")} créé${p.articlesCrees > 1 ? "s" : ""} par l'import supprimé${p.articlesCrees > 1 ? "s" : ""}` : ""}.`);
    lignes.push("Si un mouvement, un comptage ou un autre import a touché un de ces articles depuis, l'annulation sera refusée et vous le dira (rien n'est effacé sans votre accord).");
  } else {
    lignes.push(`${s(p.factures, "facture")} importée${p.factures > 1 ? "s" : ""} ${p.factures > 1 ? "seront supprimées" : "sera supprimée"}${p.fournisseursCrees ? `, ainsi que ${s(p.fournisseursCrees, "fournisseur")} créé${p.fournisseursCrees > 1 ? "s" : ""} par l'import s'il${p.fournisseursCrees > 1 ? "s" : ""} ne serv${p.fournisseursCrees > 1 ? "ent" : "ait"} plus` : ""}.`);
  }
  lignes.push("Un mois clôturé n'est jamais modifié : l'annulation sera refusée s'il est concerné.");
  return `Annuler l'import « ${libelle} » ?\n\n${lignes.join("\n")}`;
}

export function BoutonAnnulerImport({ batchId, libelle, type = "INVENTAIRE", portee }: { batchId: string; libelle: string; type?: string; portee?: PorteeAnnulation }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const lancer = (remettreQuandMeme: boolean) => {
    setErreur(null);
    start(async () => {
      const r = await annulerImportAction(batchId, remettreQuandMeme);
      if (estErreur(r)) {
        // Des saisies postérieures sur les articles d'un inventaire : le refus est dit en entier, puis la Direction peut confirmer.
        if (r.erreur.startsWith(PREFIXE_STOCK_POSTERIEUR)) {
          const detail = r.erreur.slice(PREFIXE_STOCK_POSTERIEUR.length);
          setErreur(detail);
          if (confirm(`${detail}\n\nRemettre quand même la valeur d'avant pour ces articles ?\n(La quantité actuelle de chacun sera remplacée ; le journal garde « avant → après ».)`)) lancer(true);
          return;
        }
        setErreur(r.erreur);
        return;
      }
      // Un stock ne passe jamais sous 0 : une valeur d'avant négative n'est pas réécrite, l'article est nommé.
      // Le bouton disparaît avec l'import annulé : le compte rendu s'affiche en boîte de dialogue (et reste au journal).
      if (r?.stocksLaisses?.length) window.alert(`Import annulé. Stock laissé tel quel (valeur d'avant négative, jamais réécrite) : ${r.stocksLaisses.join(" ; ")}.`);
    });
  };
  const annuler = () => {
    const base = portee ?? { mouvements: 0, achatsLegumes: 0, articlesCrees: 0, articlesStock: 0, factures: 0, fournisseursCrees: 0 };
    if (!confirm(texteConfirmationAnnulation(libelle, type, base))) return;
    lancer(false);
  };
  return (
    <div className="text-right">
      <button onClick={annuler} disabled={isPending} className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">{isPending ? "Annulation…" : "Annuler cet import"}</button>
      {erreur && <p className="mt-1 text-xs text-destructive">{erreur}</p>}
    </div>
  );
}

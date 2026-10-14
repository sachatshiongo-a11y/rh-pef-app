"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { estErreur } from "@/lib/action-lisible";
import { BoutonNeutre } from "@/components/action-buttons";
import { ErreurAction } from "@/components/erreur-action";
import { basculerActifArticles } from "../actions";

/**
 * « Désactiver » / « Réactiver » sur la fiche article (décision de la Direction, 2026-10-14) — la même action que
 * l'action groupée de l'Inventaire, donc la même règle : Direction = tout de suite, autre compte = PROPOSITION (« À valider »).
 * Un article désactivé quitte l'Inventaire (pastille « Désactivés »), les compteurs et les listes de saisie ; son historique reste.
 * C'est l'issue que propose le refus de suppression d'un article qui a un historique.
 */
export function ActivationArticle({ id, actif, libelle, estDirection }: { id: string; actif: boolean; libelle: string; estDirection: boolean }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const basculer = () => {
    if (actif && !window.confirm(`Désactiver « ${libelle} » ? Il quitte l'Inventaire et les listes de saisie ; son historique et son stock restent, et vous pourrez le réactiver (Inventaire › Désactivés, ou ici).`)) return;
    setErreur(null); setInfo(null);
    demarrer(async () => {
      const r = await basculerActifArticles([id], !actif);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (r && typeof r === "object" && "proposition" in r && r.proposition) setInfo(r.message);
      router.refresh();
    });
  };
  return (
    <>
      <BoutonNeutre type="button" disabled={enCours} data-activation-article="" onClick={basculer}>
        {actif ? (estDirection ? "Désactiver" : "Proposer la désactivation") : (estDirection ? "Réactiver" : "Proposer la réactivation")}
      </BoutonNeutre>
      {(erreur || info) && (
        <div className="basis-full space-y-1">
          <ErreurAction message={erreur} />
          {info && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info} <Link href="/stock/a-valider" className="font-medium underline">Voir mes demandes</Link></p>}
        </div>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { brouillonLocal, vierge, type Brouillon, type Devise, type Ligne } from "@/lib/liste-achat-saisie";

/**
 * Brouillon LOCAL de la liste d'achat (téléphone) : la liste en cours est gardée dans le stockage de
 * l'appareil, une clé par compte, et proposée à la réouverture (« Reprendre / Effacer »). Elle est
 * effacée dès que la liste est vide — donc après un enregistrement réussi, qui la vide.
 *
 * Tant qu'un brouillon trouvé n'a pas reçu de réponse, RIEN n'est écrit : la liste vide du départ ne
 * doit pas écraser ce qu'on propose de reprendre. Le stockage peut être absent ou refusé : voir
 * `brouillonLocal` (jamais d'exception ; la saisie continue sans brouillon).
 */
export function useBrouillonListe({ compteId, lignes, date, origine, deviseDefaut, appliquer }: {
  compteId: string | undefined;
  lignes: Ligne[];
  date: string;
  origine: string;
  deviseDefaut: Devise;
  /** Reprise : remplace (ou complète) la liste avec le brouillon retrouvé. */
  appliquer: (b: Brouillon) => void;
}) {
  const [trouve, setTrouve] = useState<Brouillon | null>(null);
  const [pret, setPret] = useState(false);

  // À l'ouverture seulement (le stockage n'existe pas au rendu serveur : pas d'écart d'hydratation).
  useEffect(() => {
    const b = compteId ? brouillonLocal.lire(compteId) : null;
    setTrouve(b);
    setPret(!b);
  }, [compteId]);

  useEffect(() => {
    if (!pret || !compteId) return;
    if (lignes.every(vierge)) brouillonLocal.effacer(compteId);
    else brouillonLocal.ecrire(compteId, { jour: jourCourantKinshasaISO(), date, origine, deviseDefaut, lignes });
  }, [pret, compteId, lignes, date, origine, deviseDefaut]);

  const reprendre = useCallback(() => {
    if (trouve) appliquer(trouve);
    setTrouve(null);
    setPret(true);
  }, [trouve, appliquer]);

  const ignorer = useCallback(() => {
    if (compteId) brouillonLocal.effacer(compteId);
    setTrouve(null);
    setPret(true);
  }, [compteId]);

  /** Enregistrement réussi : le brouillon est effacé, et son bandeau fermé s'il était encore ouvert. */
  const apresEnregistrement = useCallback(() => {
    if (compteId) brouillonLocal.effacer(compteId);
    setTrouve(null);
    setPret(true);
  }, [compteId]);

  return { trouve, reprendre, ignorer, apresEnregistrement };
}

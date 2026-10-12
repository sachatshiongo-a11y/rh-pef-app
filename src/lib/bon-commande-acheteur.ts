// BLOC « ACHETEUR » DU BON DE COMMANDE — module PUR : d'où vient chaque ligne, jamais en dur.
//
// L'acheteur est la société. Une valeur saisie dans les paramètres d'achat (`ParametresAchat`, historique) l'emporte ;
// à défaut, on lit l'identité de l'entreprise (Paramètres de la société, saisis par la Direction) : raison sociale,
// siège, pays, téléphone, RCCM, Id. Nat. ; l'adresse de livraison est celle saisie, sinon le lieu de travail (restaurant).
// Une information introuvable reste null (le PDF écrit « — », jamais une valeur inventée).

import type { ParametresAchat } from "@prisma/client";

export type SocieteAcheteur = {
  nom: string; adresse: string; pays: string; telephone: string; rccm: string; idNat: string; lieuTravail: string;
};

export type AcheteurBon = {
  nom: string;
  ville: string | null;
  pays: string | null;
  adresse: string | null;
  adresseLivraison: string | null;
  telephone: string | null;
  rccm: string | null;
  idNational: string | null;
  contact: string | null;
};

const v = (s: string | null | undefined): string | null => s?.trim() || null;

export function acheteurDuBon(
  params: Pick<ParametresAchat, "acheteurNom" | "acheteurAdresse" | "acheteurVille" | "acheteurPays" | "acheteurIdNational" | "acheteurRccm" | "acheteurTelephone" | "acheteurContact"> | null | undefined,
  societe: SocieteAcheteur | null | undefined,
  achats: { adresseLivraison: string | null; contact: string | null } | null | undefined,
): AcheteurBon {
  return {
    nom: v(params?.acheteurNom) ?? v(societe?.nom) ?? "TOLYA SARL",
    ville: v(params?.acheteurVille),
    pays: v(params?.acheteurPays) ?? v(societe?.pays),
    adresse: v(params?.acheteurAdresse) ?? v(societe?.adresse),
    adresseLivraison: v(achats?.adresseLivraison) ?? v(societe?.lieuTravail),
    telephone: v(params?.acheteurTelephone) ?? v(societe?.telephone),
    rccm: v(params?.acheteurRccm) ?? v(societe?.rccm),
    idNational: v(params?.acheteurIdNational) ?? v(societe?.idNat),
    contact: v(params?.acheteurContact) ?? v(achats?.contact),
  };
}

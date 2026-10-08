import type { FicheIdentiteLue } from "@/lib/employe-doublon-serveur";
import type { FicheDoublonClient } from "./alerte-doublons";

/** Fiches lues en base → forme envoyée à l'écran (dates en AAAA-MM-JJ : jour civil d'une colonne DATE). */
export function fichesPourEcran(fiches: FicheIdentiteLue[]): FicheDoublonClient[] {
  return fiches.map((f) => ({
    id: f.id,
    nom: f.nom,
    matricule: f.matricule,
    telephone: f.telephone,
    dateNaissance: f.dateNaissance ? f.dateNaissance.toISOString().slice(0, 10) : null,
    actif: f.actif,
    poste: f.poste,
    dateEmbauche: f.dateEmbauche.toISOString().slice(0, 10),
    photoUrl: f.photoUrl,
  }));
}

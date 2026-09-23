import type { IssueEnregistrement } from "@/components/telecharger-lien";

// L'état « envoyée » d'une fiche de connexion (Paramètres → Espace salarié). Fonctions PURES : ce
// dépôt n'a pas de DOM en test. Le libellé suit le chemin RÉELLEMENT pris par `enregistrerFichier`,
// pas la capacité supposée de l'appareil : un partage en échec retombe sur un téléchargement, et
// « Envoyée » ferait croire que la fiche est partie chez le salarié.

export type EnvoiFiche = Exclude<IssueEnregistrement, "annule">;

/** Une annulation ne change rien : la fiche reste « À envoyer », ou garde son envoi précédent. */
export function apresEnregistrement(avant: EnvoiFiche | undefined, issue: IssueEnregistrement): EnvoiFiche | undefined {
  return issue === "annule" ? avant : issue;
}

export function libelleEnvoiFiche(etat: EnvoiFiche | undefined): string {
  if (etat === "partage") return "✓ Envoyée";
  if (etat === "telechargement") return "✓ Téléchargée";
  return "À envoyer";
}

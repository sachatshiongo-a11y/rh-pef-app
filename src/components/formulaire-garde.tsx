"use client";

import { createContext, useContext, useState, useTransition, type FormEvent, type FormHTMLAttributes } from "react";
import { estErreur } from "@/lib/action-lisible";
import { CHAMP_RETOUR_ERREUR } from "@/lib/erreur-formulaire";
import { ErreurAction } from "@/components/erreur-action";

/**
 * Formulaire qui GARDE la saisie quand le serveur refuse.
 *
 * Un `<form action={actionServeur}>` direct est remis à zéro par React à la fin de l'action, et un
 * refus par redirection `?erreur=` fait remonter le sous-arbre : dans les deux cas la personne
 * perdait tout ce qu'elle venait de taper (audit du 10/10/2026, ergonomie 2). Ici l'envoi passe par
 * `onSubmit` et le refus revient comme valeur : rien ne remonte, rien n'est remis à zéro.
 *
 *  - refus rendu comme valeur (`{ erreur }`) : affiché au-dessus du formulaire, saisie intacte ;
 *  - refus par `formulaireLisible` : l'envoi porte CHAMP_RETOUR_ERREUR, le serveur rend le refus
 *    comme `{ erreur }` au lieu de rediriger vers `?erreur=` — une redirection d'action fait remonter
 *    tout le sous-arbre (RedirectBoundary de Next) et la saisie disparaîtrait malgré onSubmit ;
 *  - réussite : le formulaire est vidé (comme React le faisait), sauf `reinitialiser={false}`.
 * Pendant l'envoi, `BoutonEnvoi` est désactivé (pas de double envoi).
 */

/** Vrai pendant l'envoi d'un FormulaireGarde (lu par BoutonEnvoi, y compris hors du <form> dans l'arbre). */
export const EnvoiEnCours = createContext(false);
export const useEnvoiEnCours = () => useContext(EnvoiEnCours);

type ActionFormulaire = (formData: FormData) => void | Promise<unknown>;

/** Envoi gardé : à brancher sur le `onSubmit` d'un <form> (FormulaireGarde le fait ; un formulaire qui valide lui-même l'appelle après). */
export function useEnvoiGarde(action: ActionFormulaire, { reinitialiser = true }: { reinitialiser?: boolean } = {}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    if (e.defaultPrevented) return; // une validation de l'écran a déjà refusé l'envoi
    e.preventDefault();
    if (enCours) return; // double clic / Entrée répétée : un seul envoi
    const form = e.currentTarget;
    let donnees: FormData;
    try {
      // Le bouton qui a envoyé (name/value) fait partie de la saisie, comme dans un envoi natif.
      donnees = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
    } catch {
      donnees = new FormData(form);
    }
    // « Rends-moi le refus comme valeur » (lib/erreur-formulaire) : une redirection vers ?erreur= démonterait le formulaire.
    donnees.set(CHAMP_RETOUR_ERREUR, "1");
    setErreur(null);
    demarrer(async () => {
      const r = await action(donnees); // une redirection (réussite ou refus `?erreur=`) interrompt ici : Next navigue
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (reinitialiser) form.reset();
    });
  };
  return { enCours, erreur, envoyer };
}

export function FormulaireGarde({
  action,
  reinitialiser = true,
  onSubmit,
  children,
  ...reste
}: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & { action: ActionFormulaire; reinitialiser?: boolean }) {
  const { enCours, erreur, envoyer } = useEnvoiGarde(action, { reinitialiser });
  return (
    <EnvoiEnCours.Provider value={enCours}>
      <form
        {...reste}
        onSubmit={(e) => {
          onSubmit?.(e);
          envoyer(e);
        }}
      >
        <ErreurAction message={erreur} className="col-span-full mb-2" />
        {children}
      </form>
    </EnvoiEnCours.Provider>
  );
}

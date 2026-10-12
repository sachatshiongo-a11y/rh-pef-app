"use client";

import { createContext, useContext, useState, useTransition, type FormEvent, type FormHTMLAttributes } from "react";
import { estErreur } from "@/lib/action-lisible";
import { CHAMP_RETOUR_ERREUR } from "@/lib/erreur-formulaire";
import { ErreurAction } from "@/components/erreur-action";
import { useRefusVisible } from "@/components/refus-visible";

/**
 * Formulaire qui GARDE la saisie quand le serveur refuse.
 *
 * Un `<form action={actionServeur}>` direct est remis à zéro par React à la fin de l'action, et un
 * refus par redirection `?erreur=` fait remonter le sous-arbre : dans les deux cas la personne
 * perdait tout ce qu'elle venait de taper (audit du 10/10/2026, ergonomie 2). Ici l'envoi passe par
 * `onSubmit` et le refus revient comme valeur : rien ne remonte, rien n'est remis à zéro.
 *
 *  - refus rendu comme valeur (`{ erreur }`) : affiché en haut ET en bas du formulaire (même texte ; le bas est
 *    près du bouton d'envoi d'un long formulaire), la page ramène à l'écran celui qui est le plus proche du bouton
 *    cliqué s'ils sont tous deux hors de vue (components/refus-visible.ts) ; saisie intacte ;
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
  const noterEnvoi = useRefusVisible(erreur); // un refus arrive : le ramène à l'écran s'il n'y est pas
  const envoyer = (e: FormEvent<HTMLFormElement>) => {
    if (e.defaultPrevented) return; // une validation de l'écran a déjà refusé l'envoi
    e.preventDefault();
    noterEnvoi(e);
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
        <ErreurAction message={erreur} emplacement="haut" className="col-span-full mb-2 basis-full" />
        {children}
        <ErreurAction message={erreur} emplacement="bas" className="col-span-full mt-2 basis-full" />
      </form>
    </EnvoiEnCours.Provider>
  );
}

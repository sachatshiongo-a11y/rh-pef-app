"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { demanderConge } from "./actions";
import { ChampsDatesConge } from "@/components/champs-dates-conge";
import { PanneauLateral } from "@/components/panneau-lateral";

const champCls = "rounded-md border border-input bg-background px-3 py-2 text-sm";

/**
 * « Nouvelle demande de congé » : un bouton primaire en haut de l'écran qui ouvre le formulaire dans un
 * PANNEAU LATÉRAL (plein écran sur téléphone) — plus de bloc repliable qui pousse la liste vers le bas.
 * Le formulaire, ses champs et l'action serveur sont ceux d'avant (`demanderConge`, mêmes noms de champs :
 * figés par `demande-formulaire.integration.test.ts`). Une erreur du serveur revient par `?erreur=` : le
 * panneau se rouvre alors tout seul avec le message, comme le bloc d'avant.
 */
export function NouvelleDemandeConge({ employees, types, feries, erreur }: {
  employees: { id: string; nom: string }[];
  types: string[];
  /** Jours fériés AAAA-MM-JJ (le décompte en direct des jours ouvrables). */
  feries: string[];
  erreur?: string;
}) {
  const [ouvertManuel, setOuvertManuel] = useState(false);
  // L'erreur d'une demande ratée rouvre le panneau ; la fermer (ou réussir ensuite) la fait taire jusqu'à une nouvelle erreur.
  const [erreurVue, setErreurVue] = useState<string | undefined>(undefined);
  const erreurAffichee = erreur && erreur !== erreurVue ? erreur : undefined;
  const ouvert = ouvertManuel || !!erreurAffichee;
  const fermer = () => { setOuvertManuel(false); setErreurVue(erreur); };

  // Réussite : l'action ne redirige pas, la liste se rafraîchit (revalidation) et le panneau se ferme.
  // Un échec redirige vers `?erreur=` (la promesse est alors rejetée, rien de ceci ne s'exécute).
  async function soumettre(donnees: FormData) {
    await demanderConge(donnees);
    fermer();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setErreurVue(erreur); setOuvertManuel(true); }}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        <span aria-hidden>+</span> Nouvelle demande
      </button>
      <PanneauLateral ouvert={ouvert} onFermer={fermer} titre="Nouvelle demande de congé">
        {erreurAffichee && (
          <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreurAffichee}</p>
        )}
        <form action={soumettre} className="grid grid-cols-2 gap-4">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label htmlFor="employeeId" className="text-sm font-medium">Employé</label>
            <select id="employeeId" name="employeeId" required className={champCls}>
              {employees.map((e) => (<option key={e.id} value={e.id}>{e.nom}</option>))}
            </select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <label htmlFor="type" className="text-sm font-medium">Type</label>
            <select id="type" name="type" className={champCls}>
              {types.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
          {/* Dates + décompte EN DIRECT des jours ouvrables (dimanches et fériés exclus). */}
          <ChampsDatesConge feries={feries} inputClassName={champCls} />
          <div className="col-span-2 flex flex-col gap-1.5">
            <label htmlFor="remplacantId" className="text-sm font-medium">Remplaçant(e)</label>
            <select id="remplacantId" name="remplacantId" className={champCls}>
              <option value="">— Aucun —</option>
              {employees.map((e) => (<option key={e.id} value={e.id}>{e.nom}</option>))}
            </select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <label htmlFor="motif" className="text-sm font-medium">Motif (optionnel)</label>
            <input id="motif" name="motif" className={champCls} />
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-2">
            <Enregistrer />
            <button type="button" onClick={fermer} className="inline-flex min-h-9 items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Annuler</button>
          </div>
        </form>
      </PanneauLateral>
    </>
  );
}

/** Le bouton d'envoi : désactivé pendant l'enregistrement (un double clic ne crée pas deux demandes). */
function Enregistrer() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex min-h-9 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
      {pending ? "Enregistrement…" : "Enregistrer la demande"}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { creerCompteEmploye, reinitialiserCompteEmploye, desactiverCompteEmploye } from "./compte-actions";
import { estErreur } from "@/lib/action-lisible";

/**
 * Gestion du compte de l'espace salarié depuis la fiche employé (Direction, feature active).
 * Le mot de passe temporaire n'est affiché QU'UNE FOIS après création/réinitialisation.
 */
export function CompteEmployePanel({
  employeeId,
  aCompte,
  compteActif,
}: {
  employeeId: string;
  aCompte: boolean;
  compteActif: boolean;
}) {
  const [isPending, start] = useTransition();
  const [creds, setCreds] = useState<{ matricule: string; motDePasse: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  function lancer(fn: () => Promise<unknown>) {
    setErreur(null);
    setCreds(null);
    start(async () => {
      const r = (await fn()) as { matricule: string; motDePasse: string } | { erreur: string } | void;
      if (r && estErreur(r)) setErreur(r.erreur);
      else if (r && "motDePasse" in r) setCreds(r);
    });
  }

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Espace salarié</h2>
          <p className="text-sm text-muted-foreground">
            {aCompte
              ? compteActif ? "Ce salarié a un compte actif (connexion par matricule)." : "Compte désactivé — réinitialisez-le pour le réactiver."
              : "Aucun compte. Créez-en un pour donner accès au planning, aux congés et aux documents."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!aCompte ? (
            <button disabled={isPending} onClick={() => lancer(() => creerCompteEmploye(employeeId))}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Créer un compte
            </button>
          ) : (
            <>
              <button disabled={isPending} onClick={() => lancer(() => reinitialiserCompteEmploye(employeeId))}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
                Réinitialiser le mot de passe
              </button>
              {compteActif && (
                <button disabled={isPending} onClick={() => { if (confirm("Désactiver ce compte salarié ? Le salarié ne pourra plus se connecter.")) lancer(() => desactiverCompteEmploye(employeeId)); }}
                  className="rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  Désactiver
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {erreur && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {creds && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Identifiants à transmettre au salarié — affichés une seule fois</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">Identifiant (matricule)</p>
              <p className="font-mono text-sm font-semibold">{creds.matricule}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-xs text-muted-foreground">Mot de passe temporaire</p>
              <p className="select-all font-mono text-sm font-semibold">{creds.motDePasse}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Notez-le maintenant : il ne sera plus affiché. Le salarié devra le changer à sa 1re connexion.
          </p>
        </div>
      )}
    </div>
  );
}

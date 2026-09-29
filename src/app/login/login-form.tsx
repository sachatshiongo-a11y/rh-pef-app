"use client";

import { useActionState, useState } from "react";
import { login } from "./actions";

/**
 * `retour` : chemin déjà validé par la page (`retourValide`) ; l'action le revalide de son côté.
 * Venu d'un scan de l'affiche (retour présent), c'est un salarié debout au restaurant, téléphone en
 * main : champs en 16 px (sous 16 px, Safari iOS zoome à la saisie et décale la page), gros bouton.
 * `autocomplete="username"` / `"current-password"` : le gestionnaire de mots de passe du téléphone
 * propose l'identifiant enregistré — la connexion tient alors en un appui.
 */
export function LoginForm({ retour }: { retour?: string | null }) {
  const [state, action, pending] = useActionState(login, undefined);
  const [visible, setVisible] = useState(false);
  const depuisScan = !!retour;
  const tailleChamp = depuisScan ? "text-base py-3" : "text-base py-2 sm:text-sm";

  return (
    <form action={action} className="flex flex-col gap-4">
      {retour && <input type="hidden" name="retour" value={retour} />}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email ou matricule
        </label>
        <input
          id="email"
          name="email"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={depuisScan ? "Votre matricule" : "vous@exemple.cd ou votre matricule"}
          className={`rounded-md border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring ${tailleChamp}`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Mot de passe
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            required
            autoComplete="current-password"
            className={`w-full rounded-md border border-input bg-background px-3 pr-16 outline-none focus:ring-2 focus:ring-ring ${tailleChamp}`}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            className="absolute inset-y-0 right-0 rounded-r-md px-3 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {visible ? "Masquer" : "Afficher"}
          </button>
        </div>
      </div>

      <a href="/mot-de-passe-oublie" className="-mt-2 self-end text-xs text-muted-foreground underline hover:text-foreground">Mot de passe oublié ?</a>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className={`mt-2 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60 ${
          depuisScan ? "min-h-12 w-full py-3 text-base" : "py-2 text-sm"
        }`}
      >
        {pending ? "Connexion..." : "Se connecter"}
      </button>
    </form>
  );
}

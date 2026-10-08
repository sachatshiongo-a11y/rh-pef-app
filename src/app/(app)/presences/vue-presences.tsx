"use client";

// Vue choisie de Présences & heures (Semaine / Mois / Employé), semaine affichée et employé
// consulté : un seul état pour toute la page, partagé par la barre du haut et les deux grilles
// (Brigade, Back-office). Il vit dans le navigateur — changer de semaine ne recharge rien — et se
// recopie dans l'adresse (`?vue=mois`, `?sem=2026-10-05`, `?emp=…`) pour qu'un rechargement ou un
// lien rouvre la même vue. Sans fournisseur (grille isolée, tests), chaque grille garde son état local.

import { createContext, useContext, useState, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { Icone } from "@/components/icones";
import { OngletsDefilants } from "@/components/onglets-defilants";
import { libelleSemaine, type SemaineAffichee } from "./semaines";

export type VuePresences = "semaine" | "mois" | "employe";

type Etat = {
  vue: VuePresences;
  /** `employe` : l'employé de la vue Employé, quand on y arrive d'un clic sur un nom. */
  setVue: (v: VuePresences, employe?: string | null) => void;
  semaine: number;
  setSemaine: (n: number) => void;
  employeId: string | null;
  setEmployeId: (id: string | null) => void;
};

const Ctx = createContext<Etat | null>(null);

/** Recopie la vue dans l'adresse sans recharger la page (ni empiler l'historique). */
function recopierDansAdresse(modif: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [cle, valeur] of Object.entries(modif)) {
    if (valeur === null) url.searchParams.delete(cle);
    else url.searchParams.set(cle, valeur);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function PresencesVueProvider({ vueInitiale, semaineInitiale, employeInitial, semaines, children }: {
  vueInitiale: VuePresences;
  semaineInitiale: number;
  employeInitial: string | null;
  /** Les semaines de la période : le lundi de la semaine choisie va dans l'adresse. */
  semaines: SemaineAffichee[];
  children: ReactNode;
}) {
  const [vue, setVueEtat] = useState(vueInitiale);
  const [semaine, setSemaineEtat] = useState(semaineInitiale);
  const [employeId, setEmployeEtat] = useState(employeInitial);
  const etat: Etat = {
    vue, semaine, employeId,
    setVue: (v, employe) => {
      const emp = employe === undefined ? employeId : employe;
      setVueEtat(v);
      if (employe !== undefined) setEmployeEtat(employe);
      recopierDansAdresse({ vue: v === "semaine" ? null : v, emp: v === "employe" ? emp : null });
    },
    setSemaine: (n) => { setSemaineEtat(n); recopierDansAdresse({ sem: semaines[n]?.lundi ?? null }); },
    setEmployeId: (id) => { setEmployeEtat(id); recopierDansAdresse({ emp: id }); },
  };
  return <Ctx.Provider value={etat}>{children}</Ctx.Provider>;
}

/** L'état partagé de la page ; sans fournisseur, un état local (grille isolée). */
export function useVuePresences(semaineParDefaut = 0): Etat {
  const ctx = useContext(Ctx);
  const [vue, setVue] = useState<VuePresences>("semaine");
  const [semaine, setSemaine] = useState(semaineParDefaut);
  const [employeId, setEmployeId] = useState<string | null>(null);
  return ctx ?? {
    vue, semaine, employeId, setSemaine, setEmployeId,
    setVue: (v, employe) => { setVue(v); if (employe !== undefined) setEmployeId(employe); },
  };
}

export type EmployePourBarre = { id: string; nom: string; photoUrl?: string | null; groupe: string };

const HREF: Record<VuePresences, string> = {
  semaine: "/presences",
  mois: "/presences?vue=mois",
  employe: "/presences?vue=employe",
};

const BOUTON_FLECHE = "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 lg:h-9 lg:w-9";

/**
 * Barre du haut de l'écran : onglets Semaine / Mois / Employé, puis le sélecteur de la vue —
 * semaine (‹ › et « Cette semaine ») ou employé (‹ › entre collègues). Pas de « Mois » sur téléphone :
 * le téléphone n'a pas de grille, il lit le jour.
 */
export function BarreVuePresences({ semaines, semaineAujourdhui, employes }: {
  semaines: SemaineAffichee[];
  /** Rang de la semaine d'aujourd'hui (jour civil de Kinshasa), ou de repli si la période est ailleurs. */
  semaineAujourdhui: number;
  employes: EmployePourBarre[];
}) {
  const { vue, setVue, semaine, setSemaine, employeId, setEmployeId } = useVuePresences();
  const rang = employes.findIndex((e) => e.id === employeId);
  const emp = rang >= 0 ? employes[rang] : null;

  function choisirVue(href: string) {
    const v = (Object.keys(HREF) as VuePresences[]).find((k) => HREF[k] === href) ?? "semaine";
    setVue(v, v === "employe" ? (employeId ?? employes[0]?.id ?? null) : undefined);
  }

  return (
    <div className="mb-4 space-y-3" data-barre-vue-presences="">
      <OngletsDefilants
        libelle="Vue des présences"
        surChoix={choisirVue}
        onglets={[
          { href: HREF.semaine, label: (<><span className="lg:hidden">Jour</span><span className="max-lg:hidden">Semaine</span></>), actif: vue === "semaine" },
          { href: HREF.mois, label: "Mois", actif: vue === "mois", masqueTelephone: true },
          { href: HREF.employe, label: "Employé", actif: vue === "employe" },
        ]}
      />

      {vue !== "employe" && (
        <div className="flex items-center gap-2 text-sm max-lg:hidden" data-selecteur-semaine="">
          {vue === "semaine" ? (
            <>
              <button type="button" onClick={() => setSemaine(semaine - 1)} disabled={semaine <= 0} aria-label="Semaine précédente" className={BOUTON_FLECHE}>
                <Icone nom="chevronGauche" />
              </button>
              <span className="min-w-0 flex-1 truncate text-center font-medium sm:flex-none sm:px-2" aria-live="polite">
                {semaines[semaine] ? libelleSemaine(semaines[semaine]) : ""}
              </span>
              <button type="button" onClick={() => setSemaine(semaine + 1)} disabled={semaine >= semaines.length - 1} aria-label="Semaine suivante" className={BOUTON_FLECHE}>
                <Icone nom="chevronDroit" />
              </button>
              {semaine !== semaineAujourdhui && (
                <button type="button" onClick={() => setSemaine(semaineAujourdhui)} className="flex h-11 shrink-0 items-center rounded-md border px-3 font-medium hover:bg-accent lg:h-9">
                  Cette semaine
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Vue du mois : une case = un code. Survolez ou touchez une case pour lire l&apos;horaire.</p>
          )}
        </div>
      )}

      {vue === "employe" && (
        <div className="flex items-center gap-2 text-sm" data-selecteur-employe="">
          <button type="button" onClick={() => emp && rang > 0 && setEmployeId(employes[rang - 1].id)} disabled={rang <= 0} aria-label="Employé précédent" className={BOUTON_FLECHE}>
            <Icone nom="chevronGauche" />
          </button>
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm sm:flex-none">
            {emp && <Avatar nom={emp.nom} taille={28} photoUrl={emp.photoUrl} />}
            <span className="sr-only">Employé</span>
            <select
              value={employeId ?? ""}
              onChange={(e) => setEmployeId(e.target.value || null)}
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm font-medium lg:h-9"
            >
              {employeId === null && <option value="">Choisir un employé…</option>}
              {[...new Set(employes.map((e) => e.groupe))].map((g) => (
                <optgroup key={g} label={g}>
                  {employes.filter((e) => e.groupe === g).map((e) => (<option key={e.id} value={e.id}>{e.nom}</option>))}
                </optgroup>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => emp && rang < employes.length - 1 && setEmployeId(employes[rang + 1].id)} disabled={rang < 0 || rang >= employes.length - 1} aria-label="Employé suivant" className={BOUTON_FLECHE}>
            <Icone nom="chevronDroit" />
          </button>
        </div>
      )}
    </div>
  );
}

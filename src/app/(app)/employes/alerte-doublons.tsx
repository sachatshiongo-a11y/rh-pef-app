"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EmployeeName } from "@/components/employee-name";
import { BoutonNeutre, BoutonValider, CLASSES_NEUTRE } from "@/components/action-buttons";
import { libelleMotif, type FicheProche } from "@/lib/employe-doublon";
import { reactiverEmploye } from "./actions";

/** Fiche existante telle que l'écran la reçoit (dates en texte : AAAA-MM-JJ). */
export type FicheDoublonClient = {
  id: string;
  nom: string;
  matricule: string;
  telephone: string | null;
  dateNaissance: string | null;
  actif: boolean;
  poste: string;
  dateEmbauche: string;
  photoUrl: string | null;
};

const dateFr = (iso: string) => {
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
};

/**
 * Fiches PROCHES de la saisie (règle de `lib/employe-doublon`), montrées sous le nom pendant qu'on
 * tape. Trois issues explicites : ouvrir la fiche existante, la réactiver (inactive, Direction —
 * action existante `reactiverEmploye`), ou « C'est une autre personne » (enregistrer quand même).
 * Tant qu'aucune n'est choisie, l'envoi est bloqué ici… et refusé par le serveur, qui revérifie.
 */
export function AlerteDoublons({
  proches,
  ecartes,
  onEcarter,
  onAnnuler,
  peutReactiver,
  modification,
  bloque,
}: {
  proches: FicheProche<FicheDoublonClient>[];
  ecartes: ReadonlySet<string>;
  onEcarter: (ids: string[]) => void;
  onAnnuler: () => void;
  peutReactiver: boolean;
  modification: boolean;
  /** L'utilisateur a tenté d'enregistrer sans choisir : le message passe au rouge. */
  bloque: boolean;
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  if (proches.length === 0) return null;
  const aTrancher = proches.filter((p) => !ecartes.has(p.fiche.id));

  if (aTrancher.length === 0) {
    return (
      <p id="alerte-doublons" className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
        Vous avez indiqué qu&apos;il s&apos;agit d&apos;une autre personne que {proches.map((p) => `« ${p.fiche.nom} »`).join(", ")}.{" "}
        <button type="button" onClick={onAnnuler} className="font-medium text-primary underline">Annuler</button>
      </p>
    );
  }

  function reactiver(id: string) {
    setErreur(null);
    demarrer(async () => {
      try {
        await reactiverEmploye(id);
        router.push(`/employes/${id}`);
      } catch {
        setErreur("La réactivation a échoué. Réessayez depuis la fiche.");
      }
    });
  }

  return (
    <div id="alerte-doublons" role="alert" className={`rounded-lg border p-3 sm:col-span-2 ${bloque ? "border-destructive/50 bg-destructive/5" : "border-amber-300 bg-amber-50"}`}>
      <p className={`text-sm font-semibold ${bloque ? "text-destructive" : "text-amber-900"}`}>
        {aTrancher.length > 1 ? `${aTrancher.length} fiches proches existent déjà` : "Une fiche proche existe déjà"} — choisissez avant d&apos;enregistrer
      </p>
      <ul className="mt-2 space-y-2">
        {aTrancher.map(({ fiche: f, motifs, memeNom }) => (
          <li key={f.id} className="flex flex-col gap-2 rounded-md border bg-card p-2.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <EmployeeName id={f.id} nom={f.nom} photoUrl={f.photoUrl} taille={28} />
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${f.actif ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>{f.actif ? "Actif" : "Inactif"}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{f.matricule}</span> · {f.poste} · entré(e) le {dateFr(f.dateEmbauche)}
              </p>
              <p className="mt-1 flex flex-wrap gap-1">
                {motifs.map((m) => (
                  <span key={m} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{libelleMotif(m, memeNom)}</span>
                ))}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/employes/${f.id}`} className={CLASSES_NEUTRE}>Ouvrir la fiche existante</Link>
              {!f.actif && peutReactiver && (
                <BoutonValider type="button" disabled={enCours} onClick={() => reactiver(f.id)}>Réactiver</BoutonValider>
              )}
            </div>
          </li>
        ))}
      </ul>
      {erreur && <p className="mt-2 text-xs text-destructive">{erreur}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BoutonNeutre type="button" onClick={() => onEcarter(aTrancher.map((p) => p.fiche.id))}>
          C&apos;est une autre personne : {modification ? "enregistrer" : "créer"} quand même
        </BoutonNeutre>
        <span className="text-[11px] text-muted-foreground">Ce choix est tracé au journal.</span>
      </div>
    </div>
  );
}

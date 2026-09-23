"use client";

// Paramètres → Espace salarié : les salariés ACTIFS SANS COMPTE, à cocher, et la création des
// comptes en lot avec leurs fiches de connexion (un PDF à découper). Actions groupées : cases +
// « Tout cocher » + barre d'action, comme le Suivi des pointages (`suivi-bulk.tsx`).
//
// Le PDF arrive dans la réponse de l'action (base64) : il n'existe qu'ici, en mémoire, et c'est le
// seul endroit où figurent les mots de passe temporaires. On ne l'enregistre PAS automatiquement
// après l'action — sur iPhone, la feuille de partage exige un geste de l'utilisateur, et la
// création de dix-huit comptes dure plus longtemps que ce geste ne vaut : un bouton dédié
// l'enregistre par `enregistrerFichier`, le geste de `TelechargerLien`.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoutonValider, CLASSES_GEOMETRIE } from "@/components/action-buttons";
import { EmployeeName } from "@/components/employee-name";
import { enregistrerFichier } from "@/components/telecharger-lien";
import { estErreur } from "@/lib/action-lisible";
import { creerComptesEnLot } from "./comptes-lot-actions";

export type SalarieSansCompte = { id: string; nom: string; matricule: string; photoUrl: string | null };

const AVERTISSEMENT_FICHES = "Ce document contient des mots de passe : remettez chaque fiche en main propre.";

const CLASSES_ENREGISTRER = `${CLASSES_GEOMETRIE} bg-primary text-primary-foreground hover:bg-primary/90`;

type Resultat = {
  pdf: Blob | null;
  nomFichier: string;
  crees: { nom: string; matricule: string }[];
  ignores: { nom: string; raison: string }[];
};

function pdfDepuisBase64(b64: string): Blob {
  const binaire = atob(b64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type: "application/pdf" });
}

export function ComptesEnLot({ salaries }: { salaries: SalarieSansCompte[] }) {
  const router = useRouter();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  // Tant que les fiches n'ont pas été enregistrées une fois, quitter la page les perdrait (et avec
  // elles les mots de passe) : le navigateur demande confirmation.
  const pdfEnAttente = !!resultat?.pdf && !enregistre;
  useEffect(() => {
    if (!pdfEnAttente) return;
    const retenir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [pdfEnAttente]);

  const tousCoches = salaries.length > 0 && salaries.every((s) => selection.has(s.id));

  function toggle(id: string) {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function creer() {
    const ids = [...selection];
    if (ids.length === 0 || enCours) return;
    if (pdfEnAttente && !window.confirm("Les fiches du lot précédent n'ont pas été enregistrées : leurs mots de passe seront perdus. Continuer ?"))
      return;
    setErreur(null);
    demarrer(async () => {
      const r = await creerComptesEnLot(ids);
      if (estErreur(r)) {
        setErreur(r.erreur);
        router.refresh(); // des comptes ont pu être créés avant l'erreur : la liste doit le montrer
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      setResultat({
        pdf: r.pdfBase64 ? pdfDepuisBase64(r.pdfBase64) : null,
        nomFichier: `Fiches de connexion ${date}.pdf`,
        crees: r.crees,
        ignores: r.ignores,
      });
      setEnregistre(false);
      setSelection(new Set());
      router.refresh();
    });
  }

  async function enregistrer() {
    if (!resultat?.pdf) return;
    try {
      await enregistrerFichier(resultat.pdf, resultat.nomFichier);
      setEnregistre(true);
    } catch {
      setErreur("L'enregistrement des fiches a échoué. Réessayez avec le même bouton : ne quittez pas cette page.");
    }
  }

  const n = selection.size;

  return (
    <div className="mt-5 border-t pt-4">
      <h3 className="text-sm font-semibold">Créer les comptes en lot</h3>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
        Salariés actifs <b>sans compte</b>. Chaque compte reçoit un mot de passe temporaire, à changer à la première
        connexion ; un salarié qui a déjà un compte n&apos;est jamais modifié.
      </p>

      <p className="mb-3 max-w-2xl rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
        {AVERTISSEMENT_FICHES}
      </p>

      {erreur && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>
      )}

      {resultat && (
        <div className="mb-3 space-y-2 rounded-md border px-3 py-3 text-sm">
          {resultat.pdf ? (
            <>
              <p className="font-medium text-emerald-800">
                {resultat.crees.length} compte(s) créé(s) : {resultat.crees.map((c) => `${c.nom} (${c.matricule})`).join(", ")}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={enregistrer} className={CLASSES_ENREGISTRER}>
                  Enregistrer les fiches de connexion (PDF)
                </button>
                <span className="text-xs text-muted-foreground">
                  {enregistre
                    ? "Fiches enregistrées. Imprimez-les, découpez-les, remettez chaque fiche en main propre."
                    : "Seul exemplaire des mots de passe : enregistrez-le avant de quitter cette page."}
                </span>
              </div>
            </>
          ) : (
            <p className="font-medium">Aucun compte créé.</p>
          )}
          {resultat.ignores.length > 0 && (
            <div className="text-amber-800">
              <p className="font-medium">Non créés :</p>
              <ul className="ml-5 list-disc">
                {resultat.ignores.map((i, k) => (
                  <li key={k}>
                    {i.nom} — {i.raison}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {salaries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tous les salariés actifs ont un compte.</p>
      ) : (
        <>
          {n > 0 && (
            <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
              <span className="text-sm font-medium">{n} sélectionné(s) :</span>
              <BoutonValider onClick={creer} disabled={enCours}>
                Créer les comptes et imprimer les fiches
              </BoutonValider>
              <button onClick={() => setSelection(new Set())} className="ml-auto text-xs text-muted-foreground underline">
                Tout désélectionner
              </button>
              {enCours && <span className="text-xs text-muted-foreground">Création des comptes…</span>}
            </div>
          )}

          <label className="mb-2 flex w-fit items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tousCoches}
              onChange={(e) => setSelection(e.target.checked ? new Set(salaries.map((s) => s.id)) : new Set())}
            />
            Tout cocher <span className="text-muted-foreground">({salaries.length} salarié(s) sans compte)</span>
          </label>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[20rem] text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="w-8" />
                  <th>Salarié</th>
                  <th>Matricule</th>
                </tr>
              </thead>
              <tbody>
                {salaries.map((s) => (
                  <tr key={s.id} className={`border-t ${selection.has(s.id) ? "bg-primary/5" : ""}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selection.has(s.id)}
                        onChange={() => toggle(s.id)}
                        aria-label={`Sélectionner ${s.nom}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EmployeeName id={s.id} nom={s.nom} photoUrl={s.photoUrl} taille={26} />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.matricule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

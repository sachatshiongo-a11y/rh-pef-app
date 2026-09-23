"use client";

// Paramètres → Espace salarié : TOUS les salariés actifs, l'état de leur compte, et deux actions
// groupées (cases + « Tout cocher » + barre d'action, comme le reste de l'application) :
//   - « Créer les comptes » pour ceux qui n'en ont pas ;
//   - « Nouvelle fiche » pour ceux qui ont un compte à identifiant matricule : nouveau mot de passe
//     temporaire, l'ancien cesse de fonctionner (confirmation obligatoire).
// Chaque salarié traité reçoit SA fiche de connexion, un PDF à part, que la Direction envoie par
// WhatsApp depuis la feuille de partage du téléphone (sur ordinateur : téléchargement). La planche
// de toutes les fiches (8 par A4) reste disponible pour qui imprime.
//
// Les PDF arrivent dans la réponse de l'action (base64) : ils n'existent qu'ici, en mémoire, et ce
// sont les seuls endroits où figurent les mots de passe temporaires. Le mot de passe ne passe
// JAMAIS dans une URL (pas de lien « wa.me/?text=… ») : il ne voyage que dans le fichier. Rien n'est
// envoyé automatiquement : sur iPhone, la feuille de partage exige un geste de l'utilisateur.

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoutonNeutre, BoutonValider, CLASSES_GEOMETRIE, CLASSES_NEUTRE } from "@/components/action-buttons";
import { Avatar } from "@/components/avatar";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { EmployeeName } from "@/components/employee-name";
import { enregistrerFichier, partageDeFichierPossible } from "@/components/telecharger-lien";
import { estErreur } from "@/lib/action-lisible";
import { creerComptesEnLot, nouvellesFichesEnLot } from "./comptes-lot-actions";

/** Même union que `EtatCompteSalarie` (src/lib/comptes-salaries.ts, module serveur). */
export type EtatCompteLigne = "SANS_COMPTE" | "ACTIF" | "DESACTIVE" | "PAR_EMAIL";

export type SalarieLigne = {
  id: string;
  nom: string;
  matricule: string;
  photoUrl: string | null;
  telephone: string | null;
  etat: EtatCompteLigne;
};

const AVERTISSEMENT_FICHES =
  "Chaque fiche contient un mot de passe : envoyez-la au seul salarié concerné, ou remettez-la-lui en main propre.";

const ETATS: Record<EtatCompteLigne, { libelle: string; classes: string }> = {
  SANS_COMPTE: { libelle: "pas de compte", classes: "bg-muted text-muted-foreground" },
  ACTIF: { libelle: "compte actif", classes: "border border-emerald-200 bg-emerald-50 text-emerald-800" },
  DESACTIVE: { libelle: "compte désactivé", classes: "border border-amber-200 bg-amber-50 text-amber-800" },
  PAR_EMAIL: { libelle: "compte par e-mail", classes: "border border-sky-200 bg-sky-50 text-sky-800" },
};

const RAISON_PAR_EMAIL = "compte par adresse e-mail — géré dans Utilisateurs & accès";

const CLASSES_PRINCIPAL = `${CLASSES_GEOMETRIE} bg-primary text-primary-foreground hover:bg-primary/90`;

type FicheRecue = { employeeId: string; nom: string; matricule: string; telephone: string | null; pdf: Blob; nomFichier: string };

type Resultat = {
  action: "creation" | "nouvelle-fiche";
  fiches: FicheRecue[];
  planche: Blob | null;
  ignores: { nom: string; raison: string }[];
};

function pdfDepuisBase64(b64: string): Blob {
  const binaire = atob(b64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type: "application/pdf" });
}

/** Le nom du fichier tel que WhatsApp l'affiche au salarié. */
function nomFichierFiche(nom: string): string {
  return `Fiche de connexion - ${nom.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()}.pdf`;
}

const sAbonnerAucun = () => () => {};
function partageSurCetAppareil(): boolean {
  const essai = new File([new Blob(["%PDF"], { type: "application/pdf" })], "essai.pdf", { type: "application/pdf" });
  return partageDeFichierPossible(essai);
}

export function ComptesEnLot({ salaries }: { salaries: SalarieLigne[] }) {
  const router = useRouter();
  const { sel, toggle, clear, setAll } = useBulkSelection();
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [envoyees, setEnvoyees] = useState<Set<string>>(new Set());
  const [plancheEnregistree, setPlancheEnregistree] = useState(false);
  // Libellé du bouton d'envoi : connu seulement côté client (feuille de partage ou téléchargement) ;
  // « Télécharger » au rendu serveur, sans écart d'hydratation.
  const partage = useSyncExternalStore(sAbonnerAucun, partageSurCetAppareil, () => false);

  const photoDe = useMemo(() => new Map(salaries.map((s) => [s.id, s.photoUrl])), [salaries]);
  const selectionnables = salaries.filter((s) => s.etat !== "PAR_EMAIL");
  const choisis = salaries.filter((s) => sel.has(s.id));
  const aCreer = choisis.filter((s) => s.etat === "SANS_COMPTE");
  const aRenouveler = choisis.filter((s) => s.etat === "ACTIF" || s.etat === "DESACTIVE");
  const desactivesChoisis = aRenouveler.filter((s) => s.etat === "DESACTIVE").length;

  // Une fiche ni envoyée ni couverte par la planche enregistrée = un mot de passe qui n'existe
  // encore que dans cet onglet. Fermer ou recharger l'onglet le perdrait : le navigateur demande
  // confirmation. Cette garde ne voit PAS la navigation interne (menu, liens) : l'écran le dit.
  const enAttente = resultat ? resultat.fiches.filter((f) => !envoyees.has(f.employeeId)) : [];
  const fichesEnAttente = enAttente.length > 0 && !plancheEnregistree;
  useEffect(() => {
    if (!fichesEnAttente) return;
    const retenir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", retenir);
    return () => window.removeEventListener("beforeunload", retenir);
  }, [fichesEnAttente]);

  function lancer(action: Resultat["action"], ids: string[]) {
    if (ids.length === 0 || enCours) return;
    if (
      fichesEnAttente &&
      !window.confirm(
        `${enAttente.length} fiche(s) du lot précédent n'ont été ni envoyées ni enregistrées : leurs mots de passe seront perdus. Continuer ?`,
      )
    )
      return;
    if (action === "nouvelle-fiche") {
      const reactivation = desactivesChoisis > 0 ? ` ${desactivesChoisis} compte(s) désactivé(s) seront réactivés.` : "";
      if (
        !window.confirm(
          `Le mot de passe actuel de ${ids.length} salarié(s) cessera de fonctionner.${reactivation} Une nouvelle fiche sera produite pour chacun. Continuer ?`,
        )
      )
        return;
    }
    setErreur(null);
    demarrer(async () => {
      let r: Awaited<ReturnType<typeof creerComptesEnLot>>;
      try {
        r = action === "creation" ? await creerComptesEnLot(ids) : await nouvellesFichesEnLot(ids);
      } catch {
        // Réponse perdue (réseau coupé, serveur redémarré) : le serveur a pu créer ou réinitialiser
        // des comptes dont les mots de passe ne nous parviendront jamais. Le dire, et le recours.
        setErreur(
          "La réponse du serveur est perdue : des comptes ont peut-être été créés ou réinitialisés. Rechargez la page pour voir leur état, puis refaites « Nouvelle fiche » pour les salariés concernés.",
        );
        router.refresh();
        return;
      }
      if (estErreur(r)) {
        setErreur(r.erreur);
        router.refresh(); // des comptes ont pu être traités avant l'erreur : la liste doit le montrer
        return;
      }
      setResultat({
        action,
        fiches: r.fiches.map((f) => ({
          employeeId: f.employeeId,
          nom: f.nom,
          matricule: f.matricule,
          telephone: f.telephone,
          pdf: pdfDepuisBase64(f.ficheBase64),
          nomFichier: nomFichierFiche(f.nom),
        })),
        planche: r.plancheBase64 ? pdfDepuisBase64(r.plancheBase64) : null,
        ignores: r.ignores,
      });
      setEnvoyees(new Set());
      setPlancheEnregistree(false);
      clear();
      router.refresh();
    });
  }

  async function envoyer(f: FicheRecue) {
    try {
      // `false` = feuille de partage ANNULÉE : rien n'est parti, la fiche reste « à envoyer ».
      if (await enregistrerFichier(f.pdf, f.nomFichier)) {
        setErreur(null);
        setEnvoyees((s) => new Set(s).add(f.employeeId));
      } else {
        setErreur(`Envoi annulé : la fiche de ${f.nom} n'est pas partie. Appuyez de nouveau sur son bouton.`);
      }
    } catch {
      setErreur(`L'envoi de la fiche de ${f.nom} a échoué. Réessayez avec le même bouton : ne quittez pas cette page.`);
    }
  }

  async function enregistrerPlanche() {
    if (!resultat?.planche) return;
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (await enregistrerFichier(resultat.planche, `Fiches de connexion ${date}.pdf`)) {
        setErreur(null);
        setPlancheEnregistree(true);
      } else {
        setErreur("Enregistrement annulé : la planche n'est pas enregistrée.");
      }
    } catch {
      setErreur("L'enregistrement de la planche a échoué. Réessayez avec le même bouton : ne quittez pas cette page.");
    }
  }

  const libelleEnvoi = partage ? "Envoyer par WhatsApp" : "Télécharger la fiche";

  return (
    <div className="mt-5 border-t pt-4">
      <h3 className="text-sm font-semibold">Comptes et fiches de connexion</h3>
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">
        Tous les salariés actifs. <b>Créer les comptes</b> : pour ceux qui n&apos;en ont pas. <b>Nouvelle fiche</b> : un
        nouveau mot de passe temporaire pour un compte existant — l&apos;ancien cesse de fonctionner. Chaque salarié reçoit sa
        propre fiche, à lui envoyer par WhatsApp ; le mot de passe est à changer à la première connexion.
      </p>

      <p className="mb-3 max-w-2xl rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
        {AVERTISSEMENT_FICHES}
      </p>

      {erreur && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>
      )}

      {resultat && (
        <div className="mb-4 space-y-3 rounded-md border px-3 py-3 text-sm">
          {resultat.fiches.length > 0 ? (
            <>
              <p className="font-medium text-emerald-800">
                {resultat.action === "creation"
                  ? `${resultat.fiches.length} compte(s) créé(s).`
                  : `${resultat.fiches.length} mot(s) de passe réinitialisé(s) : les anciens ne fonctionnent plus.`}{" "}
                Envoyez à chacun SA fiche.
              </p>
              <ul className="divide-y rounded-md border">
                {resultat.fiches.map((f) => {
                  const envoyee = envoyees.has(f.employeeId);
                  return (
                    <li key={f.employeeId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                      {/* Avatar + nom SANS lien, par exception : ouvrir la fiche du salarié ici
                          quitterait la page et perdrait les fiches pas encore envoyées. */}
                      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <Avatar nom={f.nom} taille={26} photoUrl={photoDe.get(f.employeeId) ?? null} />
                        <span>{f.nom}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {f.telephone ?? "pas de téléphone enregistré"}
                        </span>
                      </span>
                      <span className={`text-xs font-medium ${envoyee ? "text-emerald-700" : "text-amber-700"}`}>
                        {envoyee ? (partage ? "✓ Envoyée" : "✓ Téléchargée") : "À envoyer"}
                      </span>
                      <button type="button" onClick={() => envoyer(f)} className={envoyee ? CLASSES_NEUTRE : CLASSES_PRINCIPAL}>
                        {envoyee ? `${libelleEnvoi} à nouveau` : libelleEnvoi}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                {partage
                  ? "Le bouton ouvre le partage du téléphone : choisissez WhatsApp, puis le contact du salarié (son numéro est affiché). « Envoyée » veut dire que le partage est allé au bout, pas que le salarié l'a lue."
                  : "Sur ordinateur, la fiche est téléchargée : envoyez-la ensuite au salarié par WhatsApp Web ou depuis votre téléphone."}
              </p>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <BoutonNeutre type="button" onClick={enregistrerPlanche}>
                  Toutes les fiches (PDF à imprimer, 8 par page)
                </BoutonNeutre>
                {plancheEnregistree && <span className="text-xs text-emerald-700">✓ Planche enregistrée</span>}
              </div>
              {/* La garde `beforeunload` ne voit que la fermeture ou le rechargement de l'onglet :
                  ni le menu ni un lien interne. On le dit plutôt que de promettre une protection. */}
              {fichesEnAttente && (
                <p className="text-xs font-medium text-amber-800">
                  {enAttente.length} fiche(s) pas encore envoyée(s) : seul exemplaire de leurs mots de passe. Le navigateur vous
                  retiendra si vous fermez ou rechargez l&apos;onglet, mais PAS si vous ouvrez une autre page de l&apos;application
                  (menu, lien, nom d&apos;un salarié dans la liste) : n&apos;en ouvrez aucune avant d&apos;avoir tout envoyé.
                </p>
              )}
            </>
          ) : (
            <p className="font-medium">{resultat.action === "creation" ? "Aucun compte créé." : "Aucun mot de passe réinitialisé."}</p>
          )}
          {resultat.ignores.length > 0 && (
            <div className="text-amber-800">
              <p className="font-medium">{resultat.action === "creation" ? "Non créés :" : "Non réinitialisés :"}</p>
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
        <p className="text-sm text-muted-foreground">Aucun salarié actif.</p>
      ) : (
        <>
          <div className="mb-3">
            <BulkBar count={sel.size} total={selectionnables.length} onAll={(on) => setAll(selectionnables.map((s) => s.id), on)}>
              <BoutonValider onClick={() => lancer("creation", aCreer.map((s) => s.id))} disabled={enCours || aCreer.length === 0}>
                Créer les comptes ({aCreer.length})
              </BoutonValider>
              <BoutonNeutre
                onClick={() => lancer("nouvelle-fiche", aRenouveler.map((s) => s.id))}
                disabled={enCours || aRenouveler.length === 0}
              >
                ↻ Nouvelle fiche ({aRenouveler.length})
              </BoutonNeutre>
              <button type="button" onClick={clear} className="text-xs text-muted-foreground underline">
                Tout désélectionner
              </button>
              {enCours && <span className="text-xs text-muted-foreground">Traitement en cours…</span>}
            </BulkBar>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th className="w-8" />
                  <th>Salarié</th>
                  <th>Matricule</th>
                  <th>Téléphone</th>
                  <th>Compte</th>
                </tr>
              </thead>
              <tbody>
                {salaries.map((s) => {
                  const etat = ETATS[s.etat];
                  const parEmail = s.etat === "PAR_EMAIL";
                  return (
                    <tr key={s.id} className={`border-t ${sel.has(s.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={sel.has(s.id)}
                          disabled={parEmail}
                          onChange={() => toggle(s.id)}
                          aria-label={`Sélectionner ${s.nom}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <EmployeeName id={s.id} nom={s.nom} photoUrl={s.photoUrl} taille={26} />
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.matricule}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.telephone ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${etat.classes}`}>{etat.libelle}</span>
                        {parEmail && <span className="mt-0.5 block text-xs text-muted-foreground">{RAISON_PAR_EMAIL}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

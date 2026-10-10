"use client";

import { useState } from "react";
import { terminerContrat } from "./dossier-actions";
import { ChampNombre } from "@/components/champ-nombre";
import { lireNombreSaisi, versSaisie } from "@/lib/nombre";
import { MOIS_FR } from "@/lib/dates-fr";
import { AVERTISSEMENT_SOLDE_REGLEMENTAIRE, messageBulletinDuMoisFige, type ReprisesSolde } from "@/lib/solde-tout-compte";

const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
/** Négatif entre parenthèses (convention maison), jamais un signe moins. */
const fmtSigne = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));
const cls = "rounded-md border border-input bg-background px-3 py-2 text-sm";

/**
 * Fin de contrat + solde de tout compte. Le salaire au prorata et l'indemnité de congés non pris
 * sont calculés automatiquement ; les indemnités légales (préavis, licenciement) sont à SAISIR
 * selon la loi RDC et à faire valider par un juriste (le logiciel n'invente aucune valeur légale).
 */
export function FinContratForm({
  employeeId,
  salaireJournalier,
  soldeCongesInit,
  joursPresence,
  ancienneteMois,
  preavisDemission,
  preavisLicenciement,
  indemniteLicenciementJoursParAn,
  reprises = null,
}: {
  employeeId: string;
  salaireJournalier: number;
  soldeCongesInit: number;
  joursPresence: number; // jours de présence du mois en cours (auto)
  ancienneteMois: number;
  preavisDemission: number | null;
  preavisLicenciement: number | null;
  indemniteLicenciementJoursParAn: number | null;
  /** Reste des prêts, acomptes non retenus, bulletin du mois figé (lib/solde-tout-compte.ts). */
  reprises?: ReprisesSolde | null;
}) {
  // Préavis pré-rempli depuis les paramètres légaux selon le motif (À VALIDER si non renseigné).
  const preavisDe = (m: string) =>
    m === "LICENCIEMENT" ? preavisLicenciement : m === "DEMISSION" ? preavisDemission : null;
  // Indemnité de licenciement suggérée = jours/année × années d'ancienneté × salaire journalier.
  const anciennteAnnees = ancienneteMois / 12;
  const indemLicenciementSuggeree =
    indemniteLicenciementJoursParAn != null
      ? Math.round(indemniteLicenciementJoursParAn * anciennteAnnees * salaireJournalier * 100) / 100
      : 0;

  const [motif, setMotif] = useState("DEMISSION");
  const [joursTravailles, setJoursTravailles] = useState(versSaisie(joursPresence));
  const [joursConges, setJoursConges] = useState(versSaisie(Math.max(0, soldeCongesInit)));
  const [preavis, setPreavis] = useState(versSaisie(preavisDemission ?? 0));
  const [licenciement, setLicenciement] = useState("0");
  const [autres, setAutres] = useState("0");

  function changerMotif(m: string) {
    setMotif(m);
    setPreavis(versSaisie(preavisDe(m) ?? 0));
    setLicenciement(m === "LICENCIEMENT" ? versSaisie(indemLicenciementSuggeree) : "0");
  }

  // Saisies à la française (« 1 250,5 ») ; vide ou illisible → 0 dans le récapitulatif (le champ signale « illisible »,
  // et l'envoi est refusé par le serveur plutôt que compté zéro).
  const lire = (s: string) => lireNombreSaisi(s) ?? 0;
  const salaireProrata = salaireJournalier * lire(joursTravailles);
  const indemConges = salaireJournalier * lire(joursConges);
  const indemPreavis = salaireJournalier * lire(preavis);
  const total = salaireProrata + indemConges + indemPreavis + lire(licenciement) + lire(autres);
  const reprisePret = reprises?.reprisePretUSD ?? 0;
  const repriseAcomptes = reprises?.repriseAcomptesUSD ?? 0;
  const netAVerser = total - reprisePret - repriseAcomptes;

  return (
    <form
      action={terminerContrat.bind(null, employeeId)}
      onSubmit={(e) => {
        if (!confirm("Confirmer la fin de contrat ? L'employé sera désactivé (jamais supprimé) et le solde de tout compte archivé.")) {
          e.preventDefault();
        }
      }}
    >
      {/* Reprises MONTRÉES : le serveur les revérifie au centime (un écart depuis l'affichage refuse). */}
      <input type="hidden" name="reprisePretUSD" value={reprisePret.toFixed(2)} />
      <input type="hidden" name="repriseAcomptesUSD" value={repriseAcomptes.toFixed(2)} />
      <div className="mb-4 space-y-2">
        {reprises?.bulletinFigeDuMois && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {messageBulletinDuMoisFige(reprises.bulletinFigeDuMois)}
          </p>
        )}
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {AVERTISSEMENT_SOLDE_REGLEMENTAIRE}
          {(reprises?.primesDuMoisUSD ?? 0) > 0 && <> Primes enregistrées ce mois : {fmt(reprises!.primesDuMoisUSD)}.</>}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Colonne saisie, en 3 blocs clairs */}
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="mb-3 text-sm font-semibold">Motif &amp; date</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Motif du départ">
                <select name="motif" value={motif} onChange={(e) => changerMotif(e.target.value)} className={cls}>
                  <option value="LICENCIEMENT">Licenciement (Art. 67 C.T.)</option>
                  <option value="DEMISSION">Démission (Art. 69 C.T.)</option>
                  <option value="FIN_CDD">Fin de CDD</option>
                  <option value="RETRAITE">Départ à la retraite</option>
                  <option value="FAUTE_LOURDE">Faute lourde (Art. 72 C.T.)</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </Champ>
              <Champ label="Date de fin"><input name="dateFin" type="date" required className={cls} /></Champ>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <p className="mb-1 text-sm font-semibold text-emerald-800">Calculé automatiquement</p>
            <p className="mb-3 text-xs text-emerald-700">D&apos;après les présences saisies et les congés approuvés — ajustable si besoin.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Jours de présence (mois en cours)">
                <ChampNombre name="joursTravaillesMois" suffixe="j" alerteMilliers value={joursTravailles} onChange={(e) => setJoursTravailles(e.target.value)} className={cls} />
              </Champ>
              <Champ label="Jours de congés non pris">
                <ChampNombre name="joursCongesNonPris" suffixe="j" alerteMilliers value={joursConges} onChange={(e) => setJoursConges(e.target.value)} className={cls} />
              </Champ>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <p className="mb-1 text-sm font-semibold text-amber-800">Indemnités légales — à valider (Code du travail RDC)</p>
            <p className="mb-3 text-xs text-amber-700">Pré-remplies depuis Paramètres → paramètres légaux (ancienneté × barème). À faire valider par un juriste.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Préavis (jours)">
                <ChampNombre name="preavisJours" suffixe="j" alerteMilliers value={preavis} onChange={(e) => setPreavis(e.target.value)} className={cls} />
              </Champ>
              <Champ label="Indemnité de licenciement $">
                <ChampNombre name="indemniteLicenciementUSD" suffixe="$" value={licenciement} onChange={(e) => setLicenciement(e.target.value)} className={cls} disabled={motif !== "LICENCIEMENT"} />
              </Champ>
              <Champ label="Autres indemnités $">
                <ChampNombre name="autresUSD" suffixe="$" value={autres} onChange={(e) => setAutres(e.target.value)} className={cls} />
              </Champ>
              <Champ label="Commentaire"><input name="commentaire" placeholder="optionnel" className={cls} /></Champ>
            </div>
          </div>
        </div>

        {/* Carte solde de tout compte, mise en avant */}
        <aside className="lg:sticky lg:top-4 h-max rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm font-semibold">Solde de tout compte</p>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Salaire au prorata <span className="text-xs">({joursTravailles || 0} j × {fmt(salaireJournalier)})</span></span><span className="font-medium">{fmt(salaireProrata)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Congés non pris <span className="text-xs">({joursConges || 0} j)</span></span><span className="font-medium">{fmt(indemConges)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Préavis <span className="text-xs">({preavis || 0} j)</span></span><span className="font-medium">{fmt(indemPreavis)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Licenciement</span><span className="font-medium">{fmt(lire(licenciement))}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Autres</span><span className="font-medium">{fmt(lire(autres))}</span></div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <span className="font-semibold">Total du solde</span>
            <span className="font-semibold">{fmt(total)}</span>
          </div>
          {(reprisePret > 0 || repriseAcomptes > 0) && (
            <div className="mt-2 space-y-1.5 text-sm">
              {reprises!.prets.map((p) => (
                <div key={p.id} className="flex justify-between"><span className="text-muted-foreground">Reste du prêt{p.motif ? <span className="text-xs"> ({p.motif})</span> : null}</span><span className="font-medium">({fmt(p.resteUSD)})</span></div>
              ))}
              {reprises!.acomptes.map((a) => (
                <div key={`${a.annee}-${a.mois}`} className="flex justify-between"><span className="text-muted-foreground">Acompte non retenu <span className="text-xs">({MOIS_FR[a.mois - 1]} {a.annee})</span></span><span className="font-medium">({fmt(a.montantUSD)})</span></div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <span className="font-semibold">Net à verser</span>
            <span className={`text-xl font-bold ${netAVerser < 0 ? "text-red-700" : ""}`}>{fmtSigne(netAVerser)}</span>
          </div>
          {netAVerser < 0 && (
            <p className="mt-2 text-xs text-red-700">
              Le reste du prêt et les acomptes dépassent le solde : le salarié resterait débiteur. À la Direction de décider (annuler le prêt, accord de remboursement) — l&apos;archivage sera refusé en l&apos;état.
            </p>
          )}
          <button className="mt-4 w-full rounded-md bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground hover:opacity-90">
            Terminer le contrat &amp; archiver
          </button>
        </aside>
      </div>
    </form>
  );
}

// Défini au niveau module (pas dans le rendu) : sinon React le voit comme un composant
// différent à chaque rendu et démonte/remonte les champs (perte de focus à la saisie).
function Champ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

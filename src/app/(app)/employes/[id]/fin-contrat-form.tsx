"use client";

import { useState } from "react";
import { terminerContrat } from "./dossier-actions";

const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
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
}: {
  employeeId: string;
  salaireJournalier: number;
  soldeCongesInit: number;
  joursPresence: number; // jours de présence du mois en cours (auto)
  ancienneteMois: number;
  preavisDemission: number | null;
  preavisLicenciement: number | null;
  indemniteLicenciementJoursParAn: number | null;
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
  const [joursTravailles, setJoursTravailles] = useState(String(joursPresence));
  const [joursConges, setJoursConges] = useState(String(Math.max(0, soldeCongesInit)));
  const [preavis, setPreavis] = useState(String(preavisDemission ?? 0));
  const [licenciement, setLicenciement] = useState("0");
  const [autres, setAutres] = useState("0");

  function changerMotif(m: string) {
    setMotif(m);
    setPreavis(String(preavisDe(m) ?? 0));
    setLicenciement(m === "LICENCIEMENT" ? String(indemLicenciementSuggeree) : "0");
  }

  const salaireProrata = salaireJournalier * (Number(joursTravailles) || 0);
  const indemConges = salaireJournalier * (Number(joursConges) || 0);
  const indemPreavis = salaireJournalier * (Number(preavis) || 0);
  const total = salaireProrata + indemConges + indemPreavis + (Number(licenciement) || 0) + (Number(autres) || 0);

  return (
    <form
      action={terminerContrat.bind(null, employeeId)}
      onSubmit={(e) => {
        if (!confirm("Confirmer la fin de contrat ? L'employé sera désactivé (jamais supprimé) et le solde de tout compte archivé.")) {
          e.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Motif</span>
          <select name="motif" value={motif} onChange={(e) => changerMotif(e.target.value)} className={cls}>
            <option value="DEMISSION">Démission</option>
            <option value="LICENCIEMENT">Licenciement</option>
            <option value="FIN_CDD">Fin de CDD</option>
            <option value="AUTRE">Autre</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Date de fin</span>
          <input name="dateFin" type="date" required className={cls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Jours de présence (mois en cours, auto)</span>
          <input name="joursTravaillesMois" type="number" min="0" step="1" value={joursTravailles} onChange={(e) => setJoursTravailles(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Jours de congés non pris (auto)</span>
          <input name="joursCongesNonPris" type="number" min="0" step="0.5" value={joursConges} onChange={(e) => setJoursConges(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Préavis (jours) — loi RDC ⚠</span>
          <input name="preavisJours" type="number" min="0" step="1" value={preavis} onChange={(e) => setPreavis(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Indemnité de licenciement $ — loi RDC ⚠</span>
          <input name="indemniteLicenciementUSD" type="number" min="0" step="0.01" value={licenciement} onChange={(e) => setLicenciement(e.target.value)} className={cls} disabled={motif !== "LICENCIEMENT"} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Autres indemnités $</span>
          <input name="autresUSD" type="number" min="0" step="0.01" value={autres} onChange={(e) => setAutres(e.target.value)} className={cls} />
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-1">
          <span className="text-muted-foreground">Commentaire</span>
          <input name="commentaire" placeholder="optionnel" className={cls} />
        </label>
      </div>

      {/* Récapitulatif du solde de tout compte */}
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex justify-between py-0.5"><span>Salaire au prorata ({joursTravailles || 0} j × {fmt(salaireJournalier)})</span><span className="font-medium">{fmt(salaireProrata)}</span></div>
        <div className="flex justify-between py-0.5"><span>Indemnité congés non pris ({joursConges || 0} j)</span><span className="font-medium">{fmt(indemConges)}</span></div>
        <div className="flex justify-between py-0.5"><span>Indemnité de préavis ({preavis || 0} j)</span><span className="font-medium">{fmt(indemPreavis)}</span></div>
        <div className="flex justify-between py-0.5"><span>Indemnité de licenciement</span><span className="font-medium">{fmt(Number(licenciement) || 0)}</span></div>
        <div className="flex justify-between py-0.5"><span>Autres</span><span className="font-medium">{fmt(Number(autres) || 0)}</span></div>
        <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-bold"><span>Solde de tout compte</span><span>{fmt(total)}</span></div>
      </div>

      <p className="text-xs text-muted-foreground">
        Jours de présence et congés non pris <span className="font-medium">calculés automatiquement</span>{" "}
        (présences saisies et congés approuvés). Le préavis et l&apos;indemnité de licenciement sont
        pré-remplis depuis les <span className="font-medium">Paramètres → paramètres légaux</span>{" "}
        (ancienneté × barème) ; ils dépendent du <span className="font-medium">Code du travail RDC</span> et
        restent <span className="font-medium">à faire valider par un juriste</span> (modifiables ici).
      </p>

      <button className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white">
        Terminer le contrat & archiver le solde
      </button>
    </form>
  );
}

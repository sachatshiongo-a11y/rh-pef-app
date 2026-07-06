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

  const Champ = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );

  return (
    <form
      action={terminerContrat.bind(null, employeeId)}
      onSubmit={(e) => {
        if (!confirm("Confirmer la fin de contrat ? L'employé sera désactivé (jamais supprimé) et le solde de tout compte archivé.")) {
          e.preventDefault();
        }
      }}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Colonne saisie, en 3 blocs clairs */}
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="mb-3 text-sm font-semibold">Motif &amp; date</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Motif du départ">
                <select name="motif" value={motif} onChange={(e) => changerMotif(e.target.value)} className={cls}>
                  <option value="DEMISSION">Démission</option>
                  <option value="LICENCIEMENT">Licenciement</option>
                  <option value="FIN_CDD">Fin de CDD</option>
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
                <input name="joursTravaillesMois" type="number" min="0" step="1" value={joursTravailles} onChange={(e) => setJoursTravailles(e.target.value)} className={cls} />
              </Champ>
              <Champ label="Jours de congés non pris">
                <input name="joursCongesNonPris" type="number" min="0" step="0.5" value={joursConges} onChange={(e) => setJoursConges(e.target.value)} className={cls} />
              </Champ>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <p className="mb-1 text-sm font-semibold text-amber-800">Indemnités légales — à valider (Code du travail RDC)</p>
            <p className="mb-3 text-xs text-amber-700">Pré-remplies depuis Paramètres → paramètres légaux (ancienneté × barème). À faire valider par un juriste.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Préavis (jours)">
                <input name="preavisJours" type="number" min="0" step="1" value={preavis} onChange={(e) => setPreavis(e.target.value)} className={cls} />
              </Champ>
              <Champ label="Indemnité de licenciement $">
                <input name="indemniteLicenciementUSD" type="number" min="0" step="0.01" value={licenciement} onChange={(e) => setLicenciement(e.target.value)} className={cls} disabled={motif !== "LICENCIEMENT"} />
              </Champ>
              <Champ label="Autres indemnités $">
                <input name="autresUSD" type="number" min="0" step="0.01" value={autres} onChange={(e) => setAutres(e.target.value)} className={cls} />
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
            <div className="flex justify-between"><span className="text-muted-foreground">Licenciement</span><span className="font-medium">{fmt(Number(licenciement) || 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Autres</span><span className="font-medium">{fmt(Number(autres) || 0)}</span></div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <span className="font-semibold">Total à verser</span>
            <span className="text-xl font-bold">{fmt(total)}</span>
          </div>
          <button className="mt-4 w-full rounded-md bg-destructive px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
            Terminer le contrat &amp; archiver
          </button>
        </aside>
      </div>
    </form>
  );
}

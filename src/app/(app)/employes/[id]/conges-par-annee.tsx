import Link from "next/link";
import { PastillesFiltre } from "@/components/pastilles-filtre";
import { anneesDeConges, lienFicheAnnee } from "@/lib/fiche-annees";
import { formaterNombre } from "@/lib/montant";
import type { BilanAnneeConge, DemandeCongeFiche } from "@/lib/solde-conge-salarie";
import { AbsencesCard, type AbsenceItem } from "./fiche-cards";

/** Jours, au dixième, à la française ; « — » quand la valeur n'a pas de sens (jamais 0 pour « inconnu »). */
const jours = (n: number | null) => (n === null ? "—" : `${formaterNombre(n, { maximumFractionDigits: 1 })} j`);

function Carte({ label, valeur, rouge = false }: { label: string; valeur: string; rouge?: boolean }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold ${rouge ? "text-red-600" : ""}`}>{valeur}</dd>
    </div>
  );
}

const anneeDe = (d: Date) => new Date(d).getUTCFullYear();

/** Une demande touche l'année si elle commence au plus tard, et finit au plus tôt, cette année-là. */
const touche = (d: DemandeCongeFiche, annee: number) => anneeDe(d.dateDebut) <= annee && anneeDe(d.dateFin) >= annee;

/**
 * CONGÉS PAR ANNÉE CIVILE (demande de la Direction, 2026-10-12) : pastilles des années depuis l'embauche
 * (l'année en cours par défaut), le BILAN de l'année choisie, ses demandes, puis un récapitulatif de toutes
 * les années. Les chiffres viennent de `calculerSoldeAnneeCivile` (via `chargerCongesParAnnee`) : la
 * source du solde de l'en-tête de la fiche, de l'espace salarié et des PDF. Rien n'est recalculé ici.
 */
export function CongesParAnnee({ employeeId, annee, anneeCourante, bilans, demandes, sansConges }: {
  employeeId: string;
  annee: number;
  anneeCourante: number;
  bilans: BilanAnneeConge[];
  demandes: DemandeCongeFiche[];
  sansConges: boolean;
}) {
  const annees = anneesDeConges(bilans, demandes, anneeCourante);
  const effectifs: Record<string, number> = Object.fromEntries(annees.map((a) => [String(a), demandes.filter((d) => touche(d, a)).length]));
  const bilan = bilans.find((b) => b.annee === annee);
  const delAnnee = demandes.filter((d) => touche(d, annee));

  const absences: AbsenceItem[] = delAnnee.map((d) => {
    const details: string[] = [];
    const part = d.joursParAnnee[annee];
    if (anneeDe(d.dateDebut) !== anneeDe(d.dateFin)) {
      details.push(part !== undefined ? `à cheval sur deux années : ${formaterNombre(part, { maximumFractionDigits: 1 })} j décomptés en ${annee}` : "à cheval sur deux années");
    }
    if (d.statut === "APPROUVE" && !d.entameLeSolde) details.push("non décompté du solde");
    return { id: d.id, type: d.type, dateDebut: d.dateDebut, dateFin: d.dateFin, nbJours: d.nbJours, statut: d.statut, motifRefus: d.motifRefus, detail: details.join(" · ") || null };
  });

  return (
    <>
      <div className="mb-4">
        <PastillesFiltre
          libelle="Année des congés"
          valeurs={annees.map((a) => [String(a), String(a)] as const)}
          actif={String(annee)}
          effectifs={effectifs}
          lien={(v) => lienFicheAnnee(employeeId, "conges", Number(v))}
        />
      </div>

      {bilan ? (
        <>
          <dl data-bilan-conges={annee} className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <Carte label={`Report de ${annee - 1}`} valeur={jours(sansConges ? null : bilan.report)} rouge={!sansConges && bilan.report < 0} />
            <Carte label={`Acquis en ${annee}`} valeur={jours(sansConges ? null : bilan.acquisAnnee)} />
            <Carte label={`Pris en ${annee}`} valeur={jours(bilan.pris)} />
            <Carte label="Perdus au plafond" valeur={jours(sansConges ? null : bilan.perdu)} />
            <Carte label={bilan.enCours ? "Solde à date" : `Solde au 31 décembre ${annee}`} valeur={jours(sansConges ? null : bilan.solde)} rouge={!sansConges && bilan.solde < 0} />
          </dl>
          {sansConges && (
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">Contrat sans congés : rien ne s&apos;acquiert, les jours pris sont seulement comptés.</p>
          )}
          {bilan.cSansDemande > 0 && (
            // Régularisation dans la grille : payée comme congé par la paie, donc décomptée — et dite.
            <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">C sans demande</span>
              {bilan.cSansDemande} jour(s) C posé(s) sans demande dans la grille Présences en {annee} : décompté(s) des congés pris.
              Pour les régulariser, enregistrez la demande correspondante (elle remplace ces jours, sans double décompte).
            </p>
          )}
        </>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Pas de bilan pour {annee} : {annee > anneeCourante ? "cette année n'a pas encore commencé" : "le salarié n'était pas encore dans l'entreprise"}.</p>
      )}

      <AbsencesCard absences={absences} messageVide={`Aucune demande de congé en ${annee}.`} />

      {bilans.length > 1 && (
        <section aria-label="Congés, toutes les années" className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Toutes les années</h3>
          <div className="tableau-normal rounded-lg border">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">Année</th>
                  <th className="px-3 py-2 text-right">Report</th>
                  <th className="px-3 py-2 text-right">Acquis</th>
                  <th className="px-3 py-2 text-right">Pris</th>
                  <th className="px-3 py-2 text-right">Perdus</th>
                  <th className="px-3 py-2 text-right">Solde</th>
                </tr>
              </thead>
              <tbody>
                {[...bilans].reverse().map((b) => (
                  <tr key={b.annee} className={`border-t ${b.annee === annee ? "bg-muted/40" : ""}`}>
                    <td className="px-3 py-2">
                      <Link href={lienFicheAnnee(employeeId, "conges", b.annee)} scroll={false} aria-current={b.annee === annee ? "page" : undefined} className="font-medium text-primary underline">{b.annee}</Link>
                      {b.enCours && <span className="ml-1.5 text-xs text-muted-foreground">(à date)</span>}
                    </td>
                    <td className={`px-3 py-2 text-right ${!sansConges && b.report < 0 ? "text-red-600" : ""}`}>{jours(sansConges ? null : b.report)}</td>
                    <td className="px-3 py-2 text-right">{jours(sansConges ? null : b.acquisAnnee)}</td>
                    <td className="px-3 py-2 text-right">{jours(b.pris)}</td>
                    <td className="px-3 py-2 text-right">{jours(sansConges ? null : b.perdu)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${!sansConges && b.solde < 0 ? "text-red-600" : ""}`}>{jours(sansConges ? null : b.solde)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

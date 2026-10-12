import Link from "next/link";
import { PastillesFiltre } from "@/components/pastilles-filtre";
import { anneesDeConges, lienFicheAnnee } from "@/lib/fiche-annees";
import { formaterNombre } from "@/lib/montant";
import type { BilanAnneeConge, DemandeCongeFiche } from "@/lib/solde-conge-salarie";
import type { PeriodeSansConges } from "@/lib/conges-periodes";
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

/** AAAA-MM-JJ → JJ/MM/AAAA. */
const fr = (iso: string) => iso.split("-").reverse().join("/");
const frDate = (d: Date) => fr(new Date(d).toISOString().slice(0, 10));
const anneeDe = (d: Date) => new Date(d).getUTCFullYear();
const libelleType = (t: string) => ({ CDI: "un CDI", CDD: "un CDD", STAGE: "un stage", INTERIM: "un intérim", JOURNALIER: "un contrat journalier" } as Record<string, string>)[t] ?? t;

/** Une demande touche l'année si elle commence au plus tard, et finit au plus tôt, cette année-là. */
const touche = (d: DemandeCongeFiche, annee: number) => anneeDe(d.dateDebut) <= annee && anneeDe(d.dateFin) >= annee;

/**
 * CONGÉS PAR ANNÉE CIVILE (demande de la Direction, 2026-10-12) : pastilles des années depuis l'embauche
 * (l'année en cours par défaut), le BILAN de l'année choisie, ses demandes, puis un récapitulatif de toutes
 * les années. Les chiffres viennent de `calculerSoldeAnneeCivile` (via `chargerCongesParAnnee`) : la
 * source du solde de l'en-tête de la fiche, de l'espace salarié et des PDF. Rien n'est recalculé ici.
 */
export function CongesParAnnee({ employeeId, annee, anneeCourante, bilans, demandes, sansConges, periodesSansConges = [], trous = [], dateSortie = null, ecartFiche = null }: {
  employeeId: string;
  annee: number;
  anneeCourante: number;
  bilans: BilanAnneeConge[];
  demandes: DemandeCongeFiche[];
  sansConges: boolean;
  /** Périodes de stage / d'intérim : aucun jour ne s'acquiert pendant (un mois partiellement couvert n'acquiert pas). */
  periodesSansConges?: PeriodeSansConges[];
  /** Plages couvertes par aucun contrat : le régime du contrat précédent s'y poursuit (signalé, à trancher par la Direction). */
  trous?: { debut: Date; fin: Date | null }[];
  /** Dernier jour de présence d'un salarié parti : le bilan s'arrête à son année. */
  dateSortie?: Date | null;
  /** Type de la fiche contredit par l'historique des contrats (droit aux congés) : le solde suit l'historique. */
  ecartFiche?: { typeFiche: string; typeHistorique: string } | null;
}) {
  const annees = anneesDeConges(bilans, demandes, anneeCourante);
  const effectifs: Record<string, number> = Object.fromEntries(annees.map((a) => [String(a), demandes.filter((d) => touche(d, a)).length]));
  const bilan = bilans.find((b) => b.annee === annee);
  // Année de la sortie : le bilan s'arrête là, et son solde est « à la sortie » (les années d'après n'ont plus de bilan).
  const sortieLe = dateSortie ? new Date(dateSortie).toISOString().slice(0, 10) : null;
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
            {/* Contrat sans congés : seuls l'acquis et les perdus n'ont pas de sens (« — »). Le report et le
                solde restent chiffrés — les jours pris se décomptent — : c'est le solde de l'en-tête de la fiche. */}
            <Carte label={`Report de ${annee - 1}`} valeur={jours(bilan.report)} rouge={bilan.report < 0} />
            <Carte label={`Acquis en ${annee}`} valeur={jours(sansConges ? null : bilan.acquisAnnee)} />
            <Carte label={`Pris en ${annee}`} valeur={jours(bilan.pris)} />
            <Carte label="Perdus au plafond" valeur={jours(sansConges ? null : bilan.perdu)} />
            <Carte label={!bilan.enCours && bilan.annee === Number(sortieLe?.slice(0, 4)) ? `Solde à la sortie (${fr(sortieLe!)})` : bilan.enCours ? "Solde à date" : `Solde au 31 décembre ${annee}`} valeur={jours(bilan.solde)} rouge={bilan.solde < 0} />
          </dl>
          {sansConges && (
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">Contrat sans congés : rien ne s&apos;acquiert, les jours pris sont seulement comptés.</p>
          )}
          {!sansConges && periodesSansConges.length > 0 && (
            // Stage puis CDI (ou l'inverse) : le régime se lit par période de contrat, et un mois n'acquiert que s'il est entièrement avec congés.
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">
              Sans congés ({periodesSansConges.map((p) => `${p.type === "INTERIM" ? "intérim" : "stage"} ${p.debut ? `du ${frDate(p.debut)}` : "depuis l'embauche"}${p.fin ? ` au ${frDate(p.fin)}` : ""}`).join(" ; ")}) :
              rien ne s&apos;acquiert, et un mois à cheval sur une de ces périodes n&apos;acquiert pas.
            </p>
          )}
          {ecartFiche && (
            // Stage sans date de fin sur une fiche CDI (ou l'inverse) : seule contradiction non tranchée — le solde suit le contrat en cours, et c'est dit.
            <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Contrat à vérifier</span>
              La fiche indique {libelleType(ecartFiche.typeFiche)}, mais le contrat enregistré encore en cours est {libelleType(ecartFiche.typeHistorique)} : les congés suivent ce contrat.
              Donnez-lui sa date de fin, enregistrez le nouveau contrat, ou corrigez la fiche.
            </p>
          )}
          {trous.length > 0 && (
            <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Contrat manquant</span>
              Aucun contrat enregistré {trous.map((t) => `${t.fin ? `du ${frDate(t.debut)} au ${frDate(t.fin)}` : `depuis le ${frDate(t.debut)}`}`).join(" ; ")} : les congés suivent le régime du contrat précédent.
              Ajoutez le contrat manquant pour corriger.
            </p>
          )}
          {bilan.cSansDemande > 0 && (
            // Régularisation dans la grille : payée comme congé par la paie, donc décomptée — et dite.
            <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">C sans demande</span>
              {bilan.cSansDemande} jour(s) C posé(s) sans demande dans la grille Présences en {annee} : décompté(s) des congés pris.
              Pour les régulariser, enregistrez la demande correspondante (elle remplace ces jours, sans double décompte).
            </p>
          )}
          {sortieLe && bilan.annee === Number(sortieLe.slice(0, 4)) && (bilan.prisApresSortie ?? 0) > 0 && (
            // Congé daté après le départ : il ne se prendra pas, il n'entame donc pas le solde de sortie — et c'est dit.
            <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Après la sortie</span>
              {jours(bilan.prisApresSortie ?? 0)} de congé posé(s) après la sortie du {fr(sortieLe)} : non déduit(s) du solde. Annulez ces congés.
            </p>
          )}
        </>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Pas de bilan pour {annee} : {annee > anneeCourante ? (sortieLe ? `le salarié est parti le ${fr(sortieLe)}, les années suivantes n'ont plus de bilan` : "cette année n'a pas encore commencé") : "le salarié n'était pas encore dans l'entreprise"}.</p>
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
                    <td className={`px-3 py-2 text-right ${b.report < 0 ? "text-red-600" : ""}`}>{jours(b.report)}</td>
                    <td className="px-3 py-2 text-right">{jours(sansConges ? null : b.acquisAnnee)}</td>
                    <td className="px-3 py-2 text-right">{jours(b.pris)}</td>
                    <td className="px-3 py-2 text-right">{jours(sansConges ? null : b.perdu)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${b.solde < 0 ? "text-red-600" : ""}`}>{jours(b.solde)}</td>
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

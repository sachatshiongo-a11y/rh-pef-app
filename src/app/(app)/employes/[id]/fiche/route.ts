import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceRH } from "@/lib/garde-route";
import { chargerParametresPaie } from "@/lib/config";
import { resumerPresences, type CodePresence } from "@/lib/payroll";
import { FicheEmployeDocument } from "@/lib/pdf/fiche-employe";
import { chargerSoldeCongeSalarie } from "@/lib/solde-conge-salarie";
import { formaterNombre } from "@/lib/montant";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa } from "@/lib/heure-kinshasa";

const fr = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const usd = (n: number) =>
  formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const { id } = await params;

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return new Response("Employé introuvable", { status: 404 });

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = config?.moisCourant ?? numeroMoisCourantKinshasa();
  const annee = config?.anneeCourante ?? anneeCouranteKinshasa();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [contrats, attendances, leaveRequests, payrollLines, parametres, soldeConge] = await Promise.all([
    prisma.contrat.findMany({ where: { employeeId: id }, orderBy: { dateDebut: "desc" } }),
    prisma.attendance.findMany({ where: { employeeId: id, date: { gte: debutMois, lte: finMois } } }),
    prisma.leaveRequest.findMany({ where: { employeeId: id }, orderBy: { dateDebut: "desc" }, take: 15 }),
    prisma.payrollLine.findMany({
      where: { employeeId: id },
      include: { payrollRun: true },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
    }),
    chargerParametresPaie(),
    // Le solde de congé se lit à la SOURCE UNIQUE, à l'horloge (2026-09-29) : c'est le chiffre de
    // la fiche à l'écran et de l'espace salarié. Avant, ce PDF le recalculait sur Config.moisCourant
    // (qui peut rester figé) et sur les 15 dernières demandes seulement → il pouvait différer de l'écran.
    // L'ancienneté imprimée plus bas n'est PAS concernée (hors du périmètre de ce correctif).
    chargerSoldeCongeSalarie(prisma, id),
  ]);

  const resume = resumerPresences(attendances.map((a) => a.code as CodePresence));
  const salaireJournalier = Number(employee.salaireMensuel) / parametres.joursOuvrablesMois;
  const salaireHoraire = salaireJournalier / Number(employee.heuresParJour);
  const anciennete =
    (new Date(annee, mois - 1).getFullYear() - new Date(employee.dateEmbauche).getFullYear()) * 12 +
    (new Date(annee, mois - 1).getMonth() - new Date(employee.dateEmbauche).getMonth());

  const periodePresences = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const buffer = await renderPdfBuffer(
    FicheEmployeDocument({
      employee,
      general: [
        { label: "Catégorie", value: employee.categorie },
        { label: "Type", value: employee.type },
        { label: "Contrat", value: employee.contrat },
        { label: "Poste", value: employee.poste },
        { label: "Secteur", value: employee.secteur },
        { label: "Sexe", value: employee.sexe },
        { label: "État civil", value: employee.etatCivil },
        { label: "Enfants", value: String(employee.enfants) },
        { label: "Téléphone", value: employee.telephone ?? "—" },
        { label: "Date d'embauche", value: fr(employee.dateEmbauche) },
        { label: "Ancienneté", value: `${anciennete} mois` },
        { label: "Heures / jour", value: String(employee.heuresParJour) },
      ],
      salaire: [
        { label: `Salaire mensuel${parametres.salairesSaisisEnNet ? " net" : ""}`, value: usd(Number(employee.salaireMensuel)) },
        { label: `Salaire journalier${parametres.salairesSaisisEnNet ? " net" : ""}`, value: usd(salaireJournalier) },
        { label: `Salaire horaire${parametres.salairesSaisisEnNet ? " net" : ""}`, value: usd(salaireHoraire) },
        { label: "Transport / jour", value: `${formaterNombre(Number(employee.transportJourCDF))} CDF` },
        { label: "Heures hebdo", value: String(employee.heuresHebdomadaires) },
        { label: "CNSS", value: usd(Number(employee.cnssMontant)) },
      ],
      presences: [
        { label: "Payé 100%", value: String(resume.payes100) },
        { label: "Payé 2/3", value: String(resume.payes2_3) },
        { label: "Non payé", value: String(resume.nonPayes) },
      ],
      periodePresences,
      soldes: [
        { label: "Congés acquis (année)", value: `${soldeConge.acquis} j` },
        { label: "Congés pris (année)", value: `${soldeConge.pris} j` },
        { label: "Solde de congé annuel", value: `${soldeConge.solde} j` },
      ],
      conges: leaveRequests.map((l) => ({
        type: l.type,
        debut: fr(l.dateDebut),
        fin: fr(l.dateFin),
        jours: Number(l.nbJours),
        statut: l.statut.replace("_", " "),
      })),
      paies: payrollLines.map((l) => ({
        periode: new Date(l.payrollRun.annee, l.payrollRun.mois - 1).toLocaleDateString("fr-FR", {
          month: "long",
          year: "numeric",
        }),
        netUSD: usd(salaireNetUSD(l)),
        netCDF: `${formaterNombre(salaireNetCDF(l, Number(l.payrollRun.tauxChangeUtilise)), { maximumFractionDigits: 0 })} CDF`,
        verseUSD: usd(totalVerseUSD(l)),
        statut: l.statutPaiement === "PAYE" ? "Payé" : "En attente",
      })),
      contrats: contrats.map((c) => ({
        type: c.type,
        debut: fr(c.dateDebut),
        fin: fr(c.dateFin),
        essai: fr(c.finPeriodeEssai),
        statut: c.statut,
      })),
    })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Fiche_${employee.matricule}.pdf"`,
    },
  });
}

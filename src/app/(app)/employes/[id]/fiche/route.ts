import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { calculerCongesAcquis, resumerPresences, type CodePresence } from "@/lib/payroll";
import { FicheEmployeDocument } from "@/lib/pdf/fiche-employe";

const fr = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const usd = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return new Response("Employé introuvable", { status: 404 });

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const annee = config?.anneeCourante ?? new Date().getFullYear();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const debutAnnee = new Date(Date.UTC(annee, 0, 1));

  const [contrats, attendances, leaveRequests, payrollLines, parametres] = await Promise.all([
    prisma.contrat.findMany({ where: { employeeId: id }, orderBy: { dateDebut: "desc" } }),
    prisma.attendance.findMany({ where: { employeeId: id, date: { gte: debutMois, lte: finMois } } }),
    prisma.leaveRequest.findMany({ where: { employeeId: id }, orderBy: { dateDebut: "desc" }, take: 15 }),
    prisma.payrollLine.findMany({
      where: { employeeId: id },
      include: { payrollRun: true },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
    }),
    chargerParametresPaie(),
  ]);

  const resume = resumerPresences(attendances.map((a) => a.code as CodePresence));
  const salaireJournalier = Number(employee.salaireMensuel) / parametres.joursOuvrablesMois;
  const salaireHoraire = salaireJournalier / Number(employee.heuresParJour);
  const anciennete =
    (new Date(annee, mois - 1).getFullYear() - new Date(employee.dateEmbauche).getFullYear()) * 12 +
    (new Date(annee, mois - 1).getMonth() - new Date(employee.dateEmbauche).getMonth());
  const congesAcquis = calculerCongesAcquis(anciennete, parametres.droitsCongesAnnuel);
  const congesPris = leaveRequests
    .filter((l) => l.statut === "APPROUVE" && new Date(l.dateDebut) >= debutAnnee)
    .reduce((acc, l) => acc + Number(l.nbJours), 0);

  const periodePresences = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const buffer = await renderToBuffer(
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
        { label: "Salaire mensuel", value: usd(Number(employee.salaireMensuel)) },
        { label: "Salaire journalier", value: usd(salaireJournalier) },
        { label: "Salaire horaire", value: usd(salaireHoraire) },
        { label: "Transport / jour", value: `${Number(employee.transportJourCDF).toLocaleString("fr-FR")} CDF` },
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
        { label: "Congés acquis (année)", value: `${congesAcquis} j` },
        { label: "Congés pris (année)", value: `${congesPris} j` },
        { label: "Solde", value: `${Math.round((congesAcquis - congesPris) * 10) / 10} j` },
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
        netUSD: usd(Number(l.salNetUSD)),
        netCDF: `${Number(l.salNetCDF).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF`,
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

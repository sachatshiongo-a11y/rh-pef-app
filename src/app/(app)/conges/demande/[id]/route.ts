import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { DemandeCongeDocument } from "@/lib/pdf/demande-conge";
import { calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { chargerParametresPaie } from "@/lib/config";
import { chargerTauxParTypeConge } from "@/lib/conges";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await verifySession();
  const { id } = await params;

  const demande = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: true, approuvePar: true, remplacant: true },
  });
  if (!demande) {
    return new Response("Demande introuvable", { status: 404 });
  }

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const annee = config?.anneeCourante ?? new Date().getFullYear();
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const debutAnnee = new Date(Date.UTC(annee, 0, 1));

  const ancienneteMois =
    (new Date(annee, mois - 1, 1).getFullYear() -
      new Date(demande.employee.dateEmbauche).getFullYear()) *
      12 +
    (new Date(annee, mois - 1, 1).getMonth() - new Date(demande.employee.dateEmbauche).getMonth());
  const parametres = await chargerParametresPaie();
  const congesAcquis = calculerCongesAcquis(ancienneteMois, parametres.droitsCongesAnnuel);

  const approuvees = await prisma.leaveRequest.findMany({
    where: {
      employeeId: demande.employeeId,
      statut: "APPROUVE",
      dateDebut: { gte: debutAnnee },
    },
  });
  const tauxParType = await chargerTauxParTypeConge();
  // Seuls les congés DÉDUCTIBLES (annuels payés) entament le solde ; les congés spéciaux
  // (maternité, paternité, maladie, accident…) et les congés sans solde n'y touchent pas.
  const congesPris = approuvees
    .filter((l) => congeDeductibleDuSolde(l.type, tauxParType.get(l.type)))
    .reduce((acc, l) => acc + Number(l.nbJours), 0);
  const soldeConges = Math.round((congesAcquis - congesPris) * 10) / 10;

  const buffer = await renderToBuffer(
    DemandeCongeDocument({
      employee: demande.employee,
      demande,
      approuvePar: demande.approuvePar,
      remplacant: demande.remplacant,
      soldeConges,
    })
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Demande_${demande.employee.matricule}.pdf"`,
    },
  });
}

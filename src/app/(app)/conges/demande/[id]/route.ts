import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { DemandeCongeDocument } from "@/lib/pdf/demande-conge";
import { ancienneteEnMois, calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { chargerParametresPaie } from "@/lib/config";
import { typeSansConges, chargerTauxParTypeConge } from "@/lib/regles-contrats";

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

  const ancienneteMois = ancienneteEnMois(new Date(demande.employee.dateEmbauche), new Date(annee, mois - 1, 1));
  const parametres = await chargerParametresPaie();
  const congesAcquis = typeSansConges(demande.employee.contrat) ? 0 : calculerCongesAcquis(ancienneteMois, parametres.droitsCongesAnnuel);

  const [approuvees, tauxParType] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: demande.employeeId,
        statut: "APPROUVE",
        dateDebut: { gte: debutAnnee },
      },
    }),
    chargerTauxParTypeConge(),
  ]);
  // Seuls les congés DÉDUCTIBLES (payés, hors congés spéciaux) entament le solde ; les congés
  // spéciaux (maternité, paternité, maladie, accident…) et les congés sans solde (tauxPct = 0)
  // n'y touchent pas — même logique que partout ailleurs.
  const congesPris = approuvees
    .filter((l) => congeDeductibleDuSolde(l.type, tauxParType.get(l.type)))
    .reduce((acc, l) => acc + Number(l.nbJours), 0);
  const soldeConges = Math.round((congesAcquis - congesPris) * 10) / 10;

  const buffer = await renderPdfBuffer(
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

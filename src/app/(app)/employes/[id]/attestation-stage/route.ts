import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { AttestationStageDocument } from "@/lib/pdf/attestation-stage";
import { chargerEntreprise } from "@/lib/entreprise";
import { slugFichier } from "@/lib/texte";

/** Attestation de fin de stage (PDF) — générée depuis la fiche employé (Direction / Manager). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const { id } = await params;

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return new Response("Employé introuvable", { status: 404 });

  // Le stage le plus récent (actif ou terminé) — l'attestation se délivre en fin de stage.
  const contrat = await prisma.contrat.findFirst({
    where: { employeeId: id, type: "STAGE" },
    orderBy: { dateDebut: "desc" },
  });
  if (!contrat) return new Response("Aucun contrat de stage pour cet employé.", { status: 404 });

  const ent = await chargerEntreprise();
  const buffer = await renderPdfBuffer(AttestationStageDocument({ employee, contrat, entreprise: ent.entreprise, logo: ent.logo }));
  const nom = slugFichier(employee.nom);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Attestation_stage_${nom}.pdf"`,
    },
  });
}

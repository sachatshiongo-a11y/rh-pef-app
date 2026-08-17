import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { AttestationPaieDocument } from "@/lib/pdf/attestation-paie";
import { chargerEntreprise } from "@/lib/entreprise";
import { slugFichier } from "@/lib/texte";

/** Attestation de paie d'UN MOIS (PDF) — dérivée de la ligne de paie réelle. Direction / Manager. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; ligneId: string }> }) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const { id, ligneId } = await params;

  const ligne = await prisma.payrollLine.findUnique({
    where: { id: ligneId },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne || ligne.employeeId !== id) {
    return new Response("Aucune ligne de paie pour cet employé sur cette période.", { status: 404 });
  }

  const ent = await chargerEntreprise();
  const buffer = await renderPdfBuffer(
    AttestationPaieDocument({
      employee: ligne.employee,
      ligne,
      run: ligne.payrollRun,
      entreprise: ent.entreprise,
      logo: ent.logo,
      signature: ent.signature,
    }),
  );

  const nom = slugFichier(ligne.employee.nom);
  const periode = `${ligne.payrollRun.annee}-${String(ligne.payrollRun.mois).padStart(2, "0")}`;
  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="Attestation_paie_${periode}_${nom}.pdf"`,
    },
  });
}

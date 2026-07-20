import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { AttestationDocument, type TypeAttestation } from "@/lib/pdf/attestation";
import { chargerEntreprise } from "@/lib/entreprise";

/** Attestation de travail / de salaire du salarié connecté (self-service, ses données uniquement). */
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) {
    return new Response("Accès refusé", { status: 403 });
  }
  const { type } = await params;
  if (type !== "travail" && type !== "salaire") return new Response("Type d'attestation inconnu", { status: 404 });

  const employee = await prisma.employee.findUnique({ where: { id: user.employeeId } });
  if (!employee) return new Response("Employé introuvable", { status: 404 });

  // Contrat courant (actif le plus récent) ou, à défaut, le plus récent — toujours celui du salarié.
  const contrat =
    (await prisma.contrat.findFirst({ where: { employeeId: user.employeeId, statut: "ACTIF" }, orderBy: { dateDebut: "desc" } })) ??
    (await prisma.contrat.findFirst({ where: { employeeId: user.employeeId }, orderBy: { dateDebut: "desc" } }));
  if (!contrat) return new Response("Aucun contrat enregistré.", { status: 404 });

  const ent = await chargerEntreprise();
  const buffer = await renderPdfBuffer(
    AttestationDocument({ employee, contrat, type: type as TypeAttestation, entreprise: ent.entreprise, logo: ent.logo, signature: ent.signature }),
  );
  const nom = employee.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");
  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="Attestation_${type}_${nom}.pdf"`,
    },
  });
}

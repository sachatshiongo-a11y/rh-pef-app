import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { AttestationDocument, type TypeAttestation } from "@/lib/pdf/attestation";
import { chargerEntreprise } from "@/lib/entreprise";
import { slugFichier } from "@/lib/texte";

/** Attestation de travail ou de salaire (PDF) — Direction / Manager. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; type: string }> }) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const { id, type } = await params;
  if (type !== "travail" && type !== "salaire") return new Response("Type d'attestation inconnu", { status: 404 });

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return new Response("Employé introuvable", { status: 404 });

  // Contrat courant (actif le plus récent) ou, à défaut, le plus récent.
  const contrat =
    (await prisma.contrat.findFirst({ where: { employeeId: id, statut: "ACTIF" }, orderBy: { dateDebut: "desc" } })) ??
    (await prisma.contrat.findFirst({ where: { employeeId: id }, orderBy: { dateDebut: "desc" } }));
  if (!contrat) return new Response("Aucun contrat pour cet employé.", { status: 404 });

  const ent = await chargerEntreprise();
  const buffer = await renderPdfBuffer(
    AttestationDocument({ employee, contrat, type: type as TypeAttestation, entreprise: ent.entreprise, logo: ent.logo, signature: ent.signature }),
  );
  const nom = slugFichier(employee.nom);
  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="Attestation_${type}_${nom}.pdf"`,
    },
  });
}

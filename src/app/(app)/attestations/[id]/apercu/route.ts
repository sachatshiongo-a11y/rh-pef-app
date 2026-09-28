import { exigerEspaceRH } from "@/lib/garde-route";
import { prisma } from "@/lib/prisma";
import { instantaneAttestation } from "@/lib/attestations";
import { rendreApercuAttestationPdf } from "@/lib/pdf/attestation-buffer";

/**
 * APERÇU d'une demande avant délivrance — ce que l'attestation imprimerait AUJOURD'HUI, sans
 * numéro (il n'est tiré qu'à la délivrance) et sans rien écrire. Une demande inéligible répond par
 * son motif, en texte : c'est exactement ce que la délivrance refuserait.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const a = await prisma.attestation.findUnique({ where: { id }, select: { employeeId: true, type: true } });
  if (!a) return new Response("Demande introuvable", { status: 404 });
  const maintenant = new Date();
  const r = await instantaneAttestation(prisma, a.employeeId, a.type, maintenant);
  if (!r.ok) return new Response(r.motif, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  // Si la demande est délivrée, elle répondra à la demande du salarié : l'aperçu le dit déjà.
  const pdf = await rendreApercuAttestationPdf({ donnees: { ...r.donnees, aSaDemande: true }, delivreeLe: maintenant });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Apercu_attestation.pdf"`, "Cache-Control": "private, no-store" },
  });
}

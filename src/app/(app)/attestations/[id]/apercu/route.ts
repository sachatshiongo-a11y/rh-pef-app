import { verifySession, estRH } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { instantaneAttestation } from "@/lib/attestations";
import { rendreAttestationPdf } from "@/lib/pdf/attestation-buffer";

/**
 * APERÇU d'une demande avant délivrance — ce que l'attestation imprimerait AUJOURD'HUI, sans
 * numéro (il n'est tiré qu'à la délivrance) et sans rien écrire. Une demande inéligible répond par
 * son motif, en texte : c'est exactement ce que la délivrance refuserait.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!estRH(user.role)) return new Response("Accès refusé", { status: 403 });
  const { id } = await params;
  const a = await prisma.attestation.findUnique({ where: { id }, select: { employeeId: true, type: true } });
  if (!a) return new Response("Demande introuvable", { status: 404 });
  const maintenant = new Date();
  const r = await instantaneAttestation(prisma, a.employeeId, a.type, maintenant);
  if (!r.ok) return new Response(r.motif, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const pdf = await rendreAttestationPdf({ donnees: r.donnees, numero: "à attribuer à la délivrance", delivreeLe: maintenant });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Apercu_attestation.pdf"`, "Cache-Control": "private, no-store" },
  });
}

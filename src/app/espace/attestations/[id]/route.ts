import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { exemplaireAttestation } from "@/lib/pdf/attestation-buffer";

/**
 * Exemplaire d'une attestation DÉLIVRÉE, pour son TITULAIRE seulement : la propriété se lit en base
 * (`Attestation.employeeId`), jamais dans l'URL. L'exemplaire figé n'est pas exposé par
 * `/fichiers` au salarié : c'est cette route, et elle seule, qui le lui sert.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) {
    return new Response("Accès refusé", { status: 403 });
  }
  const { id } = await params;
  const a = await prisma.attestation.findUnique({ where: { id } });
  // Inconnue ou à un collègue : même réponse, qui ne dit pas laquelle des deux.
  if (!a || a.employeeId !== user.employeeId) return new Response("Accès refusé", { status: 403 });
  const pdf = await exemplaireAttestation(a);
  if (!pdf) return new Response("Cette attestation n'a pas encore été délivrée.", { status: 404 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

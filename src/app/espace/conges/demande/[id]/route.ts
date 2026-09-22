import { verifySession, estSalarie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { genererDemandeCongePdf } from "@/lib/pdf/demande-conge-buffer";

/**
 * Demande de congé (PDF) du salarié pour SON espace — le document qu'on lui demande de signer.
 *
 * C'est EXACTEMENT le document de la Direction : même assembleur (`genererDemandeCongePdf`),
 * donc mêmes mentions, même paraphe, même comportement quand la demande a bougé depuis la
 * signature. Seule la garde diffère.
 *
 * Toute garde qui échoue répond 403 — JAMAIS une redirection vers /login : un `fetch` (ou le
 * lien « Télécharger ») suit les redirections et enregistrerait la page de connexion sous le nom
 * du document, sans que rien ne signale l'erreur.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  // 1. L'espace salarié est ouvert, 2. la session est bien celle d'un salarié relié à une fiche.
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) {
    return new Response("Accès refusé", { status: 403 });
  }

  const { id } = await params;
  // 3. La demande appartient au salarié CONNECTÉ, et 4. elle est approuvée : les deux se lisent
  // en base AVANT de composer quoi que ce soit — une demande en attente ou refusée n'a pas de
  // document à remettre, et l'`employeeId` comparé est celui de la SESSION, jamais un paramètre
  // du client.
  const demande = await prisma.leaveRequest.findUnique({
    where: { id },
    select: { employeeId: true, statut: true },
  });
  if (!demande || demande.employeeId !== user.employeeId) {
    return new Response("Accès refusé", { status: 403 });
  }
  if (demande.statut !== "APPROUVE") {
    return new Response("Cette demande n'est pas approuvée", { status: 403 });
  }

  const pdf = await genererDemandeCongePdf(id);
  if (!pdf) return new Response("Demande introuvable", { status: 404 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}

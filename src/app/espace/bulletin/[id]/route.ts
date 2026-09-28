import { exigerEspaceSalarie } from "@/lib/garde-route";
import { prisma } from "@/lib/prisma";
import { genererBulletinPdf } from "@/lib/pdf/bulletin-buffer";
import type { Devise } from "@/lib/pdf/theme";
import { bulletinVisibleParLeSalarie } from "@/lib/bulletin-salarie";

// Bulletin d'un salarié pour SON espace : accès strictement limité à ses propres bulletins.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigerEspaceSalarie();
  if (!g.ok) return g.reponse;
  const compte = { employeeId: g.user.employeeId };

  const { id } = await params;
  const url = new URL(request.url);
  const devise: Devise = url.searchParams.get("devise") === "CDF" ? "CDF" : "USD";
  // ?dl=1 → téléchargement direct ; sinon affichage inline (aperçu dans le visualiseur).
  const telecharger = url.searchParams.get("dl") === "1";

  // Propriété ET statut lus en base AVANT de composer le PDF : un salarié n'ouvre que SES bulletins,
  // et seulement VALIDÉS ou PAYÉS — un brouillon (PAS_VALIDE) n'a pas été arrêté par la Direction.
  const ligne = await prisma.payrollLine.findUnique({ where: { id }, select: { employeeId: true, statutPaiement: true } });
  if (!ligne) return new Response("Bulletin introuvable", { status: 404 });
  if (ligne.employeeId !== compte.employeeId) return new Response("Accès refusé", { status: 403 });
  if (!bulletinVisibleParLeSalarie(ligne.statutPaiement)) {
    return new Response("Ce bulletin n'est pas encore validé par la Direction.", { status: 403 });
  }

  const pdf = await genererBulletinPdf(id, devise);
  if (!pdf) return new Response("Bulletin introuvable", { status: 404 });
  // Contrôle de propriété : un salarié ne peut consulter QUE ses propres bulletins.
  if (pdf.employeeId !== compte.employeeId) return new Response("Accès refusé", { status: 403 });

  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}

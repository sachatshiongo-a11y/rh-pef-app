import { verifySession, estSalarie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { genererBulletinPdf } from "@/lib/pdf/bulletin-buffer";
import type { Devise } from "@/lib/pdf/theme";

// Bulletin d'un salarié pour SON espace : accès strictement limité à ses propres bulletins.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user)) {
    return new Response("Accès refusé", { status: 403 });
  }
  const compte = { employeeId: user.employeeId };
  if (!compte.employeeId) return new Response("Compte non relié", { status: 403 });

  const { id } = await params;
  const url = new URL(request.url);
  const devise: Devise = url.searchParams.get("devise") === "CDF" ? "CDF" : "USD";
  // ?dl=1 → téléchargement direct ; sinon affichage inline (aperçu dans le visualiseur).
  const telecharger = url.searchParams.get("dl") === "1";

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

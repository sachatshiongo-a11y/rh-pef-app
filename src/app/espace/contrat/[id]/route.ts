import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";

/** Contrat de travail (PDF) du salarié pour SON espace — accès limité à ses propres contrats. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) {
    return new Response("Accès refusé", { status: 403 });
  }
  const { id } = await params;
  const pdf = await genererContratPdf(id);
  if (!pdf) return new Response("Contrat introuvable", { status: 404 });
  if (pdf.employeeId !== user.employeeId) return new Response("Accès refusé", { status: 403 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}

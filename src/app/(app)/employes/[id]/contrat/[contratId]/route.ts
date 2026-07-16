import { verifySession, requireRole } from "@/lib/auth";
import { genererContratPdf } from "@/lib/pdf/contrat-buffer";

/** Contrat de travail (PDF) généré depuis la fiche — Direction / Manager. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; contratId: string }> }) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const { id, contratId } = await params;

  const pdf = await genererContratPdf(contratId);
  if (!pdf || pdf.employeeId !== id) return new Response("Contrat introuvable", { status: 404 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}

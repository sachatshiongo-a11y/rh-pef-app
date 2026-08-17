import { verifySession, requireRole } from "@/lib/auth";
import { genererFichePostePdf } from "@/lib/pdf/fiche-poste-buffer";

/** Fiche de poste (PDF) générée depuis les infos enregistrées — Direction / Manager. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const { id } = await params;

  const pdf = await genererFichePostePdf(id);
  if (!pdf) return new Response("Fiche de poste introuvable", { status: 404 });

  const telecharger = new URL(request.url).searchParams.get("dl") === "1";
  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${pdf.nomFichier}"`,
    },
  });
}

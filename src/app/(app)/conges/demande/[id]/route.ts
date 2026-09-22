import { verifySession } from "@/lib/auth";
import { genererDemandeCongePdf } from "@/lib/pdf/demande-conge-buffer";

/** Demande de congé (PDF) côté Direction. Le document lui-même est assemblé par
 *  `genererDemandeCongePdf`, partagé avec l'espace salarié (/espace/conges/demande) : les deux
 *  côtés impriment donc rigoureusement la même feuille. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await verifySession();
  const { id } = await params;

  const pdf = await genererDemandeCongePdf(id);
  if (!pdf) {
    return new Response("Demande introuvable", { status: 404 });
  }

  return new Response(new Uint8Array(pdf.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.nomFichier}"`,
    },
  });
}

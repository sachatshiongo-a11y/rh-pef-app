import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { BonCommandeDocument } from "@/lib/pdf/bon-commande";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  requireModule(user, "stock");
  const { id } = await params;

  const bc = await prisma.bonDeCommande.findUnique({
    where: { id },
    include: { lignes: true, fournisseur: true },
  });
  if (!bc) return new Response("Bon de commande introuvable", { status: 404 });
  if (bc.statut === "BROUILLON") {
    return new Response("Le bon de commande doit être validé avant d'être exporté.", { status: 409 });
  }

  const acheteur = await prisma.parametresAchat.findUnique({ where: { id: "singleton" } });

  const buffer = await renderPdfBuffer(BonCommandeDocument({ bc, fournisseur: bc.fournisseur, acheteur }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="BC_${bc.numero.replace(/\//g, "-")}.pdf"`,
    },
  });
}

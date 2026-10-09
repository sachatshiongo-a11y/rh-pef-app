import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { BonCommandeDocument } from "@/lib/pdf/bon-commande";
import { CHAMPS_CONTENANCE } from "@/lib/libelle-article";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;
  const { id } = await params;

  const bc = await prisma.bonDeCommande.findUnique({
    where: { id },
    include: { lignes: { include: { article: { select: CHAMPS_CONTENANCE } } }, fournisseur: true },
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

import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";

export async function GET() {
  const user = await verifySession();
  requireModule(user, "stock");

  const fournisseurs = await prisma.fournisseur.findMany({
    orderBy: { nom: "asc" },
    include: { _count: { select: { articles: true, factures: true, bonsCommande: true } } },
  });

  const lignes = fournisseurs.map((f) => [
    f.nom, f.contactNom ?? "", f.telephone ?? "", f.email ?? "", f.ville ?? "", f.pays ?? "",
    f.rccm ?? "", f.idNational ?? "", f.delaiPaiement ?? "", f.delaiLivraison ?? "", f.modePaiement ?? "",
    f.produits ?? "", f._count.articles, f._count.bonsCommande, f._count.factures,
  ]);

  const buf = await classeurExcel({
    titre: "Fournisseurs",
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: "Fournisseurs",
      entete: ["Nom", "Contact", "Téléphone", "Email", "Ville", "Pays", "RCCM", "ID National", "Délai paiement", "Délai livraison", "Mode paiement", "Produits", "Articles", "Bons de cde", "Factures"],
      lignes,
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Fournisseurs_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}

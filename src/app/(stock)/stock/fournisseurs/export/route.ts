import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";
import { MAX_EXPORT_SELECTION } from "@/lib/export-selection";

export async function GET(request: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  // `?ids=a,b` : seulement les fournisseurs cochés sur l'écran (sans ce paramètre, tous — export historique).
  const brut = new URL(request.url).searchParams.get("ids");
  const ids = brut === null ? null : [...new Set(brut.split(",").map((x) => x.trim()).filter(Boolean))];
  // Plafond de l'export d'une SÉLECTION (le bouton se désactive au-delà) : refus lisible plutôt qu'un fichier tronqué.
  if (ids && ids.length > MAX_EXPORT_SELECTION) return new Response(`Exportez ${MAX_EXPORT_SELECTION} fournisseurs au plus à la fois.`, { status: 400 });

  const fournisseurs = await prisma.fournisseur.findMany({
    ...(ids ? { where: { id: { in: ids } } } : {}),
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
    periode: jourKinshasa(new Date()),
    feuilles: [{
      nom: "Fournisseurs",
      entete: ["Nom", "Contact", "Téléphone", "Email", "Ville", "Pays", "RCCM", "ID National", "Délai paiement", "Délai livraison", "Mode paiement", "Produits", "Articles", "Bons de cde", "Factures"],
      lignes,
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Fournisseurs_${jourCourantKinshasaISO()}.xlsx"`,
    },
  });
}

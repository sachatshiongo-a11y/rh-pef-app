import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL } from "@/lib/stock";
import { analyserPrix } from "@/lib/stock-prix";
import { FicheArticleDocument, type MouvementLigne } from "@/lib/pdf/fiche-article";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  requireModule(user, "stock");
  const { id } = await params;

  const a = await prisma.articleStock.findUnique({
    where: { id },
    include: {
      stock: true,
      categorie: { select: { nom: true } },
      fournisseur: { select: { nom: true } },
      mouvements: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: {
          facture: { select: { numero: true, fournisseurNom: true } },
          reception: { select: { bonDeCommande: { select: { numero: true, fournisseur: { select: { nom: true } } } } } },
        },
      },
      lignesFacture: { include: { facture: { select: { id: true, numero: true, date: true } } } },
    },
  });
  if (!a) return new Response("Article introuvable", { status: 404 });

  const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
  const stockQte = a.stock ? Number(a.stock.quantite) : null;
  const prixRef = a.prixUnitaireUSD !== null ? Number(a.prixUnitaireUSD) : null;

  const analyse = analyserPrix(
    a.lignesFacture
      .filter((l) => l.facture.date)
      .map((l) => ({ date: l.facture.date as Date, prix: Number(l.prixUnitaireUSD), qte: Number(l.quantite), factureId: l.facture.id, numero: l.facture.numero })),
  );

  const mouvements: MouvementLigne[] = a.mouvements.map((m) => {
    const bc = m.reception?.bonDeCommande;
    const source = m.facture
      ? `Facture ${m.facture.numero ?? ""}${m.facture.fournisseurNom ? ` — ${m.facture.fournisseurNom}` : ""}`.trim()
      : bc
        ? `BC ${bc.numero}${bc.fournisseur?.nom ? ` — ${bc.fournisseur.nom}` : ""}`
        : null;
    return { id: m.id, date: m.date, type: m.type, quantite: Number(m.quantite), origine: m.origine, source };
  });

  const buffer = await renderToBuffer(
    FicheArticleDocument({
      designation: a.designation,
      code: a.code,
      domaineLabel: DOMAINE_LABEL[a.domaine] ?? a.domaine,
      categorieNom: a.categorie?.nom ?? "à classer",
      fournisseurNom: a.fournisseur?.nom ?? "—",
      unite: a.unite,
      stock: stockQte,
      stockMinimum: a.stock ? Number(a.stock.stockMinimum) : null,
      seuilUrgent: a.stock ? Number(a.stock.seuilUrgent) : null,
      valeur: (stockQte ?? 0) * (prixRef ?? 0),
      prixReference: prixRef,
      alerteLabel: niv ? ALERTE_LABEL[niv] : "—",
      analyse,
      mouvements,
    }),
  );

  const nomFichier = `Fiche_${a.designation.replace(/[^\w-]+/g, "_").slice(0, 40)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomFichier}"`,
    },
  });
}

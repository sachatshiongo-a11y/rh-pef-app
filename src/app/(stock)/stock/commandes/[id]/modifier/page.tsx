import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { NouveauBonForm } from "../../nouveau/nouveau-client";

export default async function ModifierBonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [bc, articles, fournisseurs] = await Promise.all([
    prisma.bonDeCommande.findUnique({ where: { id }, include: { lignes: true } }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, prixUnitaireUSD: true, uniteParCarton: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);
  if (!bc) notFound();
  if (bc.statut !== "BROUILLON") redirect(`/stock/commandes/${id}`); // seuls les brouillons sont modifiables

  const arts = articles.map((a) => ({
    id: a.id,
    designation: a.designation,
    prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
    uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
  }));

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/stock/commandes" className="underline">Bons de commande</Link>
        <span>/</span>
        <Link href={`/stock/commandes/${id}`} className="underline">{bc.numero}</Link>
        <span>/</span>
        <span>Modifier</span>
      </div>
      <h1 className="text-xl font-semibold sm:text-2xl">Modifier le brouillon {bc.numero}</h1>
      <NouveauBonForm
        articles={arts}
        fournisseurs={fournisseurs}
        initial={{
          bcId: bc.id,
          fournisseurId: bc.fournisseurId,
          delaiPaiement: bc.delaiPaiement ?? "",
          modePaiement: bc.modePaiement ?? "",
          commentaire: bc.commentaire ?? "",
          lignes: bc.lignes.map((l) => ({
            articleId: l.articleId ?? "",
            designation: l.designation,
            quantite: l.quantite.toString(),
            prix: l.prixUnitaireUSD.toString(),
            uniteParCarton: l.uniteParCarton !== null ? l.uniteParCarton.toString() : "",
          })),
        }}
      />
    </div>
  );
}

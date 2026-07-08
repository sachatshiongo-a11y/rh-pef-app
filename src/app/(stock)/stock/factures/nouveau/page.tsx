import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NouvelleFactureForm } from "./nouveau-client";

function delaiEnJours(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (s.toLowerCase().includes("livraison")) return 0;
  return null;
}

export default async function NouvelleFacturePage({ searchParams }: { searchParams: Promise<{ bc?: string }> }) {
  const { bc } = await searchParams;
  const [articles, fournisseurs, bons] = await Promise.all([
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, unite: true, prixUnitaireUSD: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true, delaiPaiement: true } }),
    prisma.bonDeCommande.findMany({
      where: { statut: { not: "ANNULE" } },
      orderBy: [{ annee: "desc" }, { sequence: "desc" }],
      take: 120,
      select: {
        id: true, numero: true, fournisseurId: true, delaiPaiement: true,
        fournisseur: { select: { nom: true } },
        lignes: { select: { articleId: true, designation: true, unite: true, quantite: true, prixUnitaireUSD: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Nouvelle facture fournisseur</h1>
        <Link href="/stock/factures" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">← Retour</Link>
      </div>
      <p className="text-sm text-muted-foreground">Saisissez la facture avec ses articles et quantités. En liant un bon de commande, ses lignes sont pré-remplies pour comparaison.</p>
      <NouvelleFactureForm
        articles={articles.map((a) => ({ id: a.id, designation: a.designation, unite: a.unite, prix: a.prixUnitaireUSD?.toString() ?? "" }))}
        fournisseurs={fournisseurs.map((f) => ({ id: f.id, nom: f.nom, delaiJours: delaiEnJours(f.delaiPaiement) }))}
        bons={bons.map((b) => ({
          id: b.id, numero: b.numero, fournisseurId: b.fournisseurId,
          fournisseurNom: b.fournisseur?.nom ?? "", delaiJours: delaiEnJours(b.delaiPaiement),
          lignes: b.lignes.map((l) => ({ articleId: l.articleId, designation: l.designation, unite: l.unite, quantite: l.quantite.toString(), prix: l.prixUnitaireUSD.toString() })),
        }))}
        bcInitial={bc ?? null}
      />
    </div>
  );
}

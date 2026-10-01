import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { NouveauBonForm } from "./nouveau-client";
import { exigerPageStock } from "@/lib/garde-page";

export default async function NouveauBonPage() {
  const user = await exigerPageStock();
  const [articles, fournisseurs] = await Promise.all([
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, nomCourt: true, code: true, prixUnitaireUSD: true, uniteParCarton: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  const arts = articles.map((a) => ({
    id: a.id,
    designation: a.designation,
    nomCourt: a.nomCourt,
    code: a.code,
    prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
    uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
  }));

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/stock/commandes" className="underline">Bons de commande</Link>
        <span>/</span>
        <span>Nouveau</span>
      </div>
      <h1 className="text-xl font-semibold sm:text-2xl">Nouveau bon de commande</h1>
      <NouveauBonForm articles={arts} fournisseurs={fournisseurs} estDirection={user.role === "ADMIN"} />
    </div>
  );
}

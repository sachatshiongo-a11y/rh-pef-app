import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formaterPrix, prixProposeEn, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { NouveauBonForm } from "../../nouveau/nouveau-client";
import { exigerPageStock } from "@/lib/garde-page";
import { contenancePourClient } from "@/lib/libelle-article";

export default async function ModifierBonPage({ params }: { params: Promise<{ id: string }> }) {
  await exigerPageStock();
  const { id } = await params;
  const [bc, articles, taux, fournisseurs] = await Promise.all([
    prisma.bonDeCommande.findUnique({ where: { id }, include: { lignes: true } }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, contenance: true, contenanceUnite: true, nomCourt: true, code: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, uniteParCarton: true } }),
    tauxDuJour(),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);
  if (!bc) notFound();
  if (bc.statut !== "BROUILLON") redirect(`/stock/commandes/${id}`); // seuls les brouillons sont modifiables

  const arts = articles.map((a) => ({
    id: a.id,
    designation: a.designation,
    ...contenancePourClient(a), // libellé du choix d'article (contenance comprise)
    nomCourt: a.nomCourt,
    code: a.code,
    // Un bon de commande est en dollars : un article au prix en FRANCS y est proposé converti au taux
    // du jour (« ≈ », 4 décimales), son prix en francs rappelé sous la case. Sans taux : pas de prix.
    prix: (() => { const p = prixProposeEn(a, "USD", taux); return p === null ? null : String(p); })(),
    prixFC: a.devisePrix === "CDF" ? (() => { const ps = prixSaisi(a); return ps ? formaterPrix(Number(ps.montant), "CDF") : null; })() : null,
    uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
  }));

  return (
    <div className="w-full space-y-4">
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

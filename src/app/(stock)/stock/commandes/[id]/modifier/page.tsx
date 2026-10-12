import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formaterPrix, prixProposeEn, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { NouveauBonForm } from "../../nouveau/nouveau-client";
import { exigerPageStock } from "@/lib/garde-page";
import { contenancePourClient } from "@/lib/libelle-article";
import { chargerLiensFournisseurs } from "@/lib/article-fournisseurs";
import { prixLigneBon } from "@/lib/bon-commande-devise";

export default async function ModifierBonPage({ params }: { params: Promise<{ id: string }> }) {
  await exigerPageStock();
  const { id } = await params;
  const [bc, articles, taux, fournisseurs, liens] = await Promise.all([
    prisma.bonDeCommande.findUnique({ where: { id }, include: { lignes: true } }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, marque: true, contenance: true, contenanceUnite: true, nomCourt: true, code: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, uniteParCarton: true } }),
    tauxDuJour(),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    chargerLiensFournisseurs(),
  ]);
  if (!bc) notFound();
  if (bc.statut !== "BROUILLON") redirect(`/stock/commandes/${id}`); // seuls les brouillons sont modifiables

  const arts = articles.map((a) => ({
    id: a.id,
    designation: a.designation,
    ...contenancePourClient(a), // libellé du choix d'article (contenance comprise)
    nomCourt: a.nomCourt,
    code: a.code,
    // Prix proposé dans CHAQUE devise de bon (2026-10-16 : bon en $ ou en FC) : exact dans la devise du prix de référence
    // de l'article, converti au taux du jour dans l'autre (« ≈ » sous la case, le prix de référence rappelé). Sans taux : pas de prix.
    prix: (() => { const p = prixProposeEn(a, "USD", taux); return p === null ? null : String(p); })(),
    prixCDF: (() => { const p = prixProposeEn(a, "CDF", taux); return p === null ? null : String(p); })(),
    prixFC: a.devisePrix === "CDF" ? (() => { const ps = prixSaisi(a); return ps ? formaterPrix(Number(ps.montant), "CDF") : null; })() : null,
    refDevise: prixSaisi(a)?.devise ?? null,
    prixRef: (() => { const ps = prixSaisi(a); return ps ? formaterPrix(Number(ps.montant), ps.devise) : null; })(),
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
        liens={liens}
        taux={taux}
        initial={{
          bcId: bc.id,
          devise: bc.devise,
          fournisseurId: bc.fournisseurId,
          delaiPaiement: bc.delaiPaiement ?? "",
          modePaiement: bc.modePaiement ?? "",
          commentaire: bc.commentaire ?? "",
          lignes: bc.lignes.map((l) => ({
            articleId: l.articleId ?? "",
            designation: l.designation,
            quantite: l.quantite.toString(),
            prix: (() => { const p = prixLigneBon(l, bc.devise); return p === null ? "" : (bc.devise === "CDF" ? l.prixUnitaireCDF : l.prixUnitaireUSD)!.toString(); })(), // dans la devise du bon ; sans prix (ou 0 d'une ancienne saisie) : case vide, jamais 0
            uniteParCarton: l.uniteParCarton !== null ? l.uniteParCarton.toString() : "",
          })),
        }}
      />
    </div>
  );
}

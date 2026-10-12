import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formaterPrix, prixProposeEn, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { NouveauBonForm } from "./nouveau-client";
import { exigerPageStock } from "@/lib/garde-page";
import { contenancePourClient } from "@/lib/libelle-article";
import { chargerLiensFournisseurs } from "@/lib/article-fournisseurs";

export default async function NouveauBonPage() {
  const user = await exigerPageStock();
  const [articles, taux, fournisseurs, liens] = await Promise.all([
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, marque: true, contenance: true, contenanceUnite: true, nomCourt: true, code: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, uniteParCarton: true } }),
    tauxDuJour(),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    chargerLiensFournisseurs(),
  ]);

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
        <span>Nouveau</span>
      </div>
      <h1 className="text-xl font-semibold sm:text-2xl">Nouveau bon de commande</h1>
      <NouveauBonForm articles={arts} fournisseurs={fournisseurs} liens={liens} taux={taux} estDirection={user.role === "ADMIN"} />
    </div>
  );
}

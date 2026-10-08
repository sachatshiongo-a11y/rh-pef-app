import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formaterPrix, prixProposeEn, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { NouveauBonForm } from "./nouveau-client";
import { exigerPageStock } from "@/lib/garde-page";

export default async function NouveauBonPage() {
  const user = await exigerPageStock();
  const [articles, taux, fournisseurs] = await Promise.all([
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, nomCourt: true, code: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, uniteParCarton: true } }),
    tauxDuJour(),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  const arts = articles.map((a) => ({
    id: a.id,
    designation: a.designation,
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
        <span>Nouveau</span>
      </div>
      <h1 className="text-xl font-semibold sm:text-2xl">Nouveau bon de commande</h1>
      <NouveauBonForm articles={arts} fournisseurs={fournisseurs} estDirection={user.role === "ADMIN"} />
    </div>
  );
}

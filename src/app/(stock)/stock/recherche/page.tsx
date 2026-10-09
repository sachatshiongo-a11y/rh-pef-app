import Link from "next/link";
import { formaterMontantFacture } from "@/lib/facture-devise";
import { prisma } from "@/lib/prisma";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE, DOMAINE_LABEL } from "@/lib/stock";
import { exigerPageStock } from "@/lib/garde-page";
import { CHAMPS_LIBELLE, chercheurParContenance, libelleArticle } from "@/lib/libelle-article";
import { normTexte } from "@/lib/texte";

export default async function RecherchePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await exigerPageStock();
  const q = ((await searchParams).q ?? "").trim();

  if (q.length < 2) {
    return (
      <div className="w-full space-y-3">
        <h1 className="text-xl font-semibold sm:text-2xl">Recherche</h1>
        <p className="text-sm text-muted-foreground">Saisissez au moins 2 caractères (article, N° de bon de commande, N° de facture, fournisseur).</p>
      </div>
    );
  }

  const like = { contains: q, mode: "insensitive" as const };
  // Recherche par CONTENANCE (2026-10-09) : « bacardi 1l » trouve « Bacardi » enregistré 1 l (ou 100 cl…),
  // « 1l » seul tous les articles d'un litre. Le tri se fait EN MÉMOIRE (accents ignorés, contenance
  // canonique) sur tout le catalogue : une base ne compare ni « creme » à « Crème » ni 1 l à 100 cl.
  const parContenance = chercheurParContenance(q);
  const [articlesTrouves, bons, factures, fournisseurs] = await Promise.all([
    prisma.articleStock.findMany({
      where: parContenance ? {} : { OR: [{ designation: like }, { code: { contains: q } }] },
      orderBy: { designation: "asc" }, ...(parContenance ? {} : { take: 12 }), select: { id: true, ...CHAMPS_LIBELLE, domaine: true, code: true },
    }),
    prisma.bonDeCommande.findMany({ where: { OR: [{ numero: like }, { fournisseur: { nom: like } }] }, orderBy: [{ annee: "desc" }, { sequence: "desc" }], take: 12, include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.findMany({ where: { OR: [{ numero: like }, { fournisseurNom: like }, { fournisseur: { nom: like } }] }, orderBy: [{ annee: "desc" }, { mois: "desc" }], take: 12, include: { fournisseur: { select: { nom: true } } } }),
    prisma.fournisseur.findMany({ where: { OR: [{ nom: like }, { contactNom: like }, { ville: like }] }, orderBy: { nom: "asc" }, take: 12, select: { id: true, nom: true, ville: true } }),
  ]);

  const articles = parContenance
    ? articlesTrouves.filter((a) => parContenance(a) || normTexte(a.designation).includes(normTexte(q)) || (a.code ?? "").includes(q)).slice(0, 12)
    : articlesTrouves;
  const total = articles.length + bons.length + factures.length + fournisseurs.length;

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Recherche : « {q} »</h1>
        <p className="mt-1 text-sm text-muted-foreground">{total} résultat(s).</p>
      </div>

      {bons.length > 0 && (
        <Section titre={`Bons de commande (${bons.length})`}>
          {bons.map((b) => (
            <Link key={b.id} href={`/stock/commandes/${b.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate"><b>{b.numero}</b> · {b.fournisseur?.nom ?? "—"}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm"><span className="text-muted-foreground">{usd(b.totalUSD)}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span></span>
            </Link>
          ))}
        </Section>
      )}

      {factures.length > 0 && (
        <Section titre={`Factures (${factures.length})`}>
          {factures.map((f) => (
            <Link key={f.id} href={`/stock/factures/${f.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate">{f.numero ? <b>{f.numero}</b> : "Facture"} · {f.fournisseur?.nom ?? f.fournisseurNom}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm"><span className="text-muted-foreground">{f.devise === "CDF" ? formaterMontantFacture(Number(f.montantCDF), "CDF") : usd(f.montantUSD)}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span></span>
            </Link>
          ))}
        </Section>
      )}

      {fournisseurs.length > 0 && (
        <Section titre={`Fournisseurs (${fournisseurs.length})`}>
          {fournisseurs.map((f) => (
            <Link key={f.id} href={`/stock/fournisseurs/${f.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate font-medium">{f.nom}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{f.ville ?? ""}</span>
            </Link>
          ))}
        </Section>
      )}

      {articles.length > 0 && (
        <Section titre={`Articles (${articles.length})`}>
          {articles.map((a) => (
            <Link key={a.id} href={`/stock/catalogue/${a.domaine.toLowerCase() === "nourriture" ? "nourriture" : a.domaine.toLowerCase() === "boisson" ? "boissons" : "autre"}?q=${encodeURIComponent(a.designation)}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate font-medium">{libelleArticle(a)}{a.code ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">#{a.code}</span> : null}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{DOMAINE_LABEL[a.domaine]}</span>
            </Link>
          ))}
        </Section>
      )}

      {total === 0 && <p className="text-sm text-muted-foreground">Aucun résultat pour « {q} ».</p>}
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/50 px-3 py-2 text-sm font-semibold">{titre}</div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

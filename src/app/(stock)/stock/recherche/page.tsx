import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE, DOMAINE_LABEL } from "@/lib/stock";

export default async function RecherchePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();

  if (q.length < 2) {
    return (
      <div className="max-w-3xl space-y-3">
        <h1 className="text-xl font-semibold sm:text-2xl">Recherche</h1>
        <p className="text-sm text-muted-foreground">Saisissez au moins 2 caractères (article, N° de bon de commande, N° de facture, fournisseur).</p>
      </div>
    );
  }

  const like = { contains: q, mode: "insensitive" as const };
  const [articles, bons, factures, fournisseurs] = await Promise.all([
    prisma.articleStock.findMany({ where: { OR: [{ designation: like }, { code: { contains: q } }] }, orderBy: { designation: "asc" }, take: 12, select: { id: true, designation: true, domaine: true, code: true } }),
    prisma.bonDeCommande.findMany({ where: { OR: [{ numero: like }, { fournisseur: { nom: like } }] }, orderBy: [{ annee: "desc" }, { sequence: "desc" }], take: 12, include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.findMany({ where: { OR: [{ numero: like }, { fournisseurNom: like }, { fournisseur: { nom: like } }] }, orderBy: [{ annee: "desc" }, { mois: "desc" }], take: 12, include: { fournisseur: { select: { nom: true } } } }),
    prisma.fournisseur.findMany({ where: { OR: [{ nom: like }, { contactNom: like }, { ville: like }] }, orderBy: { nom: "asc" }, take: 12, select: { id: true, nom: true, ville: true } }),
  ]);

  const total = articles.length + bons.length + factures.length + fournisseurs.length;

  return (
    <div className="max-w-4xl space-y-5">
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
              <span className="flex shrink-0 items-center gap-2 text-sm"><span className="text-muted-foreground">{usd(f.montantUSD)}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span></span>
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
              <span className="truncate font-medium">{a.designation}{a.code ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">#{a.code}</span> : null}</span>
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

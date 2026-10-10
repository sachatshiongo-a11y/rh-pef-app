import Link from "next/link";
import { formaterMontantFacture } from "@/lib/facture-devise";
import { prisma } from "@/lib/prisma";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE, DOMAINE_LABEL } from "@/lib/stock";
import { exigerPageStock } from "@/lib/garde-page";
import { CHAMPS_LIBELLE, chercheurParContenance, libelleArticle } from "@/lib/libelle-article";
import { LIMITE_RECHERCHE, compteRecherche, contientTout, filtrerRecherche, motsRecherche } from "@/lib/recherche-stock";
import { WHERE_LIGNE_SANS_PRIX, bonDeListe, libelleTotalListe } from "@/lib/bon-commande-devise";

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

  // Recherche INSENSIBLE AUX ACCENTS (« creme » trouve « Crème »), faite en mémoire sur des champs minimaux
  // (une base ne compare pas les accents) ; un résultat tronqué le dit (« 12 premiers sur 37 »).
  // Recherche par CONTENANCE (2026-10-09) : « bacardi 1l » trouve « Bacardi » enregistré 1 l (ou 100 cl…),
  // « 1l » seul tous les articles d'un litre.
  const parContenance = chercheurParContenance(q);
  const [tousArticles, tousBons, toutesFactures, tousFournisseurs] = await Promise.all([
    prisma.articleStock.findMany({ orderBy: { designation: "asc" }, select: { id: true, ...CHAMPS_LIBELLE, domaine: true, code: true } }),
    prisma.bonDeCommande.findMany({ orderBy: [{ annee: "desc" }, { sequence: "desc" }], select: { id: true, numero: true, fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.findMany({ orderBy: [{ annee: "desc" }, { mois: "desc" }], select: { id: true, numero: true, fournisseurNom: true, fournisseur: { select: { nom: true } } } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true, contactNom: true, ville: true } }),
  ]);
  const rArticles = parContenance
    ? (() => { const f = tousArticles.filter((a) => parContenance(a) || contientTout(a.designation, motsRecherche(q)) || (a.code ?? "").includes(q)); return { premiers: f.slice(0, LIMITE_RECHERCHE), total: f.length }; })()
    : filtrerRecherche(tousArticles, q, (a) => [a.designation, a.code]);
  const rBons = filtrerRecherche(tousBons, q, (b) => [b.numero, b.fournisseur?.nom]);
  const rFactures = filtrerRecherche(toutesFactures, q, (f) => [f.numero, f.fournisseurNom, f.fournisseur?.nom]);
  const rFournisseurs = filtrerRecherche(tousFournisseurs, q, (f) => [f.nom, f.contactNom, f.ville]);
  // Détail des seuls résultats affichés (total, statut…).
  const [bonsAff, facturesAff] = await Promise.all([
    prisma.bonDeCommande.findMany({ where: { id: { in: rBons.premiers.map((b) => b.id) } }, orderBy: [{ annee: "desc" }, { sequence: "desc" }], include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } }, lignes: { where: WHERE_LIGNE_SANS_PRIX, select: { id: true } } } }),
    prisma.factureFournisseur.findMany({ where: { id: { in: rFactures.premiers.map((f) => f.id) } }, orderBy: [{ annee: "desc" }, { mois: "desc" }], include: { fournisseur: { select: { nom: true } } } }),
  ]);
  const articles = rArticles.premiers, bons = bonsAff, factures = facturesAff, fournisseurs = rFournisseurs.premiers;
  const total = rArticles.total + rBons.total + rFactures.total + rFournisseurs.total;

  return (
    <div className="w-full space-y-5">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Recherche : « {q} »</h1>
        <p className="mt-1 text-sm text-muted-foreground">{total} résultat(s){total > articles.length + bons.length + factures.length + fournisseurs.length ? " : seuls les premiers de chaque rubrique sont affichés (précisez la recherche pour les autres)" : ""}.</p>
      </div>

      {bons.length > 0 && (
        <Section titre={`Bons de commande (${compteRecherche(bons.length, rBons.total)})`}>
          {bons.map((b) => (
            <Link key={b.id} href={`/stock/commandes/${b.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate"><b>{b.numero}</b> · {b.fournisseur?.nom ?? "—"}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm"><span className="text-muted-foreground">{libelleTotalListe(bonDeListe(b, b.lignes.length, b._count.lignes))}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span></span>
            </Link>
          ))}
        </Section>
      )}

      {factures.length > 0 && (
        <Section titre={`Factures (${compteRecherche(factures.length, rFactures.total)})`}>
          {factures.map((f) => (
            <Link key={f.id} href={`/stock/factures/${f.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate">{f.numero ? <b>{f.numero}</b> : "Facture"} · {f.fournisseur?.nom ?? f.fournisseurNom}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm"><span className="text-muted-foreground">{f.devise === "CDF" ? formaterMontantFacture(Number(f.montantCDF), "CDF") : usd(f.montantUSD)}</span><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span></span>
            </Link>
          ))}
        </Section>
      )}

      {fournisseurs.length > 0 && (
        <Section titre={`Fournisseurs (${compteRecherche(fournisseurs.length, rFournisseurs.total)})`}>
          {fournisseurs.map((f) => (
            <Link key={f.id} href={`/stock/fournisseurs/${f.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
              <span className="truncate font-medium">{f.nom}</span>
              <span className="shrink-0 text-sm text-muted-foreground">{f.ville ?? ""}</span>
            </Link>
          ))}
        </Section>
      )}

      {articles.length > 0 && (
        <Section titre={`Articles (${compteRecherche(articles.length, rArticles.total)})`}>
          {articles.map((a) => (
            <Link key={a.id} href={`/stock/catalogue/${a.id}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-accent/40">
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

import { valeurEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { prisma } from "@/lib/prisma";
import { MouvementForm, ColonneMouvements, BandeauPlafond, type MvtLite } from "./mouvements-client";
import { lireFiltreMouvements, whereMouvements, whereColonne, libelleFiltre, optionsMoisMouvements, moisCourantMouvements, FILTRES_MOTIF, PLAFOND_AFFICHAGE } from "@/lib/filtre-mouvements";
import { OngletsAchats } from "../_achats/onglets-achats";
import { fournisseurDuMouvement } from "@/lib/achats-liste";
import type { Prisma } from "@prisma/client";
import { conseilLivraison, etatRattachementLivraison } from "@/lib/stock-restaurant";
import type { ConseilLivraison } from "./mouvements-client";
import { exigerPageStock } from "@/lib/garde-page";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsArticles } from "@/lib/recherche-options";

const mvtInclude = {
  article: { select: { designation: true, domaine: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } },
  facture: { select: { id: true, numero: true, fournisseurId: true, fournisseurNom: true } },
  reception: { select: { bonDeCommande: { select: { id: true, numero: true, fournisseurId: true, fournisseur: { select: { nom: true } } } } } },
  fournisseur: { select: { id: true, nom: true } }, // achat direct de la Liste d'achat
} satisfies Prisma.MouvementStockInclude;
type Mvt = Prisma.MouvementStockGetPayload<{ include: typeof mvtInclude }>;

// Valeur d'un mouvement : montant saisi, sinon ESTIMATION quantité × prix catalogue (affichée ≈) —
// un article en francs converti au taux du jour (src/lib/prix-article.ts) ; sans prix ni taux : rien.
const valeurDe = (m: Mvt, taux: number | null): { v: number; estime: boolean } | null => {
  if (m.montantUSD !== null) return { v: Number(m.montantUSD), estime: false };
  const c = valeurEnUSD(m.article, Number(m.quantite), taux);
  return c === null ? null : { v: c.valeur, estime: true };
};

// Sérialise un mouvement Prisma (Decimal/Date) vers la forme légère consommée côté client.
const versLite = (m: Mvt, taux: number | null): MvtLite => {
  const bc = m.reception?.bonDeCommande;
  const va = valeurDe(m, taux);
  const fourn = fournisseurDuMouvement(m);
  return {
    id: m.id,
    articleId: m.articleId,
    designation: m.article.designation,
    dateISO: new Date(m.date).toISOString().slice(0, 10),
    origine: m.origine,
    type: m.type,
    quantite: Number(m.quantite),
    valeur: va ? va.v : null,
    valeurEstimee: va ? va.estime : false,
    facture: m.facture ? { id: m.facture.id, numero: m.facture.numero } : null,
    bc: bc ? { id: bc.id, numero: bc.numero } : null,
    fournId: fourn?.id ?? null,
    fournNom: fourn?.nom ?? null,
    motif: m.categorieSortie,
  };
};

type SP = { mois?: string; articleId?: string; motif?: string };

export default async function MouvementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  // Liste BORNÉE : mois courant par défaut (« tous » = tout l'historique, plafonné et signalé).
  // Le filtre et son `where` viennent de `lib/filtre-mouvements` : les actions « tout le filtre »
  // reconstruisent EXACTEMENT le même ensemble côté serveur.
  const now = new Date();
  const moisCourant = moisCourantMouvements(now);
  const filtre = lireFiltreMouvements(sp, now);
  const mois = filtre.mois === "tous" ? undefined : filtre.mois; // « 2026-7 »
  const articleId = filtre.articleId ?? undefined;
  const filtreMotif = filtre.motif ?? undefined;
  const where = whereMouvements(filtre);

  const PLAFOND = PLAFOND_AFFICHAGE;
  const [mouvements, nbSortiesFiltre, nbEntreesFiltre, articles, restos] = await Promise.all([
    prisma.mouvementStock.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: PLAFOND, include: mvtInclude }),
    prisma.mouvementStock.count({ where: whereColonne(filtre, "SORTIES") }),
    prisma.mouvementStock.count({ where: whereColonne(filtre, "ENTREES") }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, nomCourt: true, code: true, unite: true, domaine: true, contenance: true, contenanceUnite: true } }),
    // Rattachements au restaurant (une requête) : avertir qu'une livraison ne l'alimentera pas.
    prisma.articleResto.findMany({ where: { actif: true, articleStockId: { not: null } }, select: { id: true, designation: true, espace: true, unite: true, articleStockId: true } }),
  ]);
  const conseilsLivraison: Record<string, ConseilLivraison> = {};
  for (const a of articles) {
    const c = conseilLivraison(etatRattachementLivraison(a.id, { unite: a.unite, contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite }, restos, a.domaine), a.id, restos);
    if (c) conseilsLivraison[a.id] = c;
  }
  const nbTotal = nbSortiesFiltre + nbEntreesFiltre;
  const designation = articleId
    ? articles.find((a) => a.id === articleId)?.designation
      ?? (await prisma.articleStock.findUnique({ where: { id: articleId }, select: { designation: true } }))?.designation
    : null;
  const libelle = libelleFiltre(filtre, designation);
  const taux = await tauxDuJour();
  const entrees = mouvements.filter((m) => m.type !== "SORTIE").map((m) => versLite(m, taux));
  const sorties = mouvements.filter((m) => m.type === "SORTIE").map((m) => versLite(m, taux));

  // 12 derniers mois pour le filtre, plus le mois filtré s'il est plus ancien (lien d'une carte).
  const moisOptions = optionsMoisMouvements(now, mois);

  return (
    <div className="space-y-4">
      <OngletsAchats />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Mouvements de stock</h1>
        <p className="text-xs text-muted-foreground">Les mouvements s&apos;exportent avec l&apos;inventaire du mois (Paramètres → Clôture).</p>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <select name="mois" defaultValue={mois ?? "tous"} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="tous">Tous les mois</option>
          {moisOptions.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <ChoixRecherche options={optionsArticles(articles)} name="articleId" defaultValue={articleId ?? ""} vide="Tous les produits" aria-label="Produit" className="min-w-56 rounded-md border border-input bg-background px-2 py-1.5" />
        <select name="motif" defaultValue={filtreMotif ?? ""} aria-label="Motif" className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les motifs</option>
          {Object.entries(FILTRES_MOTIF).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {(mois !== moisCourant || articleId || filtreMotif) && <a href="/stock/mouvements" className="text-muted-foreground underline">Réinitialiser</a>}
        <span className="ml-auto text-xs text-muted-foreground">{nbTotal} mouvement(s)</span>
      </form>

      <MouvementForm articles={articles.map((a) => ({ id: a.id, designation: a.designation, nomCourt: a.nomCourt, code: a.code }))} estDirection={estDirection} conseilsLivraison={conseilsLivraison} />

      {nbTotal > PLAFOND && <BandeauPlafond affiches={mouvements.length} total={nbTotal} estDirection={estDirection} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <ColonneMouvements titre="Entrées" mouvements={entrees} signe="+" couleur="bg-emerald-50 text-emerald-800" estDirection={estDirection}
          toutLeFiltre={{ filtre, colonne: "ENTREES", libelle, total: nbEntreesFiltre }} />
        <ColonneMouvements titre="Sorties" mouvements={sorties} signe="−" couleur="bg-red-50 text-red-800" estDirection={estDirection} requalifiable
          toutLeFiltre={{ filtre, colonne: "SORTIES", libelle, total: nbSortiesFiltre }} />
      </div>
    </div>
  );
}

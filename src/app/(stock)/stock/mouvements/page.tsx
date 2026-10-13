import Link from "next/link";
import { valeurEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { prisma } from "@/lib/prisma";
import { MouvementForm, ColonneMouvements, BandeauPlafond, type MvtLite } from "./mouvements-client";
import { lireFiltreMouvements, whereMouvements, whereColonne, libelleFiltre, optionsMoisMouvements, moisCourantMouvements, FILTRES_MOTIF, PLAFOND_AFFICHAGE } from "@/lib/filtre-mouvements";
import { OngletsAchats } from "../_achats/onglets-achats";
import { fournisseurDuMouvement } from "@/lib/achats-liste";
import type { Prisma } from "@prisma/client";
import { conseilLivraison, etatRattachementLivraison, regrouperConseils } from "@/lib/stock-restaurant";
import { ChoixProduitFiltre } from "./mouvements-client";
import { exigerPageStock } from "@/lib/garde-page";
import { estStock } from "@/lib/espaces";
import { CHAMPS_LIBELLE, contenancePourClient, libelleArticle } from "@/lib/libelle-article";

const mvtInclude = {
  article: { select: { ...CHAMPS_LIBELLE, unite: true, domaine: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true } },
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

// Sérialise un mouvement Prisma (Decimal/Date) vers la forme légère consommée côté client. Une valeur VIDE
// n'est pas écrite (2026-10-13, liaisons lentes) : sans facture, sans bon, sans fournisseur, sans DLC, sans
// origine, sans unité, valeur exacte (non estimée) — l'écran lit l'absence comme le vide. Le motif d'une
// SORTIE est toujours écrit (null = « sans motif », pastille affichée) ; celui d'une entrée ne s'affiche pas.
const versLite = (m: Mvt, taux: number | null): MvtLite => {
  const bc = m.reception?.bonDeCommande;
  const va = valeurDe(m, taux);
  const fourn = fournisseurDuMouvement(m);
  const l: MvtLite = {
    id: m.id,
    articleId: m.articleId,
    designation: libelleArticle(m.article), // nom affiché (contenance comprise)
    dateISO: new Date(m.date).toISOString().slice(0, 10),
    type: m.type,
    quantite: Number(m.quantite),
    valeur: va ? va.v : null,
  };
  if (m.origine) l.origine = m.origine;
  if (m.article.unite !== null) l.unite = m.article.unite; // le mouvement ne porte pas d'unité : celle de l'article
  if (va?.estime) l.valeurEstimee = true;
  if (m.facture) l.facture = { id: m.facture.id, numero: m.facture.numero };
  if (bc) l.bc = { id: bc.id, numero: bc.numero };
  if (fourn) { l.fournId = fourn.id; l.fournNom = fourn.nom; }
  if (m.type === "SORTIE") l.motif = m.categorieSortie;
  if (m.dlc) l.dlcISO = new Date(m.dlc).toISOString().slice(0, 10); // date PURE (colonne @db.Date)
  return l;
};

type SP = { mois?: string; articleId?: string; motif?: string };

export default async function MouvementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  // Changer la date d'une sortie : tout compte de l'espace Stock (décision Direction du 2026-10-08) —
  // même règle que l'action `changerDateSorties` (requireModule « stock »).
  const peutChangerDate = estStock(user);
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
  const [mouvements, nbSortiesFiltre, nbEntreesFiltre, articles, restos, taux] = await Promise.all([
    prisma.mouvementStock.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: PLAFOND, include: mvtInclude }),
    prisma.mouvementStock.count({ where: whereColonne(filtre, "SORTIES") }),
    prisma.mouvementStock.count({ where: whereColonne(filtre, "ENTREES") }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, marque: true, nomCourt: true, code: true, unite: true, domaine: true, contenance: true, contenanceUnite: true, stock: { select: { quantite: true } } } }),
    // Rattachements au restaurant (une requête) : avertir qu'une livraison ne l'alimentera pas.
    prisma.articleResto.findMany({ where: { actif: true, liens: { some: {} } }, select: { id: true, designation: true, espace: true, unite: true, liens: { select: { articleStock: { select: { id: true, unite: true, marque: true, contenance: true, contenanceUnite: true } } } } } }),
    tauxDuJour(), // avec les autres lectures (il partait seul, après elles : un aller-retour de plus)
  ]);
  const restosSR = restos.map((r) => ({ id: r.id, designation: r.designation, espace: r.espace, unite: r.unite, rattaches: r.liens.map((l) => ({ id: l.articleStock.id, unite: l.articleStock.unite, contenance: l.articleStock.contenance?.toString() ?? null, contenanceUnite: l.articleStock.contenanceUnite })) }));
  // Chaque conseil distinct part UNE fois au navigateur ; l'article n'en porte que le rang (voir `regrouperConseils`).
  const conseilsLivraison = regrouperConseils(articles.map((a) => [a.id, conseilLivraison(etatRattachementLivraison(a.id, { unite: a.unite, contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite }, restosSR, a.domaine), a.id, restosSR)] as const));
  const nbTotal = nbSortiesFiltre + nbEntreesFiltre;
  const articleFiltre = articleId
    ? articles.find((a) => a.id === articleId) ?? (await prisma.articleStock.findUnique({ where: { id: articleId }, select: CHAMPS_LIBELLE }))
    : null;
  const designation = articleFiltre ? libelleArticle(articleFiltre) : null;
  const libelle = libelleFiltre(filtre, designation);
  const entrees = mouvements.filter((m) => m.type !== "SORTIE").map((m) => versLite(m, taux));
  const sorties = mouvements.filter((m) => m.type === "SORTIE").map((m) => versLite(m, taux));

  // Articles du formulaire ET du filtre « Produit » : le MÊME tableau passé aux deux composants part une
  // seule fois au navigateur (la sérialisation de React renvoie au premier envoi) ; chacun en tire ses options.
  // Stock disponible de chaque article (0 sans ligne de stock) : affiché à côté de la quantité, une sortie qui le dépasse est bloquée (2026-10-09).
  // Nom court et code ne partent que s'ils existent (la recherche les lit, absents = vides).
  const articlesClient = articles.map((a) => ({ id: a.id, designation: a.designation, ...contenancePourClient(a), ...(a.nomCourt ? { nomCourt: a.nomCourt } : {}), ...(a.code ? { code: a.code } : {}), unite: a.unite, domaine: a.domaine, quantite: Number(a.stock?.quantite ?? 0) }));

  // 12 derniers mois pour le filtre, plus le mois filtré s'il est plus ancien (lien d'une carte).
  const moisOptions = optionsMoisMouvements(now, mois);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Achats &amp; mouvements</h1>
        <p className="text-xs text-muted-foreground">Les mouvements s&apos;exportent avec l&apos;inventaire du mois (Stock → Clôture du mois).</p>
      </div>
      <OngletsAchats />

      <MouvementForm articles={articlesClient} estDirection={estDirection} conseilsLivraison={conseilsLivraison} />

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <select name="mois" defaultValue={mois ?? "tous"} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="tous">Tous les mois</option>
          {moisOptions.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <ChoixProduitFiltre articles={articlesClient} defaultValue={articleId ?? ""} />
        <select name="motif" defaultValue={filtreMotif ?? ""} aria-label="Motif" className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les motifs</option>
          {Object.entries(FILTRES_MOTIF).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {(mois !== moisCourant || articleId || filtreMotif) && <Link href="/stock/mouvements" className="text-muted-foreground underline">Réinitialiser</Link>}
        <span className="ml-auto text-xs text-muted-foreground">{nbTotal} mouvement(s)</span>
      </form>

      {nbTotal > PLAFOND && <BandeauPlafond affiches={mouvements.length} total={nbTotal} estDirection={estDirection} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <ColonneMouvements titre="Entrées" mouvements={entrees} signe="+" couleur="bg-emerald-50 text-emerald-800" estDirection={estDirection}
          toutLeFiltre={{ filtre, colonne: "ENTREES", libelle, total: nbEntreesFiltre }} />
        <ColonneMouvements titre="Sorties" mouvements={sorties} signe="−" couleur="bg-red-50 text-red-800" estDirection={estDirection} requalifiable peutChangerDate={peutChangerDate}
          toutLeFiltre={{ filtre, colonne: "SORTIES", libelle, total: nbSortiesFiltre }} />
      </div>
    </div>
  );
}

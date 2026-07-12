import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { MouvementForm, ColonneMouvements, type MvtLite } from "./mouvements-client";
import { MOIS_FR_MAJ as MOIS_FR } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";

const mvtInclude = {
  article: { select: { designation: true, domaine: true, prixUnitaireUSD: true } },
  facture: { select: { id: true, numero: true, fournisseurId: true, fournisseurNom: true } },
  reception: { select: { bonDeCommande: { select: { id: true, numero: true, fournisseurId: true, fournisseur: { select: { nom: true } } } } } },
} satisfies Prisma.MouvementStockInclude;
type Mvt = Prisma.MouvementStockGetPayload<{ include: typeof mvtInclude }>;

// Valeur d'un mouvement : montant saisi, sinon ESTIMATION quantité × prix catalogue (affichée ≈).
const valeurDe = (m: Mvt): { v: number; estime: boolean } | null => {
  if (m.montantUSD !== null) return { v: Number(m.montantUSD), estime: false };
  if (m.article.prixUnitaireUSD === null) return null;
  return { v: Number(m.quantite) * Number(m.article.prixUnitaireUSD), estime: true };
};

// Sérialise un mouvement Prisma (Decimal/Date) vers la forme légère consommée côté client.
const versLite = (m: Mvt): MvtLite => {
  const bc = m.reception?.bonDeCommande;
  const va = valeurDe(m);
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
    fournId: m.facture?.fournisseurId ?? bc?.fournisseurId ?? null,
    fournNom: m.facture?.fournisseurNom ?? bc?.fournisseur?.nom ?? null,
  };
};

type SP = { mois?: string; articleId?: string };

export default async function MouvementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const mois = sp.mois && /^\d{4}-\d{1,2}$/.test(sp.mois) ? sp.mois : undefined; // « 2026-7 »
  const articleId = sp.articleId || undefined;

  const where: Prisma.MouvementStockWhereInput = { ...(articleId ? { articleId } : {}) };
  if (mois) {
    const [y, m] = mois.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }

  const [mouvements, articles] = await Promise.all([
    prisma.mouvementStock.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 600, include: mvtInclude }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true } }),
  ]);
  const entrees = mouvements.filter((m) => m.type !== "SORTIE").map(versLite);
  const sorties = mouvements.filter((m) => m.type === "SORTIE").map(versLite);

  // 12 derniers mois pour le filtre.
  const now = new Date();
  const moisOptions = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { val: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, label: `${MOIS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Mouvements de stock</h1>
        <p className="text-xs text-muted-foreground">Les mouvements s&apos;exportent avec l&apos;inventaire du mois (Paramètres → Clôture).</p>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <select name="mois" defaultValue={mois ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les mois</option>
          {moisOptions.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <select name="articleId" defaultValue={articleId ?? ""} className="min-w-56 rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les produits</option>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {(mois || articleId) && <a href="/stock/mouvements" className="text-muted-foreground underline">Réinitialiser</a>}
      </form>

      <MouvementForm articles={articles} estDirection={estDirection} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ColonneMouvements titre="Entrées" mouvements={entrees} signe="+" couleur="bg-emerald-50 text-emerald-800" estDirection={estDirection} />
        <ColonneMouvements titre="Sorties" mouvements={sorties} signe="−" couleur="bg-red-50 text-red-800" estDirection={estDirection} />
      </div>
    </div>
  );
}

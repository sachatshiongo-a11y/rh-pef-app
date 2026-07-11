import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { qte, usd } from "@/lib/stock";
import { MouvementForm, SupprimerMouvementBtn } from "./mouvements-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { MOIS_FR_MAJ as MOIS_FR } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";

type Mvt = Prisma.MouvementStockGetPayload<{ include: { article: { select: { designation: true, domaine: true, prixUnitaireUSD: true } } } }>;

// Valeur d'un mouvement : montant saisi, sinon ESTIMATION quantité × prix catalogue (affichée ≈).
const valeurDe = (m: Mvt): { v: number; estime: boolean } | null => {
  if (m.montantUSD !== null) return { v: Number(m.montantUSD), estime: false };
  if (m.article.prixUnitaireUSD === null) return null;
  return { v: Number(m.quantite) * Number(m.article.prixUnitaireUSD), estime: true };
};
const totalValeur = (ms: Mvt[]) => ms.reduce((t, m) => t + (valeurDe(m)?.v ?? 0), 0);

// Lien vers le catalogue de l'article (pré-filtré sur sa désignation), comme la recherche globale.
const lienCatalogue = (m: Mvt) => {
  const seg = m.article.domaine === "NOURRITURE" ? "nourriture" : m.article.domaine === "BOISSON" ? "boissons" : "autre";
  return `/stock/catalogue/${seg}?q=${encodeURIComponent(m.article.designation)}`;
};

function Colonne({ titre, mouvements, signe, couleur }: { titre: string; mouvements: Mvt[]; signe: string; couleur: string }) {
  // Classement par jour : les mouvements arrivent triés par date décroissante.
  const jours: { cle: string; titre: string; lignes: Mvt[] }[] = [];
  const idx = new Map<string, number>();
  for (const m of mouvements) {
    const cle = new Date(m.date).toISOString().slice(0, 10);
    if (!idx.has(cle)) { idx.set(cle, jours.length); jours.push({ cle, titre: new Date(m.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }), lignes: [] }); }
    jours[idx.get(cle)!].lignes.push(m);
  }

  const nomArticle = (m: Mvt) => (
    <Link href={lienCatalogue(m)} className="truncate font-medium text-primary hover:underline">{m.article.designation}</Link>
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold ${couleur}`}><span>{titre} <span className="font-normal opacity-70">· {mouvements.length}</span></span><span className="text-xs font-normal opacity-80">≈ {usd(totalValeur(mouvements))}</span></div>
      <div className="max-h-[70vh] divide-y overflow-auto">
        {jours.map((j, ji) => (
          <details key={j.cle} open={ji === 0} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold capitalize [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{j.titre}</span>
              <span className="font-normal text-muted-foreground">{j.lignes.length} mouvement(s) · {signe}{qte(j.lignes.reduce((t, m) => t + Number(m.quantite), 0))} · ≈ {usd(totalValeur(j.lignes))}</span>
            </summary>
            <div className="divide-y border-t">
              {j.lignes.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <div className="min-w-0">
                    {nomArticle(m)}
                    {m.origine && <div className="truncate text-[11px] text-muted-foreground">{m.origine}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-right">
                    <div>
                      <div className="font-semibold tabular-nums">{signe}{qte(m.quantite)}</div>
                      <div className="text-[11px] tabular-nums text-muted-foreground">{(() => { const va = valeurDe(m); return va ? `${va.estime ? "≈ " : ""}${usd(va.v)}` : "—"; })()}</div>
                    </div>
                    <SupprimerMouvementBtn id={m.id} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
        {mouvements.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun mouvement.</p>}
      </div>
    </div>
  );
}

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
    prisma.mouvementStock.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 600, include: { article: { select: { designation: true, domaine: true, prixUnitaireUSD: true } } } }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true } }),
  ]);
  const entrees = mouvements.filter((m) => m.type !== "SORTIE");
  const sorties = mouvements.filter((m) => m.type === "SORTIE");

  // 12 derniers mois pour le filtre.
  const now = new Date();
  const moisOptions = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { val: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, label: `${MOIS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });
  const dlQs = new URLSearchParams({ ...(mois ? { mois } : {}), ...(articleId ? { articleId } : {}) }).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Mouvements de stock</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BoutonRapport types={[{ value: "MOUVEMENTS", label: "Mouvements" }]} pdfHref={`/stock/mouvements/pdf${dlQs ? `?${dlQs}` : ""}`} pdfDownload excelHref={`/stock/mouvements/export${dlQs ? `?${dlQs}` : ""}`} />
        </div>
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
        <Colonne titre="Entrées" mouvements={entrees} signe="+" couleur="bg-emerald-50 text-emerald-800" />
        <Colonne titre="Sorties" mouvements={sorties} signe="−" couleur="bg-red-50 text-red-800" />
      </div>
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ReconciliationForm } from "./reconciliation-client";
import { ImportInventaireClient } from "../imports/import-client";
import type { Prisma } from "@prisma/client";
import { exigerPageStock } from "@/lib/garde-page";
import { FichesVierges } from "./fiches-vierges";
import { lireDomaine } from "@/components/stock/pilules-domaine";
import { lirePagination } from "@/lib/pagination";

type SP = { domaine?: string; page?: string; par?: string };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const { page, par } = lirePagination(sp);
  const domaine = lireDomaine(sp.domaine); // domaine de départ (pilules) ; l'écran change de domaine sans recharger

  // TOUS les articles actifs, tous domaines : l'écran masque ceux des autres domaines au lieu de les recharger,
  // pour que le comptage déjà tapé ne soit jamais perdu en changeant de pilule.
  const where: Prisma.ArticleStockWhereInput = { actif: true };
  const articles = await prisma.articleStock.findMany({
    where, orderBy: [{ categorie: { nom: "asc" } }, { designation: "asc" }],
    include: { stock: true, categorie: { select: { nom: true } } },
  });
  const rows = articles.map((a) => ({ id: a.id, code: a.code, designation: a.designation, categorie: a.categorie?.nom ?? "À classer", theorique: a.stock ? Number(a.stock.quantite) : 0, domaine: a.domaine }));
  const nombres = {
    NOURRITURE: rows.filter((r) => r.domaine === "NOURRITURE").length,
    BOISSON: rows.filter((r) => r.domaine === "BOISSON").length,
    AUTRE: rows.filter((r) => r.domaine === "AUTRE").length,
  };

  // Trois derniers comptages appliqués — l'historique complet vit dans Archives.
  const [comptages, enAttente] = await Promise.all([
    prisma.sessionComptage.findMany({ orderBy: { createdAt: "desc" }, take: 3 }),
    // Comptages soumis à la Direction, pas encore décidés (tous pour elle, les siens pour un autre compte).
    prisma.demandeValidationStock.findMany({
      where: { nature: "RECONCILIATION", statut: "EN_ATTENTE", ...(estDirection ? {} : { auteurId: user.id }) },
      orderBy: { createdAt: "desc" }, select: { id: true, resume: true, auteurNom: true, createdAt: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Réconciliation d&apos;inventaire</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Saisissez les quantités physiques comptées : les écarts avec le stock théorique génèrent un
          ajustement et le stock est mis au réel. Choisissez un domaine pour compter par lot : les quantités tapées sont conservées d&apos;un domaine à l&apos;autre.
          {!estDirection && " Un comptage avec écart est soumis à la Direction : le stock n'est ajusté qu'après sa validation."}
        </p>
      </div>

      <FichesVierges nombres={nombres} />

      {enAttente.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">En attente de la Direction ({enAttente.length})</p>
          <ul className="mt-1 space-y-0.5 text-amber-900">
            {enAttente.map((d) => (
              <li key={d.id}>{d.resume} <span className="text-xs text-amber-800/80">— {d.auteurNom}, le {d.createdAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Kinshasa" })}</span></li>
            ))}
          </ul>
          <Link href="/stock/a-valider" className="mt-1 inline-block text-xs font-medium text-amber-800 underline">{estDirection ? "Valider ou refuser" : "Voir mes demandes"}</Link>
        </div>
      )}

      <ReconciliationForm articles={rows} domaineInit={domaine} estDirection={estDirection} pageInit={page} parInit={par} />

      {/* Autre façon de mettre le stock au réel (saisie manuelle ci-dessus, ou import du classeur Excel) : repliée et discrète. */}
      {estDirection && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
            Importer un comptage depuis le classeur Excel d&apos;inventaire
            <span className="text-xs">— aperçu avant écriture, annulable depuis Imports</span>
          </summary>
          <div className="mt-2 rounded-lg border p-3"><ImportInventaireClient /></div>
        </details>
      )}

      {comptages.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Comptages récents</h2>
          <div className="space-y-2">
            {comptages.map((s) => (
              <Link key={s.id} href={`/stock/archives/${s.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 hover:bg-accent/40">
                <div>
                  <div className="font-medium">{new Date(s.date).toLocaleDateString("fr-FR")}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.nbArticles} articles · {s.nbEcarts} écart(s)
                    {s.nbHorsTol > 0 && <> · <span className="font-semibold text-red-700">{s.nbHorsTol} hors tolérance</span></>}
                  </div>
                </div>
                <span className="shrink-0 text-sm text-primary underline">Ouvrir</span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Tous les comptages sont aussi conservés dans <Link href="/stock/archives?vue=comptages" className="underline">Archives</Link>.</p>
        </div>
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import Link from "next/link";
import { ImportFacturesClient } from "./import-factures-client";
import { ImportMouvementsClient } from "./import-mouvements-client";
import { BoutonAnnulerImport } from "./annuler-btn";

export default async function ImportsPage() {
  const user = await verifySession();
  if (user.role !== "ADMIN") notFound(); // Direction uniquement

  const batches = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { operations: true } } },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Imports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import des factures fournisseurs et journal de tous les imports (chacun est réversible).
          L&apos;import d&apos;un comptage d&apos;inventaire se fait depuis la <Link href="/stock/reconciliation" className="underline">Réconciliation</Link>.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Factures fournisseurs</h2>
        <ImportFacturesClient />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Entrées / sorties de stock (CSV)</h2>
        <ImportMouvementsClient />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Historique des imports</h2>
        {batches.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun import pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {batches.map((b) => {
              const r = (b.resume ?? {}) as Record<string, number>;
              const annule = b.statut === "ANNULE";
              return (
                <li key={b.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${annule ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <p className="font-medium">{b.libelle} {annule && <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">annulé</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleString("fr-FR")} · {b.type === "INVENTAIRE" ? "Inventaire" : b.type === "MOUVEMENTS" ? "Mouvements" : "Factures"}
                      {r.maj != null && ` · ${r.maj} MAJ · ${r.crees ?? 0} créés · ${(r.mvEntree ?? 0) + (r.mvSortie ?? 0)} mouvements · ${r.legumes ?? 0} légumes`}
                    </p>
                  </div>
                  {!annule && <BoutonAnnulerImport batchId={b.id} libelle={b.libelle} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { MOIS_FR } from "@/lib/dates-fr";
import { cloturerMoisStock, rouvrirMoisStock } from "./actions";

export default async function StockParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const sp = await searchParams;
  const [user, config, clotures] = await Promise.all([
    verifySession(),
    prisma.config.findUnique({ where: { id: "singleton" } }),
    prisma.clotureStock.findMany({ orderBy: [{ annee: "desc" }, { mois: "desc" }] }),
  ]);
  const estDirection = user.role === "ADMIN";
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  // Les 6 derniers mois (mois courant inclus) avec leur état de clôture.
  const closes = new Set(clotures.map((c) => `${c.annee}-${c.mois}`));
  const maintenant = new Date();
  const moisRecents = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1));
    const annee = d.getUTCFullYear(), mois = d.getUTCMonth() + 1;
    return { annee, mois, label: `${MOIS_FR[mois - 1]} ${annee}`, cloture: closes.has(`${annee}-${mois}`) };
  });

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold sm:text-2xl">Paramètres</h1>
      {sp.erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-5">
          <h2 className="font-semibold">Taux de change</h2>
          <p className="mt-1 text-lg font-semibold">1 USD = {taux ? taux.toLocaleString("fr-FR") : "—"} CDF</p>
          <p className="mt-1 text-xs text-muted-foreground">Taux partagé avec la paie. Il se modifie dans les Paramètres de l’espace RH (Direction).</p>
        </div>
      </div>

      {/* Clôture mensuelle : fige les mouvements d'un mois terminé (comme la paie validée côté RH). */}
      {estDirection && (
        <div className="rounded-lg border p-5">
          <h2 className="font-semibold">Clôture mensuelle du stock</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Un mois clôturé n&apos;accepte plus ni création ni suppression de mouvements datés dedans
            (liste d&apos;achat, mouvements manuels, achats légumes, entrées de factures). Réversible.
            Chaque mois s&apos;exporte avec ses mouvements valorisés (entrées, sorties, consommation nette).
          </p>
          <ul className="mt-3 divide-y">
            {moisRecents.map((m) => (
              <li key={`${m.annee}-${m.mois}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 text-sm">
                <span className="capitalize">{m.label} {m.cloture && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">🔒 clôturé</span>}</span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Inventaire + mouvements</span>
                    <a href={`/stock/cloture/inventaire?mois=${m.annee}-${m.mois}&format=pdf`} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">PDF</a>
                    <a href={`/stock/cloture/inventaire?mois=${m.annee}-${m.mois}&format=excel`} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Excel</a>
                  </span>
                  {m.cloture ? (
                    <form action={rouvrirMoisStock.bind(null, m.annee, m.mois)}>
                      <button className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">Rouvrir</button>
                    </form>
                  ) : (
                    <form action={cloturerMoisStock.bind(null, m.annee, m.mois)}>
                      <button className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">Clôturer</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { MOIS_FR } from "@/lib/dates-fr";
import { cloturerMoisStock, rouvrirMoisStock } from "@/app/(stock)/stock/parametres/actions";

// Section « Clôture mensuelle du stock » — EXTRAITE de (stock)/stock/parametres pour être partagée :
// l'onglet Paramètres est UNIQUE (demande user 2026-07-20). Elle vit désormais dans la page
// Paramètres RH (/parametres, ADMIN) ; /stock/parametres y redirige. Composant serveur autonome
// (fait ses propres lectures). Les actions gardent leur propre garde ADMIN + requireModule("stock").
export async function ClotureStockSection() {
  const [config, clotures] = await Promise.all([
    prisma.config.findUnique({ where: { id: "singleton" } }),
    prisma.clotureStock.findMany({ orderBy: [{ annee: "desc" }, { mois: "desc" }] }),
  ]);
  const closes = new Set(clotures.map((c) => `${c.annee}-${c.mois}`));
  const maintenant = new Date();
  const moisRecents = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1));
    const annee = d.getUTCFullYear(), mois = d.getUTCMonth() + 1;
    return { annee, mois, label: `${MOIS_FR[mois - 1]} ${annee}`, cloture: closes.has(`${annee}-${mois}`) };
  });
  void config; // taux affiché ailleurs (Paramètres opérationnels) — pas de doublon ici.

  return (
    <div>
      <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
        Un mois clôturé n&apos;accepte plus ni création ni suppression de mouvements datés dedans
        (liste d&apos;achat, mouvements manuels, achats légumes, entrées de factures). Réversible.
        Chaque mois s&apos;exporte avec ses mouvements valorisés (entrées, sorties, consommation nette).
      </p>
      <ul className="divide-y">
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
  );
}

import { prisma } from "@/lib/prisma";
import { MOIS_FR } from "@/lib/dates-fr";
import { cloturerMoisStock, rouvrirMoisStock } from "@/app/(stock)/stock/cloture/actions";
import { TelechargerLien } from "@/components/telecharger-lien";
import { jourCivilKinshasa, dateHeureGenerationKinshasa } from "@/lib/heure-kinshasa";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

// Section « Clôture du mois » du Stock (page /stock/cloture, plan d'ergonomie V8). Elle a vécu dans /stock/parametres, puis
// dans Paramètres (lot 7) ; elle est de retour dans le menu Stock, comme la paie se clôture dans Paie. Composant serveur
// autonome (fait ses propres lectures). Les actions gardent leur propre garde ADMIN + requireModule("stock").
export async function ClotureStockSection() {
  const [config, clotures] = await Promise.all([
    prisma.config.findUnique({ where: { id: "singleton" } }),
    prisma.clotureStock.findMany({ orderBy: [{ annee: "desc" }, { mois: "desc" }] }),
  ]);
  const closes = new Map(clotures.map((c) => [`${c.annee}-${c.mois}`, c.createdAt]));
  const aujourdhui = jourCivilKinshasa(new Date()); // le mois en cours se lit à Kinshasa
  // Les 6 derniers mois TERMINÉS : le mois en cours et les mois futurs ne se clôturent pas (leur instantané
  // figerait un stock incomplet) ; le mois en cours reste exportable depuis Mouvements. Tout mois DÉJÀ clôturé
  // reste listé, même en cours ou futur (clôturé avant cette règle) : il doit pouvoir être rouvert.
  const termines = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() - i - 1, 1));
    return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1 };
  });
  const cles = new Set(termines.map((m) => `${m.annee}-${m.mois}`));
  const dejaCloturesHorsListe = clotures.filter((c) => !cles.has(`${c.annee}-${c.mois}`)).map((c) => ({ annee: c.annee, mois: c.mois }));
  const moisRecents = [...termines, ...dejaCloturesHorsListe].sort((x, y) => y.annee * 12 + y.mois - (x.annee * 12 + x.mois))
    .map(({ annee, mois }) => ({ annee, mois, label: `${MOIS_FR[mois - 1]} ${annee}`, cloture: closes.has(`${annee}-${mois}`), figeLe: closes.get(`${annee}-${mois}`) ?? null }));
  void config; // taux affiché ailleurs (Paramètres opérationnels) — pas de doublon ici.

  return (
    <div>
      <p className="mb-3 max-w-2xl text-xs text-muted-foreground">
        Un mois clôturé n&apos;accepte plus ni création ni suppression de mouvements datés dedans
        (liste d&apos;achat, mouvements manuels, achats légumes, entrées de factures). Réversible : « Rouvrir » le lève.
        L&apos;instantané est le stock <strong>du moment où vous clôturez</strong> (la date est écrite à côté du mois), pas un
        stock de fin de mois reconstitué : clôturez un mois dès qu&apos;il est terminé. Le mois en cours ne se clôture pas.
        Un mois déjà clôturé ne se reclôture pas : rouvrez-le d&apos;abord.
        Chaque mois s&apos;exporte avec ses mouvements valorisés (entrées, sorties, consommation nette).
      </p>
      <ul className="divide-y">
        {moisRecents.map((m) => (
          <li key={`${m.annee}-${m.mois}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 text-sm">
            <span className="capitalize">{m.label} {m.cloture && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">🔒 clôturé</span>}
              {m.figeLe && <span className="ml-1.5 text-xs normal-case text-muted-foreground">stock au {dateHeureGenerationKinshasa(m.figeLe)}</span>}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Inventaire + mouvements</span>
                <TelechargerLien href={`/stock/cloture/inventaire?mois=${m.annee}-${m.mois}&format=pdf`} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">PDF</TelechargerLien>
                <TelechargerLien href={`/stock/cloture/inventaire?mois=${m.annee}-${m.mois}&format=excel`} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Excel</TelechargerLien>
              </span>
              {m.cloture ? (
                <form action={rouvrirMoisStock.bind(null, m.annee, m.mois)}>
                  <ConfirmSubmitButton variante="neutre" message={`Rouvrir ${m.label} ? Les mouvements datés dans ce mois (et les mois qui le précèdent) pourront de nouveau être créés ou supprimés, et l'instantané figé sera supprimé.`}>Rouvrir</ConfirmSubmitButton>
                </form>
              ) : (
                <form action={cloturerMoisStock.bind(null, m.annee, m.mois)}>
                  <ConfirmSubmitButton variante="approuver" message={`Clôturer ${m.label} ? L'inventaire d'AUJOURD'HUI est figé (stock au moment de la clôture), et plus aucun mouvement daté dans ce mois ou avant ne pourra être créé ni supprimé tant qu'il n'est pas rouvert.`}>Clôturer</ConfirmSubmitButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

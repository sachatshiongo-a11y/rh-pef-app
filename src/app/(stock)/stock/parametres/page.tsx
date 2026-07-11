import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { MOIS_FR } from "@/lib/dates-fr";
import { BoutonSupprimerTout } from "../_rapport/bouton-supprimer-tout";
import { cloturerMoisStock, rouvrirMoisStock } from "./actions";
import { supprimerToutesEntreesAchat } from "../entree/actions";
import { supprimerTousComptages } from "../reconciliation/actions";
import { supprimerTousAchatsLegumes } from "../legumes/actions";
import { supprimerTousMouvements } from "../mouvements/actions";
import { supprimerTousBonsCommande } from "../commandes/actions";
import { supprimerTousRapports } from "../archives/actions";

export default async function StockParametresPage() {
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

  const purges: { titre: string; action: () => Promise<void>; libelle: string }[] = [
    { titre: "Liste d'achat", action: supprimerToutesEntreesAchat, libelle: "Supprimer TOUTES les entrées de la liste d'achat ? Le stock sera corrigé (effet annulé)." },
    { titre: "Mouvements", action: supprimerTousMouvements, libelle: "Supprimer TOUS les mouvements ? Le stock sera recalculé (effet annulé)." },
    { titre: "Bons de commande", action: supprimerTousBonsCommande, libelle: "Supprimer TOUS les bons de commande ?" },
    { titre: "Achats de légumes", action: supprimerTousAchatsLegumes, libelle: "Supprimer TOUS les achats de légumes ?" },
    { titre: "Comptages archivés", action: supprimerTousComptages, libelle: "Supprimer TOUS les comptages archivés ?" },
    { titre: "Rapports générés", action: supprimerTousRapports, libelle: "Supprimer TOUS les rapports générés ?" },
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold sm:text-2xl">Paramètres</h1>

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
                    <span className="text-xs text-muted-foreground">Inventaire</span>
                    <a href={`/stock/cloture/inventaire?mois=${m.annee}-${m.mois}&format=pdf`} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">PDF</a>
                    <a href={`/stock/cloture/inventaire?mois=${m.annee}-${m.mois}&format=excel`} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Excel</a>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Mouvements</span>
                    <a href={`/stock/mouvements/pdf?mois=${m.annee}-${m.mois}`} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">PDF</a>
                    <a href={`/stock/mouvements/export?mois=${m.annee}-${m.mois}`} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Excel</a>
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

      {/* Zone dangereuse : les purges globales vivent ICI, plus dans les pages de travail —
          trop risquées au quotidien maintenant que les données sont réelles. */}
      {estDirection && (
        <div className="rounded-lg border border-destructive/40 p-5">
          <h2 className="font-semibold text-destructive">Zone dangereuse</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Suppressions globales, irréversibles (double confirmation). Réservées aux remises à zéro exceptionnelles.
          </p>
          <ul className="mt-3 divide-y">
            {purges.map((p) => (
              <li key={p.titre} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{p.titre}</span>
                <BoutonSupprimerTout estDirection action={p.action} libelle={p.libelle} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

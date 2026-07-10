import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BoutonSupprimerTout } from "../_rapport/bouton-supprimer-tout";
import { supprimerToutesEntreesAchat } from "../entree/actions";
import { supprimerTousComptages } from "../reconciliation/actions";
import { supprimerTousAchatsLegumes } from "../legumes/actions";
import { supprimerTousMouvements } from "../mouvements/actions";
import { supprimerTousBonsCommande } from "../commandes/actions";
import { supprimerTousRapports } from "../archives/actions";

export default async function StockParametresPage() {
  const [user, config] = await Promise.all([
    verifySession(),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const estDirection = user.role === "ADMIN";
  const taux = config ? Number(config.tauxChangeCDF) : 0;

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

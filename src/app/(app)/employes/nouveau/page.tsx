import { verifySession, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmployeeForm } from "../employee-form";
import { creerEmploye } from "../actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";
import { MOIS_FR } from "@/lib/dates-fr";

export default async function NouvelEmployePage() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const [parametres, postes, dernierRun] = await Promise.all([
    chargerParametresPaie(),
    chargerPostes(),
    // Dernière paie calculée : sert de référence à la simulation d'impact (masse, coût).
    prisma.payrollRun.findFirst({
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      include: { lignes: { select: { salNetUSD: true, coutEmployeurUSD: true } } },
    }),
  ]);
  const impact =
    dernierRun && dernierRun.lignes.length > 0
      ? {
          netActuel: dernierRun.lignes.reduce((t, l) => t + Number(l.salNetUSD), 0),
          coutActuel: dernierRun.lignes.reduce((t, l) => t + Number(l.coutEmployeurUSD), 0),
          effectif: dernierRun.lignes.length,
          periode: `${MOIS_FR[dernierRun.mois - 1]} ${dernierRun.annee}`,
        }
      : null;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold sm:text-2xl">Nouvel employé</h1>
      <EmployeeForm
        action={creerEmploye}
        joursOuvrablesMois={parametres.joursOuvrablesMois}
        postes={postes}
        parametres={parametres}
        impact={impact}
      />
    </div>
  );
}

import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { EmployeeForm } from "../employee-form";
import { creerEmploye } from "../actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";
import { MOIS_FR } from "@/lib/dates-fr";
import { salaireNetUSD } from "@/lib/paie-net";
import { exigerPageRH } from "@/lib/garde-page";

export default async function NouvelEmployePage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await exigerPageRH();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const sp = await searchParams;
  const [parametres, postes, dernierRun] = await Promise.all([
    chargerParametresPaie(),
    chargerPostes(),
    // Dernière paie calculée : sert de référence à la simulation d'impact (masse, coût).
    prisma.payrollRun.findFirst({
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      include: { lignes: { select: { id: true, employeeId: true, statutPaiement: true, salNetUSD: true, transportUSD: true, coutEmployeurUSD: true } } },
    }),
  ]);
  // Lignes hors calcul (ligne rouverte d'un salarié sorti du calcul) : hors de la masse de référence (paie-hors-calcul.ts).
  if (dernierRun) dernierRun.lignes = await lignesComptees(prisma, dernierRun.lignes);
  const impact =
    dernierRun && dernierRun.lignes.length > 0
      ? {
          netActuel: dernierRun.lignes.reduce((t, l) => t + salaireNetUSD(l), 0),
          coutActuel: dernierRun.lignes.reduce((t, l) => t + Number(l.coutEmployeurUSD), 0),
          effectif: dernierRun.lignes.length,
          periode: `${MOIS_FR[dernierRun.mois - 1]} ${dernierRun.annee}`,
        }
      : null;

  return (
    <div>
      {sp.erreur && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
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

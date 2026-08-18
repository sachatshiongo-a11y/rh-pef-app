import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { EmployeeForm } from "../../employee-form";
import { modifierEmploye } from "../../actions";
import { uploadPhotoEmploye } from "../../photo-actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";
import { Avatar } from "@/components/avatar";
import { MOIS_FR } from "@/lib/dates-fr";
import { CompositionFamiliale } from "../../composition-familiale";

export default async function ModifierEmployePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string }>;
}) {
  const sp = await searchParams;
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const { id } = await params;
  const [employee, parametres, postes, dernierRun, famille, config] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    chargerParametresPaie(),
    chargerPostes(),
    // Dernière paie calculée : référence de la simulation (visualiser une augmentation).
    prisma.payrollRun.findFirst({
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      include: { lignes: { select: { employeeId: true, salNetUSD: true, coutEmployeurUSD: true } } },
    }),
    prisma.membreFamille.findMany({ where: { employeeId: id }, orderBy: [{ lien: "asc" }, { dateNaissance: "asc" }] }),
    prisma.config.findUnique({ where: { id: "singleton" }, select: { ageLimiteEnfantACharge: true } }),
  ]);
  if (!employee) notFound();

  const ligneEmp = dernierRun?.lignes.find((l) => l.employeeId === id) ?? null;
  const impact =
    dernierRun && dernierRun.lignes.length > 0
      ? {
          netActuel: dernierRun.lignes.reduce((t, l) => t + Number(l.salNetUSD), 0),
          coutActuel: dernierRun.lignes.reduce((t, l) => t + Number(l.coutEmployeurUSD), 0),
          effectif: dernierRun.lignes.length,
          periode: `${MOIS_FR[dernierRun.mois - 1]} ${dernierRun.annee}`,
          actuel: ligneEmp ? { net: Number(ligneEmp.salNetUSD), cout: Number(ligneEmp.coutEmployeurUSD) } : null,
        }
      : null;

  const action = modifierEmploye.bind(null, employee.id);

  return (
    <div>
      {sp.erreur && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
      <Link href={`/employes/${employee.id}`} className="text-sm text-primary underline">
        ← Retour à la fiche
      </Link>
      <h1 className="mb-6 mt-2 text-xl font-semibold sm:text-2xl">Modifier — {employee.nom}</h1>

      {/* Photo — modifiable uniquement ici (page Modifier) */}
      <div className="mb-6 flex items-center gap-4 rounded-xl border bg-card p-4">
        {employee.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={employee.photoUrl} alt={employee.nom} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <Avatar nom={employee.nom} taille={64} />
        )}
        <form action={uploadPhotoEmploye.bind(null, employee.id)} className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-medium">Photo de l&apos;employé</p>
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required className="mt-1 text-xs" />
          </div>
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Mettre à jour la photo
          </button>
        </form>
      </div>

      {/* Composition familiale — modifiable uniquement ici, comme la photo. */}
      <div className="mb-6 rounded-xl border bg-card p-4">
        <p className="mb-3 text-sm font-medium">Composition familiale</p>
        <CompositionFamiliale
          employeeId={employee.id}
          membres={famille}
          enfantsCompteur={employee.enfants}
          ageLimiteEnfant={config?.ageLimiteEnfantACharge ?? 18}
          modifiable
        />
      </div>

      <EmployeeForm
        employee={employee}
        action={action}
        joursOuvrablesMois={parametres.joursOuvrablesMois}
        postes={postes}
        parametres={parametres}
        impact={impact}
      />
    </div>
  );
}

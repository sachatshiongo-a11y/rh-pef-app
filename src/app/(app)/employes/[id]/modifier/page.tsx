import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { requireRole } from "@/lib/auth";
import { EmployeeForm } from "../../employee-form";
import { modifierEmploye } from "../../actions";
import { uploadPhotoEmploye } from "../../photo-actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";
import { Avatar } from "@/components/avatar";
import { MOIS_FR } from "@/lib/dates-fr";
import { CompositionFamiliale } from "../../composition-familiale";
import { salaireNetUSD } from "@/lib/paie-net";
import { exigerPageRH } from "@/lib/garde-page";
import { peutSupprimer } from "@/lib/suppression-direction";
import { chargerFichesIdentite, chargerPairesEcartees } from "@/lib/employe-doublon-serveur";
import { fichesPourEcran } from "../../fiches-doublon";

export default async function ModifierEmployePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string }>;
}) {
  const user = await exigerPageRH();
  const sp = await searchParams;
  requireRole(user, ["ADMIN", "MANAGER"]);

  const { id } = await params;
  const [employee, parametres, postes, dernierRun, famille, config, identites, ecartees] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    chargerParametresPaie(),
    chargerPostes(),
    // Dernière paie calculée : référence de la simulation (visualiser une augmentation).
    prisma.payrollRun.findFirst({
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      include: { lignes: { select: { id: true, employeeId: true, statutPaiement: true, salNetUSD: true, transportUSD: true, coutEmployeurUSD: true } } },
    }),
    prisma.membreFamille.findMany({ where: { employeeId: id }, orderBy: [{ lien: "asc" }, { dateNaissance: "asc" }] }),
    prisma.config.findUnique({ where: { id: "singleton" }, select: { ageLimiteEnfantACharge: true } }),
    // Anti-doublon : toutes les fiches (actives et inactives) et les paires déjà déclarées « deux personnes ».
    chargerFichesIdentite(),
    chargerPairesEcartees(),
  ]);
  // Lignes hors calcul (ligne rouverte d'un salarié sorti du calcul) : hors de la masse de référence (paie-hors-calcul.ts).
  if (dernierRun) dernierRun.lignes = await lignesComptees(prisma, dernierRun.lignes);
  if (!employee) notFound();

  const ligneEmp = dernierRun?.lignes.find((l) => l.employeeId === id) ?? null;
  const impact =
    dernierRun && dernierRun.lignes.length > 0
      ? {
          netActuel: dernierRun.lignes.reduce((t, l) => t + salaireNetUSD(l), 0),
          coutActuel: dernierRun.lignes.reduce((t, l) => t + Number(l.coutEmployeurUSD), 0),
          effectif: dernierRun.lignes.length,
          periode: `${MOIS_FR[dernierRun.mois - 1]} ${dernierRun.annee}`,
          actuel: ligneEmp ? { net: salaireNetUSD(ligneEmp), cout: Number(ligneEmp.coutEmployeurUSD) } : null,
        }
      : null;

  const action = modifierEmploye.bind(null, employee.id);

  return (
    <div>
      {sp.erreur && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
      <Link href={`/employes/${employee.id}`} className="text-sm text-primary underline">
        ← Retour à la fiche
      </Link>

      {/* En-tête : qui l'on modifie, et sa photo — modifiable uniquement ici (page Modifier). */}
      <div className="mb-4 mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar nom={employee.nom} taille={56} photoUrl={employee.photoUrl} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold sm:text-2xl">Modifier — {employee.nom}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{employee.matricule}</span> · {employee.poste}
              {!employee.actif && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Inactif</span>}
            </p>
          </div>
        </div>
        <form action={uploadPhotoEmploye.bind(null, employee.id)} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <label className="flex flex-col text-xs font-medium">
            Photo de l&apos;employé
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required className="mt-1 max-w-56 text-xs font-normal" />
          </label>
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Mettre à jour la photo
          </button>
        </form>
      </div>

      <EmployeeForm
        employee={employee}
        action={action}
        joursOuvrablesMois={parametres.joursOuvrablesMois}
        postes={postes}
        parametres={parametres}
        impact={impact}
        doublons={{ fiches: fichesPourEcran(identites), ecartees: [...ecartees], peutReactiver: user.role === "ADMIN" }}
        famille={
          // Composition familiale — modifiable uniquement ici, comme la photo (ses propres formulaires : hors du formulaire principal).
          <CompositionFamiliale
            employeeId={employee.id}
            membres={famille}
            enfantsCompteur={employee.enfants}
            ageLimiteEnfant={config?.ageLimiteEnfantACharge ?? 18}
            modifiable
            peutRetirer={peutSupprimer(user)}
          />
        }
      />
    </div>
  );
}

import { requireRole } from "@/lib/auth";
import { messageLisible } from "@/lib/erreur-metier";
import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { EmployeeForm } from "../employee-form";
import { creerEmploye } from "../actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";
import { MOIS_FR } from "@/lib/dates-fr";
import { salaireNetUSD } from "@/lib/paie-net";
import { exigerPageRH } from "@/lib/garde-page";
import type { Employee } from "@prisma/client";
import { verifierReembauche } from "@/lib/creation-fiche";
import { chargerFichesIdentite } from "@/lib/employe-doublon-serveur";
import { fichesPourEcran } from "../fiches-doublon";

export default async function NouvelEmployePage({ searchParams }: { searchParams: Promise<{ erreur?: string; reembauche?: string }> }) {
  const user = await exigerPageRH();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const sp = await searchParams;
  const [parametres, postes, dernierRun, identites] = await Promise.all([
    chargerParametresPaie(),
    chargerPostes(),
    // Dernière paie calculée : sert de référence à la simulation d'impact (masse, coût).
    prisma.payrollRun.findFirst({
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      include: { lignes: { select: { id: true, employeeId: true, statutPaiement: true, salNetUSD: true, transportUSD: true, coutEmployeurUSD: true } } },
    }),
    // Anti-doublon : toutes les fiches (actives et inactives), rapprochées pendant la saisie.
    chargerFichesIdentite(),
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

  // RÉEMBAUCHE : le formulaire est pré-rempli depuis la fiche archivée (jamais la date d'embauche ni le salaire).
  let reembauche: { ancienneFicheId: string; nom: string; matricule: string; modele: Partial<Employee> } | undefined;
  let refusReembauche: string | null = null;
  if (sp.reembauche) {
    try {
      await verifierReembauche(prisma, sp.reembauche);
      const a = await prisma.employee.findUniqueOrThrow({ where: { id: sp.reembauche } });
      reembauche = {
        ancienneFicheId: a.id, nom: a.nom, matricule: a.matricule,
        modele: {
          nom: a.nom, sexe: a.sexe, etatCivil: a.etatCivil, poste: a.poste, secteur: a.secteur, categorie: a.categorie,
          categorieProfessionnelle: a.categorieProfessionnelle, type: a.type, dateNaissance: a.dateNaissance, telephone: a.telephone,
          email: a.email, adresse: a.adresse, banque: a.banque, compteBancaire: a.compteBancaire, mobileMoney: a.mobileMoney,
          modePaiement: a.modePaiement, enfants: a.enfants, heuresParJour: a.heuresParJour, heuresHebdomadaires: a.heuresHebdomadaires,
          transportJourCDF: a.transportJourCDF, transportMoisCDF: a.transportMoisCDF, transportMoisUSD: a.transportMoisUSD, cnssMontant: a.cnssMontant,
        },
      };
    } catch (e) {
      refusReembauche = messageLisible(e, "employes/nouveau réembauche").replace(" Rien n'a été enregistré.", "");
    }
  }

  return (
    <div>
      {refusReembauche && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{refusReembauche}</p>}
      {sp.erreur && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
      <h1 className="mb-6 text-xl font-semibold sm:text-2xl">{reembauche ? `Réembaucher ${reembauche.nom}` : "Nouvel employé"}</h1>
      <EmployeeForm
        action={creerEmploye}
        reembauche={reembauche}
        joursOuvrablesMois={parametres.joursOuvrablesMois}
        postes={postes}
        parametres={parametres}
        impact={impact}
        champsDirection={user.role === "ADMIN" ? "modifiables" : "validation"}
        doublons={{ fiches: fichesPourEcran(identites), ecartees: [], peutReactiver: user.role === "ADMIN" }}
      />
    </div>
  );
}

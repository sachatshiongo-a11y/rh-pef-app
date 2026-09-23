import "server-only";
import type { PrismaClient } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { emailInterneMatricule, genererMotDePasseTemporaire } from "@/lib/espace-employe";
import { creerUtilisateurAuth, supprimerUtilisateurAuth } from "@/lib/securite-connexion";

// Le SEUL chemin de création d'un compte de l'espace salarié : la fiche employé (« Créer un
// compte ») comme la création en lot (Paramètres → Espace salarié) passent par ici. Les gardes de
// rôle et d'activation de l'espace salarié restent dans les actions serveur qui l'appellent : ce
// module ne connaît ni la session ni Next.

/** Pourquoi un compte n'a pas été créé, quand ce n'est pas une panne. */
export type MotifRefusCompte = "INTROUVABLE" | "INACTIF" | "COMPTE_EXISTANT";

export class RefusCompteSalarie extends Error {
  constructor(
    readonly motif: MotifRefusCompte,
    message: string,
  ) {
    super(message);
    this.name = "RefusCompteSalarie";
  }
}

export type CompteSalarieCree = { employeeId: string; nom: string; matricule: string; motDePasse: string };

/**
 * Crée le compte d'un salarié ACTIF qui n'en a pas : identifiant = matricule (e-mail interne
 * dérivé), mot de passe TEMPORAIRE à changer à la 1re connexion. Un compte existant n'est JAMAIS
 * touché (ni réinitialisé, ni réactivé) : c'est un refus.
 *
 * Le mot de passe n'est renvoyé qu'à l'appelant — jamais stocké côté application, jamais écrit
 * au journal. Si la ligne applicative ne peut pas être écrite, le compte Auth tout juste créé est
 * supprimé : pas de compte à moitié.
 */
export async function creerCompteSalarie(
  client: PrismaClient,
  p: { employeeId: string; auteurId: string },
): Promise<CompteSalarieCree> {
  const emp = await client.employee.findUnique({
    where: { id: p.employeeId },
    select: { id: true, nom: true, matricule: true, actif: true },
  });
  if (!emp) throw new RefusCompteSalarie("INTROUVABLE", "Salarié introuvable.");
  if (!emp.actif) throw new RefusCompteSalarie("INACTIF", "Cet employé n'est plus actif.");

  const dejaCompte = await client.user.findUnique({ where: { employeeId: emp.id }, select: { id: true } });
  if (dejaCompte)
    throw new RefusCompteSalarie(
      "COMPTE_EXISTANT",
      "Un compte existe déjà pour ce salarié. Utilisez « Réinitialiser le mot de passe ».",
    );

  const email = emailInterneMatricule(emp.matricule);
  const motDePasse = genererMotDePasseTemporaire();

  // Le compte Auth d'abord, puis la ligne applicative. En cas d'échec applicatif, on nettoie l'Auth.
  const authId = await creerUtilisateurAuth(email, motDePasse);
  try {
    await client.user.create({
      data: { id: authId, email, nom: emp.nom, role: "EMPLOYE", employeeId: emp.id, motDePasseTemporaire: true },
    });
  } catch (e) {
    await supprimerUtilisateurAuth(authId);
    throw e;
  }

  await journaliser(client, {
    entite: "User",
    entiteId: authId,
    champ: "creation",
    nouvelleValeur: `compte salarié ${emp.matricule}`,
    userId: p.auteurId,
  });
  return { employeeId: emp.id, nom: emp.nom, matricule: emp.matricule, motDePasse };
}

export type ResultatLot = {
  /** Dans l'ordre alphabétique des noms : l'ordre des fiches imprimées. */
  crees: CompteSalarieCree[];
  ignores: { nom: string; raison: string }[];
};

const RAISON_REFUS: Record<MotifRefusCompte, string> = {
  INTROUVABLE: "salarié introuvable",
  INACTIF: "n'est plus actif",
  COMPTE_EXISTANT: "a déjà un compte (non modifié)",
};

/** Première ligne d'un message d'erreur, bornée : une erreur Prisma tient sur des dizaines de lignes. */
function resumeErreur(e: unknown): string {
  const ligne = (e instanceof Error ? e.message : "").trim().split("\n")[0]?.trim() ?? "";
  if (!ligne) return "erreur inattendue";
  return ligne.length > 160 ? `${ligne.slice(0, 157)}…` : ligne;
}

/**
 * Crée les comptes d'une liste de salariés, UN PAR UN. Un échec n'arrête PAS le lot et n'annule
 * PAS les comptes déjà créés : leur mot de passe n'existe que dans le résultat de cet appel (puis
 * dans le PDF des fiches) — les défaire les rendrait introuvables, les laisser tomber les rendrait
 * inutilisables. Chaque salarié non créé est nommé dans `ignores`, avec sa raison.
 */
export async function creerComptesSalaries(
  client: PrismaClient,
  p: { employeeIds: string[]; auteurId: string },
): Promise<ResultatLot> {
  const ids = [...new Set(p.employeeIds)];
  const connus = await client.employee.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true } });
  const nomDe = new Map(connus.map((e) => [e.id, e.nom]));
  const ordre = [...ids].sort((a, b) => (nomDe.get(a) ?? "").localeCompare(nomDe.get(b) ?? "", "fr"));

  const resultat: ResultatLot = { crees: [], ignores: [] };
  for (const employeeId of ordre) {
    try {
      resultat.crees.push(await creerCompteSalarie(client, { employeeId, auteurId: p.auteurId }));
    } catch (e) {
      const raison = e instanceof RefusCompteSalarie ? RAISON_REFUS[e.motif] : `échec de la création : ${resumeErreur(e)}`;
      resultat.ignores.push({ nom: nomDe.get(employeeId) ?? "(salarié introuvable)", raison });
    }
  }
  return resultat;
}

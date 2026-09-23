import "server-only";
import type { PrismaClient } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { emailInterneMatricule, genererMotDePasseTemporaire } from "@/lib/espace-employe";
import { changerMotDePasseAdmin, creerUtilisateurAuth, supprimerUtilisateurAuth } from "@/lib/securite-connexion";

// Le SEUL chemin de création d'un compte de l'espace salarié, et le SEUL chemin de
// réinitialisation de son mot de passe : la fiche employé (« Créer un compte », « Réinitialiser le
// mot de passe ») comme Paramètres → Espace salarié (« Créer les comptes », « Nouvelle fiche »)
// passent par ici. Les gardes de rôle et d'activation de l'espace salarié restent dans les actions
// serveur qui l'appellent : ce module ne connaît ni la session ni Next.

/** Pourquoi un compte n'a pas été créé ou réinitialisé, quand ce n'est pas une panne. */
export type MotifRefusCompte = "INTROUVABLE" | "INACTIF" | "COMPTE_EXISTANT" | "SANS_COMPTE" | "COMPTE_PAR_EMAIL" | "ROLE_NON_SALARIE";

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

/**
 * L'état du compte d'un salarié, tel que Paramètres → Espace salarié l'affiche. « PAR_EMAIL » : le
 * compte se connecte par une adresse e-mail (ex. un compte Stock créé dans Utilisateurs & accès),
 * pas par le matricule — une fiche « matricule + mot de passe » ne lui servirait à rien.
 */
export type EtatCompteSalarie = "SANS_COMPTE" | "ACTIF" | "DESACTIVE" | "PAR_EMAIL";

/** Vrai si le compte se connecte par le MATRICULE (son e-mail est l'e-mail interne du matricule). */
export function identifiantEstLeMatricule(email: string, matricule: string): boolean {
  return email.toLowerCase() === emailInterneMatricule(matricule);
}

export function etatCompteSalarie(matricule: string, compte: { email: string; actif: boolean } | null): EtatCompteSalarie {
  if (!compte) return "SANS_COMPTE";
  if (!identifiantEstLeMatricule(compte.email, matricule)) return "PAR_EMAIL";
  return compte.actif ? "ACTIF" : "DESACTIVE";
}

export const MESSAGE_COMPTE_PAR_EMAIL = "compte par adresse e-mail — géré dans Utilisateurs & accès";

/** Réinitialisation à moitié faite : l'Auth a changé le mot de passe, la base ou le journal non. */
export class ReinitialisationInachevee extends Error {
  constructor(cause: unknown) {
    super("Mot de passe changé mais non enregistré : l'ancien ne marche plus, refaites “Nouvelle fiche” pour ce salarié.", { cause });
    this.name = "ReinitialisationInachevee";
  }
}

/**
 * Nouveau mot de passe TEMPORAIRE pour le compte d'un salarié : l'ancien cesse de fonctionner, le
 * compte est (ré)activé et le changement sera exigé à la connexion suivante.
 *
 * Éligible : un compte LIÉ au salarié, de rôle EMPLOYE ou STOCK, dont l'identifiant de connexion
 * est son matricule. Refusés, sans rien modifier : pas de compte ; un autre rôle (Direction,
 * Manager, Compta… : ces comptes se gèrent dans Utilisateurs & accès) ; compte à identifiant
 * e-mail (la fiche porterait un identifiant qui ne connecte pas).
 * L'activité du salarié n'est PAS vérifiée ici (la fiche employé ne la vérifiait pas) : le lot la
 * vérifie, lui, avant d'appeler.
 *
 * Le mot de passe n'est renvoyé qu'à l'appelant — jamais stocké, jamais écrit au journal. Si la
 * base ou le journal échoue APRÈS le changement côté Auth, l'erreur le dit : l'ancien mot de passe
 * ne fonctionne plus et le nouveau est perdu.
 */
export async function reinitialiserCompteSalarie(
  client: PrismaClient,
  p: { employeeId: string; auteurId: string },
): Promise<CompteSalarieCree> {
  const compte = await client.user.findUnique({
    where: { employeeId: p.employeeId },
    select: { id: true, email: true, role: true, employe: { select: { id: true, nom: true, matricule: true } } },
  });
  if (!compte?.employe) throw new RefusCompteSalarie("SANS_COMPTE", "Aucun compte salarié pour cet employé.");
  const emp = compte.employe;
  if (compte.role !== "EMPLOYE" && compte.role !== "STOCK")
    throw new RefusCompteSalarie(
      "ROLE_NON_SALARIE",
      "Ce compte n'est ni un compte salarié ni un compte Stock : il se gère dans Paramètres → Utilisateurs & accès.",
    );
  if (!identifiantEstLeMatricule(compte.email, emp.matricule))
    throw new RefusCompteSalarie(
      "COMPTE_PAR_EMAIL",
      "Ce compte se connecte par adresse e-mail, pas par le matricule : il se gère dans Paramètres → Utilisateurs & accès.",
    );

  const motDePasse = genererMotDePasseTemporaire();
  // L'Auth d'abord : si elle échoue, rien n'a changé côté application.
  await changerMotDePasseAdmin(compte.id, motDePasse);
  try {
    await client.user.update({ where: { id: compte.id }, data: { motDePasseTemporaire: true, actif: true } });
    await journaliser(client, {
      entite: "User",
      entiteId: compte.id,
      champ: "reinitialisation",
      nouvelleValeur: "mot de passe temporaire régénéré",
      userId: p.auteurId,
    });
  } catch (e) {
    // Le mot de passe n'est plus rendu à personne : le dire, sans jamais le citer.
    throw new ReinitialisationInachevee(e);
  }
  return { employeeId: emp.id, nom: emp.nom, matricule: emp.matricule, motDePasse };
}

export type ResultatLot = {
  /** Créés (ou réinitialisés), dans l'ordre alphabétique des noms : l'ordre des fiches imprimées. */
  crees: CompteSalarieCree[];
  ignores: { nom: string; raison: string }[];
};

const RAISON_REFUS: Record<MotifRefusCompte, string> = {
  INTROUVABLE: "salarié introuvable",
  INACTIF: "n'est plus actif",
  COMPTE_EXISTANT: "a déjà un compte (non modifié)",
  SANS_COMPTE: "n'a pas de compte (utilisez « Créer les comptes »)",
  COMPTE_PAR_EMAIL: MESSAGE_COMPTE_PAR_EMAIL,
  ROLE_NON_SALARIE: "ni compte salarié ni compte Stock — géré dans Utilisateurs & accès",
};

/** Première ligne d'un message d'erreur, bornée : une erreur Prisma tient sur des dizaines de lignes. */
function resumeErreur(e: unknown): string {
  const ligne = (e instanceof Error ? e.message : "").trim().split("\n")[0]?.trim() ?? "";
  if (!ligne) return "erreur inattendue";
  return ligne.length > 160 ? `${ligne.slice(0, 157)}…` : ligne;
}

/**
 * Traite une liste de salariés UN PAR UN, dans l'ordre alphabétique (l'ordre des fiches). Un échec
 * n'arrête PAS le lot et n'annule PAS ce qui est déjà fait : chaque mot de passe n'existe que dans
 * le résultat de cet appel (puis dans les fiches) — défaire les comptes les rendrait introuvables,
 * les laisser tomber les rendrait inutilisables. Chaque salarié non traité est nommé dans
 * `ignores`, avec sa raison.
 */
async function traiterEnLot(
  client: PrismaClient,
  employeeIds: string[],
  traiter: (employeeId: string, emp: { actif: boolean } | undefined) => Promise<CompteSalarieCree>,
  verbeEchec: string,
): Promise<ResultatLot> {
  const ids = [...new Set(employeeIds)];
  const connus = await client.employee.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true, actif: true } });
  const parId = new Map(connus.map((e) => [e.id, e]));
  const ordre = [...ids].sort((a, b) => (parId.get(a)?.nom ?? "").localeCompare(parId.get(b)?.nom ?? "", "fr"));

  const resultat: ResultatLot = { crees: [], ignores: [] };
  for (const employeeId of ordre) {
    try {
      resultat.crees.push(await traiter(employeeId, parId.get(employeeId)));
    } catch (e) {
      const raison =
        e instanceof RefusCompteSalarie
          ? RAISON_REFUS[e.motif]
          : e instanceof ReinitialisationInachevee
            ? e.message // déjà complet : « échec » dirait le contraire de ce qui s'est passé
            : `échec ${verbeEchec} : ${resumeErreur(e)}`;
      resultat.ignores.push({ nom: parId.get(employeeId)?.nom ?? "(salarié introuvable)", raison });
    }
  }
  return resultat;
}

/** Crée les comptes d'une liste de salariés (cf. `traiterEnLot`). */
export async function creerComptesSalaries(
  client: PrismaClient,
  p: { employeeIds: string[]; auteurId: string },
): Promise<ResultatLot> {
  return traiterEnLot(client, p.employeeIds, (employeeId) => creerCompteSalarie(client, { employeeId, auteurId: p.auteurId }), "de la création");
}

/**
 * « Nouvelle fiche » pour une liste de salariés : réinitialise le mot de passe de chacun (cf.
 * `reinitialiserCompteSalarie`, `traiterEnLot`). Un salarié qui n'est plus actif est refusé AVANT
 * toute écriture : une fiche ne rouvre pas le compte de quelqu'un qui est parti.
 */
export async function reinitialiserComptesSalaries(
  client: PrismaClient,
  p: { employeeIds: string[]; auteurId: string },
): Promise<ResultatLot> {
  return traiterEnLot(
    client,
    p.employeeIds,
    async (employeeId, emp) => {
      if (!emp) throw new RefusCompteSalarie("INTROUVABLE", "Salarié introuvable.");
      if (!emp.actif) throw new RefusCompteSalarie("INACTIF", "Cet employé n'est plus actif.");
      return reinitialiserCompteSalarie(client, { employeeId, auteurId: p.auteurId });
    },
    "de la réinitialisation",
  );
}

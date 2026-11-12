import type { Role } from "@prisma/client";

/**
 * PERMISSIONS PAR PERSONNE — Module PUR (ni session ni base), importable par le serveur ET le client.
 *
 * Le RÔLE donne le comportement de base (voir `lib/espaces.ts`) ; la Direction peut ensuite, compte par
 * compte, RETIRER une permission à une personne RH ou Stock, ou lui en ACCORDER une qui n'est pas
 * dans le rôle (approuver un bon de commande). Stockage : `User.permissions` (JSON) ne contient QUE les
 * écarts par rapport au défaut du rôle. `null` / absent = le comportement historique du rôle, exactement :
 * tant que la Direction ne coche rien, rien ne change.
 *
 * RÈGLES FIXES (jamais réglables, quoi qu'on stocke) :
 *   - la Direction (ADMIN) a toujours tout ;
 *   - ce que la Direction se réserve (suppressions, imports, clôture du mois, approbation des congés,
 *     validation de la paie…) reste gardé par `requireRole(["ADMIN"])` : une permission ne l'ouvre pas ;
 *   - un compte « Consultation » (VIEWER) lit comme avant : ses permissions ne se règlent pas ;
 *   - les permissions RH ne concernent que le rôle RH (MANAGER) ; les permissions Stock que le rôle Stock
 *     et le salarié à qui l'accès Stock a été accordé.
 */

export type EspacePermission = "rh" | "stock";

export type DefinitionPermission = {
  cle: string;
  espace: EspacePermission;
  libelle: string;
  description: string;
  /** Valeur par défaut du rôle ciblé = comportement actuel. */
  defaut: boolean;
};

export const DEFINITIONS_PERMISSIONS = [
  // ── Espace RH (rôle « RH » = MANAGER) ─────────────────────────────────────────────
  { cle: "rh.employes", espace: "rh", defaut: true, libelle: "Employés", description: "Voir et modifier les fiches des employés (dossier, photo, prêts, accueil)" },
  { cle: "rh.fiches_poste", espace: "rh", defaut: true, libelle: "Fiches de poste", description: "Consulter et modifier les fiches de poste" },
  { cle: "rh.presences", espace: "rh", defaut: true, libelle: "Présences & heures", description: "Saisir et corriger les présences, heures supplémentaires et maladies" },
  { cle: "rh.planning", espace: "rh", defaut: true, libelle: "Planning", description: "Construire et modifier le planning" },
  { cle: "rh.conges", espace: "rh", defaut: true, libelle: "Congés & absences", description: "Saisir les demandes de congés et d'absences" },
  { cle: "rh.paie", espace: "rh", defaut: true, libelle: "Paie", description: "Voir la paie, vérifier les bulletins, gérer contrats et rémunérations" },
  { cle: "rh.declarations", espace: "rh", defaut: true, libelle: "Déclarations", description: "Consulter et exporter les déclarations sociales et fiscales" },
  { cle: "rh.documents", espace: "rh", defaut: true, libelle: "Documents & attestations", description: "Documents, archives, attestations et signatures" },
  // ── Espace Stock (rôle « Stock ») ─────────────────────────────────────────────────
  { cle: "stock.bon_creer", espace: "stock", defaut: true, libelle: "Bons de commande : créer et suivre", description: "Créer, modifier et réceptionner un bon de commande" },
  { cle: "stock.bon_valider", espace: "stock", defaut: false, libelle: "Bons de commande : approuver", description: "Approuver un bon de commande (réservé à la Direction par défaut)" },
  { cle: "stock.facture", espace: "stock", defaut: false, libelle: "Factures : enregistrer", description: "Enregistrer une facture fournisseur avec entrée en stock (réservé à la Direction par défaut)" },
  { cle: "stock.mouvement", espace: "stock", defaut: true, libelle: "Entrées et sorties", description: "Saisir une entrée, une sortie ou une consommation de stock" },
  { cle: "stock.inventaire", espace: "stock", defaut: true, libelle: "Inventaire et comptage", description: "Faire un comptage et le réconcilier avec le stock" },
  { cle: "stock.catalogue", espace: "stock", defaut: true, libelle: "Catalogue et prix", description: "Créer des articles, proposer des modifications du catalogue et des prix" },
  { cle: "stock.restaurant", espace: "stock", defaut: true, libelle: "Restaurant", description: "Consommation journalière, stock du restaurant, fiches techniques" },
  { cle: "stock.exports", espace: "stock", defaut: true, libelle: "Exports et impressions", description: "Exporter ou imprimer (Excel, PDF) les données du Stock" },
] as const satisfies readonly DefinitionPermission[];

export type Permission = (typeof DEFINITIONS_PERMISSIONS)[number]["cle"];

/** Les écarts stockés pour une personne : seules les permissions qui diffèrent du défaut du rôle. */
export type SurchargesPermissions = Partial<Record<Permission, boolean>>;

const PAR_CLE = new Map<string, DefinitionPermission>(DEFINITIONS_PERMISSIONS.map((d) => [d.cle, d]));

export const PERMISSIONS_RH: readonly DefinitionPermission[] = DEFINITIONS_PERMISSIONS.filter((d) => d.espace === "rh");
export const PERMISSIONS_STOCK: readonly DefinitionPermission[] = DEFINITIONS_PERMISSIONS.filter((d) => d.espace === "stock");

export function definitionPermission(cle: Permission): DefinitionPermission {
  return PAR_CLE.get(cle)!;
}

export function estPermission(v: unknown): v is Permission {
  return typeof v === "string" && PAR_CLE.has(v);
}

/** Lit la colonne JSON : ignore tout ce qui n'est pas « clé connue → booléen » (donnée corrompue ou ancienne). */
export function lireSurcharges(brut: unknown): SurchargesPermissions {
  const out: SurchargesPermissions = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return out;
  for (const [k, v] of Object.entries(brut as Record<string, unknown>)) {
    if (estPermission(k) && typeof v === "boolean") out[k] = v;
  }
  return out;
}

type Titulaire = { role: Role; accesStock?: boolean; permissions?: SurchargesPermissions | null };

/** Les permissions de cet espace sont-elles RÉGLABLES pour ce compte ? */
export function permissionsReglables(user: Pick<Titulaire, "role" | "accesStock">, espace: EspacePermission): boolean {
  if (espace === "rh") return user.role === "MANAGER";
  return user.role === "STOCK" || (user.role === "EMPLOYE" && !!user.accesStock);
}

/** La personne a-t-elle cette permission ? Direction : toujours. Sans écart stocké : le défaut du rôle. */
export function aPermission(user: Titulaire, cle: Permission): boolean {
  if (user.role === "ADMIN") return true;
  const def = definitionPermission(cle);
  if (def.espace === "rh" && user.role === "VIEWER") return true; // lecture, comme avant (les écritures restent fermées par le rôle)
  if (!permissionsReglables(user, def.espace)) return false;
  return user.permissions?.[cle] ?? def.defaut;
}

/** Permissions REFUSÉES à la personne (pour masquer les entrées de menu côté client). */
export function permissionsRefusees(user: Titulaire): Permission[] {
  return DEFINITIONS_PERMISSIONS.filter((d) => !aPermission(user, d.cle)).map((d) => d.cle);
}

/**
 * Réglage coché dans l'écran → écarts à stocker. Ne garde QUE ce qui diffère du défaut : si le défaut
 * d'une permission change plus tard, les personnes qu'on n'a jamais réglées suivent. Vide → null.
 * `espace` limite le calcul aux permissions de cet espace ; les écarts existants de l'autre espace sont conservés.
 */
export function surchargesDepuisCases(
  espace: EspacePermission,
  coches: Partial<Record<Permission, boolean>>,
  existantes: SurchargesPermissions = {},
): SurchargesPermissions | null {
  const out: SurchargesPermissions = {};
  for (const [k, v] of Object.entries(existantes)) {
    const def = PAR_CLE.get(k);
    if (def && def.espace !== espace && typeof v === "boolean") out[k as Permission] = v;
  }
  for (const d of DEFINITIONS_PERMISSIONS) {
    if (d.espace !== espace) continue;
    const v = coches[d.cle];
    if (typeof v === "boolean" && v !== d.defaut) out[d.cle] = v;
  }
  return Object.keys(out).length ? out : null;
}

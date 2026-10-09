// LISTE DES CONGÉS (refonte de l'écran, 2026-10-09) — la partie PURE : lecture des filtres de l'adresse,
// clauses de recherche, sections (À traiter · En cours · À venir · Passés), pastilles d'état et leurs
// compteurs, adresses, libellés de dates. Aucun accès à React, à la base ni à l'horloge : « aujourd'hui »
// est un paramètre (le jour civil de Kinshasa, donné par la page). Rien ici ne décide d'un solde, d'un
// nombre de jours ouvrables ni d'un droit : ce sont les mêmes demandes, seulement mieux rangées.
import type { Prisma } from "@prisma/client";
import { MOIS_FR_COURT } from "@/lib/dates-fr";
import { paramsSansPage } from "@/lib/pagination";

export const STATUTS_CONGE = ["EN_ATTENTE", "APPROUVE", "REFUSE"] as const;
export type StatutConge = (typeof STATUTS_CONGE)[number];
export const LIBELLE_STATUT_CONGE: Record<StatutConge, string> = { APPROUVE: "Approuvé", REFUSE: "Refusé", EN_ATTENTE: "En attente" };

/** Fenêtre de la pastille « À venir » : les congés approuvés qui commencent dans les 30 jours. */
export const JOURS_A_VENIR = 30;
/** Un lot de PDF (ZIP) : au plus ce nombre de demandes — même borne que les fiches de poste. */
export const MAX_DEMANDES_PAR_LOT = 50;
/** Suppression groupée : au plus ce nombre de demandes par lot (refusé en bloc au-delà, côté serveur comme à l'écran). */
export const MAX_SUPPRESSIONS_PAR_LOT = 200;
/** Sections « À traiter », « En cours », « À venir » : lues en entier, jusqu'à cette borne (au-delà, l'écran le dit). */
export const PLAFOND_SECTION = 300;

type Clause = Prisma.LeaveRequestWhereInput;

/** Paramètres d'adresse de l'écran (tous facultatifs, tous du texte). */
export type ParamsConges = {
  statut?: string; type?: string; q?: string; quand?: string; mois?: string; du?: string; au?: string; groupe?: string;
  page?: string; par?: string;
};
const CLES_PARAMS = ["statut", "type", "q", "quand", "mois", "du", "au", "groupe", "page", "par"] as const;

/** Une demande, prête à l'affichage (tout en texte et en nombres : elle passe du serveur au navigateur). */
export type LigneConge = {
  id: string;
  employeeId: string;
  nom: string;
  photoUrl: string | null;
  type: string;
  /** Dates pures AAAA-MM-JJ. */
  debut: string;
  fin: string;
  nbJours: number;
  statut: StatutConge;
  approuveParNom: string | null;
  /** État de la signature d'une demande APPROUVÉE (null : rien à signer — en attente ou refusée). */
  signature: { etat: "A_SIGNER" | "SIGNE" | "A_RESIGNER"; signeLeTexte: string | null } | null;
};

export type Quand = "en-cours" | "a-venir";
export type Regroupement = "etat" | "mois";

export type FiltresConges = {
  /** Statut demandé ; `statutInconnu` quand l'adresse en porte un qui n'existe pas (aucune demande — comportement d'avant). */
  statut: StatutConge | null;
  statutInconnu: boolean;
  type: string | null;
  q: string;
  quand: Quand | null;
  /** Période : un mois (AAAA-MM) OU une plage de dates ; vide si rien de lisible. */
  mois: string | null;
  du: Date | null;
  au: Date | null;
  groupe: Regroupement;
};

/** Une date AAAA-MM-JJ lisible, en date PURE (minuit UTC) ; null sinon (30 février, texte…). */
export function lireJourParametre(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v ? d : null;
}

/** Un mois AAAA-MM lisible (01 à 12), sinon null. */
export function lireMoisParametre(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})$/.exec(v) : null;
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? v as string : null;
}

/** Les bornes (incluses, dates pures) d'un mois AAAA-MM. */
export function bornesDuMois(mois: string): { du: Date; au: Date } {
  const [a, m] = mois.split("-").map(Number);
  return { du: new Date(Date.UTC(a, m - 1, 1)), au: new Date(Date.UTC(a, m, 0)) };
}

/** Lit les paramètres d'adresse. Toute valeur illisible est IGNORÉE (sauf un statut inconnu : aucune demande, comme avant). */
export function lireFiltresConges(sp: ParamsConges): FiltresConges {
  const statutBrut = (sp.statut ?? "").trim();
  const statut = (STATUTS_CONGE as readonly string[]).includes(statutBrut) ? (statutBrut as StatutConge) : null;
  const mois = lireMoisParametre(sp.mois);
  return {
    statut,
    statutInconnu: statutBrut !== "" && statut === null,
    type: (sp.type ?? "").trim() || null,
    q: (sp.q ?? "").trim(),
    quand: sp.quand === "en-cours" || sp.quand === "a-venir" ? sp.quand : null,
    mois,
    // Un mois prime sur une plage : l'écran n'envoie jamais les deux (choisir l'un efface l'autre).
    du: mois ? null : lireJourParametre(sp.du),
    au: mois ? null : lireJourParametre(sp.au),
    groupe: sp.groupe === "mois" ? "mois" : "etat",
  };
}

/** Il y a au moins un filtre (hors regroupement et pagination). */
export function filtreActif(f: FiltresConges): boolean {
  return !!(f.statut || f.statutInconnu || f.type || f.q || f.quand || f.mois || f.du || f.au);
}

// ── Clauses ───────────────────────────────────────────────────────────────────────────────────────

/** Une demande en cours AUJOURD'HUI : approuvée, commencée, pas finie (un congé du 12 au 12 l'est le 12). */
export function clauseEnCours(jourJ: Date): Clause {
  return { statut: "APPROUVE", dateDebut: { lte: jourJ }, dateFin: { gte: jourJ } };
}
/** Une demande À VENIR : approuvée et commençant après aujourd'hui (et, avec `jours`, dans les `jours` suivants). */
export function clauseAVenir(jourJ: Date, jours?: number): Clause {
  const fin = jours === undefined ? undefined : new Date(jourJ.getTime() + jours * 86_400_000);
  return { statut: "APPROUVE", dateDebut: fin ? { gt: jourJ, lte: fin } : { gt: jourJ } };
}

/** Recherche par nom ou matricule du salarié. */
export function clauseRecherche(q: string): Clause | null {
  if (!q) return null;
  return { employee: { OR: [{ nom: { contains: q, mode: "insensitive" } }, { matricule: { contains: q, mode: "insensitive" } }] } };
}

/** Période : la demande CHEVAUCHE [du, au] (un congé commencé avant le 1er du mois et fini dedans y compte). */
export function clausePeriode(f: FiltresConges): Clause | null {
  const b = f.mois ? bornesDuMois(f.mois) : { du: f.du, au: f.au };
  const et: Clause[] = [];
  if (b.au) et.push({ dateDebut: { lte: b.au } });
  if (b.du) et.push({ dateFin: { gte: b.du } });
  return et.length ? { AND: et } : null;
}

/** Le filtre d'ÉTAT (statut + « quand ») de la liste. */
export function clauseEtat(f: FiltresConges, jourJ: Date): Clause | null {
  if (f.statutInconnu) return { id: { in: [] } };
  const et: Clause[] = [];
  if (f.statut) et.push({ statut: f.statut });
  if (f.quand === "en-cours") et.push(clauseEnCours(jourJ));
  if (f.quand === "a-venir") et.push(clauseAVenir(jourJ, JOURS_A_VENIR));
  return et.length ? { AND: et } : null;
}

/**
 * Tout le filtre de la liste. `sans` retire une famille pour les COMPTEURS des pastilles : ceux de la
 * rangée « état » ignorent l'état choisi (sinon cliquer « Refusé » mettrait tous les autres à zéro), ceux de
 * la rangée « type » ignorent le type choisi. Recherche et période, elles, s'appliquent toujours.
 */
export function clauseConges(f: FiltresConges, jourJ: Date, sans: "etat" | "type" | null = null): Clause {
  const et: (Clause | null)[] = [
    clauseRecherche(f.q),
    clausePeriode(f),
    sans === "type" || !f.type ? null : { type: f.type },
    sans === "etat" ? null : clauseEtat(f, jourJ),
  ];
  const retenues = et.filter((c): c is Clause => c !== null);
  return retenues.length ? { AND: retenues } : {};
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────────

export type CleSection = "A_TRAITER" | "EN_COURS" | "A_VENIR" | "PASSES";
export const SECTIONS: { cle: CleSection; titre: string; aide: string }[] = [
  { cle: "A_TRAITER", titre: "À traiter", aide: "demandes en attente de décision" },
  { cle: "EN_COURS", titre: "En cours aujourd'hui", aide: "congés approuvés en cours" },
  { cle: "A_VENIR", titre: "À venir", aide: "congés approuvés pas encore commencés" },
  { cle: "PASSES", titre: "Passés", aide: "congés terminés et demandes refusées" },
];

/** La section d'une demande. Une demande EN ATTENTE est toujours « à traiter », même si ses dates sont passées. */
export function sectionDe(d: { statut: string; dateDebut: Date; dateFin: Date }, jourJ: Date): CleSection {
  if (d.statut === "EN_ATTENTE") return "A_TRAITER";
  if (d.statut !== "APPROUVE") return "PASSES";
  if (d.dateDebut > jourJ) return "A_VENIR";
  if (d.dateFin >= jourJ) return "EN_COURS";
  return "PASSES";
}

/** La même répartition, en clause de lecture (chaque demande tombe dans UNE section, jamais deux). */
export function clauseSection(cle: CleSection, jourJ: Date): Clause {
  switch (cle) {
    case "A_TRAITER": return { statut: "EN_ATTENTE" };
    case "EN_COURS": return clauseEnCours(jourJ);
    case "A_VENIR": return clauseAVenir(jourJ);
    case "PASSES": return { OR: [{ statut: "REFUSE" }, { statut: "APPROUVE", dateFin: { lt: jourJ } }] };
  }
}

/** Ordre de chaque section : l'urgent d'abord (à traiter, en cours, à venir), le plus récent d'abord pour les passés. */
export function triSection(cle: CleSection): Prisma.LeaveRequestOrderByWithRelationInput[] {
  switch (cle) {
    case "A_TRAITER": case "A_VENIR": return [{ dateDebut: "asc" }, { id: "asc" }];
    case "EN_COURS": return [{ dateFin: "asc" }, { id: "asc" }];
    case "PASSES": return [{ dateDebut: "desc" }, { id: "asc" }];
  }
}
/** Ordre du regroupement par mois : par date de début, la plus récente d'abord. */
export const TRI_PAR_MOIS: Prisma.LeaveRequestOrderByWithRelationInput[] = [{ dateDebut: "desc" }, { id: "asc" }];

// ── Pastilles d'état ──────────────────────────────────────────────────────────────────────────────

export type CleEtat = "tous" | "EN_ATTENTE" | "en-cours" | "a-venir" | "APPROUVE" | "REFUSE";
export const ETATS: { cle: CleEtat; libelle: string; change: { statut?: StatutConge; quand?: Quand } }[] = [
  { cle: "tous", libelle: "Tous", change: {} },
  { cle: "EN_ATTENTE", libelle: "En attente", change: { statut: "EN_ATTENTE" } },
  { cle: "en-cours", libelle: "En congé aujourd'hui", change: { statut: "APPROUVE", quand: "en-cours" } },
  { cle: "a-venir", libelle: `À venir (${JOURS_A_VENIR} j)`, change: { statut: "APPROUVE", quand: "a-venir" } },
  { cle: "APPROUVE", libelle: "Approuvés", change: { statut: "APPROUVE" } },
  { cle: "REFUSE", libelle: "Refusés", change: { statut: "REFUSE" } },
];

/** La pastille d'état allumée par les filtres courants. */
export function etatActif(f: FiltresConges): CleEtat {
  if (f.statut === "APPROUVE" && f.quand === "en-cours") return "en-cours";
  if (f.statut === "APPROUVE" && f.quand === "a-venir") return "a-venir";
  if (f.statut) return f.statut;
  return "tous";
}

// ── Adresses ──────────────────────────────────────────────────────────────────────────────────────

/** Adresse de l'écran : les paramètres courants (connus seulement) + `change` (valeur vide ou absente = retirer). La page repart à 1 ; la taille de page est gardée. */
export function hrefConges(courants: ParamsConges, change: Partial<Record<keyof ParamsConges, string | undefined>> = {}): string {
  const connus: Record<string, string> = {};
  for (const cle of CLES_PARAMS) { const v = courants[cle]; if (typeof v === "string" && v !== "") connus[cle] = v; }
  const p = paramsSansPage(connus);
  for (const [cle, v] of Object.entries(change)) { if (v === undefined || v === "") p.delete(cle); else p.set(cle, v); }
  const qs = p.toString();
  return qs ? `/conges?${qs}` : "/conges";
}

// ── Libellés ──────────────────────────────────────────────────────────────────────────────────────

const jourMois = (d: Date) => `${d.getUTCDate()} ${MOIS_FR_COURT[d.getUTCMonth()]}`;
/** « 28 sept. → 20 janv. 2027 » — l'année une seule fois, à la fin ; omise quand les deux dates sont de l'année en cours. Un seul jour : « 12 oct. ». */
export function libellePeriode(debut: Date, fin: Date, anneeCourante: number): string {
  const sansAnnee = debut.getUTCFullYear() === anneeCourante && fin.getUTCFullYear() === anneeCourante;
  const annee = sansAnnee ? "" : ` ${fin.getUTCFullYear()}`;
  if (debut.getTime() === fin.getTime()) return `${jourMois(debut)}${annee}`;
  return `${jourMois(debut)} → ${jourMois(fin)}${annee}`;
}

/** « 98 j », « 0,5 j » (virgule décimale). */
export function libelleJours(n: number): string {
  return `${String(n).replace(".", ",")} j`;
}

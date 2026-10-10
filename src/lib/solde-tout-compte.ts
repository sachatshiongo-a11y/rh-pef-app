import type { PaymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { MOIS_FR } from "@/lib/dates-fr";

// SOLDE DE TOUT COMPTE — ce que le solde REPREND et ce qu'il doit SIGNALER (audit paie du 2026-10-10).
//
// Le solde archivait le prorata et les indemnités sans regarder ce que le salarié devait encore :
// reste d'un prêt, acompte approuvé qu'aucun bulletin n'avait retenu (le salarié quitte la paie,
// plus rien ne le retiendrait). Il ignorait aussi qu'un bulletin du mois déjà validé ou payé couvre
// peut-être les mêmes jours (double paiement). Une seule lecture ici, partagée par l'écran (qui
// montre) et l'action (qui revérifie dans sa transaction) : les deux disent les mêmes chiffres.
//
// Ce que le logiciel NE fait PAS (le signaler seulement) : CNSS et IPR sur le prorata et les
// indemnités (traitement réglementaire à valider), heures supp., transport et primes du mois.

type Db = PrismaClient | Prisma.TransactionClient;

export type ReprisesSolde = {
  prets: { id: string; motif: string | null; resteUSD: number }[];
  reprisePretUSD: number;
  /** Par mois : acomptes approuvés moins ce que le bulletin figé du mois a réellement retenu. */
  acomptes: { mois: number; annee: number; montantUSD: number }[];
  repriseAcomptesUSD: number;
  /** Bulletin du mois de paie en cours, s'il est déjà VALIDÉ ou PAYÉ (risque de double paiement). */
  bulletinFigeDuMois: { mois: number; annee: number; statut: PaymentStatus } | null;
  /** Primes enregistrées pour le mois en cours (non reprises dans le solde : à reporter à la main). */
  primesDuMoisUSD: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function chargerReprisesSolde(db: Db, employeeId: string, periode: { mois: number; annee: number }): Promise<ReprisesSolde> {
  const [prets, acomptes, lignesFigees, primes] = await Promise.all([
    db.pretPersonnel.findMany({
      where: { employeeId, statut: "EN_COURS" },
      orderBy: { dateAccord: "asc" },
      select: { id: true, motif: true, montantUSD: true, retenues: { select: { montantUSD: true } } },
    }),
    db.acompteSalaire.findMany({
      where: { employeeId, statut: "APPROUVE" },
      orderBy: [{ annee: "asc" }, { mois: "asc" }],
      select: { mois: true, annee: true, montantUSD: true },
    }),
    db.payrollLine.findMany({
      where: { employeeId, statutPaiement: { in: ["VALIDE", "PAYE"] } },
      select: { statutPaiement: true, acompteUSD: true, payrollRun: { select: { mois: true, annee: true } } },
    }),
    db.prime.findMany({ where: { employeeId, mois: periode.mois, annee: periode.annee }, select: { montantUSD: true } }),
  ]);
  const cle = (mois: number, annee: number) => `${annee}-${mois}`;
  const figees = new Map(lignesFigees.map((l) => [cle(l.payrollRun.mois, l.payrollRun.annee), l]));
  const restes = prets
    .map((p) => ({ id: p.id, motif: p.motif, resteUSD: r2(Number(p.montantUSD) - p.retenues.reduce((s, r) => s + Number(r.montantUSD), 0)) }))
    .filter((p) => p.resteUSD > 0);
  // Un acompte approuvé est retenu par le bulletin FIGÉ de son mois, à hauteur de ce que ce bulletin
  // a réellement déduit (`acompteUSD`) : un acompte approuvé APRÈS la validation (défaut corrigé le
  // même jour, données antérieures possibles) n'a été retenu nulle part. Le reste, le solde le reprend.
  const parMois = new Map<string, { mois: number; annee: number; montantUSD: number }>();
  for (const a of acomptes) {
    const k = cle(a.mois, a.annee);
    const m = parMois.get(k) ?? parMois.set(k, { mois: a.mois, annee: a.annee, montantUSD: 0 }).get(k)!;
    m.montantUSD += Number(a.montantUSD);
  }
  const nonRetenus = [...parMois.entries()]
    .map(([k, m]) => ({ ...m, montantUSD: r2(Math.max(0, m.montantUSD - Number(figees.get(k)?.acompteUSD ?? 0))) }))
    .filter((m) => m.montantUSD > 0);
  const statutDuMois = figees.get(cle(periode.mois, periode.annee))?.statutPaiement;
  return {
    prets: restes,
    reprisePretUSD: r2(restes.reduce((s, p) => s + p.resteUSD, 0)),
    acomptes: nonRetenus,
    repriseAcomptesUSD: r2(nonRetenus.reduce((s, a) => s + a.montantUSD, 0)),
    bulletinFigeDuMois: statutDuMois ? { ...periode, statut: statutDuMois } : null,
    primesDuMoisUSD: r2(primes.reduce((s, p) => s + Number(p.montantUSD), 0)),
  };
}

/** Avertissement « double paiement » : le bulletin du mois est déjà validé ou payé. */
export function messageBulletinDuMoisFige(b: { mois: number; annee: number; statut: PaymentStatus }): string {
  return `Le bulletin de ${MOIS_FR[b.mois - 1]} ${b.annee} est déjà ${b.statut === "PAYE" ? "payé" : "validé"} : le salaire au prorata de ce mois ferait double emploi avec lui (risque de double paiement). Ajustez les jours de présence à ce que le bulletin ne couvre pas.`;
}

/** Ce que le solde ne traite pas : toujours affiché, jamais présenté comme acquis. */
export const AVERTISSEMENT_SOLDE_REGLEMENTAIRE =
  "Aucune CNSS ni IPR n'est retenue sur ce solde (prorata, congés, préavis, indemnités) : traitement social et fiscal à faire valider par un comptable avant le versement. Heures supplémentaires, transport et primes du mois ne sont pas repris : à porter dans « Autres indemnités » si la Direction le décide.";

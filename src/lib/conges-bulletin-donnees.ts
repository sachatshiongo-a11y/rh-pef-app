import "server-only";
import type { Prisma } from "@prisma/client";
import { congesDuBulletin, type CongeBulletin, type TypeCongeInfo } from "@/lib/conges-bulletin";

type Db = Prisma.TransactionClient;

/** Types de congé (nom, taux, déduit du solde) — de quoi ranger chaque congé sous sa rubrique. */
export async function chargerTypesCongeBulletin(db: Db): Promise<TypeCongeInfo[]> {
  return db.typeConge.findMany({ select: { nom: true, tauxPct: true, compteDansSolde: true } });
}

/**
 * Les congés APPROUVÉS d'un salarié pour le bulletin d'un mois, rognés au mois, jours ouvrables
 * décomptés (fériés d'aujourd'hui). Sert à FIGER la période dans l'instantané de validation
 * (`VersionBulletin.snapshot.conges`) : la version remise garde ainsi la période de congé.
 */
export async function figerCongesDuMois(db: Db, employeeId: string, mois: number, annee: number): Promise<CongeBulletin[]> {
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const [conges, feries, types] = await Promise.all([
    db.leaveRequest.findMany({
      where: { employeeId, statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
      orderBy: { dateDebut: "asc" },
    }),
    db.jourFerie.findMany({ select: { date: true } }),
    chargerTypesCongeBulletin(db),
  ]);
  return congesDuBulletin(
    conges.map((c) => ({ dateDebut: new Date(c.dateDebut), dateFin: new Date(c.dateFin), type: c.type })),
    feries.map((f) => new Date(f.date).toISOString().slice(0, 10)),
    mois,
    annee,
    types,
  );
}

/**
 * Relit les congés figés d'un instantané (JSON : dates en ISO). `null` = instantané d'avant ce
 * champ : rien n'est reconstitué, le bulletin remis ne les imprime pas (jamais de période inventée).
 */
export function congesDeLInstantane(snapshot: unknown): CongeBulletin[] | null {
  const brut = (snapshot as { conges?: unknown } | null)?.conges;
  if (!Array.isArray(brut)) return null;
  return brut.map((c: { dateDebut: string; dateFin: string; type?: string; categorie?: CongeBulletin["categorie"]; jours?: number; rogne?: boolean }) => ({
    dateDebut: new Date(c.dateDebut),
    dateFin: new Date(c.dateFin),
    type: c.type,
    categorie: c.categorie,
    jours: c.jours,
    rogne: c.rogne,
  }));
}

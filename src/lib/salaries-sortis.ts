import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

// SALARIÉS SORTIS PENDANT LA PÉRIODE (audit RH 2026-10-10). La fin de contrat désactive la fiche
// (`actif=false`) : la grille Présences et l'import IVMS ne lisaient que les fiches actives, et le
// salarié sorti le 12 disparaissait de son propre mois — ses onze jours de travail ne se saisissaient
// plus, et ses pointages tombaient en « non apparié ». Il reste désormais visible, pour ses SEULS
// jours actifs (jusqu'à la date de fin de contrat, incluse).
//
// La date de sortie est celle de la DERNIÈRE fin de contrat enregistrée (`FinContrat.dateFin`). Une
// fiche désactivée sans fin de contrat n'a pas de date de sortie connue : elle n'entre dans la grille
// que si elle a déjà des données dans le mois (pour qu'elles se voient), sans borne de jours.

type Db = PrismaClient | Prisma.TransactionClient;
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** Date de sortie (AAAA-MM-JJ) des fiches INACTIVES parmi `employeeIds` qui ont une fin de contrat.
 *  (`FinContrat` n'a pas de relation Prisma vers `Employee` : deux lectures.) */
export async function datesDeSortie(db: Db, employeeIds: string[]): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();
  const [inactifs, fins] = await Promise.all([
    db.employee.findMany({ where: { id: { in: employeeIds }, actif: false }, select: { id: true } }),
    db.finContrat.findMany({
      where: { employeeId: { in: employeeIds } },
      orderBy: [{ dateFin: "asc" }, { createdAt: "asc" }],
      select: { employeeId: true, dateFin: true },
    }),
  ]);
  const estInactif = new Set(inactifs.map((e) => e.id));
  const m = new Map<string, string>();
  for (const f of fins) if (estInactif.has(f.employeeId)) m.set(f.employeeId, iso(f.dateFin)); // la dernière l'emporte
  return m;
}

/** Vrai si le jour tombe APRÈS la sortie du salarié (jour non actif). */
export const apresSortie = (sorties: Map<string, string>, employeeId: string, jour: string) => {
  const s = sorties.get(employeeId);
  return s !== undefined && jour > s;
};

/**
 * Identifiants des fiches INACTIVES à garder sur une période [debut, fin] : sorties pendant ou après
 * le début de la période (dernière fin de contrat ≥ début), ou désactivées sans fin de contrat mais
 * avec des présences ou des heures dans la période.
 */
export async function inactifsDeLaPeriode(db: Db, debut: Date, fin: Date): Promise<string[]> {
  const inactifs = await db.employee.findMany({ where: { actif: false }, select: { id: true } });
  if (inactifs.length === 0) return [];
  const ids = inactifs.map((e) => e.id);
  const [sorties, avecDonnees] = await Promise.all([
    datesDeSortie(db, ids),
    db.employee.findMany({
      where: {
        id: { in: ids },
        OR: [
          { attendances: { some: { date: { gte: debut, lte: fin } } } },
          { overtimeEntries: { some: { date: { gte: debut, lte: fin } } } },
        ],
      },
      select: { id: true },
    }),
  ]);
  const debutIso = iso(debut);
  const garder = new Set<string>();
  for (const [id, sortie] of sorties) if (sortie >= debutIso) garder.add(id);
  for (const e of avecDonnees) if (!sorties.has(e.id)) garder.add(e.id);
  return [...garder];
}

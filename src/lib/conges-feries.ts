import "server-only";

import type { Prisma } from "@prisma/client";
import { calculerJoursOuvrables } from "@/lib/payroll";
import { chargerMoisFiges, jourFige } from "@/lib/conges-presences";
import { journaliser } from "@/lib/audit";

// FÉRIÉ AJOUTÉ OU RETIRÉ APRÈS COUP (audit RH 2026-10-10). Un férié n'est jamais un jour de congé :
// le décompte (`calculerJoursOuvrables`) l'exclut et `poserCodesConge` ne pose rien dessus. Un férié
// ajouté APRÈS l'approbation laissait le congé décompté de ce jour (solde amputé à tort) et son « C »
// sur la grille ; un férié retiré laissait un jour non décompté et sans code. Ici, dans la
// transaction de l'ajout ou du retrait :
//  - le nombre de jours de chaque demande EN ATTENTE ou APPROUVÉE qui couvre la date est recalculé
//    (même règle que la création), et le changement est journalisé ;
//  - pour une demande APPROUVÉE, le code du jour suit : ajout → son C/S est retiré ; retrait → le
//    code (C, ou S pour un type à 0 %) est reposé, heures du jour retirées. Jamais dans un mois dont
//    la paie est validée (même garde que le rattrapage) : le jour est alors laissé tel quel, et dit.

const jjmmaaaa = (d: Date) => {
  const iso = d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

export type RecalageFerie = { demandes: number; codes: number; figes: number; travailles?: number };

/** À appeler dans la transaction qui vient d'ajouter (ou de retirer) le férié `date` (date pure). */
export async function recalerCongesSurFerie(
  tx: Prisma.TransactionClient,
  date: Date,
  sens: "ajout" | "retrait",
  userId: string,
): Promise<RecalageFerie> {
  const demandes = await tx.leaveRequest.findMany({
    where: { statut: { in: ["EN_ATTENTE", "APPROUVE"] }, dateDebut: { lte: date }, dateFin: { gte: date } },
    select: { id: true, employeeId: true, type: true, dateDebut: true, dateFin: true, nbJours: true, statut: true },
  });
  if (demandes.length === 0) return { demandes: 0, codes: 0, figes: 0 };

  const debut = demandes.reduce((m, d) => (d.dateDebut < m ? d.dateDebut : m), demandes[0].dateDebut);
  const fin = demandes.reduce((m, d) => (d.dateFin > m ? d.dateFin : m), demandes[0].dateFin);
  // Les fériés tels qu'ils sont APRÈS l'écriture (la transaction voit son propre ajout ou retrait).
  const [feries, moisFiges, types] = await Promise.all([
    tx.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } }, select: { date: true } }),
    chargerMoisFiges(tx),
    tx.typeConge.findMany({ select: { nom: true, tauxPct: true } }),
  ]);
  const tauxParType = new Map(types.map((t) => [t.nom, t.tauxPct]));
  const fige = jourFige(date, moisFiges);
  const dimanche = date.getUTCDay() === 0;

  let nbDemandes = 0;
  let codes = 0;
  let figes = 0;
  let travailles = 0;
  for (const d of demandes) {
    const avant = Number(d.nbJours);
    const apres = calculerJoursOuvrables(new Date(d.dateDebut), new Date(d.dateFin), feries.map((f) => f.date));
    if (apres !== avant) {
      await tx.leaveRequest.update({ where: { id: d.id }, data: { nbJours: apres } });
      await journaliser(tx, {
        entite: "LeaveRequest",
        entiteId: d.id,
        champ: "nbJours",
        ancienneValeur: String(avant),
        nouvelleValeur: `${apres} (férié du ${jjmmaaaa(date)} ${sens === "ajout" ? "ajouté" : "retiré"})`,
        userId,
      });
      nbDemandes++;
    }
    if (d.statut !== "APPROUVE" || dimanche) continue;
    if (fige) { figes++; continue; }
    if (sens === "ajout") {
      const { count } = await tx.attendance.deleteMany({ where: { employeeId: d.employeeId, date, code: { in: ["C", "S"] } } });
      codes += count;
    } else {
      const code = tauxParType.get(d.type) === 0 ? "S" : "C";
      // Un jour que le salarié a TRAVAILLÉ (présence P ou heures saisies) n'est jamais écrasé par un
      // retrait de férié : ses heures seraient perdues. Il est laissé tel quel, et dit.
      const [existant, heures] = await Promise.all([
        tx.attendance.findUnique({ where: { employeeId_date: { employeeId: d.employeeId, date } }, select: { code: true } }),
        tx.overtimeEntry.count({ where: { employeeId: d.employeeId, date } }),
      ]);
      if (existant?.code === "P" || heures > 0) { travailles++; continue; }
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: d.employeeId, date } },
        update: { code, maladieJustifiee: false }, // un M justifié recouvert par un congé perd son « justifié »
        create: { employeeId: d.employeeId, date, code },
      });
      await tx.overtimeEntry.deleteMany({ where: { employeeId: d.employeeId, date } });
      codes++;
    }
  }
  return { demandes: nbDemandes, codes, figes, travailles };
}

/** Phrase de compte rendu (vide si rien n'a bougé). */
export function resumeRecalage(r: RecalageFerie, sens: "ajout" | "retrait"): string {
  const parts: string[] = [];
  if (r.demandes > 0) parts.push(`${r.demandes} demande(s) de congé recalculée(s)`);
  if (r.codes > 0) parts.push(sens === "ajout" ? `${r.codes} code(s) de congé retiré(s) de la grille Présences` : `${r.codes} code(s) de congé reposé(s) sur la grille Présences`);
  if (r.figes > 0) parts.push(`${r.figes} jour(s) laissé(s) tels quels : paie du mois déjà validée`);
  if ((r.travailles ?? 0) > 0) parts.push(`${r.travailles} jour(s) laissé(s) tels quels : le salarié y a travaillé (présence ou heures saisies)`);
  return parts.join(" ; ");
}

import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { BulletinDocument } from "@/lib/pdf/bulletin";
import type { Devise } from "@/lib/pdf/theme";
import { chargerEntreprise } from "@/lib/entreprise";

/**
 * Génère le PDF d'un bulletin (buffer + nom de fichier) à partir de sa ligne de paie.
 * Partagé entre la route Direction (/paie/bulletin) et l'espace salarié (/espace/bulletin).
 * Renvoie null si la ligne n'existe pas.
 */
export async function genererBulletinPdf(
  ligneId: string,
  devise: Devise
): Promise<{ buffer: Buffer; nomFichier: string; employeeId: string } | null> {
  const ligne = await prisma.payrollLine.findUnique({
    where: { id: ligneId },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne) return null;

  const debutMois = new Date(Date.UTC(ligne.payrollRun.annee, ligne.payrollRun.mois - 1, 1));
  const finMois = new Date(Date.UTC(ligne.payrollRun.annee, ligne.payrollRun.mois, 0));
  const [congesApprouves, attendances, primes, feriesRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { employeeId: ligne.employeeId, statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    }),
    prisma.attendance.findMany({ where: { employeeId: ligne.employeeId, date: { gte: debutMois, lte: finMois } } }),
    prisma.prime.findMany({
      where: { employeeId: ligne.employeeId, mois: ligne.payrollRun.mois, annee: ligne.payrollRun.annee },
      orderBy: { createdAt: "asc" },
    }),
    prisma.jourFerie.findMany({ select: { date: true } }),
  ]);

  const codesParJour: Record<number, string> = {};
  for (const a of attendances) codesParJour[new Date(a.date).getUTCDate()] = a.code;
  const feries = feriesRows.map((f) => new Date(f.date).toISOString().slice(0, 10));

  const ent = await chargerEntreprise();
  const buffer = await renderToBuffer(
    BulletinDocument({
      employee: ligne.employee,
      ligne,
      run: ligne.payrollRun,
      devise,
      congesPeriode: congesApprouves.map((c) => ({ dateDebut: new Date(c.dateDebut), dateFin: new Date(c.dateFin) })),
      primes: primes.map((p) => ({ nom: p.nom, montantUSD: Number(p.montantUSD) })),
      codesParJour,
      feries,
      entreprise: ent.entreprise,
      logo: ent.logo,
    })
  );

  const nomFichier = `Bulletin_${ligne.employee.matricule}_${ligne.payrollRun.annee}-${String(ligne.payrollRun.mois).padStart(2, "0")}_${devise}.pdf`;
  return { buffer, nomFichier, employeeId: ligne.employeeId };
}

import "server-only";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { BulletinDocument } from "@/lib/pdf/bulletin";
import type { Devise } from "@/lib/pdf/theme";
import { chargerEntreprise } from "@/lib/entreprise";
import { chargerParametresPaie } from "@/lib/config";
import { signatureImprimable } from "@/lib/signature";

/**
 * Génère le PDF d'un bulletin (buffer + nom de fichier) à partir de sa ligne de paie.
 * Partagé entre la route Direction (/paie/bulletin) et l'espace salarié (/espace/bulletin).
 * Renvoie null si la ligne n'existe pas.
 *
 * `version` : un bulletin DÉJÀ REMIS (VersionBulletin, figé à la validation), relu depuis son
 * instantané — ligne, fiche et paie telles qu'elles étaient ce jour-là. C'est ainsi qu'un bulletin
 * remis reste consultable quand la ligne a été rouverte, recalculée ou réinitialisée depuis
 * (décision de Sacha du 2026-10-01 : un bulletin émis ne disparaît jamais).
 */
export async function genererBulletinPdf(
  ligneId: string,
  devise: Devise,
  opts: { version?: number } = {},
): Promise<{ buffer: Buffer; nomFichier: string; employeeId: string } | null> {
  const vivante = await prisma.payrollLine.findUnique({
    where: { id: ligneId },
    include: { employee: true, payrollRun: true },
  });
  if (!vivante) return null;
  let ligne = vivante;
  let archive: { genereLe: Date; suivante: Date | null } | null = null;
  if (opts.version !== undefined) {
    const versions = await prisma.versionBulletin.findMany({ where: { payrollLineId: ligneId }, orderBy: { numeroVersion: "asc" } });
    const i = versions.findIndex((v) => v.numeroVersion === opts.version);
    if (i < 0) return null;
    const s = versions[i].snapshot as unknown as { ligne: typeof vivante; employe: typeof vivante.employee; run: typeof vivante.payrollRun };
    // Instantané JSON : montants en texte, dates en ISO — le document les relit par Number()/new Date().
    ligne = { ...s.ligne, employee: s.employe, payrollRun: s.run };
    archive = { genereLe: versions[i].genereLe, suivante: versions[i + 1]?.genereLe ?? null };
  }

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

  // La signature du salarié est chargée ICI, dans le buffer partagé : la route Direction
  // (/paie/bulletin) et celle de l'espace salarié (/espace/bulletin) passent toutes deux par lui,
  // donc le même bulletin montre exactement la même chose des deux côtés.
  const [ent, parametres, signatureSalarie] = await Promise.all([
    chargerEntreprise(),
    chargerParametresPaie(),
    signatureDuBulletin(ligne.id, archive),
  ]);
  const buffer = await renderPdfBuffer(
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
      params: parametres,
      signatureSalarie,
    })
  );

  const nomFichier = `Bulletin_${ligne.employee.matricule}_${ligne.payrollRun.annee}-${String(ligne.payrollRun.mois).padStart(2, "0")}${opts.version !== undefined ? `_remis-v${opts.version}` : ""}_${devise}.pdf`;
  return { buffer, nomFichier, employeeId: ligne.employeeId };
}

/**
 * Signature imprimée : celle du bulletin vivant ; pour un bulletin REMIS (archive), seulement si la
 * signature a été donnée pendant que cette version était en vigueur (entre sa génération et la
 * suivante) — jamais la signature d'une autre version.
 */
async function signatureDuBulletin(ligneId: string, archive: { genereLe: Date; suivante: Date | null } | null) {
  if (!archive) return signatureImprimable(prisma, "BULLETIN", ligneId);
  const sig = await prisma.signatureElectronique.findFirst({ where: { cible: "BULLETIN", cibleId: ligneId }, select: { signeLe: true } });
  if (!sig || sig.signeLe < archive.genereLe || (archive.suivante && sig.signeLe >= archive.suivante)) return undefined;
  return signatureImprimable(prisma, "BULLETIN", ligneId);
}

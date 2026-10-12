import "server-only";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { BulletinDocument } from "@/lib/pdf/bulletin";
import type { Devise } from "@/lib/pdf/theme";
import { chargerEntreprise } from "@/lib/entreprise";
import { chargerParametresPaie } from "@/lib/config";
import { chargerSignatures, mentionSignature, signatureImprimable, type SignatureImprimable } from "@/lib/signature";
import { congesDuBulletin, type CongeBulletin } from "@/lib/conges-bulletin";
import { chargerTypesCongeBulletin, congesDeLInstantane } from "@/lib/conges-bulletin-donnees";
import { fusionnerFicheFigee } from "@/lib/bulletin-fiche-figee";

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
  // Ligne VALIDÉE ou PAYÉE réimprimée : ce que la fiche salarié disait au moment de la validation
  // (salaire de base, personnes à charge, banque, catégorie…) et les congés figés de ce jour-là, pas
  // ceux d'aujourd'hui. Aucune version (ligne validée avant l'existence des instantanés) : la fiche
  // du jour, faute de mieux — jamais de valeur inventée.
  let congesFiges: CongeBulletin[] | null = null;
  if (opts.version === undefined && vivante.statutPaiement !== "PAS_VALIDE") {
    const derniere = await prisma.versionBulletin.findFirst({ where: { payrollLineId: ligneId }, orderBy: { numeroVersion: "desc" } });
    if (derniere) {
      const s = derniere.snapshot as unknown as { employe?: Record<string, unknown> };
      ligne = { ...vivante, employee: fusionnerFicheFigee(vivante.employee, s.employe) };
      congesFiges = congesDeLInstantane(derniere.snapshot);
    }
  }
  let archive: { version: number; genereLe: Date; suivante: Date | null } | null = null;
  if (opts.version !== undefined) {
    const versions = await prisma.versionBulletin.findMany({ where: { payrollLineId: ligneId }, orderBy: { numeroVersion: "asc" } });
    const i = versions.findIndex((v) => v.numeroVersion === opts.version);
    if (i < 0) return null;
    const s = versions[i].snapshot as unknown as { ligne: typeof vivante; employe: typeof vivante.employee; run: typeof vivante.payrollRun };
    // Instantané JSON : montants en texte, dates en ISO — le document les relit par Number()/new Date().
    ligne = { ...s.ligne, employee: s.employe, payrollRun: s.run };
    congesFiges = congesDeLInstantane(versions[i].snapshot);
    archive = { version: versions[i].numeroVersion, genereLe: versions[i].genereLe, suivante: versions[i + 1]?.genereLe ?? null };
  }

  const debutMois = new Date(Date.UTC(ligne.payrollRun.annee, ligne.payrollRun.mois - 1, 1));
  const finMois = new Date(Date.UTC(ligne.payrollRun.annee, ligne.payrollRun.mois, 0));
  const [congesApprouves, attendances, primes, feriesRows, typesConge] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { employeeId: ligne.employeeId, statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    }),
    prisma.attendance.findMany({ where: { employeeId: ligne.employeeId, date: { gte: debutMois, lte: finMois } } }),
    prisma.prime.findMany({
      where: { employeeId: ligne.employeeId, mois: ligne.payrollRun.mois, annee: ligne.payrollRun.annee },
      orderBy: { createdAt: "asc" },
    }),
    prisma.jourFerie.findMany({ select: { date: true } }),
    chargerTypesCongeBulletin(prisma),
  ]);

  const codesParJour: Record<number, string> = {};
  for (const a of attendances) codesParJour[new Date(a.date).getUTCDate()] = a.code;
  const feries = feriesRows.map((f) => new Date(f.date).toISOString().slice(0, 10));
  // Congés imprimés : figés à la validation quand l'instantané les porte ; sinon (ligne vivante, ou
  // archive d'avant ce champ) les congés approuvés du mois pour une ligne vivante, RIEN pour une
  // archive ancienne (aucune période inventée).
  const congesPeriode: CongeBulletin[] = congesFiges
    ? congesFiges
    : archive
      ? []
      : congesDuBulletin(
          congesApprouves.map((c) => ({ dateDebut: new Date(c.dateDebut), dateFin: new Date(c.dateFin), type: c.type })),
          feries,
          ligne.payrollRun.mois,
          ligne.payrollRun.annee,
          typesConge,
        );

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
      // Archive : seuls les montants de l'instantané font foi — rien du détail VIVANT (présences,
      // primes saisies depuis) qui contredirait le bulletin remis ; les congés sont ceux figés à la validation.
      congesPeriode,
      provisoire: !archive && vivante.statutPaiement === "PAS_VALIDE",
      primes: archive ? [] : primes.map((p) => ({ nom: p.nom, montantUSD: Number(p.montantUSD) })),
      codesParJour: archive ? {} : codesParJour,
      feries: archive ? [] : feries,
      entreprise: ent.entreprise,
      logo: ent.logo,
      params: parametres,
      signatureSalarie,
      archive: archive ? { version: archive.version, remisLe: archive.genereLe } : undefined,
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
async function signatureDuBulletin(ligneId: string, archive: { genereLe: Date; suivante: Date | null } | null): Promise<SignatureImprimable | undefined> {
  if (!archive) return signatureImprimable(prisma, "BULLETIN", ligneId);
  const v = (await chargerSignatures(prisma, "BULLETIN", [ligneId])).get(ligneId);
  if (!v || v.signeLe < archive.genereLe || (archive.suivante && v.signeLe >= archive.suivante)) return undefined;
  if (!v.obsolete) return signatureImprimable(prisma, "BULLETIN", ligneId); // toujours à jour : tracé compris
  // Signée sur CETTE version : elle était valable pour elle, même si la ligne a changé depuis
  // (jamais « à resigner » sur l'archive). La mention seule — décision du 2026-10-01 : le tracé
  // d'une signature devenue obsolète n'est pas réimprimé.
  return { image: null, mention: mentionSignature({ ...v, obsolete: false }) };
}

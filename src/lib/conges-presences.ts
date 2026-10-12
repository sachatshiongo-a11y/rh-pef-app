import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Synchronisation congé → grille Présences : à l'APPROBATION d'un congé, les jours ouvrables
// couverts (jamais dimanche ni férié — même règle que le décompte) reçoivent automatiquement le
// code « C » (ou « S » si le type est à 0 % = sans solde) ; les heures pré-remplies de ces jours
// sont retirées (pas d'heures pendant un congé). Au refus/suppression, ces codes sont retirés.
//
// MOIS FIGÉ (audit RH 2026-10-10) : la MÊME garde que le rattrapage vaut désormais pour la pose et
// le retrait — un jour dont le mois a sa paie VALIDÉE n'est jamais réécrit (la paie l'a payé tel
// qu'il était). Le nombre de jours laissés intacts est rendu à l'appelant, qui le dit.

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Client = Pick<Prisma.TransactionClient, "attendance" | "overtimeEntry" | "payrollRun">;

/** Clés `AAAA-M` des mois dont la paie est VALIDÉE (figés). */
export async function chargerMoisFiges(client: Pick<Prisma.TransactionClient, "payrollRun"> = prisma): Promise<Set<string>> {
  const runs = await client.payrollRun.findMany({ where: { statut: "VALIDE" }, select: { mois: true, annee: true } });
  return new Set(runs.map((r) => `${r.annee}-${r.mois}`));
}
/** Vrai si le jour (date pure) tombe dans un mois figé. */
export const jourFige = (d: Date, moisFiges: Set<string>) => moisFiges.has(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);

/** Phrase lisible pour des jours laissés intacts parce que leur mois est figé (vide si aucun). */
export function noteMoisFige(n: number, verbe: "posé" | "retiré"): string {
  if (n <= 0) return "";
  return `${n} jour(s) dans un mois dont la paie est validée : code de congé non ${verbe} sur la grille Présences (mois figé).`;
}

/** Données rechargées une seule fois par appelant en boucle (rattrapage, lots) — évite le
 * N+1 (jourFerie.findMany / typeConge.findUnique) répété à chaque congé traité. */
export type PreloadConges = {
  feriesIso: Set<string>;
  tauxParType: Map<string, number | null>; // nom du type de congé -> tauxPct
  moisFiges: Set<string>;
};

/** Précharge la liste des jours fériés, la table des types de congé (nom -> tauxPct) et les mois figés. */
export async function chargerPreloadConges(): Promise<PreloadConges> {
  const [feries, types, moisFiges] = await Promise.all([
    prisma.jourFerie.findMany({ select: { date: true } }),
    prisma.typeConge.findMany({ select: { nom: true, tauxPct: true } }),
    chargerMoisFiges(),
  ]);
  return {
    feriesIso: new Set(feries.map((f) => iso(new Date(f.date)))),
    tauxParType: new Map(types.map((t) => [t.nom, t.tauxPct])),
    moisFiges,
  };
}

/** Jours ouvrables (ni dimanche, ni férié) d'une période, bornes incluses. */
export function joursOuvrablesDuConge(dateDebut: Date, dateFin: Date, feriesIso: Set<string>): Date[] {
  const jours: Date[] = [];
  for (let d = new Date(dateDebut); d <= dateFin; d = new Date(d.getTime() + 86_400_000)) {
    if (d.getUTCDay() === 0 || feriesIso.has(iso(d))) continue;
    jours.push(new Date(d));
  }
  return jours;
}

/** Pose les codes de congé sur la grille Présences pour un congé approuvé. `preload` est optionnel
 * (chargé à la volée si absent, pour l'appel unitaire) — les appelants en boucle (lots, rattrapage)
 * doivent le précharger une fois et le transmettre. */
export async function poserCodesConge(
  employeeId: string,
  dateDebut: Date,
  dateFin: Date,
  typeNom: string,
  preload?: PreloadConges,
  client: Client = prisma,
): Promise<{ code: "C" | "S"; poses: number; figes: number }> {
  const p = preload ?? (await chargerPreloadConges());
  const tauxPct = p.tauxParType.get(typeNom);
  const code: "C" | "S" = tauxPct === 0 ? "S" : "C";
  const tous = joursOuvrablesDuConge(new Date(dateDebut), new Date(dateFin), p.feriesIso);
  const jours = tous.filter((d) => !jourFige(d, p.moisFiges));
  for (const d of jours) {
    await client.attendance.upsert({
      where: { employeeId_date: { employeeId, date: d } },
      // Un jour M justifié recouvert par un congé perd son « justifié » : s'il redevient M plus tard, il repart non justifié.
      update: { code, maladieJustifiee: false },
      create: { employeeId, date: d, code },
    });
  }
  // Pas d'heures travaillées pendant un congé : retire les heures pré-remplies de la plage.
  if (jours.length > 0) {
    await client.overtimeEntry.deleteMany({ where: { employeeId, date: { in: jours } } });
  }
  return { code, poses: jours.length, figes: tous.length - jours.length };
}

/**
 * RATTRAPAGE : pose les codes manquants de TOUS les congés approuvés — couvre les congés validés
 * AVANT l'existence de la synchro à l'approbation (ils n'avaient jamais reçu leurs codes).
 * Idempotent et prudent : ne touche jamais un code déjà présent (createMany + skipDuplicates),
 * et n'écrit jamais dans un mois dont la paie est VALIDÉE (figée). Appelé au chargement de la
 * grille Présences ; au régime de croisière il ne fait plus rien.
 */
export async function rattraperCodesConges(): Promise<number> {
  const conges = await prisma.leaveRequest.findMany({ where: { statut: "APPROUVE" } });
  if (conges.length === 0) return 0;

  const preload = await chargerPreloadConges();
  const moisFiges = preload.moisFiges;

  let total = 0;
  for (const c of conges) {
    const tauxPct = preload.tauxParType.get(c.type);
    const code: "C" | "S" = tauxPct === 0 ? "S" : "C";
    const jours = joursOuvrablesDuConge(new Date(c.dateDebut), new Date(c.dateFin), preload.feriesIso);
    const eligibles = jours.filter((d) => !jourFige(d, moisFiges));
    if (eligibles.length === 0) continue;

    const existants = await prisma.attendance.findMany({
      where: { employeeId: c.employeeId, date: { in: eligibles } },
      select: { date: true },
    });
    const deja = new Set(existants.map((a) => iso(new Date(a.date))));
    const manquants = eligibles.filter((d) => !deja.has(iso(d)));
    if (manquants.length === 0) continue;

    await prisma.attendance.createMany({
      data: manquants.map((d) => ({ employeeId: c.employeeId, date: d, code })),
      skipDuplicates: true,
    });
    // Pas d'heures pendant un congé : retire les heures pré-remplies des jours rattrapés.
    await prisma.overtimeEntry.deleteMany({ where: { employeeId: c.employeeId, date: { in: manquants } } });
    total += manquants.length;
  }
  return total;
}

/** Retire les codes C/S de la plage (refus, suppression ou annulation d'un congé). Ne touche pas aux autres codes,
 *  ni aux jours d'un mois dont la paie est validée (`figes` : combien sont restés).
 *  `client` : la transaction de l'appelant, pour que la suppression d'une demande et le retrait de ses codes réussissent ou échouent ensemble. */
export async function retirerCodesConge(
  employeeId: string,
  dateDebut: Date,
  dateFin: Date,
  client: Pick<Prisma.TransactionClient, "attendance" | "payrollRun"> = prisma,
): Promise<{ retires: number; figes: number }> {
  const moisFiges = await chargerMoisFiges(client);
  const plage = { employeeId, code: { in: ["C", "S"] as ("C" | "S")[] }, date: { gte: new Date(dateDebut), lte: new Date(dateFin) } };
  const codes = await client.attendance.findMany({ where: plage, select: { date: true } });
  const aRetirer = codes.map((c) => new Date(c.date)).filter((d) => !jourFige(d, moisFiges));
  if (aRetirer.length === 0) return { retires: 0, figes: codes.length };
  const { count } = await client.attendance.deleteMany({ where: { ...plage, date: { in: aRetirer } } });
  return { retires: count, figes: codes.length - aRetirer.length };
}

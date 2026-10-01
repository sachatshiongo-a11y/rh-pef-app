"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole, type CurrentUser } from "@/lib/auth";
import { joursEnConge, joursDeReposSelonModele } from "@/lib/conges-couverture";
import { journaliser } from "@/lib/audit";

/**
 * Écrit (ou vide : 0 / vide) les heures d'un jour. Vider reste une correction de grille ouverte au
 * responsable (arbitrage du 2026-10-01) ; comme ces heures font la paie, chaque changement est
 * JOURNALISÉ avant → après (même règle que les ventes du jour) — une case vidée se retrouve au journal.
 */
async function appliquerHeures(employeeId: string, date: string, heures: string, userId: string) {
  const valeur = Number(heures);
  const jour = new Date(date);
  const avant = await prisma.overtimeEntry.findUnique({ where: { employeeId_date: { employeeId, date: jour } }, select: { heuresTravaillees: true } });
  const ancienne = avant ? Number(avant.heuresTravaillees) : null;

  let nouvelle: number | null;
  if (!heures || Number.isNaN(valeur) || valeur === 0) {
    if (ancienne === null) return; // rien à vider : ni écriture, ni journal
    await prisma.overtimeEntry.deleteMany({ where: { employeeId, date: jour } });
    nouvelle = null;
  } else {
    if (ancienne === valeur) return; // rien ne change
    await prisma.overtimeEntry.upsert({
      where: { employeeId_date: { employeeId, date: jour } },
      update: { heuresTravaillees: valeur },
      create: { employeeId, date: jour, heuresTravaillees: valeur },
    });
    nouvelle = valeur;
  }
  await journaliser(prisma, {
    entite: "OvertimeEntry", entiteId: `${employeeId}_${date}`, champ: "heuresTravaillees",
    ancienneValeur: ancienne === null ? null : String(ancienne), nouvelleValeur: nouvelle === null ? null : String(nouvelle), userId,
  });
}

export async function saisirHeures(employeeId: string, date: string, heures: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  await appliquerHeures(employeeId, date, heures, user.id);

  revalidatePath("/presences"); // la grille fusionnée « Présences & heures » vit sur /presences
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
}

/** Saisie en lot (collage / actions groupées). Ne reçoivent pas d'heures (entrée ignorée et
 * renvoyée à l'appelant) : les jours couverts par un congé APPROUVÉ, et les jours de REPOS
 * selon le modèle hebdo (la saisie unitaire reste libre). L'effacement reste permis partout. */
export async function saisirHeuresEnLot(
  entrees: { employeeId: string; date: string; heures: string }[]
): Promise<{ ignores: { employeeId: string; date: string }[] }> {
  const user: CurrentUser = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const [enConge, repos] = await Promise.all([joursEnConge(entrees), joursDeReposSelonModele(entrees)]);
  const ignores: { employeeId: string; date: string }[] = [];
  for (const { employeeId, date, heures } of entrees) {
    const valeur = Number(heures);
    if (heures !== "" && valeur > 0 && (enConge.has(`${employeeId}|${date}`) || repos.has(`${employeeId}|${date}`))) { ignores.push({ employeeId, date }); continue; }
    await appliquerHeures(employeeId, date, heures, user.id);
  }

  revalidatePath("/presences"); // la grille fusionnée « Présences & heures » vit sur /presences
  revalidatePath("/heures-supp");
  revalidatePath("/employes");
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
  return { ignores };
}

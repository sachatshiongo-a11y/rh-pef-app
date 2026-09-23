"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { dateDuJourKinshasa, heuresNettes } from "@/lib/pointage-jour";
import { appliquerAuxPresences, employeLieAuCompte, refusSiPaieValideeOuConge } from "@/lib/pointage-presences";

export type ResultatPointage = { ok: boolean; message?: string };

/** Exécute une action de pointage en renvoyant un résultat clair (les messages lancés restent lisibles en prod). */
async function tenter(fn: () => Promise<void>): Promise<ResultatPointage> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Une erreur est survenue." };
  }
}

/** L'employé lié au compte connecté (le pointage est TOUJOURS pour soi-même). */
async function moiEmploye() {
  const user = await verifySession();
  return { userId: user.id, employeeId: await employeLieAuCompte(prisma, user.id) };
}

/** Pointer l'arrivée (une fois par jour). */
export async function pointerArrivee(): Promise<ResultatPointage> {
  return tenter(async () => {
    const { userId, employeeId } = await moiEmploye();
    const now = new Date();
    const date = dateDuJourKinshasa(now);

    await refusSiPaieValideeOuConge(prisma, employeeId, date);
    const deja = await prisma.pointage.findUnique({ where: { employeeId_date: { employeeId, date } } });
    if (deja) throw new Error("Vous avez déjà pointé votre arrivée aujourd'hui.");

    await prisma.pointage.create({ data: { employeeId, date, heureDebut: now, source: "APP", creeParId: userId } });
    revalidatePath("/pointer");
    revalidatePath("/espace/pointer");
  });
}

/** Pointer le départ + saisir sa pause → alimente Présences et Heures. */
export async function pointerDepart(formData: FormData): Promise<ResultatPointage> {
  return tenter(async () => {
    const { employeeId } = await moiEmploye();
    const pauseMinutes = Math.max(0, Math.min(600, Number(formData.get("pauseMinutes") ?? 0) || 0));
    const date = dateDuJourKinshasa();
    const p = await prisma.pointage.findUnique({ where: { employeeId_date: { employeeId, date } } });
    if (!p) throw new Error("Aucune arrivée pointée aujourd'hui.");
    if (p.heureFin) throw new Error("Vous avez déjà pointé votre départ aujourd'hui.");

    const fin = new Date();
    const heures = heuresNettes(p.heureDebut, fin, pauseMinutes);
    await prisma.pointage.update({ where: { id: p.id }, data: { heureFin: fin, pauseMinutes } });
    await appliquerAuxPresences(prisma, employeeId, date, heures);
    revalidatePath("/pointer");
    revalidatePath("/espace/pointer");
    revalidatePath("/presences");
    revalidatePath("/heures-supp");
    revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
  });
}

/** Ajouter (ou corriger) un horaire pour un jour, en cas d'oubli. */
export async function saisirHoraireManuel(formData: FormData): Promise<ResultatPointage> {
  return tenter(async () => {
    const { userId, employeeId } = await moiEmploye();
    const jour = String(formData.get("date") ?? "").trim();
    const hd = String(formData.get("heureDebut") ?? "").trim();
    const hf = String(formData.get("heureFin") ?? "").trim();
    const pauseMinutes = Math.max(0, Math.min(600, Number(formData.get("pauseMinutes") ?? 0) || 0));
    if (!jour || !hd || !hf) throw new Error("Renseignez la date, l'heure d'arrivée et l'heure de départ.");

    const date = new Date(`${jour}T00:00:00Z`); // jour choisi (DATE à minuit UTC, comme les présences)
    const debut = new Date(`${jour}T${hd}:00+01:00`); // heures saisies en heure de Kinshasa (UTC+1)
    const fin = new Date(`${jour}T${hf}:00+01:00`);
    if (Number.isNaN(date.getTime()) || Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()))
      throw new Error("Date ou heures invalides.");
    if (fin <= debut) throw new Error("L'heure de départ doit être après l'heure d'arrivée.");

    const heures = heuresNettes(debut, fin, pauseMinutes);
    await prisma.pointage.upsert({
      where: { employeeId_date: { employeeId, date } },
      update: { heureDebut: debut, heureFin: fin, pauseMinutes, source: "APP", creeParId: userId },
      create: { employeeId, date, heureDebut: debut, heureFin: fin, pauseMinutes, source: "APP", creeParId: userId },
    });
    await appliquerAuxPresences(prisma, employeeId, date, heures);
    revalidatePath("/pointer");
    revalidatePath("/espace/pointer");
    revalidatePath("/presences");
    revalidatePath("/heures-supp");
    revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
  });
}

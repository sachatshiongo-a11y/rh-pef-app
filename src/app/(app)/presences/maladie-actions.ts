"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliserPlusieurs } from "@/lib/audit";
import { televerserFichierEmploye } from "@/lib/fichiers-employe";
import { BulletinFigeError, exigerBulletinModifiable } from "@/lib/paie-element-fige";

// JOUR DE MALADIE JUSTIFIÉ — décision de la Direction du 2026-10-12, TOUT le personnel : un jour M
// justifié AU PRÉALABLE par un certificat médical est payé à 100 % ; sans justificatif, aux 2/3.
// L'indicateur se pose sur la présence du jour (unitaire ou en lot), le certificat est facultatif et
// rangé avec les documents du salarié (bucket privé « employes », type CERTIFICAT_MEDICAL).
// Chaque changement est tracé au journal : il change un montant de paie. Un jour d'un mois dont le
// bulletin du salarié est déjà VALIDÉ ou PAYÉ est refusé (rouvrir le bulletin d'abord) : le bulletin
// figé ne se recalcule pas, l'indicateur changerait sans effet sur ce qui a été payé.

/** Refuse si l'un des (salarié, mois) concernés a un bulletin figé — tout ou rien. */
async function exigerBulletinsModifiables(tx: Parameters<typeof exigerBulletinModifiable>[0], cases: { employeeId: string; date: string }[]): Promise<void> {
  const vus = new Set<string>();
  for (const c of [...cases].sort((a, b) => `${a.employeeId}|${a.date}`.localeCompare(`${b.employeeId}|${b.date}`))) {
    const [annee, mois] = c.date.split("-").map(Number);
    const cle = `${c.employeeId}|${annee}-${mois}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    await exigerBulletinModifiable(tx, { employeeId: c.employeeId, mois, annee });
  }
}

const datePure = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function revalider() {
  revalidatePath("/presences");
  revalidatePath("/paie"); // les bulletins non figés se recalculent au prochain affichage
  revalidatePath("/employes");
}

export type ResultatMaladie = { message?: string; erreur?: string };

/**
 * Marque (ou démarque) des jours M comme justifiés. Seules les présences portant le code M sont
 * touchées : les autres cases de la sélection sont ignorées, et le compte rendu le dit.
 */
export async function marquerMaladieJustifiee(
  cases: { employeeId: string; date: string }[],
  justifiee: boolean,
): Promise<ResultatMaladie> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  if (cases.length === 0) return { message: "Aucune case sélectionnée." };
  const presences = await prisma.attendance.findMany({
    where: { OR: cases.map((c) => ({ employeeId: c.employeeId, date: datePure(c.date) })) },
    select: { id: true, employeeId: true, date: true, code: true, maladieJustifiee: true },
  });
  const maladie = presences.filter((p) => p.code === "M");
  const aChanger = maladie.filter((p) => p.maladieJustifiee !== justifiee);
  try {
    await prisma.$transaction(async (tx) => {
      await exigerBulletinsModifiables(tx, aChanger.map((p) => ({ employeeId: p.employeeId, date: new Date(p.date).toISOString().slice(0, 10) })));
      if (aChanger.length === 0) return;
      await tx.attendance.updateMany({ where: { id: { in: aChanger.map((p) => p.id) } }, data: { maladieJustifiee: justifiee } });
      await journaliserPlusieurs(tx, aChanger.map((p) => ({
        entite: "Attendance", entiteId: p.id, champ: "maladieJustifiee",
        ancienneValeur: String(!justifiee), nouvelleValeur: String(justifiee), userId: user.id,
      })));
    });
  } catch (e) {
    if (e instanceof BulletinFigeError) return { erreur: e.message };
    throw e;
  }
  revalider();
  const ignorees = cases.length - maladie.length;
  const etat = justifiee ? "justifié(s) — payé(s) 100 %" : "non justifié(s) — payé(s) aux 2/3";
  return {
    message: `${aChanger.length} jour(s) de maladie ${etat}${maladie.length > aChanger.length ? ` ; ${maladie.length - aChanger.length} déjà dans cet état` : ""}${ignorees > 0 ? ` ; ${ignorees} case(s) ignorée(s) (pas de code M)` : ""}.`,
  };
}

/**
 * Joint un certificat médical au jour M (facultatif) : le fichier va dans le dossier du salarié
 * (documents, type CERTIFICAT_MEDICAL) et le jour passe « justifié ».
 */
export async function joindreCertificatMaladie(formData: FormData): Promise<ResultatMaladie> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const employeeId = String(formData.get("employeeId") ?? "");
  const date = String(formData.get("date") ?? "");
  const fichier = formData.get("fichier");
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { erreur: "Jour introuvable." };
  if (!(fichier instanceof File) || fichier.size === 0) return { erreur: "Choisissez le certificat à joindre." };
  const presence = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: datePure(date) } }, select: { id: true, code: true, maladieJustifiee: true } });
  if (!presence || presence.code !== "M") return { erreur: "Un certificat se joint à un jour de maladie (code M) : posez d'abord le code M." };
  // Bulletin figé : refusé AVANT de téléverser (rien ne reste dans le stockage pour un geste refusé).
  try {
    await exigerBulletinModifiable(prisma, { employeeId, mois: Number(date.slice(5, 7)), annee: Number(date.slice(0, 4)) });
  } catch (e) {
    if (e instanceof BulletinFigeError) return { erreur: e.message };
    throw e;
  }
  let url: string;
  try {
    url = await televerserFichierEmploye(employeeId, fichier, "certificats");
  } catch (e) {
    return { erreur: (e as Error).message };
  }
  try {
  await prisma.$transaction(async (tx) => {
    // Revérifié sous verrou : une validation survenue pendant le téléversement l'emporte.
    await exigerBulletinModifiable(tx, { employeeId, mois: Number(date.slice(5, 7)), annee: Number(date.slice(0, 4)) });
    await tx.attendance.update({ where: { id: presence.id }, data: { maladieJustifiee: true, justificatifUrl: url } });
    await tx.documentEmploye.create({
      data: { employeeId, type: "CERTIFICAT_MEDICAL", nom: `Certificat médical — ${date.split("-").reverse().join("/")}`, fichierUrl: url, dateEmission: datePure(date), importeParId: user.id },
    });
    await journaliserPlusieurs(tx, [{
      entite: "Attendance", entiteId: presence.id, champ: "justificatifUrl",
      ancienneValeur: presence.maladieJustifiee ? "justifié" : "non justifié", nouvelleValeur: `justifié — certificat ${url}`, userId: user.id,
    }]);
  });
  } catch (e) {
    if (e instanceof BulletinFigeError) return { erreur: e.message };
    throw e;
  }
  revalider();
  return { message: "Certificat joint : le jour de maladie est justifié (payé 100 %)." };
}

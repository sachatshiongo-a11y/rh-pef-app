"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliserPlusieurs } from "@/lib/audit";
import { televerserFichierEmploye } from "@/lib/fichiers-employe";

// JOUR DE MALADIE JUSTIFIÉ — décision de la Direction du 2026-10-12, TOUT le personnel : un jour M
// justifié AU PRÉALABLE par un certificat médical est payé à 100 % ; sans justificatif, aux 2/3.
// L'indicateur se pose sur la présence du jour (unitaire ou en lot), le certificat est facultatif et
// rangé avec les documents du salarié (bucket privé « employes », type CERTIFICAT_MEDICAL).
// Chaque changement est tracé au journal : il change un montant de paie.

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
    select: { id: true, code: true, maladieJustifiee: true },
  });
  const maladie = presences.filter((p) => p.code === "M");
  const aChanger = maladie.filter((p) => p.maladieJustifiee !== justifiee);
  await prisma.$transaction(async (tx) => {
    if (aChanger.length > 0) {
      await tx.attendance.updateMany({ where: { id: { in: aChanger.map((p) => p.id) } }, data: { maladieJustifiee: justifiee } });
      await journaliserPlusieurs(tx, aChanger.map((p) => ({
        entite: "Attendance", entiteId: p.id, champ: "maladieJustifiee",
        ancienneValeur: String(!justifiee), nouvelleValeur: String(justifiee), userId: user.id,
      })));
    }
  });
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
  let url: string;
  try {
    url = await televerserFichierEmploye(employeeId, fichier, "certificats");
  } catch (e) {
    return { erreur: (e as Error).message };
  }
  await prisma.$transaction(async (tx) => {
    await tx.attendance.update({ where: { id: presence.id }, data: { maladieJustifiee: true, justificatifUrl: url } });
    await tx.documentEmploye.create({
      data: { employeeId, type: "CERTIFICAT_MEDICAL", nom: `Certificat médical — ${date.split("-").reverse().join("/")}`, fichierUrl: url, dateEmission: datePure(date), importeParId: user.id },
    });
    await journaliserPlusieurs(tx, [{
      entite: "Attendance", entiteId: presence.id, champ: "justificatifUrl",
      ancienneValeur: presence.maladieJustifiee ? "justifié" : "non justifié", nouvelleValeur: `justifié — certificat ${url}`, userId: user.id,
    }]);
  });
  revalider();
  return { message: "Certificat joint : le jour de maladie est justifié (payé 100 %)." };
}

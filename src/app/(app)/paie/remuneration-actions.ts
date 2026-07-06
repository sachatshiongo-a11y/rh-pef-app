"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { creerNotification } from "@/lib/notifications";

async function periodeCourante() {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  return {
    mois: config?.moisCourant ?? new Date().getMonth() + 1,
    annee: config?.anneeCourante ?? new Date().getFullYear(),
  };
}

/** Applique une prime à un employé pour la période en cours (répercutée au calcul de la paie). */
export async function ajouterPrime(employeeId: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const nom = String(formData.get("nom") ?? "").trim() || "Prime";
  const montantUSD = Number(formData.get("montantUSD"));
  if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant de prime invalide.");
  const { mois, annee } = await periodeCourante();

  await prisma.prime.create({
    data: { employeeId, nom, montantUSD, mois, annee, creeParId: user.id },
  });
  await journaliser(prisma, {
    entite: "Prime",
    entiteId: employeeId,
    champ: "ajout",
    nouvelleValeur: `${nom} : ${montantUSD} $ (${mois}/${annee})`,
    userId: user.id,
  });
  revalidatePath(`/employes/${employeeId}`);
  revalidatePath("/paie");
}

export async function supprimerPrime(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const prime = await prisma.prime.findUnique({ where: { id } });
  if (!prime) return;
  await prisma.prime.delete({ where: { id } });
  await journaliser(prisma, {
    entite: "Prime",
    entiteId: prime.employeeId,
    champ: "suppression",
    ancienneValeur: `${prime.nom} : ${Number(prime.montantUSD)} $`,
    userId: user.id,
  });
  revalidatePath(`/employes/${prime.employeeId}`);
  revalidatePath("/paie");
}

/** Demande d'acompte sur salaire (à approuver dans les Demandes de validation). */
export async function demanderAcompte(employeeId: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const montantUSD = Number(formData.get("montantUSD"));
  if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant d'acompte invalide.");
  const motif = String(formData.get("motif") ?? "").trim() || null;
  const { mois, annee } = await periodeCourante();

  await prisma.acompteSalaire.create({
    data: { employeeId, montantUSD, mois, annee, motif, statut: "EN_ATTENTE" },
  });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
  await creerNotification({
    type: "ACOMPTE",
    message: `Nouvelle demande d'acompte — ${emp?.nom ?? "employé"}, ${montantUSD.toFixed(2)} $.`,
    lien: "/a-valider",
  });

  revalidatePath(`/employes/${employeeId}`);
  revalidatePath("/a-valider");
  revalidatePath("/", "layout");
}

async function deciderAcompte(id: string, statut: "APPROUVE" | "REFUSE") {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const a = await prisma.acompteSalaire.findUnique({ where: { id } });
  if (!a || a.statut !== "EN_ATTENTE") return;
  await prisma.acompteSalaire.update({
    where: { id },
    data: { statut, decideParId: user.id, dateDecision: new Date() },
  });
  await journaliser(prisma, {
    entite: "AcompteSalaire",
    entiteId: a.employeeId,
    champ: "statut",
    nouvelleValeur: `${statut} — ${Number(a.montantUSD)} $ (${a.mois}/${a.annee})`,
    userId: user.id,
  });
  revalidatePath("/a-valider");
  revalidatePath(`/employes/${a.employeeId}`);
  revalidatePath("/paie");
}

export async function approuverAcompte(id: string) {
  await deciderAcompte(id, "APPROUVE");
}
export async function refuserAcompte(id: string) {
  await deciderAcompte(id, "REFUSE");
}

/** Actions groupées sur les demandes d'acompte (mêmes règles que l'individuel). */
async function deciderAcomptesEnLot(ids: string[], statut: "APPROUVE" | "REFUSE"): Promise<number> {
  let n = 0;
  for (const id of ids) {
    await deciderAcompte(id, statut);
    n++;
  }
  return n;
}
export async function approuverAcomptesEnLot(ids: string[]): Promise<number> {
  return deciderAcomptesEnLot(ids, "APPROUVE");
}
export async function refuserAcomptesEnLot(ids: string[]): Promise<number> {
  return deciderAcomptesEnLot(ids, "REFUSE");
}

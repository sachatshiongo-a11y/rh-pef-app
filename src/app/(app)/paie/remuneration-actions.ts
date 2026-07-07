"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { recalculerPaieSiCalculee } from "./actions";

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
  await recalculerPaieSiCalculee(); // répercute la prime sur le bulletin déjà calculé (non figé)
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
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${prime.employeeId}`);
  revalidatePath("/paie");
}

/** Supprime un acompte (réservé ADMIN). Tracé au journal d'audit. */
export async function supprimerAcompte(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const acompte = await prisma.acompteSalaire.findUnique({ where: { id } });
  if (!acompte) return;
  await prisma.acompteSalaire.delete({ where: { id } });
  await journaliser(prisma, {
    entite: "Acompte",
    entiteId: acompte.employeeId,
    champ: "suppression",
    ancienneValeur: `${acompte.mois}/${acompte.annee} : ${Number(acompte.montantUSD)} $`,
    userId: user.id,
  });
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${acompte.employeeId}`);
  revalidatePath("/paie");
}

/** Téléverse un certificat vers Supabase Storage (bucket employes, préfixe certificats/). */
async function televerserCertificat(employeeId: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!["pdf", "png", "jpg", "jpeg", "webp"].includes(ext)) throw new Error("Certificat : PDF ou image uniquement.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Fichier trop lourd (max 15 Mo).");
  const path = `certificats/${employeeId}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/employes/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error("Échec du téléversement du certificat.");
  return `${base}/storage/v1/object/public/employes/${path}`;
}

/** Ajoute un frais médical (avec certificat) pour la période en cours. Répercuté au calcul de la paie. */
export async function ajouterFraisMedical(employeeId: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const montantUSD = Number(formData.get("montantUSD"));
  if (!Number.isFinite(montantUSD) || montantUSD <= 0) throw new Error("Montant de frais médical invalide.");
  const motif = String(formData.get("motif") ?? "").trim() || null;
  const { mois, annee } = await periodeCourante();

  let certificatUrl: string | null = null;
  const fichier = formData.get("certificat");
  if (fichier instanceof File && fichier.size > 0) certificatUrl = await televerserCertificat(employeeId, fichier);

  await prisma.fraisMedical.create({ data: { employeeId, montantUSD, mois, annee, motif, certificatUrl, creeParId: user.id } });
  await journaliser(prisma, {
    entite: "FraisMedical",
    entiteId: employeeId,
    champ: "ajout",
    nouvelleValeur: `${montantUSD} $ (${mois}/${annee})${certificatUrl ? " + certificat" : ""}`,
    userId: user.id,
  });
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${employeeId}`);
  revalidatePath("/paie");
}

export async function supprimerFraisMedical(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const fm = await prisma.fraisMedical.findUnique({ where: { id } });
  if (!fm) return;
  await prisma.fraisMedical.delete({ where: { id } });
  await journaliser(prisma, { entite: "FraisMedical", entiteId: fm.employeeId, champ: "suppression", ancienneValeur: `${Number(fm.montantUSD)} $`, userId: user.id });
  await recalculerPaieSiCalculee();
  revalidatePath(`/employes/${fm.employeeId}`);
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

  const acompte = await prisma.acompteSalaire.create({
    data: { employeeId, montantUSD, mois, annee, motif, statut: "EN_ATTENTE" },
  });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
  await creerNotification({
    type: "ACOMPTE",
    message: `Nouvelle demande d'acompte — ${emp?.nom ?? "employé"}, ${montantUSD.toFixed(2)} $.`,
    lien: "/a-valider",
    refId: acompte.id,
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
  await supprimerNotificationsPour(id);
  // Un acompte APPROUVÉ est déduit du net → recalculer le bulletin déjà calculé (non figé).
  if (statut === "APPROUVE") await recalculerPaieSiCalculee();
  revalidatePath("/a-valider");
  revalidatePath(`/employes/${a.employeeId}`);
  revalidatePath("/paie");
  revalidatePath("/", "layout");
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

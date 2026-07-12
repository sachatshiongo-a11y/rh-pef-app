"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { genererMatricule } from "@/lib/matricule";

function decimalField(formData: FormData, name: string): number {
  const raw = formData.get(name);
  return raw ? Number(raw) : 0;
}

function toEmployeeInput(formData: FormData) {
  return {
    matricule: String(formData.get("matricule") ?? "").trim(),
    nom: String(formData.get("nom") ?? "").trim(),
    sexe: String(formData.get("sexe") ?? ""),
    etatCivil: String(formData.get("etatCivil") ?? ""),
    poste: String(formData.get("poste") ?? ""),
    secteur: String(formData.get("secteur") ?? ""),
    categorie: String(formData.get("categorie") ?? "BRIGADE") as "BRIGADE" | "BACKOFFICE",
    categorieProfessionnelle: String(formData.get("categorieProfessionnelle") ?? "").trim() || null,
    salaireMensuel: decimalField(formData, "salaireMensuel"),
    transportJourCDF: decimalField(formData, "transportJourCDF"),
    transportMoisCDF: decimalField(formData, "transportMoisCDF"),
    transportMoisUSD: decimalField(formData, "transportMoisUSD"),
    cnssMontant: decimalField(formData, "cnssMontant"),
    enfants: Math.round(decimalField(formData, "enfants")),
    type: String(formData.get("type") ?? "NATIONAL") as "NATIONAL" | "EXPATRIE",
    dateEmbauche: new Date(String(formData.get("dateEmbauche"))),
    contrat: String(formData.get("contrat") ?? ""),
    heuresParJour: decimalField(formData, "heuresParJour") || 8,
    heuresHebdomadaires: decimalField(formData, "heuresHebdomadaires") || 48,
    fraisMedicauxMoisCourant: decimalField(formData, "fraisMedicauxMoisCourant"),
    idExterneIVMS: String(formData.get("idExterneIVMS") ?? "").trim() || null,
    dateNaissance: String(formData.get("dateNaissance") ?? "").trim()
      ? new Date(String(formData.get("dateNaissance")))
      : null,
    telephone: String(formData.get("telephone") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    adresse: String(formData.get("adresse") ?? "").trim() || null,
    banque: String(formData.get("banque") ?? "").trim() || null,
    compteBancaire: String(formData.get("compteBancaire") ?? "").trim() || null,
    mobileMoney: String(formData.get("mobileMoney") ?? "").trim() || null,
    modePaiement: (["ESPECES", "VIREMENT", "MOBILE_MONEY"].includes(String(formData.get("modePaiement")))
      ? String(formData.get("modePaiement"))
      : "ESPECES") as "ESPECES" | "VIREMENT" | "MOBILE_MONEY",
  };
}

export async function creerEmploye(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const data = toEmployeeInput(formData);
  // Matricule auto-généré si laissé vide, selon la logique de la catégorie (brigade / back-office).
  if (!data.matricule) {
    const existants = await prisma.employee.findMany({
      where: { categorie: data.categorie },
      select: { matricule: true },
    });
    data.matricule = genererMatricule(data.nom, data.categorie, existants.map((e) => e.matricule));
  }

  await prisma.employee.create({ data });

  revalidatePath("/employes");
  redirect("/employes");
}

export async function modifierEmploye(employeeId: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  await prisma.employee.update({
    where: { id: employeeId },
    data: toEmployeeInput(formData),
  });

  revalidatePath("/employes");
  redirect("/employes");
}

export async function desactiverEmploye(employeeId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.employee.update({ where: { id: employeeId }, data: { actif: false } });

  revalidatePath("/employes");
  redirect("/employes");
}

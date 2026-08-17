"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { genererMatricule } from "@/lib/matricule";
import { journaliser } from "@/lib/audit";
import { formulaireLisible } from "@/lib/erreur-formulaire";

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

  const nouvel = await prisma.employee.create({ data });

  // Checklist d'intégration : copie du modèle d'onboarding pour le nouvel employé.
  const modeleOnboarding = await prisma.modeleTacheOnboarding.findMany({ orderBy: { ordre: "asc" } });
  if (modeleOnboarding.length > 0) {
    await prisma.tacheOnboarding.createMany({
      data: modeleOnboarding.map((m) => ({ employeeId: nouvel.id, libelle: m.libelle, ordre: m.ordre })),
    });
  }

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

/**
 * Ajoute un membre à la composition familiale (conjoint ou enfant).
 * NE TOUCHE PAS au compteur `Employee.enfants` qui pilote la paie : la fiche nominative est un
 * justificatif, l'écart éventuel est signalé sur la fiche et tranché par la Direction.
 */
export async function ajouterMembreFamille(employeeId: string, formData: FormData) {
  await formulaireLisible(`/employes/${employeeId}`, async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const lien = String(formData.get("lien") ?? "ENFANT") as "CONJOINT" | "ENFANT";
    if (lien !== "CONJOINT" && lien !== "ENFANT") throw new Error("Lien de parenté invalide.");
    const nom = String(formData.get("nom") ?? "").trim();
    if (!nom) throw new Error("Indiquez le nom du membre de la famille.");

    const brut = String(formData.get("dateNaissance") ?? "").trim();
    if (brut && !/^\d{4}-\d{2}-\d{2}$/.test(brut)) throw new Error("Date de naissance invalide.");
    // Date pure (colonne DATE) : construite en UTC pour ne pas glisser d'un jour selon le fuseau.
    const dateNaissance = brut ? new Date(brut + "T00:00:00.000Z") : null;
    if (dateNaissance && dateNaissance > new Date()) {
      throw new Error("La date de naissance ne peut pas être dans le futur.");
    }

    // Un seul conjoint : remplacer plutôt qu'empiler des lignes contradictoires.
    if (lien === "CONJOINT") {
      await prisma.membreFamille.deleteMany({ where: { employeeId, lien: "CONJOINT" } });
    }

    await prisma.membreFamille.create({
      data: { employeeId, lien, nom, dateNaissance, creeParId: user.id },
    });
    await journaliser(prisma, {
      entite: "MembreFamille",
      entiteId: employeeId,
      champ: "ajout",
      nouvelleValeur: `${lien === "CONJOINT" ? "Conjoint" : "Enfant"} : ${nom}${brut ? ` (né(e) le ${brut})` : " (sans date de naissance)"}`,
      userId: user.id,
    });

    revalidatePath(`/employes/${employeeId}`);
  });
}

/** Retire un membre de la composition familiale. Tracé au journal d'audit. */
export async function supprimerMembreFamille(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const membre = await prisma.membreFamille.findUnique({ where: { id } });
  if (!membre) return;
  await prisma.membreFamille.delete({ where: { id } });
  await journaliser(prisma, {
    entite: "MembreFamille",
    entiteId: membre.employeeId,
    champ: "suppression",
    ancienneValeur: `${membre.lien === "CONJOINT" ? "Conjoint" : "Enfant"} : ${membre.nom}`,
    userId: user.id,
  });

  revalidatePath(`/employes/${membre.employeeId}`);
}

export async function desactiverEmploye(employeeId: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.employee.update({ where: { id: employeeId }, data: { actif: false } });

  revalidatePath("/employes");
  redirect("/employes");
}

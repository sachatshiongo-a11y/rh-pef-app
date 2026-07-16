"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";

/** Paramètres opérationnels (non légaux) : taux de change et période courante. */
export async function mettreAJourConfig(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.config.update({
    where: { id: "singleton" },
    data: {
      tauxChangeCDF: Number(formData.get("tauxChangeCDF")),
      anneeCourante: Number(formData.get("anneeCourante")),
      moisCourant: Number(formData.get("moisCourant")),
      jourPaie: Math.min(31, Math.max(1, Math.trunc(Number(formData.get("jourPaie"))) || 30)),
    },
  });

  revalidatePath("/parametres");
  revalidatePath("/accueil");
}

/** Active / désactive l'espace salarié (self-service). Réservé à l'ADMIN. OFF par défaut. */
export async function basculerEspaceEmploye(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const actif = String(formData.get("actif")) === "1";
  await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: actif } });
  revalidatePath("/parametres");
  revalidatePath("/", "layout");
}

/**
 * Paramètres légaux versionnés — modification réservée à l'ADMIN (le directeur).
 * Toute modification remet le statut à « À VALIDER » sauf validation explicite.
 */
export async function mettreAJourParametreLegal(id: number, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const valeurRaw = String(formData.get("valeur") ?? "").trim();
  const valider = formData.get("valider") === "on";

  await prisma.parametreLegal.update({
    where: { id },
    data: {
      valeur: valeurRaw === "" ? null : Number(valeurRaw.replace(",", ".")),
      statutValidation: valider ? "VALIDE" : "A_VALIDER",
    },
  });

  revalidatePath("/parametres");
}

export async function mettreAJourTrancheIprCDF(id: number, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const plafondRaw = String(formData.get("plafondAnnuelCDF") ?? "").trim();
  const valider = formData.get("valider") === "on";

  await prisma.trancheIprCDF.update({
    where: { id },
    data: {
      plafondAnnuelCDF: plafondRaw === "" ? null : Number(plafondRaw.replace(",", ".")),
      taux: Number(String(formData.get("taux")).replace(",", ".")),
      statutValidation: valider ? "VALIDE" : "A_VALIDER",
    },
  });

  revalidatePath("/parametres");
}

export async function ajouterJourFerie(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const date = new Date(String(formData.get("date")));
  const designation = String(formData.get("designation"));

  await prisma.jourFerie.create({
    data: { date, designation, annee: date.getFullYear() },
  });

  revalidatePath("/parametres");
}

export async function supprimerJourFerie(id: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.jourFerie.delete({ where: { id } });
  revalidatePath("/parametres");
}
